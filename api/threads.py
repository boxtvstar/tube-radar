"""
Vercel Serverless Function: Threads 프로필 스크래핑
threads.net 페이지의 og 태그에서 프로필 사진, 이름, 팔로워 수 추출
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, quote
import html as html_lib
import json
import re
import time
import logging

import requests

logger = logging.getLogger(__name__)

_cache: dict = {}
_cache_time: dict = {}
CACHE_TTL = 3600


def _scrape_threads_profile(username: str) -> dict:
    username = username.lstrip("@").strip()
    if not username:
        return {"error": "username이 비어있습니다"}

    now = time.time()
    if username in _cache and (now - _cache_time.get(username, 0)) < CACHE_TTL:
        return _cache[username]

    try:
        resp = requests.get(
            f"https://www.threads.net/@{username}",
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
                "Accept": "text/html",
            },
            timeout=15,
        )
        if resp.status_code != 200:
            return {"error": f"Threads 페이지 로드 실패 ({resp.status_code})"}

        page = resp.text

        # og:image
        og_match = re.search(r'og:image["\s]+content="([^"]+)"', page)
        avatar = ""
        if og_match:
            avatar = html_lib.unescape(og_match.group(1))
            avatar = f"/api/image-proxy?url={quote(avatar, safe='')}"

        # og:title → 이름
        title_match = re.search(r'og:title["\s]+content="([^"]+)"', page)
        display_name = f"@{username}"
        if title_match:
            raw_title = html_lib.unescape(title_match.group(1))
            name_match = re.match(r'^(.+?)\s*\(@', raw_title)
            if name_match:
                display_name = name_match.group(1).strip()

        # og:description → 팔로워
        desc_match = re.search(r'og:description["\s]+content="([^"]+)"', page)
        follower_text = ""
        if desc_match:
            desc = html_lib.unescape(desc_match.group(1))
            f_match = re.search(r'([\d,.]+[KMB]?)\s*Followers', desc, re.IGNORECASE)
            if f_match:
                follower_text = f_match.group(1) + " followers"

    except Exception as e:
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


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        username = params.get("username", [""])[0].strip()
        if not username:
            body = json.dumps({"error": "username 파라미터가 필요합니다"}, ensure_ascii=False).encode()
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
            return

        try:
            result = _scrape_threads_profile(username)
            status = 200 if "error" not in result else 422
            body = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
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
