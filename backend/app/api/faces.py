"""Người quen: enroll từ ảnh, danh sách, xoá."""
from __future__ import annotations

from typing import List

import cv2
import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session, select

from ..config import settings
from ..db import get_session
from ..models import FacePhoto, KnownFace, iso_utc
from ..security import require_auth
from ..services.faces import face_service

router = APIRouter(prefix="/api/faces", tags=["faces"],
                   dependencies=[Depends(require_auth)])


def _face_dict(session: Session, face: KnownFace) -> dict:
    photos = session.exec(
        select(FacePhoto).where(FacePhoto.face_id == face.id)
    ).all()
    from sqlmodel import select as _s
    from ..models import Event
    last = session.exec(
        _s(Event).where(Event.label == face.name).order_by(Event.ts_start.desc())
    ).first()
    return {
        "id": face.id, "name": face.name, "note": face.note,
        "photos": [p.id for p in photos],
        "created_at": iso_utc(face.created_at),
        "last_seen": iso_utc(last.ts_start) if last else None,
    }


@router.get("")
def list_faces(session: Session = Depends(get_session)):
    faces = session.query(KnownFace).order_by(KnownFace.name).all()
    return {
        "available": face_service.available(),
        "items": [_face_dict(session, f) for f in faces],
    }


@router.post("", status_code=201)
async def enroll_face(
    name: str = Form(...),
    note: str = Form(""),
    files: List[UploadFile] = File(...),
    session: Session = Depends(get_session),
):
    if not name.strip():
        raise HTTPException(400, "Thiếu tên")
    if not face_service.available():
        raise HTTPException(
            400,
            "Chưa cài InsightFace. Trên NAS chạy: "
            "docker exec nvr-home pip install -r backend/requirements-faces.txt rồi restart.",
        )
    images: list[np.ndarray] = []
    for f in files[:10]:
        data = await f.read()
        if not data:
            continue
        img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if img is not None:
            images.append(img)
    if not images:
        raise HTTPException(400, "Không đọc được ảnh nào (chỉ nhận JPG/PNG)")
    try:
        face_id = face_service.enroll(name.strip(), note.strip(), images)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Lỗi nhận diện: {exc}")
    face = session.get(KnownFace, face_id)
    return _face_dict(session, face)


@router.delete("/{face_id}")
def delete_face(face_id: int, session: Session = Depends(get_session)):
    face = session.get(KnownFace, face_id)
    if not face:
        raise HTTPException(404, "Không tìm thấy người quen")
    face_service.delete(face_id)
    return {"ok": True}


@router.get("/{face_id}/photo/{photo_id}")
def face_photo(face_id: int, photo_id: int, session: Session = Depends(get_session)):
    photo = session.get(FacePhoto, photo_id)
    if not photo or photo.face_id != face_id:
        raise HTTPException(404, "Không tìm thấy ảnh")
    path = settings.storage_dir / photo.path
    if not path.exists():
        raise HTTPException(404, "File ảnh không tồn tại")
    return FileResponse(path, media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=86400"})
