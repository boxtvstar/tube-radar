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
