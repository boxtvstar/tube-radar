"""
YouTube 자막 추출 모듈
youtube-transcript-api를 사용하여 영상 자막을 [{start, duration, text}] 형태로 반환
"""

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
    NoTranscriptAvailable,
)


def extract_transcript(video_id: str, lang_priority: list[str] | None = None) -> dict:
    """
    YouTube 영상 ID로부터 자막을 추출한다.

    Args:
        video_id: YouTube 영상 ID (11자리)
        lang_priority: 언어 우선순위 리스트 (기본: ['ko', 'en'])

    Returns:
        {
            "success": True/False,
            "video_id": str,
            "language": str,          # 실제 추출된 언어 코드
            "is_generated": bool,     # 자동 생성 자막 여부
            "segments": [             # 자막 세그먼트 배열
                {"start": float, "duration": float, "text": str},
                ...
            ],
            "full_text": str,         # 전체 텍스트 (줄바꿈 연결)
            "error": str | None
        }
    """
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
        # 1. 사용 가능한 자막 목록 조회
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

        transcript = None

        # 2. 수동 자막(직접 입력) 우선 탐색
        for lang in lang_priority:
            try:
                transcript = transcript_list.find_manually_created_transcript([lang])
                result["is_generated"] = False
                break
            except NoTranscriptFound:
                continue

        # 3. 수동 자막 없으면 자동 생성 자막 탐색
        if transcript is None:
            for lang in lang_priority:
                try:
                    transcript = transcript_list.find_generated_transcript([lang])
                    result["is_generated"] = True
                    break
                except NoTranscriptFound:
                    continue

        # 4. 우선순위 언어 모두 없으면 아무 자막이나 가져오기
        if transcript is None:
            try:
                # 수동 자막 중 아무거나
                for t in transcript_list:
                    transcript = t
                    result["is_generated"] = t.is_generated
                    break
            except Exception:
                pass

        if transcript is None:
            result["error"] = "이 영상에 사용 가능한 자막이 없습니다."
            return result

        # 5. 자막 데이터 fetch
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
    except NoTranscriptAvailable:
        result["error"] = "이 영상에 사용 가능한 자막이 없습니다."
    except Exception as e:
        result["error"] = f"자막 추출 중 오류 발생: {str(e)}"

    return result


def list_available_languages(video_id: str) -> dict:
    """영상에 사용 가능한 자막 언어 목록을 반환"""
    try:
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        languages = []
        for t in transcript_list:
            languages.append({
                "code": t.language_code,
                "name": t.language,
                "is_generated": t.is_generated,
            })
        return {"success": True, "video_id": video_id, "languages": languages}
    except Exception as e:
        return {"success": False, "video_id": video_id, "languages": [], "error": str(e)}


# CLI 테스트용
if __name__ == "__main__":
    import sys
    import json

    vid = sys.argv[1] if len(sys.argv) > 1 else "dQw4w9WgXcQ"
    print(f"Extracting transcript for: {vid}\n")

    result = extract_transcript(vid)
    print(json.dumps(result, ensure_ascii=False, indent=2))
