"""
YouTube 자막 추출 API 서버
FastAPI 기반, 프론트엔드에서 호출하여 자막 데이터를 반환
"""

from fastapi import FastAPI, Query, HTTPException, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from transcript import extract_transcript, list_available_languages
from downloader import get_video_info, stream_video_process, build_download_filename
from similar_thumbnail import find_similar_thumbnails
from source_finder import find_source_from_video_url, find_source_from_image
from community_scraper import fetch_all_hot_posts
from shorts_music import fetch_shorts_music, search_shorts
from rising_channels import fetch_rising_channels

app = FastAPI(title="YouTube Transcript API")

# CORS 설정 (프론트엔드에서 호출 가능하도록)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/transcript")
def get_transcript(
    v: str = Query(..., description="YouTube 영상 ID"),
    lang: str = Query("ko,en", description="언어 우선순위 (쉼표 구분)"),
):
    """영상 자막을 추출하여 반환"""
    lang_list = [l.strip() for l in lang.split(",") if l.strip()]
    return extract_transcript(v, lang_list)


@app.get("/api/languages")
def get_languages(v: str = Query(..., description="YouTube 영상 ID")):
    """영상에 사용 가능한 자막 언어 목록 반환"""
    return list_available_languages(v)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/video/info")
def video_info(url: str = Query(..., description="YouTube 영상 URL")):
    result = get_video_info(url)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error") or "영상 정보 조회 실패")
    return result


@app.get("/api/video/download")
def download_video(url: str = Query(..., description="YouTube 영상 URL")):
    result = get_video_info(url)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error") or "영상 다운로드 준비 실패")

    filename = build_download_filename(result.get("title") or "youtube_video")
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}

    return StreamingResponse(
        stream_video_process(url),
        media_type="video/mp4",
        headers=headers,
    )


@app.get("/api/video/similar-thumbnails")
def similar_thumbnails(
    request: Request,
    url: str = Query(..., description="YouTube 영상 URL 또는 영상 ID"),
    apiKey: str = Query(..., description="YouTube Data API Key"),
    limit: int = Query(20, ge=1, le=30, description="반환 개수"),
):
    referer = request.headers.get("origin") or request.headers.get("referer")
    result = find_similar_thumbnails(apiKey, url, top_k=limit, referer=referer)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error") or "유사 썸네일 검색 실패")
    return result


@app.get("/api/video/source-from-url")
def source_from_url(
    request: Request,
    url: str = Query(..., description="YouTube 영상 URL 또는 영상 ID"),
    apiKey: str = Query(..., description="YouTube Data API Key"),
    limit: int = Query(20, ge=1, le=30, description="반환 개수"),
):
    referer = request.headers.get("origin") or request.headers.get("referer")
    result = find_source_from_video_url(apiKey, url, top_k=limit, referer=referer)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error") or "원본 영상 탐색 실패")
    return result


@app.post("/api/video/source-from-image")
async def source_from_image(
    request: Request,
    apiKey: str = Form(..., description="YouTube Data API Key"),
    query: str = Form(..., description="검색 키워드"),
    limit: int = Form(20),
    image: UploadFile = File(...),
):
    referer = request.headers.get("origin") or request.headers.get("referer")
    image_bytes = await image.read()
    safe_limit = min(max(limit, 1), 30)
    result = find_source_from_image(apiKey, image_bytes, query, top_k=safe_limit, referer=referer)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error") or "이미지 기반 탐색 실패")
    return result


@app.get("/api/community/hot-posts")
def community_hot_posts(force: bool = False):
    """커뮤니티 핫게시글 수집 (1시간 캐시)"""
    try:
        result = fetch_all_hot_posts(force=force)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"커뮤니티 스크래핑 실패: {str(e)}")


@app.get("/api/shorts-music")
def shorts_music(force: bool = False, q: str | None = None):
    """쇼츠 인기 음악 차트 (2시간 캐시) / q 파라미터 있으면 쇼츠 검색"""
    try:
        if q:
            return {"videos": search_shorts(q)}
        result = fetch_shorts_music(force=force)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"쇼츠 음악 차트 조회 실패: {str(e)}")


