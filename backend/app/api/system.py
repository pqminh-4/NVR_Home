"""Thông tin hệ thống: sức khoẻ NAS, phiên bản, trạng thái AI."""
from __future__ import annotations

import shutil
import time

import psutil
from fastapi import APIRouter, Depends, Request
from sqlmodel import Session

from .. import __version__
from ..config import settings
from ..db import get_session
from ..models import Camera
from ..security import require_auth
from ..services import settings_store
from ..services.detector import detection_manager
from ..services.faces import face_service
from ..services.go2rtc import go2rtc

router = APIRouter(prefix="/api/system", tags=["system"])

_START_TIME = time.time()


@router.get("/health")
def health():
    return {"status": "ok", "uptime": int(time.time() - _START_TIME)}


@router.get("/info", dependencies=[Depends(require_auth)])
async def info(request: Request, session: Session = Depends(get_session)):
    cams = session.query(Camera).all()
    total, used, free = shutil.disk_usage(settings.storage_dir)
    go2rtc_public = str(settings_store.get_value(session, "go2rtc_public_url") or "")
    if not go2rtc_public:
        # Host header = tên/IP máy chủ như trình duyệt đang dùng tới
        host = request.url.hostname or "localhost"
        go2rtc_public = f"http://{host}:1984"
    try:
        cpu = psutil.cpu_percent(interval=0.3)
        mem = psutil.virtual_memory()
    except Exception:
        cpu, mem = 0.0, None
    det_status = detection_manager.status()
    return {
        "version": __version__,
        "uptime": int(time.time() - _START_TIME),
        "timezone": settings.tz,
        "go2rtc_url": go2rtc_public,
        "cameras": {
            "total": len(cams),
            "enabled": sum(1 for c in cams if c.enabled),
            "online": sum(1 for c in cams if c.status == "online"),
        },
        "detection": det_status,
        "faces": face_service.stats(),
        "disk": {
            "total_gb": round(total / 1024**3, 1),
            "used_gb": round(used / 1024**3, 1),
            "free_gb": round(free / 1024**3, 1),
            "percent": round(used / total * 100, 1) if total else 0,
        },
        "cpu_percent": cpu,
        "memory_percent": mem.percent if mem else None,
    }
