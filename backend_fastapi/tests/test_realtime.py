"""Step F verification — outbox dispatcher + websocket auth (dealflow_test)."""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.main import app
from app.models.ops import OutboxEvent
from app.websocket import endpoint as ws_endpoint
from app.websocket.manager import manager
from app.workers import outbox as outbox_worker
from tests.itutil import TestSession, override_app_deps, staff_actor, unique


async def _insert_event(scope: dict, event_type: str = "QUOTE_REVISED") -> uuid.UUID:
    async with TestSession() as db:
        event = OutboxEvent(
            event_type=event_type,
            aggregate_type="Quote",
            aggregate_id=uuid.uuid4(),
            aggregate_version=1,
            payload={"reference": "Q-1"},
            recipient_scope=scope,
            attempt_count=0,
            next_attempt_at=datetime.now(timezone.utc),
        )
        db.add(event)
        await db.flush()
        eid = event.id
        await db.commit()
        return eid


async def _fetch_event(eid: uuid.UUID):
    async with TestSession() as db:
        row = (
            await db.execute(
                text(
                    "SELECT dispatched_at, attempt_count, last_error"
                    " FROM dealflow.outbox_events WHERE id = :id"
                ),
                {"id": eid},
            )
        ).mappings().first()
        return dict(row)


def test_dispatch_marks_empty_recipients_dispatched():
    async def check():
        eid = await _insert_event({"ownerProfileId": str(uuid.uuid4())})
        async with TestSession() as db:
            await outbox_worker.drain(db)
            await db.commit()
        row = await _fetch_event(eid)
        assert row["dispatched_at"] is not None

    asyncio.run(check())


class _FakeSocket:
    def __init__(self):
        self.sent: list[str] = []

    async def send_text(self, message: str) -> None:
        self.sent.append(message)


def test_dispatch_pushes_to_connected_owner():
    async def check():
        from app.models.auth import Profile

        pid = uuid.uuid4()
        async with TestSession() as db:
            db.add(
                Profile(
                    id=pid, auth_user_id=uuid.uuid4(),
                    email=unique("owner") + "@t.dev", full_name="O",
                    role="REP", is_active=True,
                )
            )
            await db.commit()
        sock = _FakeSocket()
        await manager.connect(pid, sock)  # type: ignore[arg-type]
        try:
            eid = await _insert_event({"ownerProfileId": str(pid)})
            async with TestSession() as db:
                n = await outbox_worker.drain(db)
                await db.commit()
            assert n >= 1
            row = await _fetch_event(eid)
            assert row["dispatched_at"] is not None
            assert len(sock.sent) == 1
            import json as _json

            frame = _json.loads(sock.sent[0])
            assert frame["type"] == "QUOTE_REVISED"
            assert frame["payload"] == {"reference": "Q-1"}
        finally:
            await manager.disconnect(pid, sock)  # type: ignore[arg-type]

    asyncio.run(check())


def test_failed_delivery_retries_then_parks():
    async def check():
        eid = await _insert_event({"roles": ["ADMIN"]}, event_type="BROKEN")
        real_send = manager.send_to_profile

        async def boom(pid, msg):
            raise RuntimeError("socket down")

        manager.send_to_profile = boom  # type: ignore[assignment]
        try:
            # seed an ADMIN profile so delivery is attempted (and fails)
            async with TestSession() as db:
                from app.models.auth import Profile

                admin = Profile(
                    auth_user_id=uuid.uuid4(), email=unique("admin") + "@t.dev",
                    full_name="A", role="ADMIN", is_active=True,
                )
                db.add(admin)
                await db.commit()
            async with TestSession() as db:
                # force attempts to the edge
                await db.execute(
                    text(
                        "UPDATE dealflow.outbox_events SET attempt_count = 7"
                        " WHERE id = :id"
                    ),
                    {"id": eid},
                )
                await db.commit()
            async with TestSession() as db:
                n = await outbox_worker.dispatch_batch(db)
                await db.commit()
            assert n == 0  # parked, not dispatched
            row = await _fetch_event(eid)
            assert row["dispatched_at"] is not None  # parked rows stay visible
            assert row["attempt_count"] == 8
            assert "socket down" in (row["last_error"] or "")
        finally:
            manager.send_to_profile = real_send  # type: ignore[assignment]

    asyncio.run(check())


def test_websocket_rejects_anonymous_and_accepts_verified():
    actor = staff_actor("REP")

    def fake_verify(token: str):
        assert token == "good-token"
        return {"sub": str(actor.auth_user_id)}

    async def fake_resolve(db, claims):
        return actor

    ws_endpoint.verify_token = fake_verify  # type: ignore[assignment]
    ws_endpoint.resolve_actor = fake_resolve  # type: ignore[assignment]
    try:
        client = TestClient(app, raise_server_exceptions=False)
        with pytest.raises(Exception):
            with client.websocket_connect("/ws"):
                pass
        with client.websocket_connect("/ws?token=good-token") as ws:
            assert manager.connection_count() == 1
            ws.send_text("hello (ignored)")
        assert manager.connection_count() == 0
    finally:
        import app.core.security as _sec

        ws_endpoint.verify_token = _sec.verify_token  # type: ignore[assignment]
        ws_endpoint.resolve_actor = _sec.resolve_actor  # type: ignore[assignment]
