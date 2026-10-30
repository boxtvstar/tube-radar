"""
Vercel Serverless Function: TubeRadar 공개 API + MCP 서버

한 파일이 세 가지 경로를 처리한다 (vercel.json rewrite 참고):
- POST /api/mcp            MCP Streamable HTTP (JSON-RPC 2.0): initialize / tools/list / tools/call
- POST /api/mcp/<key>      위와 같되 키를 경로로 전달 (claude.ai 커스텀 커넥터처럼 헤더를 못 붙이는 클라이언트용)
- GET  /api/v1/<tool>      같은 도구를 REST로 호출 (shorts | hot-posts | rising-channels)
- GET/POST/DELETE /api/keys   키 목록/발급/폐기 (프론트 전용, Firebase idToken) — Hobby 12함수 제한 때문에 여기 합쳐둠

인증: Authorization: Bearer <키>  또는  ?key=<키>  또는 경로 /api/mcp/<키>
키는 api/keys.py 에서 발급되며 Firestore `api_keys/{sha256}` 에 해시로만 저장된다.

필요 환경변수: FIREBASE_SERVICE_ACCOUNT, YOUTUBE_API_KEY
(없는 배포 — 테스트 프로젝트 — 에서는 503 not configured 를 돌려준다)
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import secrets
import time

import requests

PROTOCOL_VERSION = "2025-03-26"
SERVER_INFO = {"name": "tuberadar", "version": "1.0.0"}
DAILY_CALL_LIMIT = 300
MAX_KEYS_PER_USER = 5
SHORTS_CACHE_TTL = 3 * 3600
SHORTS_RESULT_LIMIT = 30

YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3"
SHORTS_CATEGORY_IDS = ["1", "2", "10", "15", "17", "19", "20", "22", "23", "24", "25", "26", "28"]
SHORTS_REGIONS = {"KR", "US", "JP", "GB", "FR", "ES", "DE"}
SHORTS_SEARCH_KEYWORD = {"KR": "쇼츠", "US": "shorts", "JP": "ショート", "GB": "shorts", "FR": "shorts", "ES": "shorts", "DE": "shorts"}
SHORTS_LANG = {"KR": "ko", "US": "en", "GB": "en", "JP": "ja", "FR": "fr", "ES": "es", "DE": "de"}
BLACKLIST_COUNTRIES = {"IN", "BR", "RU", "VN", "ID", "TH", "PH", "PK"}

_shorts_cache: dict[str, tuple[float, list]] = {}


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

    def update_fields(self, path: str, data: dict):
        """지정한 필드만 갱신 (updateMask) — 다른 필드는 보존"""
        mask = "&".join(f"updateMask.fieldPaths={k}" for k in data.keys())
        body = {"fields": {k: _fs_encode(v) for k, v in data.items()}}
        r = requests.patch(f"{self.base}/{path}?{mask}", headers=self._h(), json=body, timeout=15)
        r.raise_for_status()

    def set(self, path: str, data: dict):
        body = {"fields": {k: _fs_encode(v) for k, v in data.items()}}
        r = requests.patch(f"{self.base}/{path}", headers=self._h(), json=body, timeout=15)
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


_fs_singleton: Firestore | None = None
_fs_singleton_at: float = 0


def _firestore() -> Firestore | None:
    global _fs_singleton, _fs_singleton_at
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
    if not raw:
        return None
    # 액세스 토큰은 1시간 유효 — 50분마다 재발급
    if _fs_singleton is None or time.time() - _fs_singleton_at > 3000:
        _fs_singleton = Firestore(json.loads(raw.strip().lstrip("﻿").strip()))
        _fs_singleton_at = time.time()
    return _fs_singleton


# ---------------------------------------------------------------- API 키 검증

def _hash_key(key: str) -> str:
    return hashlib.sha256(key.strip().encode()).hexdigest()


def authenticate(key: str) -> tuple[dict | None, str]:
    """(key_doc, error). error 가 빈 문자열이면 성공."""
    if not key or not key.startswith("tr_") or len(key) < 20:
        return None, "invalid_key"
    fs = _firestore()
    if fs is None:
        return None, "not_configured"
    h = _hash_key(key)
    doc = fs.get(f"api_keys/{h}")
    if doc is None:
        return None, "invalid_key"
    if doc.get("revoked"):
        return None, "revoked"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    usage = doc.get("usage") or {}
    used = int(usage.get(today, 0))
    if used >= DAILY_CALL_LIMIT:
        return None, "rate_limited"
    # 사용량 기록 (같은 날 필드 +1, lastUsedAt 갱신) — 실패해도 호출은 허용
    try:
        fs.update_fields(f"api_keys/{h}", {
            "usage": {**{k: int(v) for k, v in usage.items() if k >= _days_ago(7)}, today: used + 1},
            "lastUsedAt": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass
    doc["_hash"] = h
    return doc, ""


def _days_ago(n: int) -> str:
    from datetime import timedelta
    return (datetime.now(timezone.utc) - timedelta(days=n)).strftime("%Y-%m-%d")


# ---------------------------------------------------------------- 도구 구현

def _yt(path: str, params: dict) -> dict:
    params["key"] = os.environ["YOUTUBE_API_KEY"]
    r = requests.get(f"{YOUTUBE_BASE}/{path}", params=params, timeout=15)
    data = r.json()
    if "error" in data:
        code = data["error"].get("code", 0)
        msg = str(data["error"].get("message", ""))
        if code == 404:
            return {"items": []}
        if code == 403 and "quota" in msg.lower():
            raise RuntimeError("QUOTA_EXCEEDED")
        return {"items": []}
    return data


def _duration_sec(iso: str | None) -> int:
    if not iso:
        return 0
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso)
    if not m:
        return 0
    h, mi, s = (int(x or 0) for x in m.groups())
    return h * 3600 + mi * 60 + s


def tool_trending_shorts(region: str = "KR", deep: bool = False, limit: int = SHORTS_RESULT_LIMIT) -> list[dict]:
    """클라이언트 autoDetectShortsChannels 와 같은 알고리즘. deep=True 면 검색 1회(100유닛) 추가."""
    region = (region or "KR").upper()
    if region not in SHORTS_REGIONS:
        region = "KR"
    ck = f"{region}:{int(deep)}"
    hit = _shorts_cache.get(ck)
    if hit and time.time() - hit[0] < SHORTS_CACHE_TTL:
        return hit[1][:limit]

    videos: list[dict] = []
    for cat in SHORTS_CATEGORY_IDS:
        try:
            d = _yt("videos", {"part": "snippet,contentDetails,statistics", "chart": "mostPopular",
                               "regionCode": region, "videoCategoryId": cat, "maxResults": 50})
            videos.extend(d.get("items", []))
        except RuntimeError:
            raise
        except Exception:
            continue

    if deep:
        try:
            from datetime import timedelta
            cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
            sp = {"part": "snippet", "type": "video", "videoDuration": "short", "maxResults": 50,
                  "order": "viewCount", "publishedAfter": cutoff, "regionCode": region,
                  "q": SHORTS_SEARCH_KEYWORD.get(region, "shorts"), "relevanceLanguage": SHORTS_LANG.get(region, "en")}
            sd = _yt("search", sp)
            ids = [it.get("id", {}).get("videoId") for it in sd.get("items", []) if it.get("id", {}).get("videoId")]
            if ids:
                dd = _yt("videos", {"part": "snippet,contentDetails,statistics", "id": ",".join(ids)})
                videos.extend(dd.get("items", []))
        except RuntimeError:
            raise
        except Exception:
            pass

    shorts = [v for v in videos if 0 < _duration_sec(v.get("contentDetails", {}).get("duration")) <= 60]
    now_ms = time.time() * 1000
    chan: dict[str, dict] = {}
    for v in shorts:
        sn, st = v.get("snippet", {}), v.get("statistics", {})
        cid = sn.get("channelId")
        if not cid:
            continue
        views = int(st.get("viewCount") or 0)
        try:
            pub = datetime.fromisoformat(sn.get("publishedAt", "").replace("Z", "+00:00")).timestamp() * 1000
        except Exception:
            pub = now_ms
        age_h = max((now_ms - pub) / 3_600_000, 1)
        fresh = max(0.0, 72 - age_h) / 72
        c = chan.get(cid)
        if c is None:
            chan[cid] = {"id": cid, "title": sn.get("channelTitle", ""), "total": views, "best": v, "n": 1, "fresh": fresh}
        else:
            c["total"] += views
            c["n"] += 1
            c["fresh"] = max(c["fresh"], fresh)
            if views > int(c["best"].get("statistics", {}).get("viewCount") or 0):
                c["best"] = v

    cands = sorted(chan.values(), key=lambda c: c["total"] * (1 + c["fresh"] * 0.35), reverse=True)[:100]
    if not cands:
        _shorts_cache[ck] = (time.time(), [])
        return []

    items: list[dict] = []
    ids = [c["id"] for c in cands]
    for i in range(0, len(ids), 50):
        try:
            d = _yt("channels", {"part": "snippet,statistics", "id": ",".join(ids[i:i + 50])})
            items.extend(d.get("items", []))
        except RuntimeError:
            raise
        except Exception:
            continue

    out: list[dict] = []
    for ch in items:
        sn, st = ch.get("snippet", {}), ch.get("statistics", {})
        subs = int(st.get("subscriberCount") or 0)
        country = sn.get("country")
        if subs < 100 or (country and country in BLACKLIST_COUNTRIES) or (country and country != region):
            continue
        c = chan.get(ch["id"])
        if not c:
            continue
        best = c["best"]
        bv = int(best.get("statistics", {}).get("viewCount") or 0)
        bt = best.get("snippet", {}).get("thumbnails", {})
        thumb = (bt.get("maxres") or bt.get("standard") or bt.get("high") or bt.get("medium") or bt.get("default") or {}).get("url", "")
        out.append({
            "channelId": ch["id"],
            "channelTitle": sn.get("title", ""),
            "channelUrl": f"https://www.youtube.com/channel/{ch['id']}",
            "subscribers": subs,
            "viralScore": round(bv / subs * 100, 1) if subs else 0,
            "avgRecentViews": round(c["total"] / c["n"]),
            "country": country,
            "representativeVideo": {
                "id": best.get("id"),
                "title": best.get("snippet", {}).get("title", ""),
                "url": f"https://www.youtube.com/shorts/{best.get('id')}",
                "views": bv,
                "publishedAt": best.get("snippet", {}).get("publishedAt"),
                "thumbnail": thumb,
            },
        })
    out.sort(key=lambda x: x["viralScore"], reverse=True)
    _shorts_cache[ck] = (time.time(), out)
    return out[:limit]


def _self_base(headers) -> str:
    """내부 도구가 자기 공개 엔드포인트를 부를 때 쓰는 기준 주소.
    PUBLIC_BASE_URL 환경변수가 있으면 그것을, 없으면 요청 Host를 쓴다 (로컬 테스트·프록시 뒤 배포 대비)."""
    fixed = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if fixed:
        return fixed
    host = headers.get("x-forwarded-host") or headers.get("host") or "www.tuberadar.kr"
    return f"https://{host}"


def tool_hot_posts(headers, source: str = "", limit: int = 50) -> dict:
    r = requests.get(f"{_self_base(headers)}/api/community/hot-posts", timeout=40)
    r.raise_for_status()
    d = r.json()
    posts = d.get("posts", [])
    if source:
        s = source.strip().lower()
        posts = [p for p in posts if s in str(p.get("source", "")).lower() or s == str(p.get("source_id", "")).lower()]
    slim = [{k: p.get(k) for k in ("rank", "title", "url", "source", "category", "view_count", "comment_count", "timestamp")} for p in posts[:limit]]
    return {"updated_at": d.get("updated_at"), "count": len(slim), "posts": slim}


def tool_rising_channels(headers, limit: int = 30) -> dict:
    r = requests.get(f"{_self_base(headers)}/api/rising-channels", timeout=60)
    r.raise_for_status()
    d = r.json()
    chs = d.get("channels", [])[:limit]
    slim = []
    for c in chs:
        slim.append({
            "channelId": c.get("id"), "title": c.get("title"),
            "channelUrl": f"https://www.youtube.com/channel/{c.get('id')}",
            "subscribers": c.get("subscriberCount"), "avgViews": c.get("avgViews"),
            "videoCount": c.get("videoCount"), "joinDate": c.get("joinDate"), "country": c.get("country"),
            "topVideos": [{"title": v.get("title"), "views": v.get("views"), "url": f"https://www.youtube.com/watch?v={v.get('videoId')}"} for v in (c.get("topVideos") or [])[:3]],
        })
    return {"updated_at": d.get("updated_at"), "count": len(slim), "channels": slim}


TOOLS = [
    {
        "name": "get_trending_shorts",
        "description": "오늘 뜨는 유튜브 쇼츠 채널을 찾는다. 인기 차트에서 60초 이하 영상을 모아 채널별로 묶고, 구독자 대비 조회수(viralScore)가 높은 순으로 돌려준다. region 은 KR/US/JP/GB/FR/ES/DE. deep=true 면 최근 7일 검색을 추가해 차트에 아직 안 오른 영상까지 본다(할당량 더 씀).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "region": {"type": "string", "enum": sorted(SHORTS_REGIONS), "default": "KR"},
                "deep": {"type": "boolean", "default": False},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
            },
        },
    },
    {
        "name": "get_community_hot_posts",
        "description": "디시·에펨·클리앙·네이트판 등 한국 커뮤니티 12곳의 실시간 인기 게시글. source 로 특정 커뮤니티만 거를 수 있다(예: '클리앙', 'dcinside'). 1시간 캐시.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "커뮤니티 이름 또는 id (비우면 전체)"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30},
            },
        },
    },
    {
        "name": "get_rising_channels",
        "description": "최근 1년 내 개설됐는데 평균 조회수가 높은 신규 급성장 유튜브 채널 목록(KR/JP/US 인기 차트 기반, 매일 갱신).",
        "inputSchema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}},
        },
    },
]


def run_tool(name: str, args: dict, headers) -> dict:
    if name == "get_trending_shorts":
        data = tool_trending_shorts(args.get("region", "KR"), bool(args.get("deep", False)), int(args.get("limit", 20)))
        return {"region": (args.get("region") or "KR").upper(), "count": len(data), "channels": data}
    if name == "get_community_hot_posts":
        return tool_hot_posts(headers, str(args.get("source", "") or ""), int(args.get("limit", 30)))
    if name == "get_rising_channels":
        return tool_rising_channels(headers, int(args.get("limit", 20)))
    raise KeyError(name)


REST_TOOL_BY_PATH = {"shorts": "get_trending_shorts", "hot-posts": "get_community_hot_posts", "rising-channels": "get_rising_channels"}


# ---------------------------------------------------------------- API 키 발급/조회/폐기 (/api/keys → ?path=keys)
# 프론트가 Firebase 로그인 ID 토큰을 보내면 identitytoolkit 으로 검증한다. API 키 인증과는 별개 경로.

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


def _public_key_view(doc: dict) -> dict:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    usage = doc.get("usage") or {}
    return {
        "id": doc.get("id"), "name": doc.get("name") or "", "prefix": doc.get("prefix") or "",
        "createdAt": doc.get("createdAt"), "lastUsedAt": doc.get("lastUsedAt"),
        "revoked": bool(doc.get("revoked")), "todayCalls": int(usage.get(today, 0)), "dailyLimit": DAILY_CALL_LIMIT,
    }


def keys_list(user: dict) -> tuple[int, dict]:
    fs = _firestore()
    keys = sorted(fs.query_keys_by_uid(user["uid"]), key=lambda d: d.get("createdAt") or "", reverse=True)
    return 200, {"keys": [_public_key_view(k) for k in keys]}


def keys_issue(user: dict, name: str) -> tuple[int, dict]:
    fs = _firestore()
    ok, why = is_allowed(fs.get(f"users/{user['uid']}"))
    if not ok:
        return 403, {"error": "forbidden", "message": why}
    active = [k for k in fs.query_keys_by_uid(user["uid"]) if not k.get("revoked")]
    if len(active) >= MAX_KEYS_PER_USER:
        return 400, {"error": "too_many_keys", "message": f"활성 키는 최대 {MAX_KEYS_PER_USER}개까지입니다. 사용하지 않는 키를 폐기해주세요."}
    key = "tr_" + secrets.token_hex(24)
    h = _hash_key(key)
    now = datetime.now(timezone.utc).isoformat()
    name = (name or "").strip()[:40] or "기본 키"
    prefix = key[:10] + "…" + key[-4:]
    fs.set(f"api_keys/{h}", {"uid": user["uid"], "email": user["email"], "name": name, "prefix": prefix,
                             "createdAt": now, "lastUsedAt": None, "revoked": False, "usage": {}})
    return 200, {"key": key, "id": h, "name": name, "prefix": prefix, "createdAt": now, "dailyLimit": DAILY_CALL_LIMIT}


def keys_revoke(user: dict, key_id: str) -> tuple[int, dict]:
    if not key_id:
        return 400, {"error": "missing_keyId"}
    fs = _firestore()
    doc = fs.get(f"api_keys/{key_id}")
    if not doc or doc.get("uid") != user["uid"]:
        return 404, {"error": "not_found"}
    fs.update_fields(f"api_keys/{key_id}", {"revoked": True, "revokedAt": datetime.now(timezone.utc).isoformat()})
    return 200, {"ok": True}


# ---------------------------------------------------------------- HTTP handler

def _rpc_error(id_, code, message):
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


class handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version")

    def _send(self, status: int, body=None):
        data = b"" if body is None else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self._cors()
        if data:
            self.send_header("Content-Type", "application/json")
        self.end_headers()
        if data:
            self.wfile.write(data)

    def _extract_key(self, params: dict) -> str:
        auth = self.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        if auth.lower().startswith("api-key "):
            return auth[8:].strip()
        return (params.get("key", [""])[0] or "").strip()

    def _auth_or_reply(self, params) -> dict | None:
        key = self._extract_key(params)
        doc, err = authenticate(key)
        if err == "not_configured":
            self._send(503, {"error": "not_configured", "message": "서버에 API 설정이 없습니다"})
            return None
        if err:
            msgs = {"invalid_key": "유효하지 않은 API 키입니다", "revoked": "폐기된 API 키입니다", "rate_limited": f"일일 호출 한도({DAILY_CALL_LIMIT}회)를 초과했습니다"}
            self._send(429 if err == "rate_limited" else 401, {"error": err, "message": msgs.get(err, err)})
            return None
        return doc

    def _read_json(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(n) or b"{}") if n else {}
        except Exception:
            return {}

    def _keys_user_or_reply(self, id_token: str) -> dict | None:
        if _firestore() is None:
            self._send(503, {"error": "not_configured"})
            return None
        user = verify_id_token(id_token)
        if not user:
            self._send(401, {"error": "invalid_token", "message": "로그인이 필요합니다"})
            return None
        return user

    def do_DELETE(self):
        params = parse_qs(urlparse(self.path).query)
        if (params.get("path", [""])[0] or "").strip("/") != "keys":
            self._send(405, {"error": "method_not_allowed"})
            return
        body = self._read_json()
        user = self._keys_user_or_reply(body.get("idToken", ""))
        if user is None:
            return
        try:
            self._send(*keys_revoke(user, str(body.get("keyId") or "")))
        except Exception as e:
            self._send(500, {"error": str(e)[:200]})

    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        rest_path = (params.get("path", [""])[0] or "").strip("/")
        if rest_path == "keys":
            user = self._keys_user_or_reply(params.get("idToken", [""])[0])
            if user is None:
                return
            try:
                self._send(*keys_list(user))
            except Exception as e:
                self._send(500, {"error": str(e)[:200]})
            return
        if not rest_path:
            # MCP 엔드포인트에 GET → SSE 미지원 (Streamable HTTP 허용 동작)
            self._send(405, {"error": "method_not_allowed", "message": "POST JSON-RPC 또는 GET /api/v1/{shorts|hot-posts|rising-channels}"})
            return
        tool = REST_TOOL_BY_PATH.get(rest_path)
        if not tool:
            self._send(404, {"error": "unknown_tool", "available": list(REST_TOOL_BY_PATH.keys())})
            return
        if self._auth_or_reply(params) is None:
            return
        args = {k: v[0] for k, v in params.items() if k not in ("key", "path")}
        if "deep" in args:
            args["deep"] = str(args["deep"]).lower() in ("1", "true", "yes")
        try:
            self._send(200, run_tool(tool, args, self.headers))
        except RuntimeError as e:
            self._send(503, {"error": str(e)})
        except Exception as e:
            self._send(500, {"error": str(e)[:200]})

    def do_POST(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if (params.get("path", [""])[0] or "").strip("/") == "keys":
            body = self._read_json()
            user = self._keys_user_or_reply(body.get("idToken", ""))
            if user is None:
                return
            try:
                self._send(*keys_issue(user, str(body.get("name") or "")))
            except Exception as e:
                self._send(500, {"error": str(e)[:200]})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            msg = json.loads(raw or b"{}")
        except Exception:
            self._send(400, _rpc_error(None, -32700, "Parse error"))
            return

        # 배치 요청은 미지원 — 단일 메시지만
        if isinstance(msg, list):
            self._send(400, _rpc_error(None, -32600, "Batch requests not supported"))
            return

        method = msg.get("method", "")
        id_ = msg.get("id")
        is_notification = "id" not in msg

        # 인증은 initialize/ping/notifications 를 포함해 모든 메시지에 적용 (키 없이는 도구 목록도 안 보여줌)
        doc = self._auth_or_reply(params)
        if doc is None:
            return

        if is_notification:
            self._send(202)
            return

        if method == "initialize":
            self._send(200, {"jsonrpc": "2.0", "id": id_, "result": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
                "instructions": "TubeRadar 도구: 오늘 뜨는 쇼츠(get_trending_shorts), 커뮤니티 핫게시글(get_community_hot_posts), 신규 급성장 채널(get_rising_channels). 결과는 JSON 문자열이다.",
            }})
            return
        if method == "ping":
            self._send(200, {"jsonrpc": "2.0", "id": id_, "result": {}})
            return
        if method == "tools/list":
            self._send(200, {"jsonrpc": "2.0", "id": id_, "result": {"tools": TOOLS}})
            return
        if method == "tools/call":
            p = msg.get("params") or {}
            name = p.get("name", "")
            args = p.get("arguments") or {}
            try:
                result = run_tool(name, args, self.headers)
                text = json.dumps(result, ensure_ascii=False)
                self._send(200, {"jsonrpc": "2.0", "id": id_, "result": {"content": [{"type": "text", "text": text}], "isError": False}})
            except KeyError:
                self._send(200, _rpc_error(id_, -32602, f"Unknown tool: {name}"))
            except RuntimeError as e:
                self._send(200, {"jsonrpc": "2.0", "id": id_, "result": {"content": [{"type": "text", "text": f"유튜브 API 할당량 초과: {e}"}], "isError": True}})
            except Exception as e:
                self._send(200, {"jsonrpc": "2.0", "id": id_, "result": {"content": [{"type": "text", "text": f"도구 실행 오류: {str(e)[:200]}"}], "isError": True}})
            return
        self._send(200, _rpc_error(id_, -32601, f"Method not found: {method}"))
