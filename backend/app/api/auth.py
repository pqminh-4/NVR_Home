"""Đăng nhập đơn giản: 1 admin."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from ..db import get_session
from ..models import Setting
from ..security import (
    create_token,
    get_jwt_secret,
    hash_password,
    require_auth,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str


class ChangePasswordBody(BaseModel):
    old_password: str
    new_password: str


@router.post("/login")
def login(body: LoginBody, session: Session = Depends(get_session)):
    if body.username != "admin":
        raise HTTPException(401, "Sai tên đăng nhập hoặc mật khẩu")
    stored = session.get(Setting, "admin_password_hash")
    if not stored or not verify_password(body.password, stored.value):
        raise HTTPException(401, "Sai tên đăng nhập hoặc mật khẩu")
    token = create_token(get_jwt_secret(session))
    return {"token": token, "username": "admin", "expires_days": 30}


@router.get("/me")
def me(_user=Depends(require_auth)):
    return {"username": "admin"}


@router.post("/password")
def change_password(
    body: ChangePasswordBody,
    _user=Depends(require_auth),
    session: Session = Depends(get_session),
):
    stored = session.get(Setting, "admin_password_hash")
    if not stored or not verify_password(body.old_password, stored.value):
        raise HTTPException(400, "Mật khẩu cũ không đúng")
    if len(body.new_password) < 6:
        raise HTTPException(400, "Mật khẩu mới tối thiểu 6 ký tự")
    stored.value = hash_password(body.new_password)
    session.add(stored)
    session.commit()
    return {"ok": True}
