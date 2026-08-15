"""Auth đơn giản: 1 admin, mật khẩu hash trong DB, token JWT."""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, Request
from sqlmodel import Session

from .db import engine
from .models import Setting

TOKEN_DAYS = 30
_ITERATIONS = 240_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), _ITERATIONS
    ).hex()
    return f"pbkdf2${_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt, digest = stored.split("$")
        calc = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), salt.encode(), int(iters)
        ).hex()
        return hmac.compare_digest(calc, digest)
    except Exception:
        return False


def _get_or_create(session: Session, key: str, factory) -> Setting:
    row = session.get(Setting, key)
    if row is None:
        row = Setting(key=key, value=factory())
        session.add(row)
        session.commit()
    return row


def ensure_admin(session: Session, env_password: str) -> None:
    _get_or_create(session, "admin_password_hash", lambda: hash_password(env_password))


def get_jwt_secret(session: Session) -> str:
    row = _get_or_create(session, "jwt_secret", lambda: secrets.token_hex(32))
    return row.value


def create_token(secret: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": "admin", "iat": now, "exp": now + timedelta(days=TOKEN_DAYS)}
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_token(token: str, secret: str) -> dict:
    return jwt.decode(token, secret, algorithms=["HS256"])


def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.query_params.get("token")


async def require_auth(request: Request) -> dict:
    """Dependency bảo vệ các route /api (trừ login/health/ws tự xử lý token)."""
    token = _extract_token(request)
    if not token:
        raise HTTPException(401, "Thiếu token đăng nhập")
    with Session(engine) as session:
        secret = get_jwt_secret(session)
        try:
            return decode_token(token, secret)
        except jwt.PyJWTError:
            raise HTTPException(401, "Token không hợp lệ hoặc đã hết hạn")
