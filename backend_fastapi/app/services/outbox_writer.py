"""Outbox writer — port of outbox/service/OutboxWriter. Joins caller txn."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ops import OutboxEvent

# Frontend contract event types
QUOTE_REVISED = "QUOTE_REVISED"
QUOTE_SUBMITTED = "QUOTE_SUBMITTED"
APPROVAL_UPDATED = "APPROVAL_UPDATED"
NEGOTIATION_UPDATED = "NEGOTIATION_UPDATED"
ORDER_CREATED = "ORDER_CREATED"
ALLOCATION_UPDATED = "ALLOCATION_UPDATED"
BACKORDER_UPDATED = "BACKORDER_UPDATED"
INVOICE_UPDATED = "INVOICE_UPDATED"
SUBSCRIPTION_UPDATED = "SUBSCRIPTION_UPDATED"
ALERT_UPDATED = "ALERT_UPDATED"
STOCK_UPDATED = "STOCK_UPDATED"


def internal_only() -> dict:
    return {}


def owner_scope(owner_profile_id: uuid.UUID | None) -> dict:
    return {"ownerProfileId": str(owner_profile_id)} if owner_profile_id else {}


def deal_scope(
    customer_id: uuid.UUID | None,
    owner_profile_id: uuid.UUID | None,
    team_id: uuid.UUID | None,
) -> dict:
    scope: dict[str, Any] = {}
    if customer_id:
        scope["customerId"] = str(customer_id)
    if owner_profile_id:
        scope["ownerProfileId"] = str(owner_profile_id)
    if team_id:
        scope["teamId"] = str(team_id)
    return scope


def roles_scope(*roles: str) -> dict:
    return {"roles": list(roles)} if roles else {}


async def publish(
    db: AsyncSession,
    event_type: str,
    aggregate_type: str,
    aggregate_id: uuid.UUID,
    aggregate_version: int,
    payload: dict | None,
    scope: dict | None,
) -> OutboxEvent:
    event = OutboxEvent(
        event_type=event_type,
        aggregate_type=aggregate_type,
        aggregate_id=aggregate_id,
        aggregate_version=aggregate_version,
        payload=payload or {},
        recipient_scope=scope or {},
        attempt_count=0,
        next_attempt_at=datetime.now(timezone.utc),
    )
    db.add(event)
    return event
