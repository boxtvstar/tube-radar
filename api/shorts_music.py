"""
Vercel Serverless Function: 쇼츠 인기 음악 차트
YouTube Charts 내부 API에서 SHORTS_TRACKS_BY_USAGE 데이터 수집
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import time
import logging
from datetime import datetime, timezone, timedelta
import re as _re

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# In-memory cache (cold start마다 리셋)
# ---------------------------------------------------------------------------
_cache: dict | None = None
_cache_time: float = 0
CACHE_TTL = 7200  # 2 hours

_KST = timezone(timedelta(hours=9))

CHARTS_API_URL = "https://charts.youtube.com/youtubei/v1/browse"

CHARTS_PAYLOAD = {
    "browseId": "FEmusic_analytics_charts_home",
    "context": {
        "client": {
            "clientName": "WEB_MUSIC_ANALYTICS",
            "clientVersion": "2.0",
            "hl": "ko",
            "gl": "KR",
        }
    },
    "query": "chart_params_chart_type=SHORTS_TRACKS_BY_USAGE&chart_params_country_code=kr&chart_params_period_type=WEEKLY",
}

CHARTS_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Origin": "https://charts.youtube.com",
    "Referer": "https://charts.youtube.com/",
}


def _parse_chart_response(data: dict) -> list[dict]:
    """YouTube Charts API 응답에서 트랙 목록 파싱

    구조: contents.sectionListRenderer.contents[0]
          .musicAnalyticsSectionRenderer.content.trackTypes[0].trackViews
    """
    tracks: list[dict] = []
    try:
        sections = (
            data.get("contents", {})
            .get("sectionListRenderer", {})
            .get("contents", [])
        )

        track_views: list[dict] = []
        for section in sections:
            content = (
                section.get("musicAnalyticsSectionRenderer", {})
                .get("content", {})
            )
            track_types = content.get("trackTypes", [])
            if track_types:
                track_views = track_types[0].get("trackViews", [])
                break

        for i, entry in enumerate(track_views[:50]):
            track = _parse_single_entry(entry, i + 1)
            if track:
                tracks.append(track)

    except Exception as e:
        logger.warning("Chart response parsing error: %s", e)

    return tracks


def _parse_single_entry(entry: dict, rank: int) -> dict | None:
    """단일 차트 항목 파싱"""
    if not isinstance(entry, dict):
        return None

    name = entry.get("name", "")
    if not name:
        return None

    # Artists: list of {name, kgMid}
    artist = ""
    artists_data = entry.get("artists", [])
    if isinstance(artists_data, list):
        artist = ", ".join(a.get("name", "") for a in artists_data if isinstance(a, dict) and a.get("name"))

    # Thumbnail — use medium quality (index 2 ~480px) or last available
    thumbnail = ""
    thumbs = entry.get("thumbnail", {}).get("thumbnails", [])
    if thumbs:
        # prefer ~320px size for list display
        idx = min(1, len(thumbs) - 1)
        thumbnail = thumbs[idx].get("url", "")

    # Video ID
    video_id = entry.get("encryptedVideoId", "")

    # Rank from chartEntryMetadata
    entry_rank = rank
    meta = entry.get("chartEntryMetadata", {})
    if isinstance(meta, dict):
        current = meta.get("currentPosition")
        if current is not None:
            entry_rank = int(current)

    return {
        "rank": entry_rank,
        "name": name,
        "artist": artist,
        "thumbnail": thumbnail,
        "videoId": video_id,
    }


# ---------------------------------------------------------------------------
# YouTube 쇼츠 검색 / 쇼츠 URL 음악 추출
# ---------------------------------------------------------------------------

_search_cache: dict[str, dict] = {}
SEARCH_CACHE_TTL = 3600  # 1 hour


def _search_shorts(query: str) -> list[dict]:
    """YouTube 검색 HTML에서 쇼츠 추출"""
    cache_key = query.lower().strip()
    if cache_key in _search_cache:
        cached = _search_cache[cache_key]
        if time.time() - cached["_time"] < SEARCH_CACHE_TTL:
            return cached["results"]

    url = f"https://www.youtube.com/results?search_query={requests.utils.quote(query + ' shorts')}&sp=EgIYAQ%3D%3D"
    resp = requests.get(url, headers=CHARTS_HEADERS, timeout=10)
    resp.raise_for_status()

    m = _re.search(r"var ytInitialData\s*=\s*({.*?});</script>", resp.text)
    if not m:
        return []

    data = json.loads(m.group(1))
    results = _parse_search_results(data)
    _search_cache[cache_key] = {"results": results, "_time": time.time()}
    return results


def _parse_search_results(data: dict) -> list[dict]:
    """YouTube 검색 결과에서 쇼츠 + 짧은 영상 추출"""
    videos: list[dict] = []
    seen: set[str] = set()
    try:
        sections = (
            data.get("contents", {})
            .get("twoColumnSearchResultsRenderer", {})
            .get("primaryContents", {})
            .get("sectionListRenderer", {})
            .get("contents", [])
        )
        for section in sections:
            items = section.get("itemSectionRenderer", {}).get("contents", [])
            for item in items:
                # gridShelfViewModel → shortsLockupViewModel (실제 Shorts)
                gs = item.get("gridShelfViewModel")
                if gs:
                    for c in gs.get("contents", []):
                        slv = c.get("shortsLockupViewModel", {})
                        tap = slv.get("onTap", {}).get("innertubeCommand", {}).get("reelWatchEndpoint", {})
                        vid = tap.get("videoId", "")
                        if vid and vid not in seen:
                            seen.add(vid)
                            title = (slv.get("accessibilityText") or "").split(",")[0]
                            videos.append({"videoId": vid, "title": title, "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"})

                # videoRenderer (짧은 일반 영상)
                vr = item.get("videoRenderer")
                if vr:
                    vid = vr.get("videoId", "")
                    if not vid or vid in seen:
                        continue
                    lt = vr.get("lengthText", {}).get("simpleText", "")
                    if lt and ":" in lt:
                        parts = lt.split(":")
                        if len(parts) == 2:
                            try:
                                if int(parts[0]) == 0 and int(parts[1]) <= 60:
                                    seen.add(vid)
                                    title_runs = vr.get("title", {}).get("runs", [])
                                    title = title_runs[0].get("text", "") if title_runs else ""
                                    videos.append({"videoId": vid, "title": title, "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"})
                            except ValueError:
                                pass
    except Exception as e:
        logger.warning("Search parsing error: %s", e)
    return videos[:20]


def _extract_video_id(value: str) -> str:
    """YouTube URL 또는 11자리 ID에서 videoId 추출"""
    value = (value or "").strip()
    if _re.fullmatch(r"[a-zA-Z0-9_-]{11}", value):
        return value

    parsed = urlparse(value)
    if parsed.netloc:
        watch_id = parse_qs(parsed.query).get("v", [""])[0]
        if _re.fullmatch(r"[a-zA-Z0-9_-]{11}", watch_id or ""):
            return watch_id

        parts = [p for p in parsed.path.split("/") if p]
        if parsed.netloc.endswith("youtu.be") and parts:
            candidate = parts[0]
        elif parts and parts[0] in {"shorts", "embed", "live", "v"} and len(parts) > 1:
            candidate = parts[1]
        else:
            candidate = parts[0] if parts else ""
        if _re.fullmatch(r"[a-zA-Z0-9_-]{11}", candidate or ""):
            return candidate

    m = _re.search(r"(?:youtu\.be/|youtube\.com/(?:watch\?.*v=|shorts/|embed/|live/))([a-zA-Z0-9_-]{11})", value)
    return m.group(1) if m else ""


def _text_value(value) -> str:
    if not value:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        if isinstance(value.get("simpleText"), str):
            return value["simpleText"].strip()
        if isinstance(value.get("content"), str):
            return value["content"].strip()
        runs = value.get("runs")
        if isinstance(runs, list):
            return "".join(str(run.get("text", "")) for run in runs if isinstance(run, dict)).strip()
    return ""


def _largest_thumbnail(thumbnails: list[dict]) -> str:
    if not thumbnails:
        return ""
    sorted_thumbs = sorted(
        [t for t in thumbnails if isinstance(t, dict) and t.get("url")],
        key=lambda t: (t.get("width") or 0) * (t.get("height") or 0),
        reverse=True,
    )
    return sorted_thumbs[0].get("url", "") if sorted_thumbs else ""


def _find_music_card(data: dict) -> dict | None:
    """동영상 설명 패널의 음악 카드(videoAttributeViewModel)를 찾는다."""
    found: dict | None = None

    def walk(node):
        nonlocal found
        if found is not None:
            return
        if isinstance(node, dict):
            card = node.get("videoAttributeViewModel")
            if isinstance(card, dict):
                title = _text_value(card.get("title"))
                artist = _text_value(card.get("subtitle"))
                if title and artist:
                    image = card.get("image", {})
                    sources = image.get("sources", []) if isinstance(image, dict) else []
                    thumbnail = _largest_thumbnail(sources)
                    found = {
                        "name": title,
                        "artist": artist,
                        "thumbnail": thumbnail,
                    }
                    return
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(data)
    return found


def _extract_initial_json(html: str, variable: str) -> dict | None:
    m = _re.search(rf"(?:var\s+)?{variable}\s*=\s*({{.*?}});(?:</script>|var\s|\n)", html)
    if not m:
        m = _re.search(rf"{variable}\s*=\s*({{.*?}});", html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def _fallback_track_from_player(player: dict | None, video_id: str) -> dict:
    details = (player or {}).get("videoDetails", {})
    micro = (player or {}).get("microformat", {}).get("playerMicroformatRenderer", {})
    title = details.get("title") or _text_value(micro.get("title"))
    artist = details.get("author") or micro.get("ownerChannelName") or ""

    # 공식 음원 영상은 "아티스트 - 곡명" 형태가 많아 곡명/아티스트를 보정한다.
    if " - " in title:
        left, right = title.split(" - ", 1)
        if left.strip() and right.strip():
            artist = artist or left.strip()
            title = right.strip()

    thumbnails = details.get("thumbnail", {}).get("thumbnails", [])
    thumbnail = _largest_thumbnail(thumbnails) or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    return {
        "name": title or f"YouTube Shorts {video_id}",
        "artist": artist,
        "thumbnail": thumbnail,
    }


def _extract_shorts_music_track(short_url: str) -> dict:
    video_id = _extract_video_id(short_url)
    if not video_id:
        raise ValueError("유효한 YouTube 쇼츠 URL 또는 영상 ID가 아닙니다.")

    url = f"https://www.youtube.com/shorts/{video_id}?hl=ko&gl=KR"
    resp = requests.get(url, headers=CHARTS_HEADERS, timeout=12)
    resp.raise_for_status()

    initial_data = _extract_initial_json(resp.text, "ytInitialData")
    player = _extract_initial_json(resp.text, "ytInitialPlayerResponse")
    card = _find_music_card(initial_data or {})
    source = "music_card" if card else "video_fallback"
    track = card or _fallback_track_from_player(player, video_id)

    return {
        "track": {
            "name": track.get("name", "").strip(),
            "artist": track.get("artist", "").strip(),
            "thumbnail": track.get("thumbnail", "").strip() or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "videoId": video_id,
        },
        "source": source,
        "shortUrl": f"https://www.youtube.com/shorts/{video_id}",
    }


def _fetch_shorts_music(force: bool = False) -> dict:
    """YouTube Charts API에서 쇼츠 인기 음악 가져오기"""
    global _cache, _cache_time

    if not force and _cache and (time.time() - _cache_time) < CACHE_TTL:
        return {**_cache, "cached": True}

    resp = requests.post(
        CHARTS_API_URL,
        json=CHARTS_PAYLOAD,
        headers=CHARTS_HEADERS,
        timeout=15,
    )
    resp.raise_for_status()

    data = resp.json()
    tracks = _parse_chart_response(data)

    now = datetime.now(_KST).isoformat()
    result = {
        "tracks": tracks,
        "cached": False,
        "updated_at": now,
    }

    _cache = result
    _cache_time = time.time()
    return result


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        q = params.get("q", [None])[0]
        extract_url = params.get("extractUrl", [None])[0]

        try:
            if extract_url:
                result = _extract_shorts_music_track(extract_url)
            elif q:
                results = _search_shorts(q)
                result = {"videos": results}
            else:
                force = params.get("force", ["false"])[0].lower() == "true"
                result = _fetch_shorts_music(force=force)
            body = json.dumps(result, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            logger.exception("shorts_music handler error")
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
