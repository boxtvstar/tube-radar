from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from io import BytesIO
import re
import logging
from typing import Any

import numpy as np
from PIL import Image
import requests
import torch
from transformers import CLIPProcessor, CLIPModel

logger = logging.getLogger(__name__)

YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3"
KST = timezone(timedelta(hours=9))

# ── CLIP 모델 (서버 시작 시 1회 로드, 이후 재사용) ──────────────────────────
_clip_model: CLIPModel | None = None
_clip_processor: CLIPProcessor | None = None
_clip_device: str = "cpu"


def _ensure_clip():
    global _clip_model, _clip_processor, _clip_device
    if _clip_model is not None:
        return
    logger.info("Loading CLIP model (openai/clip-vit-base-patch32)...")
    _clip_device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    _clip_model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(_clip_device).eval()
    _clip_processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
    logger.info(f"CLIP model loaded on {_clip_device}")


def _get_clip_embedding(image: Image.Image) -> np.ndarray | None:
    """이미지 → CLIP 512차원 벡터 (L2 정규화)"""
    _ensure_clip()
    try:
        inputs = _clip_processor(images=image, return_tensors="pt").to(_clip_device)
        with torch.no_grad():
            output = _clip_model.get_image_features(**inputs)
        # transformers 5.x: BaseModelOutputWithPooling → pooler_output 사용
        if hasattr(output, "pooler_output"):
            emb = output.pooler_output
        else:
            emb = output
        vec = emb.cpu().numpy().flatten().astype(np.float32)
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec /= norm
        return vec
    except Exception:
        return None


# ── 색상 히스토그램 유사도 ──────────────────────────────────────────────────
def _color_histogram(image: Image.Image, bins: int = 32) -> np.ndarray:
    """RGB 색상 히스토그램 벡터 (정규화됨)"""
    img = image.resize((128, 128)).convert("RGB")
    arr = np.array(img)
    hist = np.concatenate([
        np.histogram(arr[:, :, c], bins=bins, range=(0, 256))[0]
        for c in range(3)
    ]).astype(np.float32)
    total = hist.sum()
    if total > 0:
        hist /= total
    return hist


def _histogram_similarity(h1: np.ndarray, h2: np.ndarray) -> float:
    """히스토그램 교차법 (intersection) — 0~1"""
    return float(np.minimum(h1, h2).sum())


# ── 이미지 다운로드 + 분석 ─────────────────────────────────────────────────
@dataclass
class ImageFeatures:
    clip_vec: np.ndarray | None
    color_hist: np.ndarray | None


def _download_and_analyze(image_url: str) -> ImageFeatures | None:
    if not image_url:
        return None
    try:
        response = requests.get(image_url, timeout=10)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content)).convert("RGB")
        clip_vec = _get_clip_embedding(image)
        color_hist = _color_histogram(image)
        return ImageFeatures(clip_vec=clip_vec, color_hist=color_hist)
    except Exception:
        return None


# ── 기존 유틸 함수 (유지) ──────────────────────────────────────────────────
@dataclass
class Candidate:
    video_id: str
    title: str
    channel_title: str
    thumbnail_url: str
    published_at: str
    view_count: int
    duration_iso: str
    title_similarity: float
    channel_boost: float


