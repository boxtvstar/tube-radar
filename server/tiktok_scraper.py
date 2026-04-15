"""
TikTok 프로필 스크래퍼 — FastAPI 로컬 서버용
yt-dlp + HTML 프로필 데이터 조합으로 채널 정보 + 영상 목록 추출
"""

import json
import re
import subprocess
import time
import logging

import requests

logger = logging.getLogger(__name__)

_cache: dict = {}
_cache_time: dict = {}
CACHE_TTL = 3600  # 1시간

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
}


def _fetch_profile_html(username: str) -> dict | None:
    """HTML에서 프로필 정보 추출 (팔로워, 닉네임, 아바타 등)"""
    try:
        resp = requests.get(
            f"https://www.tiktok.com/@{username}",
            headers=HEADERS,
            timeout=15,
            allow_redirects=True,
        )
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.warning("TikTok HTML fetch failed for @%s: %s", username, e)
        return None

    pattern = r'<script\s+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>'
    match = re.search(pattern, resp.text, re.DOTALL)
    if not match:
        return None

    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None

    user_info = (
        data.get("__DEFAULT_SCOPE__", {})
        .get("webapp.user-detail", {})
        .get("userInfo", {})
    )
    if not user_info:
        return None

    user = user_info.get("user", {})
    stats = user_info.get("stats", {})
    return {
        "id": f"tt_{username}",
        "uniqueId": user.get("uniqueId", username),
        "nickname": user.get("nickname", username),
        "avatar": (
            user.get("avatarLarger")
            or user.get("avatarMedium")
            or user.get("avatarThumb", "")
        ),
        "signature": user.get("signature", ""),
        "followerCount": stats.get("followerCount", 0),
        "followingCount": stats.get("followingCount", 0),
        "heartCount": stats.get("heartCount", 0),
        "videoCount": stats.get("videoCount", 0),
    }


def _fetch_videos_ytdlp(username: str, max_videos: int = 30) -> list[dict]:
    """yt-dlp로 영상 목록 + 통계 추출"""
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
            cmd, capture_output=True, text=True, timeout=60
        )
        if proc.returncode != 0:
            logger.warning("yt-dlp failed for @%s: %s", username, proc.stderr[:200])
            return []
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp timeout for @%s", username)
        return []

    videos = []
    for line in proc.stdout.strip().split("\n"):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue

        # 썸네일 URL 추출 (originCover 우선)
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
            "videoUrl": f"https://www.tiktok.com/@{username}/video/{item.get('id', '')}",
        })

    return videos


def scrape_tiktok_profile(username: str) -> dict:
    """TikTok 프로필 + 영상 목록 가져오기"""
    username = username.lstrip("@").strip()
    if not username:
        return {"error": "username이 비어있습니다"}

    # 캐시 확인
    now = time.time()
    if username in _cache and (now - _cache_time.get(username, 0)) < CACHE_TTL:
        return _cache[username]

    # 1) HTML에서 프로필 정보 추출
    profile = _fetch_profile_html(username)
    if not profile:
        return {"error": f"@{username} 프로필을 찾을 수 없습니다."}

    # 2) yt-dlp로 영상 목록 추출
    videos = _fetch_videos_ytdlp(username, max_videos=30)

    result = {
        "profile": profile,
        "videos": videos,
        "scrapedAt": int(time.time()),
    }

    # 캐시 저장
    _cache[username] = result
    _cache_time[username] = now

    return result
