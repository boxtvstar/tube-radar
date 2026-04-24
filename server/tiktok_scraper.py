"""
TikTok 프로필 스크래퍼 — FastAPI 로컬 서버용
yt-dlp 기반으로 프로필 정보 + 영상 목록 추출 (TikTok WAF 우회)
"""

import json
import subprocess
import time
import logging

logger = logging.getLogger(__name__)

_cache: dict = {}
_cache_time: dict = {}
CACHE_TTL = 3600  # 1시간


def _fetch_via_ytdlp(username: str, max_videos: int = 30) -> dict | None:
    """yt-dlp 한 번 호출로 프로필 정보 + 영상 목록 모두 추출"""
    url = f"https://www.tiktok.com/@{username}"
    cmd = [
        "yt-dlp",
        "--flat-playlist",
        "--dump-json",
        "--playlist-end", str(max_videos),
        "--no-warnings",
        "--quiet",
        url,
    ]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=90
        )
        if proc.returncode != 0:
            logger.warning("yt-dlp failed for @%s: %s", username, proc.stderr[:300])
            return None
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp timeout for @%s", username)
        return None

    items = []
    for line in proc.stdout.strip().split("\n"):
        if not line.strip():
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue

    if not items:
        return None

    # 첫 번째 영상 메타데이터에서 프로필 정보 추출
    first = items[0]
    nickname = first.get("channel") or first.get("uploader") or username
    unique_id = first.get("uploader") or first.get("playlist") or username

    # 프로필 이미지: unavatar.io 사용 (yt-dlp에 아바타 없음)
    avatar = f"https://unavatar.io/tiktok/{unique_id}"

    profile = {
        "id": f"tt_{unique_id}",
        "uniqueId": unique_id,
        "nickname": nickname,
        "avatar": avatar,
        "signature": "",
        "followerCount": 0,
        "followingCount": 0,
        "heartCount": 0,
        "videoCount": len(items),
    }

    # 영상 목록 변환
    videos = []
    for item in items:
        cover = ""
        for thumb in item.get("thumbnails", []):
            if thumb.get("id") == "originCover":
                cover = thumb.get("url", "")
                break
            if thumb.get("id") == "cover" and not cover:
                cover = thumb.get("url", "")

        videos.append({
            "id": item.get("id", ""),
            "desc": item.get("description") or item.get("title", ""),
            "createTime": item.get("timestamp", 0),
            "playCount": item.get("view_count", 0) or 0,
            "diggCount": item.get("like_count", 0) or 0,
            "commentCount": item.get("comment_count", 0) or 0,
            "shareCount": item.get("repost_count", 0) or 0,
            "duration": item.get("duration", 0) or 0,
            "cover": cover,
            "videoUrl": f"https://www.tiktok.com/@{unique_id}/video/{item.get('id', '')}",
        })

    return {"profile": profile, "videos": videos}


def scrape_tiktok_profile(username: str) -> dict:
    """TikTok 프로필 + 영상 목록 가져오기"""
    username = username.lstrip("@").strip()
    if not username:
        return {"error": "username이 비어있습니다"}

    # 캐시 확인
    now = time.time()
    if username in _cache and (now - _cache_time.get(username, 0)) < CACHE_TTL:
        return _cache[username]

    result = _fetch_via_ytdlp(username, max_videos=30)
    if not result:
        return {"error": f"@{username} 프로필을 찾을 수 없습니다."}

    result["scrapedAt"] = int(time.time())

    # 캐시 저장
    _cache[username] = result
    _cache_time[username] = now

    return result
