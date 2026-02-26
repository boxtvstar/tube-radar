"""
Vercel Serverless Function: YouTube 자막 추출
youtube-transcript-api 기반
"""

from http.server import BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
)


def extract_transcript(video_id: str, lang_priority: list[str] | None = None) -> dict:
    if lang_priority is None:
        lang_priority = ["ko", "en"]

    result = {
        "success": False,
        "video_id": video_id,
        "language": None,
        "is_generated": False,
        "segments": [],
        "full_text": "",
        "error": None,
    }

    try:
        ytt_api = YouTubeTranscriptApi()
        transcript_list = ytt_api.list(video_id)

        transcript = None

        # 1. 수동 자막 우선 탐색
        for lang in lang_priority:
            try:
                transcript = transcript_list.find_manually_created_transcript([lang])
                result["is_generated"] = False
                break
            except NoTranscriptFound:
                continue

        # 2. 자동 생성 자막 탐색
        if transcript is None:
            for lang in lang_priority:
                try:
                    transcript = transcript_list.find_generated_transcript([lang])
                    result["is_generated"] = True
                    break
                except NoTranscriptFound:
                    continue

        # 3. 아무 자막이나 가져오기
        if transcript is None:
            try:
                for t in transcript_list:
                    transcript = t
                    result["is_generated"] = t.is_generated
                    break
            except Exception:
                pass

        if transcript is None:
            result["error"] = "이 영상에 사용 가능한 자막이 없습니다."
            return result

        # 4. 자막 데이터 fetch
        segments = transcript.fetch()
        result["language"] = transcript.language_code
        result["segments"] = [
            {
                "start": round(seg.start, 2),
                "duration": round(seg.duration, 2),
                "text": seg.text,
            }
            for seg in segments
        ]
        result["full_text"] = "\n".join(seg.text for seg in segments)
        result["success"] = True

    except TranscriptsDisabled:
        result["error"] = "이 영상은 자막이 비활성화되어 있습니다."
    except VideoUnavailable:
        result["error"] = "영상을 찾을 수 없거나 비공개 상태입니다."
    except NoTranscriptFound:
        result["error"] = "이 영상에 사용 가능한 자막이 없습니다."
    except Exception as e:
        result["error"] = f"자막 추출 중 오류 발생: {str(e)}"

    return result


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)

        video_id = params.get("v", [None])[0]
        lang_str = params.get("lang", ["ko,en"])[0]
        lang_priority = [l.strip() for l in lang_str.split(",")]

        if not video_id:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({
                "success": False,
                "error": "video_id (v) parameter is required"
            }).encode())
            return

        result = extract_transcript(video_id, lang_priority)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(result, ensure_ascii=False).encode())
