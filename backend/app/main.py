"""NVR_Home — FastAPI app chính."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
import jwt
import yaml
from fastapi import Depends, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session
from starlette.background import BackgroundTask

from . import __version__
from .api import auth, cameras, events, faces, recordings, settings_api, system
from .config import settings, slugify
from .db import engine, init_db
from .models import Camera
from .security import decode_token, ensure_admin, get_jwt_secret, require_auth
from .services.detector import detection_manager
from .services.faces import face_service
from .services.go2rtc import go2rtc
from .services.recorder import recording_manager
from .services.resolution import monitor_loop as resolution_loop
from .ws import hub

logger = logging.getLogger("nvr.main")


def _seed_cameras() -> None:
    """Lần đầu chạy: nạp camera từ config/cameras.yml (nếu DB còn trống)."""
    cfg = settings.config_dir / "cameras.yml"
    if not cfg.exists():
        cfg = settings.config_dir / "cameras.yml.example"
    if not cfg.exists():
        return
    try:
        data = yaml.safe_load(cfg.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError:
        logger.warning("cameras.yml lỗi cú pháp, bỏ qua")
        return
    with Session(engine) as session:
        if session.query(Camera).count() > 0:
            return
        n = 0
        for item in data.get("cameras", []) or []:
            name = str(item.get("name", "")).strip()
            url_main = str(item.get("url_main", "")).strip()
            if not name or not url_main:
                continue
            base = slugify(name)
            slug, i = base, 2
            while session.query(Camera).where(Camera.slug == slug).first():
                slug, i = f"{base}-{i}", i + 1
            session.add(Camera(
                name=name, slug=slug,
                url_main=url_main,
                url_sub=str(item.get("url_sub", "")).strip(),
                record_mode=item.get("record_mode", "continuous"),
                detect_enabled=bool(item.get("detect_enabled", True)),
                detect_fps=int(item.get("detect_fps", 2)),
                detect_classes=str(item.get("detect_classes", "person,car,cat,dog")),
                detect_threshold=float(item.get("detect_threshold", 0.55)),
                zones=item.get("zones") or [],
            ))
            n += 1
        session.commit()
        if n:
            logger.info("Đã nạp %d camera từ %s", n, cfg.name)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with Session(engine) as session:
        ensure_admin(session, settings.admin_password)
    _seed_cameras()
    hub.bind_loop(asyncio.get_running_loop())
    await go2rtc.sync_cameras()
    recording_manager.start_all()
    detection_manager.start_all()
    if face_service.available():
        face_service.rebuild_index()
    res_task = asyncio.create_task(resolution_loop())
    logger.info("NVR_Home %s đã khởi động", __version__)
    yield
    res_task.cancel()
    detection_manager.stop_all()
    await recording_manager.stop_all()
    logger.info("NVR_Home đã dừng")


app = FastAPI(title="NVR_Home", version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(auth.router)
app.include_router(cameras.router)
app.include_router(events.router)
app.include_router(recordings.router)
app.include_router(faces.router)
app.include_router(settings_api.router)


@app.websocket("/api/ws")
async def ws_endpoint(ws: WebSocket, token: str = ""):
    authorized = False
    with Session(engine) as session:
        try:
            decode_token(token, get_jwt_secret(session))
            authorized = True
        except jwt.PyJWTError:
            pass
    if not authorized:
        await ws.close(code=4401)
        return
    await hub.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.disconnect(ws)


# ---------- Proxy go2rtc (live view cùng origin — tránh CORS) ----------

_HOP_HEADERS = {
    "host", "authorization", "connection", "transfer-encoding",
    "content-length", "accept-encoding", "cookie",
}


@app.api_route("/go2rtc/{path:path}", methods=["GET", "POST", "PUT", "DELETE"],
               include_in_schema=False)
async def go2rtc_proxy(path: str, request: Request, _user=Depends(require_auth)):
    """Chuyển tiếp request sang go2rtc. Browser gọi /go2rtc/... cùng origin với app
    (go2rtc trực tiếp ở cổng khác sẽ bị chặn CORS vì không trả ACAO header)."""
    url = f"{go2rtc.base}/{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_HEADERS}
    client = httpx.AsyncClient(timeout=httpx.Timeout(15, read=None))
    req = client.build_request(request.method, url, headers=headers,
                               content=await request.body())
    try:
        upstream = await client.send(req, stream=True)
    except httpx.HTTPError as exc:
        await client.aclose()
        return JSONResponse({"detail": f"go2rtc không khả dụng: {exc}"}, status_code=502)

    async def close_upstream() -> None:
        await upstream.aclose()
        await client.aclose()

    return StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        headers={k: v for k, v in upstream.headers.items() if k.lower() not in _HOP_HEADERS},
        background=BackgroundTask(close_upstream),
    )


# ---------- Static frontend (build bằng `npm run build` trong frontend/) ----------

_dist = settings.frontend_dist
if _dist.exists() and (_dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str, request: Request):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        candidate = _dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
else:
    logger.info(
        "Frontend chưa build (thiếu %s) — chỉ phục vụ API. "
        "Chạy: cd frontend && npm install && npm run build", _dist,
    )
