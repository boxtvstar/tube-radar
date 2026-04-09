"""
Vercel Serverless Function: 채널 신규 발굴 (Rising Creators)
YouTube Data API — search.list 없이 카테고리 인기영상만 활용
다중 리전(KR/JP/US) × 13 카테고리 + 채널 상세 (일일 ~110 units)
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import os
import time
import logging
from datetime import datetime, timezone, timedelta

import requests

logger = logging.getLogger(__name__)

YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3"
CACHE_TTL = 36000  # 10시간

_cache: dict | None = None
_cache_time: float = 0
_accumulated_channels: list[dict] = []  # 누적 채널 목록 (Vercel cold start 시 리셋 — 클라이언트 localStorage가 실제 누적 소스)
MAX_ACCUMULATED = 500

_KST = timezone(timedelta(hours=9))

# 전체 카테고리 — videos.list는 1 unit/호출이라 전부 돌려도 13 units
CATEGORY_IDS = ["1", "2", "10", "15", "17", "19", "20", "22", "23", "24", "25", "26", "28"]
REGION_CODES = ["KR", "JP", "US"]  # 한국 + 일본 + 미국

MAX_CHANNEL_AGE_DAYS = 365
MAX_VIDEO_COUNT = 100
MIN_AVG_VIEWS = 300_000
MAX_CHANNELS_PER_SCAN = 20  # 하루 최대 20채널


_runtime_api_key: str = ""


def _get_api_key() -> str:
    key = _runtime_api_key or os.environ.get("YOUTUBE_API_KEY", "")
    if not key:
        raise RuntimeError("YOUTUBE_API_KEY 환경변수가 설정되지 않았습니다")
    return key


def _yt_get(path: str, params: dict) -> dict:
    params["key"] = _get_api_key()
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


def _discover() -> list[dict]:
    """
    카테고리×리전별 인기 영상에서 채널 추출 → 필터링 → 상위 20개만 영상 조회

    비용 계산:
    - Step 1: 3 리전 × 13 카테고리 × videos.list (1 unit) = 39 units
    - Step 2: 채널 배치 조회 ~10 units (channels.list)
    - Step 3: 20채널 × 3호출 = 60 units (channels + playlistItems + videos)
    총: ~110 units
    """
    now = datetime.now(timezone.utc)
    one_year_ago = now - timedelta(days=MAX_CHANNEL_AGE_DAYS)

    # Step 1: 카테고리별 × 리전별 인기 동영상 수집 (~13 × 3 = 39 units)
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
                })
                all_videos.extend(data.get("items", []))
            except Exception as e:
                if "QUOTA_EXCEEDED" in str(e):
                    raise
                continue

    # Step 2: 고유 채널 ID 추출 + 배치 조회 (~8 units)
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
            })
            all_channels.extend(data.get("items", []))
        except Exception as e:
            if "QUOTA_EXCEEDED" in str(e):
                raise
            continue

    # Step 3: 필터링 (1년 이내, 영상 ≤100, 평균 조회수 ≥50만)
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

    # 평균 조회수 높은 순 정렬 후 상위 10개만
    qualified.sort(
        key=lambda c: int(c.get("statistics", {}).get("viewCount", "0"))
        / max(int(c.get("statistics", {}).get("videoCount", "1")), 1),
        reverse=True,
    )
    qualified = qualified[:MAX_CHANNELS_PER_SCAN]

    if not qualified:
        return []

    # Step 4: 상위 10개 채널의 대표 영상 4개씩 조회 (~30 units)
    results: list[dict] = []
    for ch in qualified:
        try:
            detail = _yt_get("channels", {
                "part": "contentDetails",
                "id": ch["id"],
            })
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
            })
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
            })
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


def _merge_accumulated(new_channels: list[dict]) -> list[dict]:
    """새로 발굴한 채널을 누적 목록에 merge (기존 유지 + 신규 추가)"""
    global _accumulated_channels
    existing_ids = {ch["id"] for ch in _accumulated_channels}
    now_ts = time.time()

    for ch in new_channels:
        if ch["id"] in existing_ids:
            for i, acc in enumerate(_accumulated_channels):
                if acc["id"] == ch["id"]:
                    ch["discoveredAt"] = acc.get("discoveredAt", now_ts)
                    _accumulated_channels[i] = ch
                    break
        else:
            ch["discoveredAt"] = now_ts
            _accumulated_channels.append(ch)
            existing_ids.add(ch["id"])

    _accumulated_channels.sort(key=lambda c: c.get("discoveredAt", 0), reverse=True)
    if len(_accumulated_channels) > MAX_ACCUMULATED:
        _accumulated_channels = _accumulated_channels[:MAX_ACCUMULATED]

    return _accumulated_channels


def _fetch_rising_channels(force: bool = False, api_key: str = "") -> dict:
    global _cache, _cache_time, _runtime_api_key
    if api_key:
        _runtime_api_key = api_key

    if not force and _cache and (time.time() - _cache_time) < CACHE_TTL:
        return {**_cache, "cached": True}

    new_channels = _discover()
    merged = _merge_accumulated(new_channels)
    now = datetime.now(_KST).isoformat()

    result = {
        "channels": merged,
        "cached": False,
        "updated_at": now,
        "count": len(merged),
    }

    _cache = result
    _cache_time = time.time()
    return result


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        try:
            force = params.get("force", ["false"])[0].lower() == "true"
            api_key = params.get("apiKey", [""])[0]
            result = _fetch_rising_channels(force=force, api_key=api_key)
            body = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            logger.exception("rising_channels handler error")
            body = json.dumps({"error": str(e)}, ensure_ascii=False).encode()
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
