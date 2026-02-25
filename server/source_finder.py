from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO
import math
import re
from typing import Any

import imagehash
from PIL import Image
import requests


YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3"


@dataclass
class SourceCandidate:
    video_id: str
    title: str
    channel_title: str
    thumbnail_url: str
    views: int
    published_at: str
    duration_iso: str
    title_similarity: float
    duration_similarity: float
    channel_boost: float


def _normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _tokenize(text: str) -> set[str]:
    cleaned = re.sub(r"[^\w\s가-힣]", " ", (text or "").lower())
    words = [w for w in cleaned.split() if len(w) >= 2]
    stop = {
        "official",
        "video",
        "music",
        "with",
        "from",
        "this",
        "that",
        "the",
        "and",
        "feat",
        "live",
        "full",
        "version",
        "ep",
        "part",
        "shorts",
    }
    return {w for w in words if w not in stop}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    union = len(a | b)
    if union == 0:
        return 0.0
    return len(a & b) / union


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


def _fetch_json(url: str, timeout: int = 12, headers: dict[str, str] | None = None) -> dict[str, Any]:
    response = requests.get(url, timeout=timeout, headers=headers)
    if not response.ok:
        detail = response.text.strip()
        raise RuntimeError(f"{response.status_code} {detail[:500]}")
    return response.json()


def _compute_phash_from_url(image_url: str) -> imagehash.ImageHash | None:
    if not image_url:
        return None
    try:
        response = requests.get(image_url, timeout=10)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content)).convert("RGB")
        return imagehash.phash(image)
    except Exception:
        return None


def _compute_phash_from_bytes(image_bytes: bytes) -> imagehash.ImageHash | None:
    try:
        image = Image.open(BytesIO(image_bytes)).convert("RGB")
        return imagehash.phash(image)
    except Exception:
        return None


def _iso_duration_to_seconds(duration: str) -> int:
    if not duration:
        return 0
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", duration)
    if not match:
        return 0
    h = int(match.group(1) or 0)
    m = int(match.group(2) or 0)
    s = int(match.group(3) or 0)
    return h * 3600 + m * 60 + s


def _iso8601_to_hms(duration: str) -> str:
    total = _iso_duration_to_seconds(duration)
    if total <= 0:
        return "-"
    h = total // 3600
    m = (total % 3600) // 60
    s = total % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def _search_video_ids(
    api_key: str,
    queries: list[str | None],
    source_video_id: str | None = None,
    max_ids: int = 160,
    request_headers: dict[str, str] | None = None,
) -> list[str]:
    seen: set[str] = set()
    for query in queries:
        if query is None and source_video_id:
            url = (
                f"{YOUTUBE_BASE_URL}/search?part=snippet&type=video&maxResults=50"
                f"&relatedToVideoId={source_video_id}&key={api_key}"
            )
        else:
            q = _normalize_spaces(query or "")
            if not q:
                continue
            url = (
                f"{YOUTUBE_BASE_URL}/search?part=snippet&type=video&maxResults=50"
                f"&order=relevance&q={requests.utils.quote(q)}&key={api_key}"
            )

        try:
            data = _fetch_json(url, headers=request_headers)
        except Exception:
            continue

        for item in data.get("items", []):
            video_id = ((item.get("id") or {}).get("videoId") or "").strip()
            if not video_id or video_id in seen:
                continue
            seen.add(video_id)
            if len(seen) >= max_ids:
                return list(seen)
    return list(seen)


def _get_video_details(api_key: str, video_ids: list[str], request_headers: dict[str, str] | None = None) -> list[dict[str, Any]]:
    all_items: list[dict[str, Any]] = []
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i : i + 50]
        if not chunk:
            continue
        url = (
            f"{YOUTUBE_BASE_URL}/videos?part=snippet,statistics,contentDetails"
            f"&id={','.join(chunk)}&key={api_key}"
        )
        data = _fetch_json(url, headers=request_headers)
        all_items.extend(data.get("items", []))
    return all_items


