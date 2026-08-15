"""Phát lại: danh sách segment theo ngày + serve file MP4 (hỗ trợ Range)."""
from __future__ import annotations

import re
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlmodel import Session

from ..db import get_session
from ..models import Camera
from ..security import require_auth
from ..services.recorder import recording_manager

router = APIRouter(prefix="/api/recordings", tags=["recordings"],
                   dependencies=[Depends(require_auth)])

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _get_cam(session: Session, cam_id: int) -> Camera:
    cam = session.get(Camera, cam_id)
    if not cam:
        raise HTTPException(404, "Không tìm thấy camera")
    return cam


@router.get("/{cam_id}/dates")
def available_dates(cam_id: int, session: Session = Depends(get_session)):
    """Những ngày nào có ghi hình (cho date picker)."""
    cam = _get_cam(session, cam_id)
    root = recording_manager.recordings_dir() / cam.slug
    if not root.exists():
        return {"dates": []}
    dates = [d.name for d in root.iterdir() if d.is_dir() and _DATE_RE.match(d.name)]
    return {"dates": sorted(dates, reverse=True)}


@router.get("/{cam_id}/{date}")
def day_segments(cam_id: int, date: str, session: Session = Depends(get_session)):
    if not _DATE_RE.match(date):
        raise HTTPException(400, "Ngày không hợp lệ (YYYY-MM-DD)")
    cam = _get_cam(session, cam_id)
    segments = recording_manager.scan_day(cam.slug, date)
    total = sum(s["duration"] for s in segments)
    return {"camera_id": cam.id, "camera_name": cam.name, "date": date,
            "segments": segments, "total_seconds": total}


@router.get("/file")
def segment_file(
    camera: int = Query(...),
    date: str = Query(...),
    file: str = Query(...),
    session: Session = Depends(get_session),
):
    if not _DATE_RE.match(date):
        raise HTTPException(400, "Ngày không hợp lệ")
    cam = _get_cam(session, camera)
    path = recording_manager.segment_path(cam.slug, date, file)
    if path is None:
        raise HTTPException(404, "Không tìm thấy file ghi hình")
    return FileResponse(
        path,
        media_type="video/mp4",
        headers={"Cache-Control": "public, max-age=3600"},
    )
