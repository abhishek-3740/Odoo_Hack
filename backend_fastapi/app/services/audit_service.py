"""Audit service — port of shared/audit/AuditService. Joins the caller's
transaction; JSON failures warn and never sink it."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.response import current_request_id
from app.core.security import Actor
from app.models.ops import AuditEvent

log = logging.getLogger("dealflow")


def _to_json(value: Any) -> dict | None:
    if value is None:
        return None
    try:
        return json.loads(json.dumps(value, default=str))
    except (TypeError, ValueError):
        log.warning("audit payload not serializable; dropping")
        return None


async def record(
    db: AsyncSession,
    actor: Actor | None,
    action: str,
    entity_type: str,
    entity_id: UUID | None,
    *,
    quote_id: UUID | None = None,
    revision_id: UUID | None = None,
    order_id: UUID | None = None,
    before: Any = None,
    after: Any = None,
    reason: str | None = None,
) -> AuditEvent:
    event = AuditEvent(
        actor_profile_id=actor.profile_id if actor and not actor.is_system else None,
        actor_kind="SYSTEM" if actor is None or actor.is_system else "USER",
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        quote_id=quote_id,
        revision_id=revision_id,
        order_id=order_id,
        before_summary=_to_json(before),
        after_summary=_to_json(after),
        reason=reason,
        request_id=current_request_id(),
        occurred_at=datetime.now(timezone.utc),
    )
    db.add(event)
    return event
