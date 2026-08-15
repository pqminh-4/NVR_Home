"""Client điều khiển go2rtc: đồng bộ camera, lấy trạng thái stream."""
from __future__ import annotations

import logging

import httpx
from sqlmodel import Session

from ..config import settings
from ..db import engine
from ..models import Camera

logger = logging.getLogger("nvr.go2rtc")


def _tcp_source(url: str) -> str:
    """Ép go2rtc kéo RTSP qua TCP — nhiều camera (vd Ezviz) chỉ chấp nhận TCP
    và router thường không chuyển UDP giữa các VLAN."""
    if url.startswith("rtsp") and "#" not in url:
        return f"{url}#transport=tcp"
    return url


class Go2RTC:
    def __init__(self, base_url: str | None = None):
        self.base = (base_url or settings.go2rtc_url).rstrip("/")

    def _names(self, cam: Camera) -> dict[str, str]:
        """stream name -> url nguồn cần đăng ký trên go2rtc."""
        streams: dict[str, str] = {}
        if cam.url_main and cam.url_main != "demo":
            streams[cam.slug] = _tcp_source(cam.url_main)
        if cam.url_sub and cam.url_sub not in ("demo", cam.url_main):
            streams[f"{cam.slug}_sub"] = _tcp_source(cam.url_sub)
        return streams

    async def sync_cameras(self) -> None:
        """Đăng ký mọi camera đang bật lên go2rtc.

        API của go2rtc nhận tham số qua query string:
        PUT /api/streams?name=<ten>&src=<url> — body JSON bị bỏ qua.
        """
        with Session(engine) as session:
            cams = session.query(Camera).where(Camera.enabled == True).all()  # noqa: E712
            wanted: dict[str, str] = {}
            for cam in cams:
                wanted.update(self._names(cam))
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                # gỡ stream go2rtc đang giữ mà không còn trong danh sách (camera bị xoá/đổi tên)
                try:
                    resp = await client.get(f"{self.base}/api/streams")
                    if resp.status_code < 400:
                        for name in resp.json():
                            if name not in wanted:
                                await client.delete(
                                    f"{self.base}/api/streams", params={"src": name}
                                )
                except Exception:
                    pass
                if not wanted:
                    return
                for name, url in wanted.items():
                    resp = await client.put(
                        f"{self.base}/api/streams", params={"name": name, "src": url}
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

    async def fetch_frame(self, name: str) -> bytes | None:
        """Chụp 1 frame JPEG từ stream go2rtc (không mở thêm phiên RTSP vào camera)."""
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                resp = await client.get(f"{self.base}/api/frame.jpeg", params={"src": name})
                if resp.status_code == 200:
                    return resp.content
        except Exception:
            pass
        return None

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
