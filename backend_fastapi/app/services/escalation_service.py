"""Escalation + staff negotiation-desk services.

Port of portal/service/DealEscalationService.java (escalation target roles:
DISCOUNT -> FINANCE, POLICY -> ADMIN, REVIEW -> MANAGER; active target-role
profiles notified, MANAGER filtered to the quote team) and
portal/service/NegotiationDeskService.java (staff list/reply side only).
"""

from __future__ import annotations

import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.models.auth import Profile
from app.models.ops import Notification
from app.models.portal import NegotiationRequest
from app.repositories import escalations_repo
from app.schemas.quotes import escalation_to_dict, negotiation_view_to_dict
from app.services import audit_service
from app.services.clock import now_utc
from app.services.quote_service import load_quote, lock_quote, require_adopt, require_read

TARGET_FOR_CATEGORY = {"DISCOUNT": "FINANCE", "POLICY": "ADMIN", "REVIEW": "MANAGER"}


def _require_internal(actor: Actor) -> None:
    if actor.is_customer:
        raise ApiException.forbidden("Use the portal endpoints.")


# ------------------------------------------------------------- escalations ---


async def list_escalations(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID | None
) -> list[dict]:
    _require_internal(actor)
    if quote_id is not None:
        require_read(actor, await load_quote(db, quote_id))
    if actor.is_admin:
        where, params = "true", {}
    elif actor.role == "REP":
        where, params = "q.owner_profile_id = :owner", {"owner": actor.profile_id}
    elif actor.role == "MANAGER" and actor.team_id is not None:
        where, params = "q.team_id = :team", {"team": actor.team_id}
    else:
        where, params = "true", {}
    rows = await escalations_repo.list_escalations(db, where, params, quote_id)
    return [escalation_to_dict(row) for row in rows]


async def create_escalation(db: AsyncSession, actor: Actor, request) -> dict:
    _require_internal(actor)
    quote = await lock_quote(db, request.quoteId)
    require_read(actor, quote)

    prior = await escalations_repo.find_by_raiser_and_key(db, actor.profile_id, request.requestKey)
    if prior is not None:
        if (
            str(prior["quote_id"]) != str(request.quoteId)
            or str(prior["revision_id"]) != str(request.expectedRevisionId)
            or (prior["reason"] or "") != request.reason.strip()
            or prior["category"] != request.category
        ):
            raise ApiException(
                ErrorCode.CONFLICTING_STATE,
                "Request key already used for different escalation details.",
            )
        return escalation_to_dict(prior)

    if quote.current_revision_id != request.expectedRevisionId:
        raise ApiException(
            ErrorCode.CONFLICTING_STATE, "Quotation changed. Refresh before escalating."
        )
    if quote.stage in ("CONFIRMED", "CANCELED", "LOST", "EXPIRED"):
        raise ApiException(
            ErrorCode.CONFLICTING_STATE, "This quotation is closed."
        )
    target = TARGET_FOR_CATEGORY[request.category]
    escalation_id = uuid.uuid4()
    await escalations_repo.insert_escalation(
        db,
        escalation_id,
        request.quoteId,
        request.expectedRevisionId,
        actor.profile_id,
        request.requestKey,
        request.category,
        target,
        request.reason.strip(),
    )
    recipients = await _active_by_role(db, target)
    if target == "MANAGER":
        recipients = [
            p for p in recipients if p.team_id is None or p.team_id == quote.team_id
        ]
    if not recipients:
        recipients = await _active_by_role(db, "ADMIN")
    now = now_utc()
    for profile in recipients:
        db.add(
            Notification(
                recipient_profile_id=profile.id,
                notification_type="DEAL_ESCALATED",
                title=f"Review needed: {quote.reference}",
                body=request.reason.strip(),
                quote_id=quote.id,
                dedupe_key=f"escalation:{escalation_id}:{profile.id}",
            )
        )
    await audit_service.record(
        db, actor, "DEAL_ESCALATED", "DealEscalation", escalation_id,
        quote_id=quote.id, revision_id=request.expectedRevisionId,
        after={"targetRole": target, "category": request.category},
        reason=request.reason,
    )
    await db.flush()
    row = await escalations_repo.find_by_id(db, escalation_id)
    assert row is not None
    return escalation_to_dict(row)


