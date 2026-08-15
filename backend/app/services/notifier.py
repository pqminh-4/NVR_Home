"""Thông báo event qua Telegram / Pushover (kèm ảnh)."""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

import httpx
from sqlmodel import Session

from ..config import settings, local_now
from ..db import engine
from ..models import Event
from . import settings_store

logger = logging.getLogger("nvr.notify")

TYPE_VI = {
    "person": "👤 Người",
    "car": "🚗 Ô tô",
    "cat": "🐱 Mèo",
    "dog": "🐕 Chó",
    "motion": "🌊 Chuyển động",
    "face_stranger": "🚨 NGƯỜI LẠ",
}

_last_sent: dict[tuple[int, str], float] = {}


def _in_quiet_hours(now: datetime, quiet_from: str, quiet_to: str) -> bool:
    try:
        cur = now.hour * 60 + now.minute
        f = int(quiet_from[:2]) * 60 + int(quiet_from[3:5])
        t = int(quiet_to[:2]) * 60 + int(quiet_to[3:5])
        return f <= cur <= t if f <= t else (cur >= f or cur <= t)
    except Exception:
        return False


async def _send_telegram(token: str, chat_id: str, text: str, photo: Path | None) -> bool:
    url = f"https://api.telegram.org/bot{token}"
    async with httpx.AsyncClient(timeout=20) as client:
        if photo and photo.exists():
            with open(photo, "rb") as f:
                resp = await client.post(
                    f"{url}/sendPhoto",
                    data={"chat_id": chat_id, "caption": text[:1000]},
                    files={"photo": (photo.name, f, "image/jpeg")},
                )
        else:
            resp = await client.post(
                f"{url}/sendMessage",
                data={"chat_id": chat_id, "text": text},
            )
    if resp.status_code >= 400:
        logger.warning("Telegram lỗi %s: %s", resp.status_code, resp.text[:200])
        return False
    return True


async def _send_pushover(token: str, user: str, text: str, photo: Path | None) -> bool:
    data = {"token": token, "user": user, "message": text, "priority": "1"}
    files = None
    if photo and photo.exists():
        files = {"attachment": (photo.name, open(photo, "rb"), "image/jpeg")}
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.pushover.net/1/messages.json", data=data, files=files
            )
    finally:
        if files:
            files["attachment"][1].close()
    if resp.status_code >= 400:
        logger.warning("Pushover lỗi %s: %s", resp.status_code, resp.text[:200])
        return False
    return True


def _build_text(event: Event) -> str:
    label = f" ({event.label})" if event.label else ""
    when = local_now().strftime("%H:%M:%S %d/%m")
    return f"{TYPE_VI.get(event.type, event.type)}{label}\n📷 {event.camera_name} — {when}"


async def notify_event_async(event_id: int) -> None:
    try:
        await _notify(event_id)
    except Exception:
        logger.exception("gửi thông báo lỗi (event %s)", event_id)


async def _notify(event_id: int) -> None:
    import time

    with Session(engine) as session:
        event = session.get(Event, event_id)
        if event is None or event.notified:
            return
        cfg = settings_store.get_all(session)
        if not cfg["notify_enabled"]:
            return
        notify_types = {t.strip() for t in str(cfg["notify_types"]).split(",") if t.strip()}
        if notify_types and event.type not in notify_types:
            return
        if cfg["quiet_hours_enabled"] and _in_quiet_hours(
            local_now(), str(cfg["quiet_from"]), str(cfg["quiet_to"])
        ):
            return
        key = (event.camera_id, event.type)
        now = time.monotonic()
        if now - _last_sent.get(key, 0.0) < float(cfg["notify_cooldown"]):
            return
        photo = (settings.storage_dir / event.snapshot) if event.snapshot else None
        text = _build_text(event)

    sent = False
    if cfg["telegram_token"] and cfg["telegram_chat_id"]:
        ok = await _send_telegram(
            str(cfg["telegram_token"]), str(cfg["telegram_chat_id"]), text, photo
        )
        sent = sent or ok
    if cfg["pushover_token"] and cfg["pushover_user"]:
        ok = await _send_pushover(
            str(cfg["pushover_token"]), str(cfg["pushover_user"]), text, photo
        )
        sent = sent or ok
    if sent:
        _last_sent[key] = now
        with Session(engine) as session:
            ev = session.get(Event, event_id)
            if ev:
                ev.notified = True
                session.add(ev)
                session.commit()


async def send_test_async() -> tuple[bool, str]:
    """Gửi thông báo test từ trang Cài đặt."""
    with Session(engine) as session:
        cfg = settings_store.get_all(session)
    if not cfg["notify_enabled"]:
        return False, "Thông báo đang tắt"
    text = "✅ NVR_Home — thông báo test hoạt động!"
    sent = False
    errors: list[str] = []
    if cfg["telegram_token"] and cfg["telegram_chat_id"]:
        try:
            sent = await _send_telegram(
                str(cfg["telegram_token"]), str(cfg["telegram_chat_id"]), text, None
            ) or sent
        except Exception as exc:
            errors.append(f"Telegram: {exc}")
    if cfg["pushover_token"] and cfg["pushover_user"]:
        try:
            sent = await _send_pushover(
                str(cfg["pushover_token"]), str(cfg["pushover_user"]), text, None
            ) or sent
        except Exception as exc:
            errors.append(f"Pushover: {exc}")
    if errors:
        return sent, "; ".join(errors)
    return sent, "Đã gửi" if sent else "Chưa cấu hình Telegram/Pushover"
