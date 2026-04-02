"""
Vercel Serverless Function: 커뮤니티 게시글 미리보기
OG 메타 태그 + 본문 폴백으로 description, image 추출
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import re

import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
}

_preview_cache: dict[str, dict] = {}

# 사이트별 본문 추출 셀렉터
_BODY_SELECTORS: list[str] = [
    ".xe_content",          # theqoo (XE 기반)
    "div#articleBody",      # 82cook
    "td.board-contents",    # ppomppu
    "div.bodyCont",         # bobaedream
    "div.rd_body",          # theqoo alternative
    "article.article-body",
    "div.view_content",
    "div.read_body",
]


def _fix_encoding(resp: requests.Response) -> None:
    ct = resp.headers.get("Content-Type", "")
    m = re.search(r"charset=([\w-]+)", ct, re.I)
    if m:
        resp.encoding = m.group(1)
        return
    head_bytes = resp.content[:2048]
    m = re.search(rb'charset=["\']?([\w-]+)', head_bytes, re.I)
    if m:
        resp.encoding = m.group(1).decode("ascii", errors="ignore")
        return
    if resp.apparent_encoding:
        resp.encoding = resp.apparent_encoding


def _extract_body_text(soup: BeautifulSoup, max_len: int = 300) -> str:
    for sel in _BODY_SELECTORS:
        el = soup.select_one(sel)
        if el:
            txt = el.get_text(separator=" ", strip=True)
            txt = re.sub(r"\s+", " ", txt).strip()
            if len(txt) > 10:
                return txt[:max_len]
    return ""


def _extract_body_image(soup: BeautifulSoup) -> str:
    for sel in _BODY_SELECTORS:
        el = soup.select_one(sel)
        if el:
            img = el.select_one("img[src]")
            if img:
                src = img.get("src", "")
                if src and not src.endswith((".gif", ".svg")) and "icon" not in src and "btn" not in src:
                    if src.startswith("//"):
                        src = "https:" + src
                    return src
    return ""


def _extract_title_text(soup: BeautifulSoup) -> str:
    title_el = soup.select_one("title")
    if not title_el:
        return ""
    raw = title_el.get_text(strip=True)
    for sep in [" | ", " :: ", " ::: ", " - ", " > "]:
        if sep in raw:
            parts = raw.split(sep)
            raw = max(parts, key=len).strip()
            break
    return raw[:200]


def _normalize_preview_url(url: str) -> str:
    if "ppomppu.co.kr/zboard/zboard.php?" in url:
        url = url.replace("/zboard/zboard.php?", "/zboard/view.php?")
    return url


def _fetch_preview(url: str) -> dict:
    url = _normalize_preview_url(url)
    if url in _preview_cache:
        return _preview_cache[url]
    try:
        resp = requests.get(url, headers=HEADERS, timeout=6)
        _fix_encoding(resp)
        soup = BeautifulSoup(resp.text, "lxml")

        desc = ""
        img = ""

        # 1) OG description
        og_desc = soup.select_one('meta[property="og:description"]')
        if og_desc:
            desc = (og_desc.get("content") or "").strip()

        # 2) meta description
        if not desc:
            meta_desc = soup.select_one('meta[name="description"]')
            if meta_desc:
                desc = (meta_desc.get("content") or "").strip()

        # 3) 본문 텍스트 폴백
        if not desc:
            desc = _extract_body_text(soup)

        # 4) title 태그 폴백
        if not desc:
            desc = _extract_title_text(soup)

        # OG image
        og_img = soup.select_one('meta[property="og:image"]')
        if og_img:
            img = (og_img.get("content") or "").strip()

        # 본문 이미지 폴백
        if not img:
            img = _extract_body_image(soup)

        if img.startswith("//"):
            img = "https:" + img

        result = {"description": desc[:300], "image": img}
        _preview_cache[url] = result
        return result
    except Exception:
        return {"description": "", "image": ""}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        url = params.get("url", [""])[0]

        if not url:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "url parameter required"}).encode())
            return

        result = _fetch_preview(url)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(result, ensure_ascii=False).encode())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
