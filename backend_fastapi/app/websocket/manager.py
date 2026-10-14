"""WebSocket connection registry — one private stream per profile.

Mirrors the STOMP contract (StompAuthChannelInterceptor + DealEventPublisher):
bearer auth at connect, exactly one subscribable destination (the caller's own
stream), client frames ignored (SEND was always rejected — use the REST API).
"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._connections: dict[uuid.UUID, set[WebSocket]] = {}

    async def connect(self, profile_id: uuid.UUID, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.setdefault(profile_id, set()).add(websocket)

    async def disconnect(self, profile_id: uuid.UUID, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._connections.get(profile_id)
            if sockets is not None:
                sockets.discard(websocket)
                if not sockets:
                    del self._connections[profile_id]

    async def send_to_profile(self, profile_id: uuid.UUID, message: str) -> int:
        """Best-effort push. Returns sockets written; dead ones are dropped."""
        async with self._lock:
            sockets = list(self._connections.get(profile_id, ()))
        delivered = 0
        for websocket in sockets:
            try:
                await websocket.send_text(message)
                delivered += 1
            except Exception:
                await self.disconnect(profile_id, websocket)
        return delivered

    def connection_count(self) -> int:
        return sum(len(s) for s in self._connections.values())


manager = ConnectionManager()
