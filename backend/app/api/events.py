"""Events: danh sách, ảnh, xoá, thống kê."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlmodel import Session, func, select

from ..config import settings
from ..db import get_session
from ..models import Event
from ..security import require_auth

router = APIRouter(prefix="/api/events", tags=["events"],
                   dependencies=[Depends(require_auth)])


def _parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


@router.get("")
def list_events(
    camera_id: Optional[int] = None,
    types: Optional[str] = None,
    label: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session),
):
    q = select(Event).order_by(Event.ts_start.desc())
    if camera_id:
        q = q.where(Event.camera_id == camera_id)
    if types:
        wanted = {t.strip() for t in types.split(",") if t.strip()}
        q = q.where(Event.type.in_(wanted))  # type: ignore[attr-defined]
    if label:
        q = q.where(Event.label.contains(label))
    df, dt = _parse_dt(date_from), _parse_dt(date_to)
    if df:
        q = q.where(Event.ts_start >= df)
    if dt:
        q = q.where(Event.ts_start <= dt)
    total = session.exec(select(func.count()).select_from(q.subquery())).one()
    rows = session.exec(q.offset(offset).limit(limit)).all()
    return {"total": total, "items": [e.to_dict() for e in rows]}


@router.get("/stats")
def stats(days: int = Query(7, ge=1, le=90), session: Session = Depends(get_session)):
    since = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    from datetime import timedelta

    since -= timedelta(days=days - 1)
    q = select(Event).where(Event.ts_start >= since)
    rows = session.exec(q).all()
    by_day: dict[str, dict[str, int]] = {}
    by_type: dict[str, int] = {}
    for e in rows:
        day = e.ts_start.astimezone().strftime("%Y-%m-%d")
        by_day.setdefault(day, {})
        by_day[day][e.type] = by_day[day].get(e.type, 0) + 1
        by_type[e.type] = by_type.get(e.type, 0) + 1
    return {"days": by_day, "by_type": by_type, "total": len(rows)}


@router.get("/{event_id}/snapshot")
def event_snapshot(event_id: int, session: Session = Depends(get_session)):
    event = session.get(Event, event_id)
    if not event or not event.snapshot:
        raise HTTPException(404, "Không có ảnh")
    path = settings.storage_dir / event.snapshot
    if not path.exists():
        raise HTTPException(404, "File ảnh đã bị xoá")
    return FileResponse(path, media_type="image/jpeg",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.delete("/{event_id}")
def delete_event(event_id: int, session: Session = Depends(get_session)):
    event = session.get(Event, event_id)
    if not event:
        raise HTTPException(404, "Không tìm thấy event")
    if event.snapshot:
        try:
            (settings.storage_dir / event.snapshot).unlink(missing_ok=True)
        except OSError:
            pass
    session.delete(event)
    session.commit()
    return {"ok": True}
