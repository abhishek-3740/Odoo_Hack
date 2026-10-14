"""Raw-SQL repository for deal_escalations — mirrors DealEscalationService's
JdbcTemplate usage (SELECT ... join quotes, insert, resolve update)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

_SELECT = (
    "SELECT e.*, q.reference FROM dealflow.deal_escalations e "
    "JOIN dealflow.quotes q ON q.id = e.quote_id "
)


def _row_to_escalation(row: Any) -> dict:
    m = row._mapping
    return {
        "id": m["id"],
        "quote_id": m["quote_id"],
        "revision_id": m["revision_id"],
        "reference": m["reference"],
        "raised_by": m["raised_by"],
        "category": m["category"],
        "target_role": m["target_role"],
        "reason": m["reason"],
        "status": m["status"],
        "resolution": m["resolution"],
        "created_at": m["created_at"],
        "resolved_at": m["resolved_at"],
    }


async def list_escalations(
    db: AsyncSession,
    where_sql: str,
    params: dict[str, Any],
    quote_id: uuid.UUID | None,
) -> list[dict]:
    """where_sql uses :named params (e.g. 'true', 'q.owner_profile_id = :owner')."""
    sql = _SELECT + "WHERE " + where_sql
    bound = dict(params)
    if quote_id is not None:
        sql += " AND e.quote_id = :quote_id"
        bound["quote_id"] = quote_id
    sql += " ORDER BY e.created_at DESC LIMIT 100"
    rows = (await db.execute(text(sql), bound)).all()
    return [_row_to_escalation(r) for r in rows]


async def find_by_raiser_and_key(
    db: AsyncSession, raised_by: uuid.UUID, request_key: uuid.UUID
) -> dict | None:
    rows = (
        await db.execute(
            text(_SELECT + "WHERE e.raised_by = :raised_by AND e.request_key = :key"),
            {"raised_by": raised_by, "key": request_key},
        )
    ).all()
    return _row_to_escalation(rows[0]) if rows else None


async def find_by_id(db: AsyncSession, escalation_id: uuid.UUID) -> dict | None:
    rows = (
        await db.execute(
            text(_SELECT + "WHERE e.id = :id"), {"id": escalation_id}
        )
    ).all()
    return _row_to_escalation(rows[0]) if rows else None


async def find_by_id_for_update(
    db: AsyncSession, escalation_id: uuid.UUID
) -> dict | None:
    rows = (
        await db.execute(
            text(_SELECT + "WHERE e.id = :id FOR UPDATE OF e"), {"id": escalation_id}
        )
    ).all()
    return _row_to_escalation(rows[0]) if rows else None


async def insert_escalation(
    db: AsyncSession,
    escalation_id: uuid.UUID,
    quote_id: uuid.UUID,
    revision_id: uuid.UUID,
    raised_by: uuid.UUID,
    request_key: uuid.UUID,
    category: str,
    target_role: str,
    reason: str,
) -> None:
    await db.execute(
        text(
            "INSERT INTO dealflow.deal_escalations"
            "(id, quote_id, revision_id, raised_by, request_key, category, target_role, reason)"
            " VALUES (:id, :quote_id, :revision_id, :raised_by, :key, :category, :target, :reason)"
        ),
        {
            "id": escalation_id,
            "quote_id": quote_id,
            "revision_id": revision_id,
            "raised_by": raised_by,
            "key": request_key,
            "category": category,
            "target": target_role,
            "reason": reason,
        },
    )


async def resolve_escalation(
    db: AsyncSession,
    escalation_id: uuid.UUID,
    resolution: str,
    resolved_by: uuid.UUID,
    resolved_at: datetime,
) -> None:
    await db.execute(
        text(
            "UPDATE dealflow.deal_escalations SET status='RESOLVED', resolution=:resolution,"
            " resolved_by=:by, resolved_at=:at WHERE id=:id"
        ),
        {
            "resolution": resolution,
            "by": resolved_by,
            "at": resolved_at,
            "id": escalation_id,
        },
    )
