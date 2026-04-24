"""
Threads 프로필 스크래퍼 — curl_cffi로 og:image 추출
"""

import html as html_lib
import re
import time
import logging
from urllib.parse import quote

from curl_cffi import requests as cffi_requests

logger = logging.getLogger(__name__)

_cache: dict = {}
_cache_time: dict = {}
CACHE_TTL = 3600  # 1시간


def scrape_threads_profile(username: str) -> dict:
    """Threads 프로필 이미지 + 이름 추출"""
    username = username.lstrip("@").strip()
    if not username:
        return {"error": "username이 비어있습니다"}

    now = time.time()
    if username in _cache and (now - _cache_time.get(username, 0)) < CACHE_TTL:
        return _cache[username]

    try:
        resp = cffi_requests.get(
            f"https://www.threads.net/@{username}",
            impersonate="chrome",
            timeout=15,
        )
        if resp.status_code != 200:
            return {"error": f"Threads 페이지 로드 실패 ({resp.status_code})"}

        page = resp.text

        # og:image에서 프로필 사진 추출
        og_match = re.search(r'og:image["\s]+content="([^"]+)"', page)
        avatar = ""
        if og_match:
            avatar = html_lib.unescape(og_match.group(1))
            # 프록시로 감싸기 (CORS 이슈 방지)
            avatar = f"/api/image-proxy?url={quote(avatar, safe='')}"

        # og:title에서 이름 추출 (예: "Mark Zuckerberg (&#064;zuck) &#x2022; Threads")
        title_match = re.search(r'og:title["\s]+content="([^"]+)"', page)
        display_name = f"@{username}"
        if title_match:
            raw_title = html_lib.unescape(title_match.group(1))
            # "이름 (@username) • Threads" 패턴에서 이름만 추출
            name_match = re.match(r'^(.+?)\s*\(@', raw_title)
            if name_match:
                display_name = name_match.group(1).strip()

        # og:description에서 팔로워 수 추출
        desc_match = re.search(r'og:description["\s]+content="([^"]+)"', page)
        follower_text = ""
        if desc_match:
            desc = html_lib.unescape(desc_match.group(1))
            # "123K Followers" 패턴
            f_match = re.search(r'([\d,.]+[KMB]?)\s*Followers', desc, re.IGNORECASE)
            if f_match:
                follower_text = f_match.group(1) + " followers"

    except Exception as e:
        logger.warning("Threads scrape failed for @%s: %s", username, e)
        return {"error": f"Threads 스크래핑 실패: {e}"}

    result = {
        "profile": {
            "username": username,
            "displayName": display_name,
            "avatar": avatar,
            "followerText": follower_text,
        },
        "scrapedAt": int(time.time()),
    }

    _cache[username] = result
    _cache_time[username] = now
    return result
