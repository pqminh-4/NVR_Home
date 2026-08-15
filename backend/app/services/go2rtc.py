"""Client điều khiển go2rtc: đồng bộ camera, lấy trạng thái stream."""
from __future__ import annotations

import logging

import httpx
from sqlmodel import Session

from ..config import settings
from ..db import engine
from ..models import Camera

logger = logging.getLogger("nvr.go2rtc")


class Go2RTC:
    def __init__(self, base_url: str | None = None):
        self.base = (base_url or settings.go2rtc_url).rstrip("/")

    def _names(self, cam: Camera) -> dict[str, str]:
        """stream name -> url nguồn cần đăng ký trên go2rtc."""
        streams: dict[str, str] = {}
        if cam.url_main and cam.url_main != "demo":
            streams[cam.slug] = cam.url_main
        if cam.url_sub and cam.url_sub not in ("demo", cam.url_main):
            streams[f"{cam.slug}_sub"] = cam.url_sub
        return streams

    async def sync_cameras(self) -> None:
        """Đăng ký mọi camera đang bật lên go2rtc (PUT /api/streams)."""
        with Session(engine) as session:
            cams = session.query(Camera).where(Camera.enabled == True).all()  # noqa: E712
            wanted: dict[str, str] = {}
            for cam in cams:
                wanted.update(self._names(cam))
        if not wanted:
            return
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                for name, url in wanted.items():
                    resp = await client.put(
                        f"{self.base}/api/streams", json={name: url}
                    )
                    if resp.status_code < 400:
                        logger.info("go2rtc: đã thêm stream %s", name)
                    else:
                        logger.warning(
                            "go2rtc: thêm stream %s lỗi %s: %s",
                            name, resp.status_code, resp.text[:200],
                        )
        except Exception as exc:
            logger.warning("go2rtc không khả dụng (%s) — dùng URL camera trực tiếp", exc)

    async def statuses(self) -> dict[str, dict]:
        """Trạng thái các stream đang chạy trên go2rtc."""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{self.base}/api/streams")
                resp.raise_for_status()
                return resp.json()
        except Exception:
            return {}

    def rtsp_base(self) -> str:
        """Cơ sở RTSP nội bộ của go2rtc, vd rtsp://go2rtc:8554."""
        return settings.go2rtc_rtsp.rstrip("/")

    def rtsp_url(self, cam: Camera, sub: bool = False) -> str:
        """URL RTSP nội bộ của go2rtc để recorder/detector kéo stream.

        Nếu camera là demo, trả về 'demo'.
        """
        source = (cam.url_sub if sub and cam.url_sub else cam.url_main) or cam.url_main
        if source.startswith("demo"):
            return source
        name = f"{cam.slug}_sub" if (sub and cam.url_sub and cam.url_sub != cam.url_main) else cam.slug
        return f"{self.rtsp_base()}/{name}"


go2rtc = Go2RTC()
