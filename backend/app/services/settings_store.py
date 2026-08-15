"""Kho cấu hình dạng key-value trong DB (với giá trị mặc định)."""
from __future__ import annotations

import json
from typing import Any

from sqlmodel import Session

from ..models import Setting

DEFAULTS: dict[str, Any] = {
    # Lưu trữ
    "retention_days": 14,       # xoá file ghi hình cũ hơn N ngày
    "max_storage_gb": 0,        # 0 = không giới hạn dung lượng
    # AI
    "detector_backend": "yolo",  # yolo | motion
    "face_enabled": True,
    "face_threshold": 0.38,      # cosine similarity insightface
    "stranger_alert": False,     # bật cảnh báo người lạ
    # Thông báo
    "notify_enabled": False,
    "notify_types": "person,face_stranger",
    "notify_cooldown": 180,      # giây giữa 2 lần gửi cho cùng camera+loại
    "telegram_token": "",
    "telegram_chat_id": "",
    "pushover_token": "",
    "pushover_user": "",
    "quiet_hours_enabled": False,
    "quiet_from": "22:30",
    "quiet_to": "06:00",
    # Khác
    "go2rtc_public_url": "",     # trống = tự suy ra từ request
}


def get_value(session: Session, key: str) -> Any:
    row = session.get(Setting, key)
    if row is None or row.value == "":
        return DEFAULTS.get(key)
    raw = row.value
    default = DEFAULTS.get(key)
    try:
        if isinstance(default, bool):
            return raw.lower() in ("1", "true", "yes", "on")
        if isinstance(default, int):
            return int(float(raw))
        if isinstance(default, float):
            return float(raw)
        if default is None:
            return json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        return default
    return raw


def get_all(session: Session) -> dict[str, Any]:
    return {k: get_value(session, k) for k in DEFAULTS}


def set_many(session: Session, values: dict[str, Any]) -> None:
    for key, val in values.items():
        if key not in DEFAULTS:
            continue
        row = session.get(Setting, key)
        stored = json.dumps(val, ensure_ascii=False) if isinstance(val, (dict, list)) else str(val)
        if row is None:
            session.add(Setting(key=key, value=stored))
        else:
            row.value = stored
    session.commit()
