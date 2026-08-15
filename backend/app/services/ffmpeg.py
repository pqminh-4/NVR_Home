"""Helper ffprobe / ffmpeg (chạy subprocess, không block event loop)."""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

logger = logging.getLogger("nvr.ffmpeg")


def is_demo(url: str) -> bool:
    return url.startswith("demo")


def input_args(url: str) -> list[str]:
    """Tham số đầu vào cho ffmpeg; hỗ trợ nguồn demo (không cần camera thật)."""
    if is_demo(url):
        return [
            "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=10",
            "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000",
        ]
    return ["-rtsp_transport", "tcp", "-i", url]


def encoder_args(url: str) -> list[str]:
    """Camera thật: copy codec (CPU gần như 0). Demo: transcode nhẹ."""
    if is_demo(url):
        return ["-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac"]
    return ["-c:v", "copy", "-c:a", "aac"]


async def run(cmd: list[str], timeout: float = 20) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124, "timeout"
    return proc.returncode or 0, (err or b"").decode(errors="replace")


async def probe(url: str) -> dict:
    """Kiểm tra kết nối stream, trả về thông tin cơ bản."""
    if is_demo(url):
        return {
            "ok": True, "demo": True,
            "video": {"codec": "rawvideo", "width": 1280, "height": 720, "fps": 10},
            "audio": {"codec": "pcm_s16le"},
        }
    code, out = await run([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_streams", "-show_format", url,
    ], timeout=15)
    if code != 0:
        last = [l for l in out.splitlines() if l.strip()][-3:]
        return {"ok": False, "error": " | ".join(last) or f"exit {code}"}
    try:
        data = json.loads(out or "{}")
    except json.JSONDecodeError:
        return {"ok": False, "error": "Không đọc được ffprobe output"}
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    audio = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    if not video:
        return {"ok": False, "error": "Không tìm thấy track video"}
    fps_parts = str(video.get("avg_frame_rate", "10/1")).split("/")
    try:
        fps = round(int(fps_parts[0]) / int(fps_parts[1]), 2) if len(fps_parts) == 2 and int(fps_parts[1]) else 10
    except Exception:
        fps = 10
    return {
        "ok": True,
        "video": {
            "codec": video.get("codec_name"),
            "width": video.get("width"), "height": video.get("height"),
            "fps": fps,
        },
        "audio": {"codec": audio.get("codec_name")} if audio else None,
    }


async def snapshot(url: str, out_path: Path, timeout: float = 15) -> bool:
    """Chụp 1 frame từ stream ra file jpg."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if is_demo(url):
        inputs = ["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=5"]
    else:
        inputs = ["-rtsp_transport", "tcp", "-fflags", "nobuffer", "-i", url]
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        *inputs, "-map", "0:v:0", "-frames:v", "1", "-q:v", "3", str(out_path),
    ]
    code, err = await run(cmd, timeout=timeout)
    if code != 0 or not out_path.exists():
        logger.warning("snapshot thất bại (%s): %s", url, err.strip()[-200:])
        return False
    return True
