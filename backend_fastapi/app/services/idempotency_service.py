"""Idempotency service — port of shared/idempotency/IdempotencyService.

Claim SQL joins the caller's transaction: INSERT ... ON CONFLICT DO UPDATE
(row-lock on concurrent duplicates) RETURNING (xmax=0) AS inserted.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor, request_hash

log = logging.getLogger("dealflow")

STALE_CLAIM_AFTER = timedelta(minutes=10)

_CLAIM_SQL = """
INSERT INTO dealflow.idempotency_requests
  (id, actor_profile_id, operation, idempotency_key, request_hash,
   status, created_at, updated_at)
VALUES (gen_random_uuid(), :actor, :operation, :key, :hash, 'IN_PROGRESS', now(), now())
ON CONFLICT (actor_profile_id, operation, idempotency_key) DO UPDATE
  SET updated_at = dealflow.idempotency_requests.updated_at
RETURNING id, status, request_hash, response_status, response_body,
  updated_at, (xmax = 0) AS inserted
"""


class Replay(Exception):
    """Raised when a COMPLETED response must be replayed to the caller."""

    def __init__(self, status: int, body: Any, entity_id: UUID | None = None) -> None:
        super().__init__("replay")
        self.status = status
        self.body = body
        self.entity_id = entity_id


async def claim(
    db: AsyncSession, actor: Actor, operation: str, key: str, body: Any
) -> str | None:
    """Returns the claim id, or raises Replay / ApiException. None-actor rejected."""
    if actor.is_system or actor.profile_id is None:
        raise ApiException(ErrorCode.UNAUTHENTICATED, "Sign in to continue.")
    digest = request_hash(body)
    row = (
        await db.execute(
            text(_CLAIM_SQL),
            {"actor": actor.profile_id, "operation": operation, "key": key, "hash": digest},
        )
    ).mappings().first()
    assert row is not None
    if row["status"] == "COMPLETED":
        if row["request_hash"] != digest:
            raise ApiException(
                ErrorCode.IDEMPOTENCY_KEY_REUSED,
                "This request key was already used for a different request.",
            )
        try:
            payload = json.loads(row["response_body"]) if row["response_body"] else None
        except ValueError:
            raise ApiException(
                ErrorCode.CONFLICTING_STATE,
                "The record is no longer in a state that allows this.",
            )
        raise Replay(row["response_status"] or 200, payload)
    if row["request_hash"] != digest:
        raise ApiException(
            ErrorCode.IDEMPOTENCY_KEY_REUSED,
            "This request key was already used for a different request.",
        )
    if not row["inserted"]:
        updated = row["updated_at"]
        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - updated < STALE_CLAIM_AFTER:
            raise ApiException(
                ErrorCode.IDEMPOTENT_REQUEST_IN_PROGRESS,
                "An identical request is still being processed.",
            )
        # Stale IN_PROGRESS (holder crashed): take over with the new hash.
        await db.execute(
            text(
                "UPDATE dealflow.idempotency_requests SET request_hash = :hash,"
                " updated_at = now() WHERE id = :id"
            ),
            {"hash": digest, "id": row["id"]},
        )
    return str(row["id"])


async def complete(
    db: AsyncSession,
    actor: Actor,
    operation: str,
    key: str,
    status: int,
    body: Any,
    entity_id: UUID | None = None,
) -> None:
    await db.execute(
        text(
            "UPDATE dealflow.idempotency_requests SET status = 'COMPLETED',"
            " response_status = :status, response_body = :body,"
            " entity_id = :entity, updated_at = now()"
            " WHERE actor_profile_id = :actor AND operation = :operation"
            " AND idempotency_key = :key"
        ),
        {
            "status": status,
            "body": json.dumps(body, default=str),
            "entity": entity_id,
            "actor": actor.profile_id,
            "operation": operation,
            "key": key,
        },
    )


async def execute(
    db: AsyncSession,
    actor: Actor,
    operation: str,
    key: str,
    body: Any,
    handler: Callable[[], Awaitable[tuple[int, Any, UUID | None]]],
) -> tuple[int, Any, UUID | None, bool]:
    """Runs handler once per key. Returns (status, body, entity_id, replayed).

    Deterministic ApiExceptions complete the claim so replays return the same
    error; unexpected failures release the claim for retry.
    """
    try:
        await claim(db, actor, operation, key, body)
    except Replay as replay:
        return replay.status, replay.body, replay.entity_id, True
    try:
        status, payload, entity_id = await handler()
    except ApiException as exc:
        await complete(
            db, actor, operation, key, exc.status_code,
            {"error": {"code": exc.code.name, "message": exc.message, "details": exc.details}},
        )
        raise
    except Exception:
        await db.execute(
            text(
                "DELETE FROM dealflow.idempotency_requests"
                " WHERE actor_profile_id = :actor AND operation = :operation"
                " AND idempotency_key = :key AND status = 'IN_PROGRESS'"
            ),
            {"actor": actor.profile_id, "operation": operation, "key": key},
        )
        raise
    await complete(db, actor, operation, key, status, payload, entity_id)
    return status, payload, entity_id, False
