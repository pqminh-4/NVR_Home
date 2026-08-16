"""Tự nhận độ phân giải camera.

3 nguồn, ưu tiên cái nào có sẵn cái đó (không mở phiên RTSP mới vào camera):
1. Frame detector đọc được (sub stream hoặc main nếu không có sub).
2. Thông tin stream go2rtc /api/streams — có khi live view đang chạy.
3. Probe best-effort qua restream go2rtc (chỉ với camera còn thiếu dữ liệu,
   có backoff để không quấy rối camera giới hạn phiên RTSP).
"""
from __future__ import annotations

import asyncio
import logging
import re
import time

from sqlmodel import Session

from ..db import engine
from ..models import Camera
from . import ffmpeg as ff
from .go2rtc import go2rtc

logger = logging.getLogger("nvr.resolution")

_SYNC_EVERY = 30  # giây giữa 2 lần đồng bộ từ go2rtc
_BACKOFF_STEPS = (60, 120, 300, 600, 900)  # giây — probe lại sau khi fail

_RES_RE = re.compile(r"\b(\d{2,5})x(\d{2,5})\b")

# cam_id -> (số lần fail liên tiếp, thời điểm được phép thử lại)
_probe_state: dict[int, tuple[int, float]] = {}


def extract_res(node) -> str | None:
    """Tìm "WxH" trong JSON go2rtc (đệ quy — format info thay đổi theo phiên bản)."""
    if isinstance(node, str):
        m = _RES_RE.search(node)
        return f"{m.group(1)}x{m.group(2)}" if m else None
    if isinstance(node, dict):
        for value in node.values():
            res = extract_res(value)
            if res:
                return res
    elif isinstance(node, list):
        for value in node:
            res = extract_res(value)
            if res:
                return res
    return None


def save_res(cam_id: int, field: str, res: str) -> bool:
    """Lưu độ phân giải nếu thay đổi. field = 'res_main' | 'res_sub'."""
    if field not in ("res_main", "res_sub") or not res:
        return False
    try:
        with Session(engine) as session:
            cam = session.get(Camera, cam_id)
            if cam is None or getattr(cam, field) == res:
                return False
            setattr(cam, field, res)
            session.add(cam)
            session.commit()
        logger.info("camera %s: %s = %s", cam_id, field, res)
        return True
    except Exception:
        logger.exception("lưu độ phân giải camera %s lỗi", cam_id)
        return False


async def sync_from_go2rtc() -> None:
    """Đọc thông tin stream đang chạy trên go2rtc, cập nhật res cho camera."""
    statuses = await go2rtc.statuses()
    if not statuses:
        return
    res_by_stream = {name: extract_res(info) for name, info in statuses.items()}
    with Session(engine) as session:
        cams = session.query(Camera).where(Camera.enabled == True).all()  # noqa: E712
        todo: list[tuple[int, str, str]] = []  # (cam_id, stream_name, field)
        for cam in cams:
            if ff.is_demo(cam.url_main):
                continue
            for name, field in (
                (cam.slug, "res_main"),
                (f"{cam.slug}_sub", "res_sub"),
            ):
                res = res_by_stream.get(name)
                if res and getattr(cam, field) != res:
                    setattr(cam, field, res)
                    logger.info("go2rtc: camera %s %s = %s", cam.slug, field, res)
                if not getattr(cam, field):
                    if field == "res_sub" and not (cam.url_sub and cam.url_sub != cam.url_main):
                        continue
                    todo.append((cam.id, name, field))
        session.commit()
    for cam_id, name, field in todo:
        await _probe_via_go2rtc(cam_id, name, field)


async def _probe_via_go2rtc(cam_id: int, stream_name: str, field: str) -> None:
    """Probe qua restream go2rtc — go2rtc tái dùng phiên camera đang mở nếu có."""
    state = _probe_state.get(cam_id)
    if state and time.monotonic() < state[1]:
        return
    info = await ff.probe(f"{go2rtc.rtsp_base()}/{stream_name}")
    if info.get("ok"):
        video = info.get("video") or {}
        res = f"{video['width']}x{video['height']}" if video.get("width") and video.get("height") else ""
        if save_res(cam_id, field, res):
            _probe_state.pop(cam_id, None)
            return
        if res:  # đã đúng rồi, không cần probe nữa nhưng vẫn thoát backoff
            _probe_state.pop(cam_id, None)
            return
    fails = (state[0] + 1) if state else 1
    wait = _BACKOFF_STEPS[min(fails - 1, len(_BACKOFF_STEPS) - 1)]
    _probe_state[cam_id] = (fails, time.monotonic() + wait)
    logger.debug("probe %s thất bại (lần %d), thử lại sau %ss", stream_name, fails, wait)


async def monitor_loop() -> None:
    """Chạy nền trong lifespan: đồng bộ độ phân giải định kỳ."""
    while True:
        try:
            await sync_from_go2rtc()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("resolution sync lỗi")
        await asyncio.sleep(_SYNC_EVERY)
