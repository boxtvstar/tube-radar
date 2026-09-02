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
from datetime import datetime, timezone, timedelta
import json
import os
import time

import requests

MAX_ACCUMULATED = 500

# --- 채널 발굴 로직 (rising_channels.py와 동일, Vercel 함수 격리 때문에 자립형으로 내장) ---
YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3"
CATEGORY_IDS = ["1", "2", "10", "15", "17", "19", "20", "22", "23", "24", "25", "26", "28"]
REGION_CODES = ["KR", "JP", "US"]
MAX_CHANNEL_AGE_DAYS = 365
MAX_VIDEO_COUNT = 100
MIN_AVG_VIEWS = 300_000
MAX_CHANNELS_PER_SCAN = 20


def _yt_get(path: str, params: dict, api_key: str) -> dict:
    params["key"] = api_key
    resp = requests.get(f"{YOUTUBE_BASE}/{path}", params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        code = data["error"].get("code", 0)
        if code == 404:
            return {"items": []}
        msg = data["error"].get("message", "")
        if code == 403 and "quota" in msg.lower():
            raise RuntimeError("QUOTA_EXCEEDED")
        return {"items": []}
    return data


def _discover(api_key: str) -> list[dict]:
    now = datetime.now(timezone.utc)
    one_year_ago = now - timedelta(days=MAX_CHANNEL_AGE_DAYS)

    all_videos: list[dict] = []
    for region in REGION_CODES:
        for cat_id in CATEGORY_IDS:
            try:
                data = _yt_get("videos", {
                    "part": "snippet,statistics",
                    "chart": "mostPopular",
                    "regionCode": region,
                    "videoCategoryId": cat_id,
                    "maxResults": 50,
                }, api_key)
                all_videos.extend(data.get("items", []))
            except Exception as e:
                if "QUOTA_EXCEEDED" in str(e):
                    raise
                continue

    channel_ids: set[str] = set()
    for v in all_videos:
        cid = v.get("snippet", {}).get("channelId")
        if cid:
            channel_ids.add(cid)
    if not channel_ids:
        return []

    channel_list = list(channel_ids)
    all_channels: list[dict] = []
    for i in range(0, len(channel_list), 50):
        batch = channel_list[i:i + 50]
        try:
            data = _yt_get("channels", {
                "part": "snippet,statistics",
                "id": ",".join(batch),
            }, api_key)
            all_channels.extend(data.get("items", []))
        except Exception as e:
            if "QUOTA_EXCEEDED" in str(e):
                raise
            continue

    qualified: list[dict] = []
    for ch in all_channels:
        try:
            published = datetime.fromisoformat(
                ch["snippet"]["publishedAt"].replace("Z", "+00:00")
            )
            stats = ch.get("statistics", {})
            video_count = int(stats.get("videoCount", "0"))
            total_views = int(stats.get("viewCount", "0"))
            avg_views = total_views / video_count if video_count > 0 else 0
            if (
                published >= one_year_ago
                and 0 < video_count <= MAX_VIDEO_COUNT
                and avg_views >= MIN_AVG_VIEWS
            ):
                qualified.append(ch)
        except (KeyError, ValueError):
            continue

    qualified.sort(
        key=lambda c: int(c.get("statistics", {}).get("viewCount", "0"))
        / max(int(c.get("statistics", {}).get("videoCount", "1")), 1),
        reverse=True,
    )
    qualified = qualified[:MAX_CHANNELS_PER_SCAN]
    if not qualified:
        return []

    results: list[dict] = []
    for ch in qualified:
        try:
            detail = _yt_get("channels", {
                "part": "contentDetails",
                "id": ch["id"],
            }, api_key)
            uploads_id = (
                detail.get("items", [{}])[0]
                .get("contentDetails", {})
                .get("relatedPlaylists", {})
                .get("uploads")
            )
            if not uploads_id:
                continue
            pl = _yt_get("playlistItems", {
                "part": "snippet",
                "playlistId": uploads_id,
                "maxResults": 20,
            }, api_key)
            video_ids = [
                item["snippet"]["resourceId"]["videoId"]
                for item in pl.get("items", [])
                if item.get("snippet", {}).get("resourceId", {}).get("videoId")
            ]
            if not video_ids:
                continue
            vdata = _yt_get("videos", {
                "part": "snippet,statistics",
                "id": ",".join(video_ids),
            }, api_key)
            top_videos = []
            for v in vdata.get("items", []):
                top_videos.append({
                    "videoId": v["id"],
                    "title": v["snippet"]["title"],
                    "thumbnail": (
                        v["snippet"].get("thumbnails", {}).get("high", {}).get("url")
                        or v["snippet"].get("thumbnails", {}).get("medium", {}).get("url")
                        or v["snippet"].get("thumbnails", {}).get("default", {}).get("url", "")
                    ),
                    "views": int(v.get("statistics", {}).get("viewCount", "0")),
                    "publishedAt": v["snippet"]["publishedAt"],
                })
            top_videos.sort(key=lambda x: x["views"], reverse=True)
            top_videos = top_videos[:4]

            stats = ch.get("statistics", {})
            video_count = int(stats.get("videoCount", "0"))
            total_views = int(stats.get("viewCount", "0"))
            results.append({
                "id": ch["id"],
                "title": ch["snippet"]["title"],
                "thumbnail": (
                    ch["snippet"].get("thumbnails", {}).get("high", {}).get("url")
                    or ch["snippet"].get("thumbnails", {}).get("medium", {}).get("url")
                    or ch["snippet"].get("thumbnails", {}).get("default", {}).get("url", "")
                ),
                "subscriberCount": int(stats.get("subscriberCount", "0")),
                "videoCount": video_count,
                "totalViews": total_views,
                "avgViews": round(total_views / video_count) if video_count > 0 else 0,
                "joinDate": ch["snippet"]["publishedAt"],
                "country": ch["snippet"].get("country"),
                "topVideos": top_videos,
            })
        except Exception as e:
            if "QUOTA_EXCEEDED" in str(e):
                raise
            continue

    results.sort(key=lambda x: x["avgViews"], reverse=True)
    return results


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