def _normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _tokenize(text: str) -> set[str]:
    cleaned = re.sub(r"[^\w\s가-힣]", " ", (text or "").lower())
    words = [w for w in cleaned.split() if len(w) >= 2]
    stop = {
        "official", "video", "music", "with", "from", "this", "that",
        "the", "and", "how", "what", "feat", "live", "full", "version",
        "ep", "part", "shorts",
    }
    return {w for w in words if w not in stop}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def _parse_video_id(url_or_id: str) -> str | None:
    text = (url_or_id or "").strip()
    if not text:
        return None
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", text):
        return text
    patterns = [
        r"(?:v=)([A-Za-z0-9_-]{11})",
        r"(?:youtu\.be/)([A-Za-z0-9_-]{11})",
        r"(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})",
        r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return None


def _best_thumb(snippet: dict[str, Any]) -> str:
    thumbs = snippet.get("thumbnails") or {}
    return (
        (thumbs.get("maxres") or {}).get("url")
        or (thumbs.get("standard") or {}).get("url")
        or (thumbs.get("high") or {}).get("url")
        or (thumbs.get("medium") or {}).get("url")
        or (thumbs.get("default") or {}).get("url")
        or ""
    )


def _iso8601_to_hms(duration: str) -> str:
    if not duration:
        return "-"
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not match:
        return "-"
    h = int(match.group(1) or 0)
    m = int(match.group(2) or 0)
    s = int(match.group(3) or 0)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _fetch_json(url: str, timeout: int = 12, headers: dict[str, str] | None = None) -> dict[str, Any]:
    response = requests.get(url, timeout=timeout, headers=headers)
    if not response.ok:
        detail = response.text.strip()
        raise RuntimeError(f"{response.status_code} {detail[:500]}")
    return response.json()


# ── 후보 수집 (기존 + 카테고리 기반 확장) ──────────────────────────────────
def _search_candidate_ids(
    api_key: str,
    source_video_id: str,
    source_title: str,
    source_channel: str,
    max_ids: int = 150,
    request_headers: dict[str, str] | None = None,
) -> list[str]:
    title_tokens = list(_tokenize(source_title))
    base_keywords = title_tokens[:6] if title_tokens else source_title.split()[:3]
    # 쿼터 절약: 2개 쿼리만 사용 (search.list 100 × 2 = 200 쿼터)
    search_queries = [
        None,  # relatedToVideoId (품질 최고)
        " ".join(base_keywords[:4]),  # 키워드 검색 (다양한 후보)
    ]

    seen: set[str] = set()

    for query in search_queries:
        if query is None:
            url = (
                f"{YOUTUBE_BASE_URL}/search?part=snippet&type=video&maxResults=50"
                f"&relatedToVideoId={source_video_id}&key={api_key}"
            )
        else:
            query_text = _normalize_spaces(query)
            if not query_text:
                continue
            url = (
                f"{YOUTUBE_BASE_URL}/search?part=snippet&type=video&maxResults=50"
                f"&q={requests.utils.quote(query_text)}&order=relevance&key={api_key}"
            )
        try:
            data = _fetch_json(url, headers=request_headers)
        except Exception:
            continue
        for item in data.get("items", []):
            video_id = ((item.get("id") or {}).get("videoId") or "").strip()
            if not video_id:
                continue
            if video_id in seen:
                continue
            seen.add(video_id)
            if len(seen) >= max_ids:
                return list(seen)
    return list(seen)


def _get_video_details(api_key: str, video_ids: list[str], request_headers: dict[str, str] | None = None) -> list[dict[str, Any]]:
    if not video_ids:
        return []
    all_items: list[dict[str, Any]] = []
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i : i + 50]
        url = (
            f"{YOUTUBE_BASE_URL}/videos?part=snippet,statistics,contentDetails"
            f"&id={','.join(chunk)}&key={api_key}"
        )
        data = _fetch_json(url, headers=request_headers)
        all_items.extend(data.get("items", []))
    return all_items