@app.get("/api/rising-channels")
def rising_channels(force: bool = False, apiKey: str = ""):
    """신규 발굴 — 급성장 채널 목록 (24시간 캐시)"""
    try:
        return fetch_rising_channels(force=force, api_key=apiKey)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"신규 발굴 조회 실패: {str(e)}")


import requests as _req
from bs4 import BeautifulSoup as _BS
import re as _re

_preview_cache: dict[str, dict] = {}

# 사이트별 본문 추출 셀렉터 (OG 태그 없는 사이트 대비)
_BODY_SELECTORS: list[str] = [
    ".xe_content",          # theqoo (XE 기반)
    "div#articleBody",      # 82cook
    "td.board-contents",    # ppomppu
    "div.bodyCont",         # bobaedream
    "div.rd_body",          # theqoo alternative
    "article.article-body", # generic
    "div.view_content",     # generic
    "div.read_body",        # generic
]


def _fix_encoding(resp: _req.Response) -> None:
    """HTTP 헤더 / meta 태그 / apparent_encoding 순서로 인코딩 보정"""
    ct = resp.headers.get("Content-Type", "")
    # 1) charset in Content-Type header
    m = _re.search(r"charset=([\w-]+)", ct, _re.I)
    if m:
        resp.encoding = m.group(1)
        return
    # 2) meta charset in raw bytes
    head_bytes = resp.content[:2048]
    m = _re.search(rb'charset=["\']?([\w-]+)', head_bytes, _re.I)
    if m:
        resp.encoding = m.group(1).decode("ascii", errors="ignore")
        return
    # 3) apparent_encoding fallback
    if resp.apparent_encoding:
        resp.encoding = resp.apparent_encoding


def _extract_body_text(soup: _BS, max_len: int = 300) -> str:
    """본문 영역에서 텍스트 추출 (OG 태그 없을 때 폴백)"""
    for sel in _BODY_SELECTORS:
        el = soup.select_one(sel)
        if el:
            txt = el.get_text(separator=" ", strip=True)
            txt = _re.sub(r"\s+", " ", txt).strip()
            if len(txt) > 10:
                return txt[:max_len]
    return ""


def _extract_body_image(soup: _BS) -> str:
    """본문 영역에서 첫 번째 이미지 추출"""
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


def _extract_title_text(soup: _BS) -> str:
    """title 태그에서 사이트명 제거 후 제목 추출"""
    title_el = soup.select_one("title")
    if not title_el:
        return ""
    raw = title_el.get_text(strip=True)
    # 일반적인 구분자로 사이트명 제거: " | ", " :: ", " - ", " > "
    for sep in [" | ", " :: ", " ::: ", " - ", " > "]:
        if sep in raw:
            parts = raw.split(sep)
            # 가장 긴 부분이 제목일 가능성이 높음
            raw = max(parts, key=len).strip()
            break
    return raw[:200]


def _normalize_preview_url(url: str) -> str:
    """뽐뿌 zboard.php → view.php 변환 등 미리보기용 URL 정규화"""
    if "ppomppu.co.kr/zboard/zboard.php?" in url:
        url = url.replace("/zboard/zboard.php?", "/zboard/view.php?")
    return url


@app.get("/api/preview")
@app.get("/api/community/preview")
def community_preview(url: str = Query(...)):
    """게시글 미리보기 (og 메타 + 본문 폴백)"""
    url = _normalize_preview_url(url)
    if url in _preview_cache:
        return _preview_cache[url]
    try:
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}
        resp = _req.get(url, headers=headers, timeout=6)
        _fix_encoding(resp)
        soup = _BS(resp.text, "lxml")

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

        # 프로토콜 보정
        if img.startswith("//"):
            img = "https:" + img

        result = {"description": desc[:300], "image": img}
        _preview_cache[url] = result
        return result
    except Exception:
        return {"description": "", "image": ""}
