"""
Instagram 프로필 스크래퍼 — FastAPI 로컬 서버용
i.instagram.com 내부 API를 사용하여 프로필 정보 + 최근 영상(릴스) 목록 추출
"""

import time
import logging
from urllib.parse import quote

import requests

logger = logging.getLogger(__name__)

_cache: dict = {}
_cache_time: dict = {}
CACHE_TTL = 3600  # 1시간

HEADERS = {
    "User-Agent": "Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)",
    "X-IG-App-ID": "936619743392459",
}


def _fetch_profile(username: str) -> dict | None:
    """i.instagram.com API에서 프로필 + 최근 포스트 추출"""
    try:
        resp = requests.get(
            f"https://i.instagram.com/api/v1/users/web_profile_info/?username={username}",
            headers=HEADERS,
            timeout=15,
        )
        if resp.status_code != 200:
            logger.warning("Instagram API returned %d for @%s", resp.status_code, username)
            return None

        data = resp.json()
    except (requests.RequestException, ValueError) as e:
        logger.warning("Instagram fetch failed for @%s: %s", username, e)
        return None

    user = data.get("data", {}).get("user")
    if not user:
        return None

    raw_pic = user.get("profile_pic_url", "")
    proxied_pic = f"/api/image-proxy?url={quote(raw_pic, safe='')}" if raw_pic else ""

    profile = {
        "id": f"ig_{user.get('username', username)}",
        "username": user.get("username", username),
        "fullName": user.get("full_name", username),
        "biography": user.get("biography", ""),
        "profilePicUrl": proxied_pic,
        "followerCount": user.get("edge_followed_by", {}).get("count", 0),
        "followingCount": user.get("edge_follow", {}).get("count", 0),
        "mediaCount": user.get("edge_owner_to_timeline_media", {}).get("count", 0),
        "isPrivate": user.get("is_private", False),
        "isVerified": user.get("is_verified", False),
    }

    # 최근 포스트에서 영상(릴스)만 추출
    media = user.get("edge_owner_to_timeline_media", {})
    edges = media.get("edges", [])
    videos = []
    for edge in edges:
        node = edge.get("node", {})
        if not node.get("is_video"):
            continue

        caption_edges = node.get("edge_media_to_caption", {}).get("edges", [])
        caption = caption_edges[0]["node"]["text"] if caption_edges else ""

        raw_thumb = node.get("thumbnail_src", "")
        proxied_thumb = f"/api/image-proxy?url={quote(raw_thumb, safe='')}" if raw_thumb else ""

        videos.append({
            "id": node.get("id", ""),
            "shortcode": node.get("shortcode", ""),
            "caption": caption,
            "takenAt": node.get("taken_at_timestamp", 0),
            "viewCount": node.get("video_view_count", 0) or 0,
            "likeCount": node.get("edge_liked_by", {}).get("count", 0),
            "commentCount": node.get("edge_media_to_comment", {}).get("count", 0),
            "thumbnailUrl": proxied_thumb,
            "videoUrl": f"https://www.instagram.com/reel/{node.get('shortcode', '')}/",
        })

    return {"profile": profile, "videos": videos}


def scrape_instagram_profile(username: str) -> dict:
    """Instagram 프로필 + 릴스 목록 가져오기"""
    username = username.lstrip("@").strip()
    if not username:
        return {"error": "username이 비어있습니다"}

    # 캐시 확인
    now = time.time()
    if username in _cache and (now - _cache_time.get(username, 0)) < CACHE_TTL:
        return _cache[username]

    result = _fetch_profile(username)
    if not result:
        return {"error": f"@{username} 프로필을 찾을 수 없습니다."}

    if result["profile"].get("isPrivate"):
        return {"error": f"@{username}은 비공개 계정입니다."}

    result["scrapedAt"] = int(time.time())

    # 캐시 저장
    _cache[username] = result
    _cache_time[username] = now

    return result
