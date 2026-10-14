"""Outbox dispatcher — port of outbox/service/OutboxDispatcher.

Polls every second: claim due rows (FOR UPDATE SKIP LOCKED, batch 50),
deliver to resolved recipients' sockets, mark dispatched; on failure retry
with min(300, 2^attempts)s backoff, parked after 8 attempts.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal
from app.core.response import dumps
from app.models.auth import Profile
from app.models.ops import OutboxEvent
from app.websocket.manager import manager

log = logging.getLogger("dealflow")

BATCH_SIZE = 50
MAX_ATTEMPTS = 8
POLL_INTERVAL_SECONDS = 1.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def resolve_recipients(db: AsyncSession, scope: dict) -> list[uuid.UUID]:
    """Mirror of OutboxDispatcher.resolveRecipients (hints only, active only)."""
    recipients: set[uuid.UUID] = set()
    owner = scope.get("ownerProfileId")
    if owner:
        row = (
            await db.execute(
                select(Profile.id).where(
                    Profile.id == uuid.UUID(str(owner)), Profile.is_active.is_(True)
                )
            )
        ).scalar_one_or_none()
        if row is not None:
            recipients.add(row)
    customer = scope.get("customerId")
    if customer:
        rows = (
            await db.execute(
                select(Profile.id).where(
                    Profile.customer_id == uuid.UUID(str(customer)),
                    Profile.role == "CUSTOMER",
                    Profile.is_active.is_(True),
                )
            )
        ).scalars().all()
        recipients.update(rows)
    team = scope.get("teamId")
    if team:
        rows = (
            await db.execute(
                select(Profile.id).where(
                    Profile.role == "MANAGER",
                    Profile.is_active.is_(True),
                    ((Profile.team_id == uuid.UUID(str(team))) | (Profile.team_id.is_(None))),
                )
            )
        ).scalars().all()
        recipients.update(rows)
    for role in scope.get("roles", []) or []:
        if role == "CUSTOMER":
            continue  # never broadcast to all customers
        if role not in ("REP", "MANAGER", "FINANCE", "ADMIN"):
            log.warning("unknown outbox role %s; skipping", role)
            continue
        rows = (
            await db.execute(
                select(Profile.id).where(
                    Profile.role == role, Profile.is_active.is_(True)
                )
            )
        ).scalars().all()
        recipients.update(rows)
    return sorted(recipients)


async def dispatch_batch(db: AsyncSession, batch_size: int = BATCH_SIZE) -> int:
    """Claim + deliver one batch. Returns events marked dispatched."""
    rows = (
        await db.execute(
            text(
                "SELECT * FROM dealflow.outbox_events"
                " WHERE dispatched_at IS NULL AND next_attempt_at <= now()"
                " AND (lease_until IS NULL OR lease_until < now())"
                " ORDER BY created_at ASC LIMIT :batch"
                " FOR UPDATE SKIP LOCKED"
            ),
            {"batch": batch_size},
        )
    ).mappings().all()
    if not rows:
        return 0
    lease_until = _now() + timedelta(seconds=120)
    ids = [r["id"] for r in rows]
    await db.execute(
        text(
            "UPDATE dealflow.outbox_events SET lease_until = :lease"
            " WHERE id = ANY(:ids)"
        ),
        {"lease": lease_until, "ids": ids},
    )
    dispatched = 0
    for row in rows:
        try:
            await _deliver(db, row)
            await db.execute(
                text(
                    "UPDATE dealflow.outbox_events"
                    " SET dispatched_at = now(), lease_until = NULL WHERE id = :id"
                ),
                {"id": row["id"]},
            )
            dispatched += 1
        except Exception as exc:
            await _schedule_retry(db, row, exc)
    await db.flush()
    return dispatched


async def _deliver(db: AsyncSession, row: object) -> None:
    mapping = row  # RowMapping
    scope = mapping["recipient_scope"] or {}
    recipients = await resolve_recipients(db, scope)
    if not recipients:
        return  # still marked dispatched: nothing to push to
    frame = dumps(
        {
            "eventId": str(mapping["id"]),
            "type": mapping["event_type"],
            "entityType": mapping["aggregate_type"],
            "entityId": str(mapping["aggregate_id"]),
            "version": mapping["aggregate_version"],
            "occurredAt": (mapping["created_at"].isoformat()
                           if mapping["created_at"] else None),
            "payload": mapping["payload"] or {},
        }
    )
    for recipient in recipients:
        await manager.send_to_profile(recipient, frame)


async def _schedule_retry(db: AsyncSession, row: object, exc: Exception) -> None:
    attempts = (row["attempt_count"] or 0) + 1
    error = str(exc)[:500]
    if attempts >= MAX_ATTEMPTS:
        await db.execute(
            text(
                "UPDATE dealflow.outbox_events SET attempt_count = :n,"
                " last_error = :err, dispatched_at = now(), lease_until = NULL"
                " WHERE id = :id"
            ),
            {"n": attempts, "err": error, "id": row["id"]},
        )
        return
    backoff = min(300, 2**attempts)
    await db.execute(
        text(
            "UPDATE dealflow.outbox_events SET attempt_count = :n, last_error = :err,"
            " next_attempt_at = now() + make_interval(secs => :backoff),"
            " lease_until = NULL WHERE id = :id"
        ),
        {"n": attempts, "err": error, "id": row["id"], "backoff": backoff},
    )


async def poll_forever() -> None:
    from app.core.config import get_settings

    while True:
        try:
            if get_settings().jobs_enabled:
                async with SessionLocal() as db:
                    try:
                        await dispatch_batch(db)
                        await db.commit()
                    except Exception:
                        await db.rollback()
                        raise
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("outbox sweep failed")
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def drain(db: AsyncSession) -> int:
    """Test helper: dispatch until no due rows remain. Returns total."""
    total = 0
    while True:
        n = await dispatch_batch(db)
        total += n
        if n == 0:
            return total
