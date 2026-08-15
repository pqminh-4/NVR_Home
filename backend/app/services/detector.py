"""Detector: thread mỗi camera — đọc frame từ sub stream, chạy AI, tạo Event."""
from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone

import cv2
import numpy as np
from sqlmodel import Session

from ..config import settings, local_now
from ..db import engine
from ..models import Camera, Event
from ..ws import hub
from . import settings_store
from .go2rtc import go2rtc
from .motion import MotionDetector
from .yolo import YoloDetector

# RTSP qua TCP như recorder/ffprobe — tránh UDP khi camera ở VLAN khác.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

logger = logging.getLogger("nvr.detector")

EVENT_GAP = 15      # giây không phát hiện -> đóng event
MIN_FRAMES = 3      # số frame liên tiếp để xác nhận (chống nhiễu)
COOLDOWN = 30       # giây giữa 2 event cùng loại trên 1 camera
FACE_CHECK_EVERY = 8  # giây giữa 2 lần nhận diện khuôn mặt trong 1 event


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DemoFrameSource:
    """Nguồn demo: khung hình sinh bằng numpy, không cần camera thật."""

    def __init__(self, w: int = 1280, h: int = 720):
        self.w, self.h = w, h
        self.t = 0.0

    def read(self):
        self.t += 0.25
        frame = np.full((self.h, self.w, 3), (40, 42, 54), dtype=np.uint8)
        x = int((self.t * 60) % max(1, self.w - 160))
        y = int(self.h / 2 + 120 * np.sin(self.t / 3))
        cv2.rectangle(frame, (x, y - 120), (x + 120, y + 120), (200, 180, 160), -1)
        cv2.circle(frame, (x + 60, y - 70), 40, (190, 205, 225), -1)
        cv2.rectangle(frame, (0, 0), (self.w, 46), (18, 18, 24), -1)
        cv2.putText(frame, f"NVR_Home DEMO  {local_now().strftime('%H:%M:%S')}",
                    (16, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (120, 220, 120), 2)
        return True, frame

    def release(self):
        pass


class _ClassState:
    def __init__(self) -> None:
        self.hits = 0
        self.event_id: int | None = None
        self.last_hit = 0.0
        self.last_event_end = 0.0
        self.best: tuple[float, tuple[float, float, float, float]] = (0.0, (0, 0, 0, 0))
        self.last_face_check = 0.0
        self.stranger_sent = False


class CameraDetector(threading.Thread):
    def __init__(self, cam: Camera):
        super().__init__(daemon=True, name=f"det-{cam.slug}")
        self.cam_id = cam.id
        self.cam_name = cam.name
        self.slug = cam.slug
        self.detect_url = cam.url_sub or cam.url_main
        self.demo = self.detect_url.startswith("demo")
        self.go2rtc_name = (
            f"{cam.slug}_sub" if (cam.url_sub and cam.url_sub != cam.url_main) else cam.slug
        )
        self.fps = max(1, min(cam.detect_fps or 2, 10))
        self.classes = {c.strip() for c in (cam.detect_classes or "person").split(",") if c.strip()}
        self.threshold = float(cam.detect_threshold or 0.55)
        self.zones = [tuple(float(v) for v in z) for z in (cam.zones or []) if len(z) == 4]
        self.motion_record = cam.record_mode == "motion"
        self._stopped = threading.Event()
        self._states: dict[str, _ClassState] = {}
        self._last_status_push = 0.0

    # ---------- nguồn frame ----------

    def _open_source(self):
        if self.demo:
            return DemoFrameSource()
        # luôn đọc qua restream go2rtc: nhiều camera (vd Ezviz) giới hạn số phiên
        # RTSP đồng thời — recorder đã dùng 1 phiên trực tiếp, go2rtc dùng phiên
        # thứ 2 dành chung cho detector + live view + snapshot
        url = f"{go2rtc.rtsp_base()}/{self.go2rtc_name}"
        # timeout phải truyền vào lúc mở stream — set sau khi mở là vô tác dụng
        params = [
            cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 15000,
            cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10000,
        ]
        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG, params)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # backend không hỗ trợ thì bỏ qua
        return cap

    # ---------- vòng lặp chính ----------

    def run(self) -> None:
        interval = 1.0 / self.fps
        while not self._stopped.is_set():
            try:
                self._run_once(interval)
            except Exception:
                logger.exception("[%s] detector lỗi, thử lại sau 10s", self.slug)
                time.sleep(10)

    def _run_once(self, interval: float) -> None:
        src = self._open_source()
        motion = MotionDetector()
        logger.info("[%s] detector bắt đầu (fps=%d)", self.slug, self.fps)
        next_process = 0.0
        while not self._stopped.is_set():
            ok, frame = src.read()
            if not ok or frame is None:
                logger.warning("[%s] mất nguồn frame, mở lại sau 5s", self.slug)
                src.release()
                time.sleep(5)
                if self._stopped.is_set():
                    break
                src = self._open_source()
                motion = MotionDetector()
                continue
            now = time.monotonic()
            self._push_heartbeat()
            if now >= next_process:
                next_process = now + interval
                self._process_frame(frame, motion)
            self._finalize_stale()
        src.release()

    # ---------- xử lý 1 frame ----------

    def _process_frame(self, frame: np.ndarray, motion: MotionDetector) -> None:
        yolo = YoloDetector.get() if not self.demo else None
        if yolo is not None:
            detections = yolo.predict(frame, self.classes, self.threshold)
        else:
            # không có AI model (hoặc nguồn demo) -> dùng so khung hình
            detections = motion.detect(frame)

        h, w = frame.shape[:2]
        for cls, score, x1, y1, x2, y2 in detections:
            if not self._in_zones(w, h, x1, y1, x2, y2):
                continue
            st = self._states.setdefault(cls, _ClassState())
            st.hits += 1
            st.last_hit = time.monotonic()
            if score > st.best[0]:
                st.best = (score, (x1, y1, x2, y2))
            if (
                st.hits >= MIN_FRAMES
                and st.event_id is None
                and st.last_hit - st.last_event_end > COOLDOWN
            ):
                self._start_event(frame, cls, st)
            elif st.event_id is not None:
                self._update_event(st)
                self._maybe_face(frame, st)

    def _in_zones(self, w: int, h: int, x1: float, y1: float, x2: float, y2: float) -> bool:
        if not self.zones:
            return True
        cx, cy = (x1 + x2) / 2 / w, (y1 + y2) / 2 / h
        return any(zx1 <= cx <= zx2 and zy1 <= cy <= zy2 for zx1, zy1, zx2, zy2 in self.zones)

    # ---------- vòng đời event ----------

    def _start_event(self, frame: np.ndarray, cls: str, st: _ClassState) -> None:
        score, bbox = st.best
        snap_rel = self._save_snapshot(frame, cls)
        now = _utcnow()
        event = Event(
            camera_id=self.cam_id,
            camera_name=self.cam_name,
            type=cls,
            score=score,
            ts_start=now,
            ts_end=now,
            snapshot=snap_rel,
        )
        try:
            with Session(engine) as session:
                session.add(event)
                session.commit()
                session.refresh(event)
                st.event_id = event.id
                st.last_face_check = time.monotonic()
                st.stranger_sent = False
                payload = event.to_dict()
        except Exception:
            logger.exception("[%s] tạo event lỗi", self.slug)
            return
        logger.info("[%s] event %s (score %.2f)", self.slug, cls, score)
        hub.broadcast_threadsafe({"type": "event.new", "event": payload})

        from .notifier import notify_event_async

        hub.schedule_coroutine(notify_event_async(event.id))
        if self.motion_record:
            from .recorder import recording_manager

            hub.call_soon_threadsafe(lambda: recording_manager.trigger_clip(self.cam_id))
        st.hits = 0

    def _update_event(self, st: _ClassState) -> None:
        if st.event_id is None:
            return
        try:
            with Session(engine) as session:
                event = session.get(Event, st.event_id)
                if event:
                    event.ts_end = _utcnow()
                    event.score = max(event.score, st.best[0])
                    session.add(event)
                    session.commit()
        except Exception:
            pass

    def _finalize_stale(self) -> None:
        now = time.monotonic()
        for cls, st in list(self._states.items()):
            if st.event_id is not None and now - st.last_hit > EVENT_GAP:
                eid = st.event_id
                st.event_id = None
                st.last_event_end = now
                st.hits = 0
                st.best = (0.0, (0, 0, 0, 0))
                try:
                    with Session(engine) as session:
                        event = session.get(Event, eid)
                        if event:
                            event.ts_end = _utcnow()
                            session.add(event)
                            session.commit()
                except Exception:
                    pass
                hub.broadcast_threadsafe({"type": "event.end", "id": eid})

    # ---------- nhận diện người quen ----------

    def _maybe_face(self, frame: np.ndarray, st: _ClassState) -> None:
        if time.monotonic() - st.last_face_check < FACE_CHECK_EVERY:
            return
        st.last_face_check = time.monotonic()
        try:
            from .faces import face_service

            if not face_service.available():
                return
            with Session(engine) as session:
                face_enabled = bool(settings_store.get_value(session, "face_enabled"))
                threshold = float(settings_store.get_value(session, "face_threshold"))
                stranger = bool(settings_store.get_value(session, "stranger_alert"))
            if not face_enabled:
                return
            score, (x1, y1, x2, y2) = st.best
            h, w = frame.shape[:2]
            pad_x, pad_y = (x2 - x1) * 0.2, (y2 - y1) * 0.3
            crop = frame[
                max(0, int(y1 - pad_y)): min(h, int(y2 + pad_y * 0.5)),
                max(0, int(x1 - pad_x)): min(w, int(x2 + pad_x)),
            ]
            if crop.size == 0:
                return
            name, sim = face_service.identify(crop, threshold)
            if name and st.event_id:
                with Session(engine) as session:
                    event = session.get(Event, st.event_id)
                    if event and event.label != name:
                        event.label = name
                        session.add(event)
                        session.commit()
                        hub.broadcast_threadsafe({
                            "type": "event.update",
                            "event": event.to_dict(),
                        })
            elif not name and stranger and st.event_id and not st.stranger_sent:
                st.stranger_sent = True
                self._create_stranger_event(frame)
        except Exception:
            logger.exception("[%s] face check lỗi", self.slug)

    def _create_stranger_event(self, frame: np.ndarray) -> None:
        snap_rel = self._save_snapshot(frame, "face_stranger")
        now = _utcnow()
        event = Event(
            camera_id=self.cam_id, camera_name=self.cam_name,
            type="face_stranger", score=0.0,
            ts_start=now, ts_end=now, snapshot=snap_rel,
        )
        with Session(engine) as session:
            session.add(event)
            session.commit()
            session.refresh(event)
            payload = event.to_dict()
        logger.info("[%s] phát hiện NGƯỜI LẠ", self.slug)
        hub.broadcast_threadsafe({"type": "event.new", "event": payload})
        from .notifier import notify_event_async

        hub.schedule_coroutine(notify_event_async(event.id))

    # ---------- phụ ----------

    def _save_snapshot(self, frame: np.ndarray, cls: str) -> str:
        ts = local_now().strftime("%Y%m%d_%H%M%S")
        folder = local_now().strftime("%Y-%m")
        rel = f"snapshots/{folder}/{ts}_{self.slug}_{cls}.jpg"
        path = settings.storage_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            cv2.imwrite(str(path), frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            return rel
        except Exception:
            return ""

    def _push_heartbeat(self) -> None:
        if time.monotonic() - self._last_status_push < 15:
            return
        self._last_status_push = time.monotonic()
        try:
            with Session(engine) as session:
                cam = session.get(Camera, self.cam_id)
                if cam and cam.enabled:
                    cam.last_frame_at = _utcnow()
                    if cam.status == "offline":
                        cam.status = "online"
                        cam.last_error = ""
                    session.add(cam)
                    session.commit()
        except Exception:
            pass

    def stop(self) -> None:
        self._stopped.set()


class DetectionManager:
    def __init__(self) -> None:
        self._detectors: dict[int, CameraDetector] = {}

    def start_all(self) -> None:
        with Session(engine) as session:
            cams = session.query(Camera).where(Camera.enabled == True).all()  # noqa: E712
        for cam in cams:
            self._spawn(cam)

    def _spawn(self, cam: Camera) -> None:
        if not cam.enabled or not cam.detect_enabled:
            return
        det = CameraDetector(cam)
        self._detectors[cam.id] = det
        det.start()

    def reload(self, cam: Camera) -> None:
        old = self._detectors.pop(cam.id, None)
        if old:
            old.stop()
        self._spawn(cam)

    def stop_camera(self, cam_id: int) -> None:
        old = self._detectors.pop(cam_id, None)
        if old:
            old.stop()

    def stop_all(self) -> None:
        for det in self._detectors.values():
            det.stop()
        self._detectors.clear()

    def status(self) -> dict:
        yolo = YoloDetector.get()
        return {
            "backend": "yolo" if yolo else "motion",
            "cameras": {cid: d.is_alive() for cid, d in self._detectors.items()},
        }


detection_manager = DetectionManager()
