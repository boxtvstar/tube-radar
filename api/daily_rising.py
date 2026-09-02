"""
Vercel Serverless Function: 채널 신규 발굴 일일 자동 갱신 (Vercel Cron 전용)

매일 1회 실행되어 YouTube 인기영상 기반으로 신규 채널을 발굴하고,
Firebase 누적 목록(system_data/rising_channels_accumulated)에 병합 저장한다.
이렇게 하면 방문자가 없어도 매일 새 채널이 쌓이고, 사이드바 배지가 갱신된다.

필요 환경변수 (실서비스 tube-radar 프로젝트):
- FIREBASE_SERVICE_ACCOUNT : Firebase 서비스 계정 JSON
- YOUTUBE_API_KEY          : YouTube Data API 키 (서버 발굴용)
- CRON_SECRET              : Vercel Cron 인증

환경변수가 없으면 아무 작업 없이 종료한다.
?dry=1 로 호출하면 Firebase에 쓰지 않고 발굴 결과 요약만 반환한다.
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import os
import time

import requests

# 발굴 로직은 기존 엔드포인트와 동일한 것을 재사용
from rising_channels import _discover

MAX_ACCUMULATED = 500


# ---------------------------------------------------------------- Firestore REST

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
    if "nullValue" in field:
        return None
    if "booleanValue" in field:
        return field["booleanValue"]
    if "integerValue" in field:
        return int(field["integerValue"])
    if "doubleValue" in field:
        return field["doubleValue"]
    if "stringValue" in field:
        return field["stringValue"]
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

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def get(self, path: str):
        r = requests.get(f"{self.base}/{path}", headers=self._headers(), timeout=15)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return {k: _fs_decode(v) for k, v in r.json().get("fields", {}).items()}

    def set(self, path: str, data: dict):
        body = {"fields": {k: _fs_encode(v) for k, v in data.items()}}
        r = requests.patch(f"{self.base}/{path}", headers=self._headers(), json=body, timeout=30)
        r.raise_for_status()


# ---------------------------------------------------------------- 병합 로직

def _to_saved(ch: dict, added_at: int) -> dict:
    """_discover 결과를 프론트가 읽는 AdminRisingChannel 형태로 변환"""
    return {
        "id": ch["id"],
        "title": ch.get("title", ""),
        "thumbnail": ch.get("thumbnail", ""),
        "subscriberCount": int(ch.get("subscriberCount") or 0),
        "videoCount": int(ch.get("videoCount") or 0),
        "totalViews": int(ch.get("totalViews") or 0),
        "avgViews": int(ch.get("avgViews") or 0),
        "joinDate": ch.get("joinDate", ""),
        "country": ch.get("country"),
        "addedAt": added_at,
        "topVideos": [
            {
                "videoId": v.get("videoId", ""),
                "title": v.get("title", ""),
                "thumbnail": v.get("thumbnail", ""),
                "views": int(v.get("views") or 0),
                "publishedAt": v.get("publishedAt", ""),
            }
            for v in ch.get("topVideos", [])
        ],
    }


def run(dry: bool) -> dict:
    sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
    if not sa_raw or not os.environ.get("YOUTUBE_API_KEY"):
        return {
            "skipped": True,
            "reason": "not configured",
            "has_firebase": bool(sa_raw),
            "has_youtube": bool(os.environ.get("YOUTUBE_API_KEY")),
        }

    # 서버 발굴 (YOUTUBE_API_KEY 환경변수 사용)
    discovered = _discover(os.environ["YOUTUBE_API_KEY"])
    if not discovered:
        return {"posted": False, "reason": "no channels discovered"}

    sa_info = json.loads(sa_raw.strip().lstrip("﻿").strip())
    fs = Firestore(sa_info)

    doc = fs.get("system_data/rising_channels_accumulated") or {}
    existing = doc.get("channels", [])
    existing_ids = {c.get("id") for c in existing}

    now_ms = int(time.time() * 1000)
    fresh = []
    for i, ch in enumerate(discovered):
        if ch["id"] in existing_ids:
            continue
        # 상위 채널이 배지/목록에서 위로 오도록 tiebreaker
        fresh.append(_to_saved(ch, now_ms + (1000 - i)))

    if not fresh:
        return {"posted": True, "dry": dry, "new": 0, "total": len(existing)}

    merged = fresh + existing
    merged = merged[:MAX_ACCUMULATED]

    if not dry:
        fs.set("system_data/rising_channels_accumulated", {
            "channels": merged,
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "count": len(merged),
        })

    return {
        "posted": True,
        "dry": dry,
        "new": len(fresh),
        "total": len(merged),
        "sample": [c["title"] for c in fresh[:5]],
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        dry = params.get("dry", ["0"])[0] == "1"

        secret = os.environ.get("CRON_SECRET", "")
        if secret and not dry:
            if self.headers.get("Authorization", "") != f"Bearer {secret}":
                self._send(401, {"error": "unauthorized"})
                return

        try:
            self._send(200, run(dry))
        except Exception as e:
            self._send(500, {"error": str(e)[:300]})

    def _send(self, status: int, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)
