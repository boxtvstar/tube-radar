from __future__ import annotations

import re
import sys
import subprocess
from typing import Any

import yt_dlp


def _sanitize_filename(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]+', "_", name).strip()
    return cleaned or "youtube_video"


def _is_valid_youtube_url(url: str) -> bool:
    normalized = (url or "").strip().lower()
    return "youtube.com/" in normalized or "youtu.be/" in normalized


def get_video_info(url: str) -> dict[str, Any]:
    if not _is_valid_youtube_url(url):
        return {
            "success": False,
            "error": "유효한 유튜브 주소를 입력해주세요.",
        }

    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True}) as ydl:
            info = ydl.extract_info(url, download=False)

        return {
            "success": True,
            "title": info.get("title") or "YouTube Video",
            "uploader": info.get("uploader") or "Unknown",
            "duration": int(info.get("duration") or 0),
            "thumbnail": info.get("thumbnail") or "",
            "webpage_url": info.get("webpage_url") or url,
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"영상 정보를 불러오지 못했습니다: {str(e)}",
        }


def stream_video_process(url: str):
    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "-f",
        "best[ext=mp4]/best",
        "-o",
        "-",
        url,
    ]

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        bufsize=1024 * 64,
    )

    try:
        if process.stdout is None:
            return
        for chunk in iter(lambda: process.stdout.read(1024 * 64), b""):
            if not chunk:
                break
            yield chunk
    finally:
        if process.stdout:
            process.stdout.close()
        if process.stderr:
            process.stderr.close()
        if process.poll() is None:
            process.terminate()


def build_download_filename(title: str) -> str:
    safe_title = _sanitize_filename(title)
    return f"{safe_title}.mp4"
