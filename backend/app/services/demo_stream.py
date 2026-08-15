"""Live MJPEG cho camera demo (không cần go2rtc/RTSP)."""
from __future__ import annotations

import asyncio
import threading
import time

import cv2
import numpy as np

from ..config import local_now


class DemoStream:
    """Sinh khung hình demo dùng chung, 2 fps."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._frame: bytes | None = None
        self._t = 0.0
        self._start()

    def _start(self) -> None:
        def worker() -> None:
            w, h = 1280, 720
            while True:
                self._t += 0.5
                frame = np.full((h, w, 3), (40, 42, 54), dtype=np.uint8)
                x = int((self._t * 90) % max(1, w - 160))
                y = int(h / 2 + 150 * np.sin(self._t / 3))
                cv2.rectangle(frame, (x, y - 120), (x + 120, y + 120), (200, 180, 160), -1)
                cv2.circle(frame, (x + 60, y - 70), 40, (190, 205, 225), -1)
                cv2.rectangle(frame, (0, 0), (w, 46), (18, 18, 24), -1)
                cv2.putText(
                    frame,
                    f"NVR_Home DEMO  {local_now().strftime('%H:%M:%S')}",
                    (16, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (120, 220, 120), 2,
                )
                ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                if ok:
                    with self._lock:
                        self._frame = buf.tobytes()
                time.sleep(0.5)

        threading.Thread(target=worker, daemon=True, name="demo-stream").start()

    def latest(self) -> bytes | None:
        with self._lock:
            return self._frame


_demo: DemoStream | None = None


def get_demo_stream() -> DemoStream:
    global _demo
    if _demo is None:
        _demo = DemoStream()
    return _demo


async def mjpeg_generator():
    """Async generator cho StreamingResponse multipart/x-mixed-replace."""
    demo = get_demo_stream()
    boundary = b"--nvrframe\r\n"
    while True:
        frame = demo.latest()
        if frame:
            yield (
                boundary
                + b"Content-Type: image/jpeg\r\n"
                + f"Content-Length: {len(frame)}\r\n\r\n".encode()
                + frame
                + b"\r\n"
            )
        await asyncio.sleep(0.5)
