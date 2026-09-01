"""
Vercel Serverless Function: 시크릿 추천 소재 일일 자동 등록 (Vercel Cron 전용)

매일 1회 실행되어 대기열(system_data/topic_queue)에서 채널 1개를 꺼내
TubeLab 무료 API로 채널·영상 데이터를 수집하고, Gemini로 한국어 추천 설명을
생성한 뒤 recommended_topics 에 승인 상태로 등록한다.

필요 환경변수 (실서비스 tube-radar 프로젝트에만 설정):
- FIREBASE_SERVICE_ACCOUNT : Firebase 서비스 계정 JSON 전체
- TUBELAB_API_KEY          : TubeLab API 키
- GEMINI_API_KEY_SERVER    : Gemini API 키 (설명 생성용)
- CRON_SECRET              : Vercel Cron 인증용 (설정 시 Vercel이 자동으로 헤더에 부착)

환경변수가 없는 배포(테스트 프로젝트)에서는 아무것도 하지 않고 종료한다.
?dry=1 로 호출하면 Firestore에 쓰지 않고 등록될 내용만 반환한다.
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import os
import time

import requests

TUBELAB_BASE = "https://public-api.tubelab.net/v1"
GEMINI_MODEL = "gemini-3.6-flash"
LOW_QUEUE_THRESHOLD = 5

# 최초 실행 시 Firestore에 시드되는 대기열 (TubeLab 니치파인더 2026-09-01 수집분)
QUEUE_SEED = [
    {"id": "UC0YtlyY25pnG_nFEg-BT7VA", "note": "니치 리포트: Extreme Engineering Docs"},
    {"id": "UC4xbgiqEJsDsdE8hmOo4SyQ", "note": "니치 리포트: Wealth Psychology Explainers"},
    {"id": "UCgEL0fqNd4eV6-qbqdbzJUQ", "note": "니치 리포트: Business Model Explainers"},
    {"id": "UC4NzjOdt2s-OQolQK6cMrLg", "note": "니치 리포트: Geopolitics Travel Docs"},
    {"id": "UChkuW8UnF3RAOV4mMJNoDNw", "note": "니치 리포트: Global Market Explainers"},
    {"id": "UCfDKRtviGZ1iSx92wzyt93Q", "note": "니치 리포트: Tech Software Listicles"},
    {"id": "UCrs8AmQ_vAUCURyDPBa1p9g", "note": "니치 리포트: US Retirement Listicles"},
    {"id": "UCy-tEkk4TiAP_EcAjAQHnUA", "note": "니치 리포트: Aviation Business Drama"},
    {"id": "UCu0AeKOY3uC5CVD028YJwIg", "note": "니치 리포트: Luxury Real Estate"},
    {"id": "UClYwxoyYxDKdI7FTSBsCJKw", "note": "니치 리포트: Luxury Interior Tours"},
    {"id": "UC07cLEO_ilD1RqNEK5S9nJQ", "note": "니치 리포트: Collapse History Docs"},
    {"id": "UCBEIi30OwNVPMeygHvqva7w", "note": "니치 리포트: Urban Decline Docs"},
    {"id": "UCoUFulGW9Vv7je53y0YOdBw", "note": "니치 리포트: Extreme Nature Docs"},
    {"id": "UCbEyUOPiOvMn8IhSKOyxvwg", "note": "니치 리포트: Mystery Archaeology Docs"},
    {"id": "UCyQ67ObfsdsQO9C05gMUriA", "note": "니치 리포트: Disaster History Docs"},
    {"id": "UCCZNgDngml_K8CnQxMrg-rQ", "note": "니치 리포트: Deep Ocean Docs"},
    {"id": "UCs9FqpsEtHaH7smO7oFLyOg", "note": "니치 리포트: Spiritual Sleep Stories"},
    {"id": "UCKUtVIyDAYQJdELjmGb8KWQ", "note": "니치 리포트: Mythology Sleep Stories"},
    {"id": "UCSOl_iT3qrwcsfXuMpFd_1w", "note": "니치 리포트: War History Docs"},
    {"id": "UCXpGOkpR0U9D6NhY2lbaYCQ", "note": "수익형 채널 (@abrahamiscoocking)"},
    {"id": "UCQ8ZZiluVgKO_QpEZsIKvHw", "note": "수익형 채널 (@a.walktour)"},
    {"id": "UC_6dEuq3pn3R4v0zyELKZ5A", "note": "수익형 채널 (@StrainArchivesYT)"},
    {"id": "UCAx7yvxYSzklMFbzAeriHaQ", "note": "수익형 채널 (@LetsGoSwimmin)"},
    {"id": "UCgqTPWHzuh7KJTeTh3vNzKQ", "note": "수익형 채널 (@PeacefulVietnamLife-Kit)"},
    {"id": "UCGUBXq7NYQrW-mF3R7XVp-Q", "note": "수익형 채널 (@FoodforGood-a21)"},
    {"id": "UCZdlbfB69vYNj5B4gYGU37Q", "note": "수익형 채널 (@Davescotttalks)"},
    {"id": "UChHOzUIfKqtAeUGjqR7_whQ", "note": "수익형 채널 (@laustoic)"},
    {"id": "UCr0MAmWJyifrjYOgawal9Tg", "note": "급상승 채널 (@QiuraW)"},
    {"id": "UCbjlXpA3FtyfT2q5-80rHDA", "note": "급상승 채널 (@LateSpurt)"},
    {"id": "UC6v4-JhlGISm8yNrkCptHVA", "note": "급상승 채널 (@VuDavid-q5r)"},
    {"id": "UCYNUGkvkstflcqbF6aApkSA", "note": "급상승 채널 (@thejaejams)"},
    {"id": "UC4vT_oTAkd-alJ2_xhLBsbA", "note": "급상승 채널 (@FamilyLaughsHub)"},
    {"id": "UCJ1ZotSqRdnNZpPuDBtYl_w", "note": "급상승 채널 (@MechanicGirlLife)"},
    {"id": "UC4DeC9rbFwdKnrucKk10-9w", "note": "급상승 채널 (@DeepBiblicalEchoes)"},
]


# ---------------------------------------------------------------- Firestore REST

def _get_access_token(sa_info: dict) -> str:
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request

    creds = service_account.Credentials.from_service_account_info(
        sa_info, scopes=["https://www.googleapis.com/auth/datastore"]
    )
    creds.refresh(Request())
    return creds.token


def _fs_encode(value):
    """Python 값 → Firestore REST 타입 값"""
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [_fs_encode(v) for v in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {k: _fs_encode(v) for k, v in value.items()}}}
    raise TypeError(f"unsupported type: {type(value)}")


def _fs_decode(field):
    if "nullValue" in field:
        return None
    if "booleanValue" in field:
        return field["booleanValue"]
    if "integerValue" in field:
        return int(field["integerValue"])
    if "doubleValue" in field:
        return field["doubleValue"]
    if "stringValue" in field:
        return field["stringValue"]
    if "arrayValue" in field:
        return [_fs_decode(v) for v in field["arrayValue"].get("values", [])]
    if "mapValue" in field:
        return {k: _fs_decode(v) for k, v in field["mapValue"].get("fields", {}).items()}
    return None


class Firestore:
    def __init__(self, sa_info: dict):
        self.project = sa_info["project_id"]
        self.token = _get_access_token(sa_info)
        self.base = f"https://firestore.googleapis.com/v1/projects/{self.project}/databases/(default)/documents"

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}

    def get(self, path: str):
        r = requests.get(f"{self.base}/{path}", headers=self._headers(), timeout=15)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        doc = r.json()
        return {k: _fs_decode(v) for k, v in doc.get("fields", {}).items()}

    def set(self, path: str, data: dict):
        body = {"fields": {k: _fs_encode(v) for k, v in data.items()}}
        r = requests.patch(f"{self.base}/{path}", headers=self._headers(), json=body, timeout=20)
        r.raise_for_status()

    def query_admins(self) -> list[str]:
        body = {
            "structuredQuery": {
                "from": [{"collectionId": "users"}],
                "where": {
                    "fieldFilter": {
                        "field": {"fieldPath": "role"},
                        "op": "EQUAL",
                        "value": {"stringValue": "admin"},
                    }
                },
                "limit": 10,
            }
        }
        r = requests.post(
            f"https://firestore.googleapis.com/v1/projects/{self.project}/databases/(default)/documents:runQuery",
            headers=self._headers(), json=body, timeout=15,
        )
        r.raise_for_status()
        uids = []
        for row in r.json():
            name = row.get("document", {}).get("name", "")
            if name:
                uids.append(name.rsplit("/", 1)[-1])
        return uids


# ---------------------------------------------------------------- 데이터 수집/생성

def _format_duration(seconds) -> str:
    try:
        s = int(seconds or 0)
    except (TypeError, ValueError):
        s = 0
    return f"{s // 60}:{s % 60:02d}"


def fetch_channel(channel_id: str) -> dict | None:
    r = requests.get(
        f"{TUBELAB_BASE}/channel/videos/{channel_id}",
        headers={"Authorization": f"Api-Key {os.environ['TUBELAB_API_KEY']}"},
        timeout=25,
    )
    if not r.ok:
        return None
    return r.json().get("item")


def build_saved_channel(channel_id: str, item: dict) -> dict:
    sn = item.get("snippet", {})
    st = item.get("statistics", {})
    videos = sorted(item.get("videos", []), key=lambda v: v.get("viewCount") or 0, reverse=True)[:10]
    thumbs = sn.get("thumbnails", {})
    thumb = (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url", "")
    top_videos = []
    for v in videos:
        vt = v.get("thumbnails", {})
        top_videos.append({
            "id": v.get("id", ""),
            "title": v.get("title", ""),
            "thumbnail": (vt.get("medium") or vt.get("high") or vt.get("default") or {}).get("url", ""),
            "views": f"{int(v.get('viewCount') or 0):,}",
            "date": v.get("publishedAtEstimate") or "",
            "publishedAt": v.get("publishedAtEstimate") or "",
            "duration": _format_duration(v.get("duration")),
        })
    return {
        "id": channel_id,
        "title": sn.get("title", ""),
        "description": (sn.get("description") or "")[:500],
        "thumbnail": thumb,
        "customUrl": sn.get("handle", ""),
        "subscriberCount": f"{int(st.get('subscriberCount') or 0):,}",
        "videoCount": str(st.get("videosCount") or ""),
        "platform": "youtube",
        "topVideos": top_videos,
        "addedAt": int(time.time() * 1000),
    }


def generate_description(channel_title: str, channel_desc: str, video_titles: list[str]) -> str:
    prompt = f"""
