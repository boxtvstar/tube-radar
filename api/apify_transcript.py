"""
Vercel Serverless Function: Apify 자막 추출 프록시
Apify 토큰을 클라이언트 번들에 노출하지 않기 위해 서버에서 대신 호출한다.
"""

from http.server import BaseHTTPRequestHandler
import json
import os

import requests

APIFY_ACTOR_URL = (
    "https://api.apify.com/v2/acts/pintostudio~youtube-transcript-scraper"
    "/run-sync-get-dataset-items"
)


def _get_token() -> str:
    # VITE_APIFY_TOKEN은 기존 Vercel 환경변수를 그대로 재사용하기 위한 fallback
    return os.environ.get("APIFY_TOKEN") or os.environ.get("VITE_APIFY_TOKEN") or ""


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        token = _get_token()
        if not token:
            self._send(500, {"error": "APIFY_TOKEN 환경변수가 설정되지 않았습니다"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send(400, {"error": "잘못된 요청 본문입니다"})
            return

        video_url = str(payload.get("videoUrl", "")).strip()
        if not video_url:
            self._send(400, {"error": "videoUrl이 필요합니다"})
            return

        try:
            resp = requests.post(
                APIFY_ACTOR_URL,
                params={"token": token},
                json={
                    "videoUrl": video_url,
                    "targetLanguage": str(payload.get("targetLanguage", "ko")),
                },
                timeout=55,
            )
        except requests.RequestException as e:
            self._send(502, {"error": f"자막 추출 서비스 연결 실패: {e}"})
            return

        if not resp.ok:
            self._send(resp.status_code, {"error": f"자막 추출 서비스 오류 (상태코드: {resp.status_code})"})
            return

        try:
            data = resp.json()
        except ValueError:
            self._send(502, {"error": "자막 추출 서비스 응답을 해석할 수 없습니다"})
            return

        self._send(200, data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _send(self, status: int, body: dict | list):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)
