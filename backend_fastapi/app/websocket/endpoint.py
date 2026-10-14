"""Native WebSocket endpoint at /ws (replaces STOMP /ws + /user/queue/deal-events).

Auth: ?token= or Authorization: Bearer header, verified + DB-resolved before
accept (anonymous connects are closed with 4401, like the interceptor).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.database import SessionLocal
from app.core.exceptions import ApiException
from app.core.security import resolve_actor, verify_token
from app.websocket.manager import manager

log = logging.getLogger("dealflow")

ws_router = APIRouter()

# Overridable in tests (mirrors SessionLocal in production).
session_factory: async_sessionmaker = SessionLocal


@ws_router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket, token: str | None = Query(default=None)
) -> None:
    bearer = websocket.headers.get("authorization", "")
    if bearer.lower().startswith("bearer "):
        token = bearer[7:].strip()
    if not token:
        await websocket.close(code=4401)
        return
    try:
        claims = verify_token(token)
        async with session_factory() as db:
            actor = await resolve_actor(db, claims)
            await db.commit()
    except ApiException as exc:
        log.debug("websocket auth refused: %s", exc.code.name)
        await websocket.close(code=4401)
        return
    except Exception:
        log.exception("websocket auth failed")
        await websocket.close(code=4401)
        return
    if actor.profile_id is None:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    await manager.connect(actor.profile_id, websocket)
    try:
        while True:
            frame = await websocket.receive_text()
            if frame.startswith("CONNECT") or frame.startswith("STOMP"):
                await websocket.send_text("CONNECTED\nversion:1.2\nheart-beat:10000,10000\n\n\x00")
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(actor.profile_id, websocket)
