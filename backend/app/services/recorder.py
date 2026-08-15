"""Ghi hình: continuous (24/7) + clip khi có event + retention tự xoá."""
from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path

from sqlmodel import Session

from ..config import settings, local_now
from ..db import engine
from ..models import Camera
from . import ffmpeg as ff
from . import settings_store

logger = logging.getLogger("nvr.recorder")

_SEG_RE = re.compile(r"^(\d{2})-(\d{2})-(\d{2})(?:_ev)?\.mp4$")


def _kill_proc(proc: asyncio.subprocess.Process) -> None:
    """Chắc chắn tiến trình con chết — ffmpeg sống sót sẽ giữ phiên RTSP của camera
    (camera Ezviz/Hikvision giới hạn số phiên, phiên thừa gây SETUP 500)."""
    if proc.returncode is None:
        with contextlib.suppress(ProcessLookupError, OSError):
            proc.kill()


def recordings_dir() -> Path:
    return settings.storage_dir / "recordings"


class CameraRecorder:
    """Quản lý 1 tiến trình ffmpeg ghi liên tục cho 1 camera."""

    def __init__(self, cam: Camera):
        self.cam = cam
        self._task: asyncio.Task | None = None
        self._clip_task: asyncio.Task | None = None
        self._proc: asyncio.subprocess.Process | None = None
        self._stopping = False

    # ---------- continuous ----------

    def _build_cmd(self) -> list[str]:
        url = self.cam.url_main
        out_dir = recordings_dir() / self.cam.slug / local_now().strftime("%Y-%m-%d")
        out_dir.mkdir(parents=True, exist_ok=True)
        out = out_dir / "%H-%M-%S.mp4"
        return [
            "ffmpeg", "-hide_banner", "-loglevel", "warning",
            "-use_wallclock_as_timestamps", "1",
            *ff.input_args(url),
            *ff.encoder_args(url),
            "-map", "0:v:0",
            *([] if ff.is_demo(url) else ["-map", "0:a:0?"]),
            "-f", "segment",
            "-segment_time", "10",
            "-reset_timestamps", "1",
            "-strftime", "1",
            str(out),
        ]

    async def _run_forever(self) -> None:
        backoff = 5
        while not self._stopping:
            self._set_status("online", "")
            proc = await asyncio.create_subprocess_exec(
                *self._build_cmd(),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            self._proc = proc
            logger.info("[%s] ffmpeg ghi hình bắt đầu (pid %s)", self.cam.slug, proc.pid)
            assert proc.stderr is not None
            err_tail: list[bytes] = []
            try:
                while True:
                    line = await proc.stderr.readline()
                    if not line:
                        break
                    err_tail = (err_tail + [line])[-8:]
                code = await proc.wait()
            finally:
                # mọi đường thoát (kể cả task bị cancel khi reload camera)
                # đều phải dọn ffmpeg con
                _kill_proc(proc)
                with contextlib.suppress(Exception):
                    await proc.wait()
            if self._stopping:
                break
            err = b"\n".join(err_tail).decode(errors="replace")[-500:]
            self._set_status("error", f"ffmpeg thoát mã {code}: {err}")
            logger.warning("[%s] ffmpeg chết (mã %s), thử lại sau %ss", self.cam.slug, code, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 120)
        self._set_status("offline", "")

    def _set_status(self, status: str, error: str) -> None:
        try:
            with Session(engine) as session:
                cam = session.get(Camera, self.cam.id)
                if cam:
                    cam.status = status
                    cam.last_error = error
                    session.add(cam)
                    session.commit()
        except Exception:
            pass

    # ---------- clip khi có event ----------

    async def record_clip(self, seconds: int = 20) -> None:
        """Ghi một clip ngắn quanh event (cho camera record_mode=motion)."""
        if self._clip_task and not self._clip_task.done():
            return
        self._clip_task = asyncio.create_task(self._clip(seconds))

    async def _clip(self, seconds: int) -> None:
        url = self.cam.url_main
        now = local_now()
        out_dir = recordings_dir() / self.cam.slug / now.strftime("%Y-%m-%d")
        out_dir.mkdir(parents=True, exist_ok=True)
        name = now.strftime("%H-%M-%S") + "_ev.mp4"
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning",
            *ff.input_args(url),
            *ff.encoder_args(url),
            "-map", "0:v:0",
            *([] if ff.is_demo(url) else ["-map", "0:a:0?"]),
            "-t", str(seconds),
            "-movflags", "+faststart",
            str(out_dir / name),
        ]
        proc: asyncio.subprocess.Process | None = None
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(proc.wait(), timeout=seconds + 60)
        except asyncio.TimeoutError:
            pass
        except Exception as exc:
            logger.warning("[%s] clip event lỗi: %s", self.cam.slug, exc)
        finally:
            if proc is not None:
                _kill_proc(proc)
                with contextlib.suppress(Exception):
                    await proc.wait()

    # ---------- lifecycle ----------

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stopping = False
        self._task = asyncio.create_task(self._run_forever())

    async def stop(self) -> None:
        self._stopping = True
        # kill ffmpeg TRƯỚC khi cancel task, nếu không tiến trình sẽ bị leak
        # và giữ phiên RTSP của camera
        if self._proc and self._proc.returncode is None:
            _kill_proc(self._proc)
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
        if self._clip_task and not self._clip_task.done():
            self._clip_task.cancel()


