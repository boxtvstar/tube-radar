"""
YouTube 자막 추출 API 서버
FastAPI 기반, 프론트엔드에서 호출하여 자막 데이터를 반환
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from transcript import extract_transcript, list_available_languages

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
