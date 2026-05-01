"""
Vercel Serverless Function: 이미지 프록시
Instagram/Threads CDN 이미지의 CORS 문제를 우회
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import logging

import requests

logger = logging.getLogger(__name__)

ALLOWED_DOMAINS = (
    "cdninstagram.com",
    "fbcdn.net",
    "scontent-",
    "tiktokcdn.com",
    "tiktokcdn-",
    "ruliweb.com",
    "ppomppu.co.kr",
    "slrclub.com",
    "todayhumor.co.kr",
    "theqoo.net",
    "namu.la",
    "inven.co.kr",
    "fmkorea.com",
)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        url = params.get("url", [""])[0].strip()
        if not url:
            self.send_response(400)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"url parameter required")
            return

        if not any(d in url for d in ALLOWED_DOMAINS):
            self.send_response(403)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"domain not allowed")
            return

        try:
            resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            resp.raise_for_status()
            ct = resp.headers.get("content-type", "image/jpeg")

            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(resp.content)
        except Exception:
            self.send_response(502)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b"proxy error")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
