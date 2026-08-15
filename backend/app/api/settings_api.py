"""Cài đặt toàn cục + test thông báo."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session
from typing import Any, Dict

from ..db import get_session
from ..security import require_auth
from ..services import settings_store
from ..services.notifier import send_test_async

router = APIRouter(prefix="/api/settings", tags=["settings"],
                   dependencies=[Depends(require_auth)])


class SettingsBody(BaseModel):
    values: Dict[str, Any]


@router.get("")
def get_settings(session: Session = Depends(get_session)):
    return settings_store.get_all(session)


@router.put("")
def put_settings(body: SettingsBody, session: Session = Depends(get_session)):
    settings_store.set_many(session, body.values)
    return settings_store.get_all(session)


@router.post("/test-notify")
async def test_notify():
    ok, msg = await send_test_async()
    return {"ok": ok, "message": msg}