# ── 메인 함수 ─────────────────────────────────────────────────────────────
def find_similar_thumbnails(
    api_key: str,
    source_video: str,
    top_k: int = 20,
    referer: str | None = None,
) -> dict[str, Any]:
    source_video_id = _parse_video_id(source_video)
    if not source_video_id:
        return {"success": False, "error": "유효한 유튜브 영상 URL 또는 ID를 입력해주세요."}

    request_headers = {"Referer": referer} if referer else None

    # 원본 영상 정보 조회
    source_url = (
        f"{YOUTUBE_BASE_URL}/videos?part=snippet,statistics,contentDetails"
        f"&id={source_video_id}&key={api_key}"
    )
    try:
        source_data = _fetch_json(source_url, headers=request_headers)
    except Exception as e:
        return {"success": False, "error": f"원본 영상 정보를 불러오지 못했습니다: {str(e)}"}

    source_items = source_data.get("items") or []
    if not source_items:
        return {"success": False, "error": "원본 영상을 찾을 수 없습니다."}

    source_item = source_items[0]
    source_snippet = source_item.get("snippet") or {}
    source_title = source_snippet.get("title") or ""
    source_channel = source_snippet.get("channelTitle") or ""
    source_thumb = _best_thumb(source_snippet)
    # 원본 썸네일 분석 (CLIP + 색상)
    source_features = _download_and_analyze(source_thumb)
    if source_features is None or source_features.clip_vec is None:
        return {"success": False, "error": "원본 썸네일을 분석하지 못했습니다."}

    # 후보 수집 (max 200)
    try:
        candidate_ids = _search_candidate_ids(
            api_key,
            source_video_id,
            source_title,
            source_channel,
            max_ids=150,
            request_headers=request_headers,
        )
    except Exception as e:
        return {"success": False, "error": f"유사 후보 검색에 실패했습니다: {str(e)}"}

    candidate_ids = [vid for vid in candidate_ids if vid != source_video_id]
    if not candidate_ids:
        return {
            "success": False,
            "error": "유사 후보를 찾지 못했습니다. API 키 제한(HTTP referrer/IP) 또는 검색 파라미터 제한일 수 있습니다.",
        }

    # 후보 상세 조회
    try:
        details = _get_video_details(api_key, candidate_ids, request_headers=request_headers)
    except Exception as e:
        return {"success": False, "error": f"후보 상세 조회에 실패했습니다: {str(e)}"}

    source_tokens = _tokenize(source_title)
    candidates: list[Candidate] = []

    for item in details:
        vid = (item.get("id") or "").strip()
        snippet = item.get("snippet") or {}
        title = snippet.get("title") or ""
        channel_title = snippet.get("channelTitle") or ""
        thumb = _best_thumb(snippet)
        if not vid or not thumb:
            continue

        title_sim = _jaccard(source_tokens, _tokenize(title))
        channel_boost = 1.0 if channel_title.lower() == source_channel.lower() else 0.0
        stats = item.get("statistics") or {}
        views = int(stats.get("viewCount") or 0)
        content_details = item.get("contentDetails") or {}
        candidates.append(
            Candidate(
                video_id=vid,
                title=title,
                channel_title=channel_title,
                thumbnail_url=thumb,
                published_at=snippet.get("publishedAt") or "",
                view_count=views,
                duration_iso=content_details.get("duration") or "",
                title_similarity=title_sim,
                channel_boost=channel_boost,
            )
        )

    # ── 멀티스레드 점수 산출 (CLIP + 색상 + 제목) ─────────────────────────
    # 가중치: CLIP 의미적 유사도 60% + 색상 히스토그램 25% + 제목 10% + 채널 5%
    W_CLIP = 0.60
    W_COLOR = 0.25
    W_TITLE = 0.10
    W_CHANNEL = 0.05

    def score_candidate(candidate: Candidate) -> dict[str, Any] | None:
        cand_features = _download_and_analyze(candidate.thumbnail_url)
        if cand_features is None or cand_features.clip_vec is None:
            return None

        # CLIP 코사인 유사도 (벡터가 이미 L2 정규화됨 → dot product = cosine)
        clip_sim = float(np.dot(source_features.clip_vec, cand_features.clip_vec))
        clip_sim = max(0.0, min(1.0, clip_sim))

        # 색상 히스토그램 유사도
        color_sim = 0.0
        if source_features.color_hist is not None and cand_features.color_hist is not None:
            color_sim = _histogram_similarity(source_features.color_hist, cand_features.color_hist)

        # 종합 점수
        score = (
            clip_sim * W_CLIP
            + color_sim * W_COLOR
            + candidate.title_similarity * W_TITLE
            + candidate.channel_boost * W_CHANNEL
        )

        return {
            "videoId": candidate.video_id,
            "title": candidate.title,
            "channelTitle": candidate.channel_title,
            "thumbnailUrl": candidate.thumbnail_url,
            "publishedAt": candidate.published_at,
            "duration": _iso8601_to_hms(candidate.duration_iso),
            "views": candidate.view_count,
            "score": round(score * 100, 1),
            "thumbSimilarity": round(clip_sim * 100, 1),
            "colorSimilarity": round(color_sim * 100, 1),
            "titleSimilarity": round(candidate.title_similarity * 100, 1),
            "channelMatch": bool(candidate.channel_boost > 0),
        }

    with ThreadPoolExecutor(max_workers=8) as executor:
        scored = list(executor.map(score_candidate, candidates))

    filtered = [item for item in scored if item is not None]
    filtered.sort(key=lambda x: (x["score"], x["views"]), reverse=True)
    top_items = filtered[: max(1, min(top_k, 30))]

    source_result = {
        "videoId": source_video_id,
        "title": source_title,
        "channelTitle": source_channel,
        "thumbnailUrl": source_thumb,
        "publishedAt": source_snippet.get("publishedAt") or "",
        "duration": _iso8601_to_hms((source_item.get("contentDetails") or {}).get("duration") or ""),
        "views": int((source_item.get("statistics") or {}).get("viewCount") or 0),
    }

    now_kst = datetime.now(KST).strftime("%Y-%m-%d %H:%M:%S")
    return {
        "success": True,
        "generatedAt": now_kst,
        "source": source_result,
        "count": len(top_items),
        "items": top_items,
    }
