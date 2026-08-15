"""WebSocket hub: broadcast event realtime tới mọi client."""
from __future__ import annotations

import asyncio
import logging

from fastapi import WebSocket

logger = logging.getLogger("nvr.ws")


class Hub:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    async def broadcast(self, message: dict) -> None:
        if not self._clients:
            return
        dead: list[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    def broadcast_threadsafe(self, message: dict) -> None:
        """Gọi từ worker thread (detector) — chuyển về event loop chính."""
        if self._loop and not self._loop.is_closed():
            asyncio.run_coroutine_threadsafe(self.broadcast(message), self._loop)

    def schedule_coroutine(self, coro) -> None:
        """Chạy 1 coroutine từ worker thread trên event loop chính."""
        if self._loop and not self._loop.is_closed():
            asyncio.run_coroutine_threadsafe(coro, self._loop)

    def call_soon_threadsafe(self, fn) -> None:
        """Đưa 1 hàm đồng bộ vào event loop chính từ worker thread."""
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(fn)


hub = Hub()