class RecordingManager:
    def __init__(self) -> None:
        self._recorders: dict[int, CameraRecorder] = {}
        self._retention_task: asyncio.Task | None = None

    def start_all(self) -> None:
        with Session(engine) as session:
            cams = session.query(Camera).where(Camera.enabled == True).all()  # noqa: E712
        for cam in cams:
            self._start_camera(cam)
        self._retention_task = asyncio.create_task(self._retention_loop())

    def _start_camera(self, cam: Camera) -> None:
        if not cam.enabled or cam.record_mode == "off":
            return
        rec = CameraRecorder(cam)
        self._recorders[cam.id] = rec
        rec.start()

    def reload(self, cam: Camera) -> None:
        """Gọi sau khi thêm/sửa camera."""
        asyncio.ensure_future(self._reload_async(cam))

    async def _reload_async(self, cam: Camera) -> None:
        old = self._recorders.pop(cam.id, None)
        if old:
            await old.stop()
        self._start_camera(cam)

    async def stop_camera(self, cam_id: int) -> None:
        old = self._recorders.pop(cam_id, None)
        if old:
            await old.stop()

    async def stop_all(self) -> None:
        if self._retention_task:
            self._retention_task.cancel()
        for rec in list(self._recorders.values()):
            await rec.stop()
        self._recorders.clear()

    def trigger_clip(self, cam_id: int, seconds: int = 20) -> None:
        rec = self._recorders.get(cam_id)
        if rec:
            rec.record_clip(seconds)

    # ---------- retention ----------

    async def _retention_loop(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self._enforce_retention)
            except Exception:
                logger.exception("retention loop lỗi")
            await asyncio.sleep(900)

    def _enforce_retention(self) -> None:
        with Session(engine) as session:
            days = int(settings_store.get_value(session, "retention_days") or 0)
            max_gb = float(settings_store.get_value(session, "max_storage_gb") or 0)
        root = recordings_dir()
        if not root.exists():
            return
        cutoff = datetime.now() - timedelta(days=days) if days > 0 else None
        files: list[tuple[datetime, Path]] = []
        total = 0
        for path in root.rglob("*.mp4"):
            mtime = datetime.fromtimestamp(path.stat().st_mtime)
            total += path.stat().st_size
            files.append((mtime, path))
        files.sort()
        if cutoff:
            for mtime, path in files:
                if mtime < cutoff:
                    total -= path.stat().st_size
                    path.unlink(missing_ok=True)
        if max_gb > 0:
            limit = max_gb * 1024**3
            for mtime, path in files:
                if total <= limit:
                    break
                if path.exists():
                    total -= path.stat().st_size
                    path.unlink(missing_ok=True)
        # dọn thư mục rỗng
        for d in sorted(root.rglob("*"), reverse=True):
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()

    # ---------- phát lại ----------

    def scan_day(self, slug: str, date: str) -> list[dict]:
        """Danh sách segment của 1 ngày: [{start, end, duration, file}] (giờ local)."""
        day_dir = recordings_dir() / slug / date
        if not day_dir.exists():
            return []
        segs: list[tuple[int, str, Path]] = []
        for path in day_dir.glob("*.mp4"):
            m = _SEG_RE.match(path.name)
            if not m:
                continue
            hh, mm, ss = int(m.group(1)), int(m.group(2)), int(m.group(3))
            start_sec = hh * 3600 + mm * 60 + ss
            segs.append((start_sec, path.name, path))
        segs.sort()
        out: list[dict] = []
        for i, (start_sec, name, path) in enumerate(segs):
            next_start = segs[i + 1][0] if i + 1 < len(segs) else None
            if next_start is not None and next_start > start_sec:
                dur = min(next_start - start_sec, 30)
            else:
                dur = 10
            out.append({
                "start": start_sec,
                "end": start_sec + dur,
                "duration": dur,
                "file": name,
                "size": path.stat().st_size,
            })
        return out

    def segment_path(self, slug: str, date: str, file: str) -> Path | None:
        if not _SEG_RE.match(file):
            return None
        path = recordings_dir() / slug / date / file
        if path.parent != (recordings_dir() / slug / date):
            return None
        return path if path.exists() else None

    def delete_camera_files(self, slug: str) -> None:
        import shutil

        d = recordings_dir() / slug
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)


recording_manager = RecordingManager()
