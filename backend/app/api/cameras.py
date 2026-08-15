"""Camera: CRUD, test kết nối, chụp ảnh, PTZ."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session

from ..config import settings, slugify, local_now
from ..db import get_session
from ..models import Camera, Event, iso_utc
from ..security import require_auth
from ..services import ffmpeg as ff
from ..services import onvif
from ..services.demo_stream import mjpeg_generator
from ..services.detector import detection_manager
from ..services.go2rtc import go2rtc
from ..services.recorder import recording_manager

router = APIRouter(prefix="/api/cameras", tags=["cameras"],
                   dependencies=[Depends(require_auth)])


class CameraBody(BaseModel):
    name: str
    url_main: str
    url_sub: str = ""
    enabled: bool = True
    record_mode: str = "continuous"
    detect_enabled: bool = True
    detect_fps: int = 2
    detect_classes: str = "person,car,cat,dog"
    detect_threshold: float = 0.55
    zones: List[List[float]] = []
    ptz_enabled: bool = False
    onvif_url: str = ""
    onvif_user: str = ""
    onvif_pass: str = ""


class TestBody(BaseModel):
    url: str


class PtzBody(BaseModel):
    action: str  # left|right|up|down|zoom_in|zoom_out|stop


def _cam_dict(cam: Camera) -> dict:
    return {
        "id": cam.id, "name": cam.name, "slug": cam.slug,
        "url_main": cam.url_main, "url_sub": cam.url_sub,
        "enabled": cam.enabled, "record_mode": cam.record_mode,
        "detect_enabled": cam.detect_enabled, "detect_fps": cam.detect_fps,
        "detect_classes": cam.detect_classes,
        "detect_threshold": cam.detect_threshold,
        "zones": cam.zones or [],
        "ptz_enabled": cam.ptz_enabled, "onvif_url": cam.onvif_url,
        "onvif_user": cam.onvif_user,
        "status": cam.status, "last_frame_at": iso_utc(cam.last_frame_at),
        "last_error": cam.last_error,
        "has_ptz": bool(cam.ptz_enabled and cam.onvif_url),
    }


def _apply(cam: Camera, body: CameraBody) -> None:
    cam.name = body.name.strip()
    cam.url_main = body.url_main.strip()
    cam.url_sub = body.url_sub.strip()
    cam.enabled = body.enabled
    if body.record_mode in ("continuous", "motion", "off"):
        cam.record_mode = body.record_mode
    cam.detect_enabled = body.detect_enabled
    cam.detect_fps = max(1, min(body.detect_fps, 10))
    cam.detect_classes = body.detect_classes
    cam.detect_threshold = float(body.detect_threshold)
    cam.zones = [list(z) for z in body.zones if len(z) == 4]
    cam.ptz_enabled = body.ptz_enabled
    cam.onvif_url = body.onvif_url.strip()
    cam.onvif_user = body.onvif_user.strip()
    if body.onvif_pass:  # trống = giữ nguyên
        cam.onvif_pass = body.onvif_pass


async def _reload_all(cam: Camera) -> None:
    await go2rtc.sync_cameras()
    detection_manager.reload(cam)
    recording_manager.reload(cam)


@router.get("")
def list_cameras(session: Session = Depends(get_session)):
    cams = session.query(Camera).order_by(Camera.id).all()
    return [_cam_dict(c) for c in cams]


@router.post("", status_code=201)
async def create_camera(body: CameraBody, session: Session = Depends(get_session)):
    if not body.name.strip() or not body.url_main.strip():
        raise HTTPException(400, "Thiếu tên hoặc URL camera")
    base = slugify(body.name)
    slug = base
    i = 2
    while session.query(Camera).where(Camera.slug == slug).first():
        slug = f"{base}-{i}"
        i += 1
    cam = Camera(slug=slug)
    _apply(cam, body)
    session.add(cam)
    session.commit()
    session.refresh(cam)
    await _reload_all(cam)
    return _cam_dict(cam)


@router.patch("/{cam_id}")
async def update_camera(cam_id: int, body: CameraBody, session: Session = Depends(get_session)):
    cam = session.get(Camera, cam_id)
    if not cam:
        raise HTTPException(404, "Không tìm thấy camera")
    _apply(cam, body)
    cam.status = "offline"
    session.add(cam)
    session.commit()
    session.refresh(cam)
    await _reload_all(cam)
    return _cam_dict(cam)


@router.delete("/{cam_id}")
async def delete_camera(cam_id: int, delete_recordings: bool = False,
                        session: Session = Depends(get_session)):
    cam = session.get(Camera, cam_id)
    if not cam:
        raise HTTPException(404, "Không tìm thấy camera")
    slug = cam.slug
    # Event tham chiếu camera qua FK (PRAGMA foreign_keys=ON) —
    # phải xoá event của camera trước, nếu không DELETE camera bị IntegrityError
    snapshots = [
        s for (s,) in session.query(Event.snapshot)
        .where(Event.camera_id == cam_id).all() if s
    ]
    session.query(Event).where(Event.camera_id == cam_id).delete()
    session.delete(cam)
    session.commit()
    detection_manager.stop_camera(cam_id)
    await recording_manager.stop_camera(cam_id)
    if delete_recordings:
        await asyncio.to_thread(recording_manager.delete_camera_files, slug)
    await asyncio.to_thread(_purge_event_snapshots, snapshots)
    await go2rtc.sync_cameras()
    return {"ok": True}


def _purge_event_snapshots(rels: list[str]) -> None:
    for rel in rels:
        try:
            (settings.storage_dir / rel).unlink(missing_ok=True)
        except OSError:
            pass


@router.post("/test")
async def test_connect(body: TestBody):
    return await ff.probe(body.url.strip())


@router.get("/{cam_id}/live.mjpeg")
async def demo_live_mjpeg(cam_id: int, token: str = "", session: Session = Depends(get_session)):
    """Live MJPEG cho camera demo (token qua query vì <img> không gắn header)."""
    from ..security import decode_token, get_jwt_secret

    from ..db import engine as db_engine

    try:
        with Session(db_engine) as s:
            decode_token(token, get_jwt_secret(s))
    except Exception:
        raise HTTPException(401, "Token không hợp lệ")
    cam = session.get(Camera, cam_id)
    if not cam:
        raise HTTPException(404, "Không tìm thấy camera")
    if not cam.url_main.startswith("demo"):
        raise HTTPException(400, "Chỉ dùng cho camera demo")
    return StreamingResponse(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=nvrframe",
        headers={"Cache-Control": "no-store"},
    )


@router.get("/{cam_id}/snapshot")
async def camera_snapshot(cam_id: int, session: Session = Depends(get_session)):
    cam = session.get(Camera, cam_id)
    if not cam:
        raise HTTPException(404, "Không tìm thấy camera")
    path = settings.storage_dir / "snapshots" / f"live_{cam.slug}_{local_now().strftime('%Y%m%d_%H%M%S')}.jpg"
    # Ưu tiên lấy frame qua go2rtc — không mở thêm phiên RTSP vào camera
    # (camera Ezviz và nhiều hãng giới hạn số phiên đồng thời)
    data = None if ff.is_demo(cam.url_main) else await go2rtc.fetch_frame(cam.slug)
    if data:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    else:
        ok = await ff.snapshot(cam.url_main, path)
        if not ok:
            raise HTTPException(502, f"Không chụp được ảnh từ camera: {cam.last_error or 'kiểm tra kết nối'}")
    return FileResponse(path, media_type="image/jpeg",
                        headers={"Cache-Control": "no-store"})


@router.post("/{cam_id}/ptz")
async def camera_ptz(cam_id: int, body: PtzBody, session: Session = Depends(get_session)):
    cam = session.get(Camera, cam_id)
    if not cam:
        raise HTTPException(404, "Không tìm thấy camera")
    if not cam.ptz_enabled or not cam.onvif_url:
        raise HTTPException(400, "Camera chưa bật PTZ / chưa cấu hình ONVIF")
    try:
        await onvif.ptz_command(cam.onvif_url, cam.onvif_user, cam.onvif_pass, body.action)
    except Exception as exc:
        raise HTTPException(502, f"Lỗi PTZ: {exc}")
    return {"ok": True}