def _duration_similarity(a_iso: str, b_iso: str) -> float:
    a = _iso_duration_to_seconds(a_iso)
    b = _iso_duration_to_seconds(b_iso)
    if a <= 0 or b <= 0:
        return 0.0
    diff = abs(a - b)
    return math.exp(-(diff / 60.0))


def find_source_from_video_url(
    api_key: str,
    source_video: str,
    top_k: int = 20,
    referer: str | None = None,
) -> dict[str, Any]:
    source_video_id = _parse_video_id(source_video)
    if not source_video_id:
        return {"success": False, "error": "유효한 유튜브 영상 URL 또는 ID를 입력해주세요."}

    request_headers = {"Referer": referer} if referer else None

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
        return {"success": False, "error": "입력한 영상을 찾을 수 없습니다."}

    source_item = source_items[0]
    source_snippet = source_item.get("snippet") or {}
    source_title = source_snippet.get("title") or ""
    source_channel = source_snippet.get("channelTitle") or ""
    source_duration_iso = (source_item.get("contentDetails") or {}).get("duration") or ""
    source_thumb = _best_thumb(source_snippet)
    source_hash = _compute_phash_from_url(source_thumb)
    if source_hash is None:
        return {"success": False, "error": "원본 썸네일 해시를 만들 수 없습니다."}

    title_tokens = list(_tokenize(source_title))
    base_keywords = title_tokens[:6] if title_tokens else source_title.split()[:3]
    queries: list[str | None] = [
        None,
        " ".join(base_keywords[:4]),
        " ".join(base_keywords[:2] + [source_channel]),
        source_channel,
    ]

    candidate_ids = _search_video_ids(
        api_key,
        queries,
        source_video_id=source_video_id,
        max_ids=180,
        request_headers=request_headers,
    )
    candidate_ids = [vid for vid in candidate_ids if vid != source_video_id]
    if not candidate_ids:
        return {"success": False, "error": "후보 영상을 찾지 못했습니다."}

    try:
        details = _get_video_details(api_key, candidate_ids, request_headers=request_headers)
    except Exception as e:
        return {"success": False, "error": f"후보 상세 조회 실패: {str(e)}"}

    source_tokens = _tokenize(source_title)
    candidates: list[SourceCandidate] = []
    for item in details:
        vid = (item.get("id") or "").strip()
        snippet = item.get("snippet") or {}
        thumb = _best_thumb(snippet)
        if not vid or not thumb:
            continue
        title = snippet.get("title") or ""
        channel = snippet.get("channelTitle") or ""
        views = int((item.get("statistics") or {}).get("viewCount") or 0)
        duration_iso = (item.get("contentDetails") or {}).get("duration") or ""

        candidates.append(
            SourceCandidate(
                video_id=vid,
                title=title,
                channel_title=channel,
                thumbnail_url=thumb,
                views=views,
                published_at=snippet.get("publishedAt") or "",
                duration_iso=duration_iso,
                title_similarity=_jaccard(source_tokens, _tokenize(title)),
                duration_similarity=_duration_similarity(source_duration_iso, duration_iso),
                channel_boost=1.0 if channel.lower() == source_channel.lower() else 0.0,
            )
        )

    def score_candidate(candidate: SourceCandidate) -> dict[str, Any] | None:
        cand_hash = _compute_phash_from_url(candidate.thumbnail_url)
        if cand_hash is None:
            return None
        ham = source_hash - cand_hash
        thumb_similarity = max(0.0, 1.0 - (ham / 64.0))
        score = (thumb_similarity * 0.68) + (candidate.title_similarity * 0.20) + (candidate.duration_similarity * 0.08) + (candidate.channel_boost * 0.04)
        match_type = "유사"
        if thumb_similarity >= 0.9 and candidate.duration_similarity >= 0.7:
            match_type = "동일 가능성 높음"
        elif thumb_similarity >= 0.8:
            match_type = "썸네일 동일/유사"

        return {
            "videoId": candidate.video_id,
            "title": candidate.title,
            "channelTitle": candidate.channel_title,
            "thumbnailUrl": candidate.thumbnail_url,
            "publishedAt": candidate.published_at,
            "duration": _iso8601_to_hms(candidate.duration_iso),
            "views": candidate.views,
            "score": round(score * 100, 1),
            "thumbSimilarity": round(thumb_similarity * 100, 1),
            "titleSimilarity": round(candidate.title_similarity * 100, 1),
            "durationSimilarity": round(candidate.duration_similarity * 100, 1),
            "matchType": match_type,
        }

    with ThreadPoolExecutor(max_workers=10) as executor:
        scored = list(executor.map(score_candidate, candidates))

    items = [x for x in scored if x is not None]
    items.sort(key=lambda x: (x["score"], x["views"]), reverse=True)
    items = items[: max(1, min(top_k, 30))]

    return {
        "success": True,
        "mode": "url",
        "source": {
            "videoId": source_video_id,
            "title": source_title,
            "channelTitle": source_channel,
            "thumbnailUrl": source_thumb,
            "duration": _iso8601_to_hms(source_duration_iso),
            "views": int((source_item.get("statistics") or {}).get("viewCount") or 0),
        },
        "count": len(items),
        "items": items,
    }


