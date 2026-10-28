"""
Vercel Serverless Function: TubeRadar API 키 발급/조회/폐기

- POST   /api/keys   {idToken, name?}        → 새 키 발급 (평문은 이 응답에서 단 한 번만 반환)
- GET    /api/keys?idToken=...              → 내 키 목록 (접두어·이름·생성일·오늘 사용량·폐기 여부)
- DELETE /api/keys   {idToken, keyId}        → 키 폐기

인증: 프론트가 Firebase 로그인 ID 토큰을 보내면 identitytoolkit 으로 검증한다.
권한: role == admin 이거나 status 가 gold/platinum 이고 만료되지 않은 회원만 발급 가능.
저장: Firestore `api_keys/{sha256(key)}` — 평문 키는 저장하지 않는다.

필요 환경변수: FIREBASE_SERVICE_ACCOUNT, VITE_FIREBASE_API_KEY (ID 토큰 검증용 공개 웹 키)
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
import hashlib
import json
import os
import secrets

import requests

MAX_KEYS_PER_USER = 5
DAILY_CALL_LIMIT = 300


# ---------------------------------------------------------------- Firestore REST (자립형)

def _get_access_token(sa_info: dict) -> str:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    creds = service_account.Credentials.from_service_account_info(
        sa_info, scopes=["https://www.googleapis.com/auth/datastore"]
    )
    creds.refresh(Request())
    return creds.token


def _fs_encode(value):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [_fs_encode(v) for v in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {k: _fs_encode(v) for k, v in value.items()}}}
    raise TypeError(f"unsupported type: {type(value)}")


def _fs_decode(field):
    for k in ("nullValue", "booleanValue", "stringValue", "doubleValue"):
        if k in field:
            return None if k == "nullValue" else field[k]
    if "integerValue" in field:
        return int(field["integerValue"])
    if "arrayValue" in field:
        return [_fs_decode(v) for v in field["arrayValue"].get("values", [])]
    if "mapValue" in field:
        return {k: _fs_decode(v) for k, v in field["mapValue"].get("fields", {}).items()}
    return None


class Firestore:
    def __init__(self, sa_info: dict):
        self.project = sa_info["project_id"]
        self.token = _get_access_token(sa_info)
        self.base = f"https://firestore.googleapis.com/v1/projects/{self.project}/databases/(default)/documents"

    def _h(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def get(self, path: str):
        r = requests.get(f"{self.base}/{path}", headers=self._h(), timeout=15)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return {k: _fs_decode(v) for k, v in r.json().get("fields", {}).items()}

    def set(self, path: str, data: dict):
        body = {"fields": {k: _fs_encode(v) for k, v in data.items()}}
        r = requests.patch(f"{self.base}/{path}", headers=self._h(), json=body, timeout=15)
        r.raise_for_status()

    def update_fields(self, path: str, data: dict):
        mask = "&".join(f"updateMask.fieldPaths={k}" for k in data.keys())
        body = {"fields": {k: _fs_encode(v) for k, v in data.items()}}
        r = requests.patch(f"{self.base}/{path}?{mask}", headers=self._h(), json=body, timeout=15)
        r.raise_for_status()

    def query_keys_by_uid(self, uid: str) -> list[dict]:
        body = {"structuredQuery": {
            "from": [{"collectionId": "api_keys"}],
            "where": {"fieldFilter": {"field": {"fieldPath": "uid"}, "op": "EQUAL", "value": {"stringValue": uid}}},
            "limit": 50,
        }}
        r = requests.post(f"https://firestore.googleapis.com/v1/projects/{self.project}/databases/(default)/documents:runQuery",
                          headers=self._h(), json=body, timeout=15)
        r.raise_for_status()
        out = []
        for row in r.json():
            d = row.get("document")
            if not d:
                continue
            doc = {k: _fs_decode(v) for k, v in d.get("fields", {}).items()}
            doc["id"] = d["name"].rsplit("/", 1)[-1]
            out.append(doc)
        return out


def _firestore() -> Firestore | None:
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
    if not raw:
        return None
    return Firestore(json.loads(raw.strip().lstrip("﻿").strip()))


# ---------------------------------------------------------------- 인증/권한

def verify_id_token(id_token: str) -> dict | None:
    web_key = os.environ.get("VITE_FIREBASE_API_KEY", "")
    if not id_token or not web_key:
        return None
    r = requests.post(f"https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={web_key}",
                      json={"idToken": id_token}, timeout=15)
    if not r.ok:
        return None
    users = r.json().get("users") or []
    if not users:
        return None
    return {"uid": users[0].get("localId"), "email": (users[0].get("email") or "").lower()}


def is_allowed(user_doc: dict | None) -> tuple[bool, str]:
    if not user_doc:
        return False, "회원 정보를 찾을 수 없습니다"
    if user_doc.get("role") == "admin":
        return True, ""
    status = str(user_doc.get("status") or "").lower()
    if status not in ("gold", "platinum"):
        return False, "API 연동은 골드 등급 이상 회원만 사용할 수 있습니다"
    exp = user_doc.get("expiresAt")
    if exp:
        try:
            if datetime.fromisoformat(str(exp).replace("Z", "+00:00")) < datetime.now(timezone.utc):
                return False, "멤버십이 만료되었습니다"
        except Exception:
            pass
    return True, ""


def _public_view(doc: dict) -> dict:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    usage = doc.get("usage") or {}
    return {
        "id": doc.get("id"),
        "name": doc.get("name") or "",
        "prefix": doc.get("prefix") or "",
        "createdAt": doc.get("createdAt"),
        "lastUsedAt": doc.get("lastUsedAt"),
        "revoked": bool(doc.get("revoked")),
        "todayCalls": int(usage.get(today, 0)),
        "dailyLimit": DAILY_CALL_LIMIT,
    }


# ---------------------------------------------------------------- handler

class handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except Exception:
            return {}

    def _ctx(self, id_token: str):
        """(fs, user, error_response) — 공통 인증·권한 처리"""
        fs = _firestore()
        if fs is None:
            return None, None, (503, {"error": "not_configured"})
        user = verify_id_token(id_token)
        if not user:
            return None, None, (401, {"error": "invalid_token", "message": "로그인이 필요합니다"})
        return fs, user, None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        params = parse_qs(urlparse(self.path).query)
        fs, user, err = self._ctx(params.get("idToken", [""])[0])
        if err:
            self._send(*err); return
        try:
            keys = sorted(fs.query_keys_by_uid(user["uid"]), key=lambda d: d.get("createdAt") or "", reverse=True)
            self._send(200, {"keys": [_public_view(k) for k in keys]})
        except Exception as e:
            self._send(500, {"error": str(e)[:200]})

    def do_POST(self):
        body = self._body()
        fs, user, err = self._ctx(body.get("idToken", ""))
        if err:
            self._send(*err); return
        try:
            user_doc = fs.get(f"users/{user['uid']}")
            ok, why = is_allowed(user_doc)
            if not ok:
                self._send(403, {"error": "forbidden", "message": why}); return
            active = [k for k in fs.query_keys_by_uid(user["uid"]) if not k.get("revoked")]
            if len(active) >= MAX_KEYS_PER_USER:
                self._send(400, {"error": "too_many_keys", "message": f"활성 키는 최대 {MAX_KEYS_PER_USER}개까지입니다. 사용하지 않는 키를 폐기해주세요."}); return
            key = "tr_" + secrets.token_hex(24)
            h = hashlib.sha256(key.encode()).hexdigest()
            now = datetime.now(timezone.utc).isoformat()
            name = str(body.get("name") or "").strip()[:40] or "기본 키"
            fs.set(f"api_keys/{h}", {
                "uid": user["uid"], "email": user["email"], "name": name,
                "prefix": key[:10] + "…" + key[-4:],
                "createdAt": now, "lastUsedAt": None, "revoked": False, "usage": {},
            })
            self._send(200, {"key": key, "id": h, "name": name, "prefix": key[:10] + "…" + key[-4:], "createdAt": now, "dailyLimit": DAILY_CALL_LIMIT})
        except Exception as e:
            self._send(500, {"error": str(e)[:200]})

    def do_DELETE(self):
        body = self._body()
        fs, user, err = self._ctx(body.get("idToken", ""))
        if err:
            self._send(*err); return
        key_id = str(body.get("keyId") or "")
        if not key_id:
            self._send(400, {"error": "missing_keyId"}); return
        try:
            doc = fs.get(f"api_keys/{key_id}")
            if not doc or doc.get("uid") != user["uid"]:
                self._send(404, {"error": "not_found"}); return
            fs.update_fields(f"api_keys/{key_id}", {"revoked": True, "revokedAt": datetime.now(timezone.utc).isoformat()})
            self._send(200, {"ok": True})
        except Exception as e:
            self._send(500, {"error": str(e)[:200]})