async def resolve_escalation(
    db: AsyncSession, actor: Actor, escalation_id: uuid.UUID, request
) -> dict:
    _require_internal(actor)
    row = await escalations_repo.find_by_id_for_update(db, escalation_id)
    if row is None:
        raise ApiException.not_found("Escalation")
    require_read(actor, await load_quote(db, row["quote_id"]))
    if not actor.is_admin and actor.role != row["target_role"]:
        raise ApiException.forbidden(
            f"Resolve this case as {row['target_role']} or ADMIN."
        )
    if row["status"] != "OPEN":
        raise ApiException(
            ErrorCode.CONFLICTING_STATE, "This escalation is already resolved."
        )
    await escalations_repo.resolve_escalation(
        db, escalation_id, request.resolution.strip(), actor.profile_id, now_utc()
    )
    await audit_service.record(
        db, actor, "ESCALATION_RESOLVED", "DealEscalation", escalation_id,
        quote_id=row["quote_id"], revision_id=row["revision_id"],
        reason=request.resolution,
    )
    db.add(
        Notification(
            recipient_profile_id=row["raised_by"],
            notification_type="ESCALATION_RESOLVED",
            title=f"Review completed: {row.get('reference')}",
            body=request.resolution.strip(),
            quote_id=row["quote_id"],
        )
    )
    await db.flush()
    resolved = await escalations_repo.find_by_id(db, escalation_id)
    assert resolved is not None
    return escalation_to_dict(resolved)


async def _active_by_role(db: AsyncSession, role: str) -> list[Profile]:
    return list(
        (
            await db.execute(
                select(Profile)
                .where(Profile.role == role, Profile.is_active == True)  # noqa: E712
                .order_by(Profile.full_name.asc())
            )
        )
        .scalars()
        .all()
    )


# ------------------------------------------------------ negotiation desk ---


async def list_negotiations(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID
) -> list[dict]:
    _require_internal(actor)
    require_read(actor, await load_quote(db, quote_id))
    records = list(
        (
            await db.execute(
                select(NegotiationRequest)
                .where(NegotiationRequest.quote_id == quote_id)
                .order_by(NegotiationRequest.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [await _to_view(db, record) for record in records]


async def reply_negotiation(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID, request_id: uuid.UUID, request
) -> dict:
    _require_internal(actor)
    quote = await lock_quote(db, quote_id)
    require_adopt(actor, quote)
    record = (
        (
            await db.execute(
                select(NegotiationRequest).where(
                    NegotiationRequest.id == request_id,
                    NegotiationRequest.quote_id == quote_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if record is None:
        raise ApiException.not_found(f"Request {request_id}")
    if record.status not in ("OPEN", "ANSWERED"):
        raise ApiException(
            ErrorCode.CONFLICTING_STATE,
            f"This request is already {record.status.lower()}.",
        )
    decision = (request.decision or "ANSWERED").strip().upper()
    if decision not in ("ANSWERED", "DECLINED"):
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, "decision must be ANSWERED or DECLINED."
        )
    now = now_utc()
    record.response_message = request.message.strip()
    record.responded_by_profile_id = actor.profile_id
    record.responded_at = now
    record.status = decision
    quote.last_activity_at = now

    await audit_service.record(
        db, actor, "NEGOTIATION_REPLIED", "NegotiationRequest", record.id,
        quote_id=quote.id, revision_id=record.revision_id,
        after={"status": decision, "requestType": record.request_type},
        reason=request.message,
    )
    await db.flush()
    from app.services import outbox_writer

    await outbox_writer.publish(
        db, outbox_writer.NEGOTIATION_UPDATED, "Quote", quote.id, quote.row_version,
        {"requestId": str(record.id), "status": decision},
        outbox_writer.deal_scope(quote.customer_id, quote.owner_profile_id, quote.team_id),
    )
    return await _to_view(db, record)


async def _to_view(db: AsyncSession, record: NegotiationRequest) -> dict:
    people: dict = {}
    ids = {i for i in (record.actor_profile_id, record.responded_by_profile_id) if i}
    if ids:
        people = {
            p.id: (p.full_name or p.email)
            for p in (
                await db.execute(select(Profile).where(Profile.id.in_(ids)))
            )
            .scalars()
            .all()
        }
    try:
        payload = (
            record.payload
            if isinstance(record.payload, dict)
            else (json.loads(record.payload) if record.payload else {})
        )
        if not isinstance(payload, dict):
            payload = {}
    except ValueError:
        payload = {}
    return negotiation_view_to_dict(
        record,
        people.get(record.actor_profile_id),
        people.get(record.responded_by_profile_id),
        payload,
    )