def find_source_from_image(
    api_key: str,
    image_bytes: bytes,
    query: str,
    top_k: int = 20,
    referer: str | None = None,
) -> dict[str, Any]:
    q = _normalize_spaces(query)
    if not q:
        return {"success": False, "error": "이미지 검색에는 키워드(채널명/주제) 입력이 필요합니다."}

    image_hash = _compute_phash_from_bytes(image_bytes)
    if image_hash is None:
        return {"success": False, "error": "업로드한 이미지를 분석하지 못했습니다."}

    request_headers = {"Referer": referer} if referer else None

    queries: list[str | None] = [q, f"{q} official", f"{q} video"]
    candidate_ids = _search_video_ids(api_key, queries, max_ids=150, request_headers=request_headers)
    if not candidate_ids:
        return {"success": False, "error": "검색 후보를 찾지 못했습니다. 키워드를 더 구체적으로 입력해주세요."}

    try:
        details = _get_video_details(api_key, candidate_ids, request_headers=request_headers)
    except Exception as e:
        return {"success": False, "error": f"후보 상세 조회 실패: {str(e)}"}

    title_tokens = _tokenize(q)

    def score_item(item: dict[str, Any]) -> dict[str, Any] | None:
        vid = (item.get("id") or "").strip()
        snippet = item.get("snippet") or {}
        title = snippet.get("title") or ""
        thumb = _best_thumb(snippet)
        if not vid or not thumb:
            return None
        cand_hash = _compute_phash_from_url(thumb)
        if cand_hash is None:
            return None
        ham = image_hash - cand_hash
        thumb_similarity = max(0.0, 1.0 - (ham / 64.0))
        title_similarity = _jaccard(title_tokens, _tokenize(title))
        score = (thumb_similarity * 0.82) + (title_similarity * 0.18)
        return {
            "videoId": vid,
            "title": title,
            "channelTitle": snippet.get("channelTitle") or "",
            "thumbnailUrl": thumb,
            "publishedAt": snippet.get("publishedAt") or "",
            "duration": _iso8601_to_hms((item.get("contentDetails") or {}).get("duration") or ""),
            "views": int((item.get("statistics") or {}).get("viewCount") or 0),
            "score": round(score * 100, 1),
            "thumbSimilarity": round(thumb_similarity * 100, 1),
            "titleSimilarity": round(title_similarity * 100, 1),
            "matchType": "이미지 근접 유사",
        }

    with ThreadPoolExecutor(max_workers=10) as executor:
        scored = list(executor.map(score_item, details))

    items = [x for x in scored if x is not None]
    items.sort(key=lambda x: (x["score"], x["views"]), reverse=True)
    items = items[: max(1, min(top_k, 30))]

    return {
        "success": True,
        "mode": "image",
        "query": q,
        "count": len(items),
        "items": items,
    }
