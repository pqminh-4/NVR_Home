"""Bảng dữ liệu SQLite."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import Column, JSON, LargeBinary
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(dt: datetime | None) -> str | None:
    """SQLite trả datetime naive (đã lưu UTC) — gắn lại tz khi xuất JSON."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


class Camera(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    slug: str = Field(index=True, unique=True)
    url_main: str
    url_sub: str = ""
    enabled: bool = True

    # Ghi hình: continuous | motion | off
    record_mode: str = "continuous"

    # AI detect
    detect_enabled: bool = True
    detect_fps: int = 2
    detect_classes: str = "person,car,cat,dog"
    detect_threshold: float = 0.55
    # vùng quan tâm: [[x1,y1,x2,y2], ...] toạ độ chuẩn hoá 0..1
    zones: List[List[float]] = Field(default_factory=list, sa_column=Column(JSON))

    # PTZ (ONVIF)
    ptz_enabled: bool = False
    onvif_url: str = ""
    onvif_user: str = ""
    onvif_pass: str = ""

    # Trạng thái runtime (cập nhật bởi recorder/detector)
    status: str = "offline"  # online | offline | error
    last_frame_at: Optional[datetime] = None
    last_error: str = ""

    # Độ phân giải tự nhận diện (vd "1920x1080") — cập nhật bởi resolution service
    res_main: str = ""
    res_sub: str = ""

    @property
    def detect_url(self) -> str:
        """Nguồn cho detector: ưu tiên sub stream."""
        return self.url_sub or self.url_main


class Event(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    camera_id: int = Field(foreign_key="camera.id", index=True)
    camera_name: str = ""
    type: str = Field(index=True)  # person|car|cat|dog|motion|face_stranger
    label: str = ""                # tên người quen nếu nhận diện được
    score: float = 0.0
    ts_start: datetime = Field(default_factory=utcnow, index=True)
    ts_end: datetime = Field(default_factory=utcnow)
    snapshot: str = ""             # đường dẫn tương đối trong storage
    notified: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "camera_id": self.camera_id,
            "camera_name": self.camera_name,
            "type": self.type,
            "label": self.label,
            "score": round(self.score, 3),
            "ts_start": iso_utc(self.ts_start),
            "ts_end": iso_utc(self.ts_end),
            "has_snapshot": bool(self.snapshot),
            "notified": self.notified,
        }


class KnownFace(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    note: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class FacePhoto(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    face_id: int = Field(foreign_key="knownface.id", index=True)
    path: str = ""            # file trong storage/faces/
    embedding: bytes = Field(default=b"", sa_column=Column(LargeBinary))
    created_at: datetime = Field(default_factory=utcnow)


class Setting(SQLModel, table=True):
    key: str = Field(primary_key=True)
    value: str = ""