당신은 유튜브 채널 분석 전문가입니다.
다음 채널 정보를 바탕으로, 이 채널을 "유튜브 소재"로 추천하는 이유를 2~3문장으로 매력적이고 통찰력 있게 요약해서 작성해주세요.
문체는 "~함", "~임" 등의 간결한 명사형 종결어미를 사용하거나, 전문적인 어조를 사용하세요.

채널명: {channel_title}
채널 설명: {channel_desc[:300]}
최근 주요 영상:
{chr(10).join('- ' + t for t in video_titles[:5])}

추천 이유:
""".strip()
    r = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        params={"key": os.environ["GEMINI_API_KEY_SERVER"]},
        json={"contents": [{"parts": [{"text": prompt}]}]},
        timeout=40,
    )
    if not r.ok:
        return ""
    try:
        return (r.json()["candidates"][0]["content"]["parts"][0]["text"] or "").strip()
    except (KeyError, IndexError):
        return ""


# ---------------------------------------------------------------- 메인 로직

def _parse_service_account(raw: str) -> dict:
    """붙여넣기 과정에서 흔히 섞이는 BOM/공백/감싼 따옴표를 정리한 뒤 JSON 파싱."""
    s = raw.strip().lstrip("﻿").strip()
    if len(s) >= 2 and s[0] in "\"'" and s[-1] == s[0]:
        s = s[1:-1]
    # 이스케이프된 개행이 실제 개행으로 바뀐 경우까지는 json이 처리하므로 그대로 파싱
    return json.loads(s)


def run(dry: bool) -> dict:
    sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
    if not sa_raw or not os.environ.get("TUBELAB_API_KEY"):
        return {
            "skipped": True,
            "reason": "not configured (env vars missing)",
            "has_firebase": bool(sa_raw),
            "has_tubelab": bool(os.environ.get("TUBELAB_API_KEY")),
            "has_gemini": bool(os.environ.get("GEMINI_API_KEY_SERVER")),
        }
    try:
        sa_info = _parse_service_account(sa_raw)
    except Exception as e:
        # 비밀은 노출하지 않고 진단 정보만 반환
        head = sa_raw.lstrip()[:1]
        return {
            "error": "FIREBASE_SERVICE_ACCOUNT is not valid JSON",
            "detail": str(e)[:120],
            "length": len(sa_raw),
            "starts_with": repr(head),
            "looks_like_json": sa_raw.strip().startswith("{"),
        }

    fs = Firestore(sa_info)
    queue = fs.get("system_data/topic_queue")
    if queue is None:
        queue = {"pending": QUEUE_SEED, "done": [], "updatedAt": ""}
        if not dry:
            fs.set("system_data/topic_queue", queue)

    pending = queue.get("pending", [])
    if not pending:
        return {"posted": False, "reason": "queue empty", "remaining": 0}

    entry = pending[0]
    channel_id = entry["id"]

    item = fetch_channel(channel_id)
    if item is None:
        # 조회 실패한 채널은 대기열에서 제거하고 다음 실행에 맡긴다
        if not dry:
            fs.set("system_data/topic_queue", {
                "pending": pending[1:],
                "done": queue.get("done", []) + [{**entry, "error": "fetch failed"}],
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        return {"posted": False, "reason": f"channel fetch failed: {channel_id}"}

    saved_channel = build_saved_channel(channel_id, item)
    desc = generate_description(
        saved_channel["title"],
        saved_channel["description"],
        [v["title"] for v in saved_channel["topVideos"]],
    ) or f"TubeLab 니치파인더 발굴 채널. ({entry.get('note', '')})"

    now_ms = int(time.time() * 1000)
    topic = {
        "id": str(now_ms),
        "title": saved_channel["title"],
        "description": desc,
        "category": "Topic",
        "createdAt": now_ms,
        "channels": [saved_channel],
        "channelCount": 1,
        "status": "approved",
        "creatorName": "TubeLab Auto",
    }

    remaining = len(pending) - 1
    if not dry:
        fs.set(f"recommended_topics/{topic['id']}", topic)
        fs.set("system_data/topic_queue", {
            "pending": pending[1:],
            "done": queue.get("done", []) + [{**entry, "postedAt": now_ms, "topicId": topic["id"]}],
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })
        if remaining <= LOW_QUEUE_THRESHOLD:
            try:
                for uid in fs.query_admins():
                    nid = str(now_ms)
                    fs.set(f"users/{uid}/notifications/{nid}", {
                        "id": nid,
                        "userId": uid,
                        "title": "추천 소재 대기열 부족",
                        "message": f"자동 등록 대기열이 {remaining}개 남았습니다. TubeLab에서 새 채널을 보충해주세요.",
                        "type": "info",
                        "isRead": False,
                        "createdAt": now_ms,
                    })
            except Exception:
                pass

    return {
        "posted": True,
        "dry": dry,
        "topic": {"id": topic["id"], "title": topic["title"], "description": desc[:200], "videos": len(saved_channel["topVideos"])},
        "source": entry.get("note", ""),
        "remaining": remaining,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        dry = params.get("dry", ["0"])[0] == "1"

        # Vercel Cron 인증 (CRON_SECRET 설정 시 Vercel이 Authorization 헤더로 전달)
        secret = os.environ.get("CRON_SECRET", "")
        if secret and not dry:
            if self.headers.get("Authorization", "") != f"Bearer {secret}":
                self._send(401, {"error": "unauthorized"})
                return

        try:
            result = run(dry)
            self._send(200, result)
        except Exception as e:
            self._send(500, {"error": str(e)[:300]})

    def _send(self, status: int, body: dict):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)
