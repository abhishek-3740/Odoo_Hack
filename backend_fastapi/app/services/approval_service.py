"""Approval service — port of approvals/service/ApprovalService.java and
ApprovalRoutingService.java.

Chains route from scratch per revision (both steps upfront when finance is
required); retiring a step never grants approval. Every decision locks the
quotation aggregate first, then the step row.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.models.approvals import ApprovalRequest
from app.models.auth import ApprovalDelegation, Profile
from app.models.catalog import Customer
from app.models.quotes import Quote, QuoteRevision
from app.schemas.quotes import approval_queue_item_to_dict, decision_to_dict
from app.services import audit_service, idempotency_service, outbox_writer
from app.services.clock import now_utc
from app.services.quote_service import (
    APPROVAL_CLEARING,
    find_order_id,
    hook_gates_cleared,
)

APPROVAL_DUE_HOURS = 48


# ----------------------------------------------------------------- routing ---


async def find_available_approvers(
    db: AsyncSession, role: str, team_id: uuid.UUID | None, now: datetime
) -> list[Profile]:
    query = select(Profile).where(
        Profile.role == role,
        Profile.is_active == True,  # noqa: E712
        ((Profile.unavailable_until.is_(None)) | (Profile.unavailable_until < now)),
    )
    if team_id is not None:
        query = query.where(Profile.team_id == team_id)
    return list((await db.execute(query.order_by(Profile.full_name.asc()))).scalars().all())


async def create_chain(
    db: AsyncSession,
    quote: Quote,
    revision: QuoteRevision,
    required_level: str,
    reasons_json: str,
    now: datetime,
) -> None:
    if required_level == "NONE":
        revision.required_level = "NONE"
        revision.approval_status = "NOT_REQUIRED"
        return
    try:
        reasons = json.loads(reasons_json) if reasons_json else []
    except ValueError:
        reasons = []
    due_at = now + timedelta(hours=APPROVAL_DUE_HOURS)
    chain = ["MANAGER", "FINANCE"] if required_level == "MANAGER_FINANCE" else ["MANAGER"]
    for index, role in enumerate(chain):
        team_id = quote.team_id if role == "MANAGER" else None
        step = ApprovalRequest(
            quote_id=quote.id,
            revision_id=revision.id,
            step=index + 1,
            required_role=role,
            team_id=team_id,
            due_at=due_at,
            status="PENDING",
            reasons=reasons if isinstance(reasons, list) else [],
        )
        candidates = [
            p
            for p in await find_available_approvers(db, role, team_id, now)
            if p.id != quote.owner_profile_id and p.id != revision.created_by_profile_id
        ]
        if len(candidates) == 1:
            step.assignee_profile_id = candidates[0].id
        db.add(step)
    revision.required_level = required_level
    revision.approval_status = "PENDING_MANAGER"
    await outbox_writer.publish(
        db, outbox_writer.APPROVAL_UPDATED, "Quote", quote.id, quote.row_version,
        {"revisionId": str(revision.id), "requiredLevel": required_level},
        outbox_writer.roles_scope("MANAGER", "FINANCE"),
    )


async def supersede_pending(
    db: AsyncSession, revision: QuoteRevision, actor: Actor, reason: str
) -> int:
    pending = list(
        (
            await db.execute(
                select(ApprovalRequest)
                .where(
                    ApprovalRequest.revision_id == revision.id,
                    ApprovalRequest.status == "PENDING",
                )
                .order_by(ApprovalRequest.step.asc())
            )
        )
        .scalars()
        .all()
    )
    for step in pending:
        step.status = "SUPERSEDED"
        await audit_service.record(
            db, actor, "APPROVAL_SUPERSEDED", "ApprovalRequest", step.id,
            quote_id=revision.quote_id, revision_id=revision.id, reason=reason,
        )
    if pending:
        await outbox_writer.publish(
            db, outbox_writer.APPROVAL_UPDATED, "Quote", revision.quote_id, 0,
            {"revisionId": str(revision.id), "supersededSteps": len(pending), "reason": reason},
            outbox_writer.roles_scope("MANAGER", "FINANCE"),
        )
    return len(pending)


# ------------------------------------------------------------------- queue ---


async def queue(
    db: AsyncSession,
    actor: Actor,
    *,
    status: str,
    page: int,
    size: int,
    sort_field: str,
    descending: bool,
) -> tuple[list[dict], int]:
    candidate = (status or "PENDING").strip().upper()
    if candidate not in ("PENDING", "APPROVED", "REJECTED", "REVISION_REQUIRED", "SUPERSEDED"):
        raise ApiException(ErrorCode.VALIDATION_FAILED, f'Unknown status "{status}".')
    role_filter = actor.role if actor.role in ("MANAGER", "FINANCE") else None
    team_filter = actor.team_id if actor.role == "MANAGER" else None

    base = select(ApprovalRequest).where(ApprovalRequest.status == candidate)
    count_base = select(func.count()).select_from(ApprovalRequest).where(
        ApprovalRequest.status == candidate
    )
    if role_filter is not None:
        base = base.where(ApprovalRequest.required_role == role_filter)
        count_base = count_base.where(ApprovalRequest.required_role == role_filter)
    if team_filter is not None:
        base = base.where(ApprovalRequest.team_id == team_filter)
        count_base = count_base.where(ApprovalRequest.team_id == team_filter)
    if actor.role == "REP":
        base = base.join(Quote, Quote.id == ApprovalRequest.quote_id).where(
            Quote.owner_profile_id == actor.profile_id
        )
        count_base = count_base.join(Quote, Quote.id == ApprovalRequest.quote_id).where(
            Quote.owner_profile_id == actor.profile_id
        )

    column = {
        "createdAt": ApprovalRequest.created_at,
        "dueAt": ApprovalRequest.due_at,
        "step": ApprovalRequest.step,
    }[sort_field]
    page = max(page, 0)
    steps = list(
        (
            await db.execute(
                base.order_by(column.desc() if descending else column.asc()).offset(page * size).limit(size)
            )
        )
        .scalars()
        .all()
    )
    total = int((await db.execute(count_base)).scalar_one())
    return [await _to_item(db, step) for step in steps], total


async def get_item(db: AsyncSession, actor: Actor, step_id: uuid.UUID) -> dict:
    from app.api.deps import scope_404

    step = (
        (await db.execute(select(ApprovalRequest).where(ApprovalRequest.id == step_id)))
        .scalars()
        .first()
    )
    if step is None:
        raise ApiException.not_found(f"Approval step {step_id}")
    if actor.is_customer:
        raise scope_404()
    return await _to_item(db, step)


async def _to_item(db: AsyncSession, step: ApprovalRequest) -> dict:
    quote = (
        (await db.execute(select(Quote).where(Quote.id == step.quote_id))).scalars().first()
    )
    revision = (
        (await db.execute(select(QuoteRevision).where(QuoteRevision.id == step.revision_id)))
        .scalars()
        .first()
    )
    customer_name: str | None = None
    if quote is not None:
        customer_name = (
            await db.execute(select(Customer.name).where(Customer.id == quote.customer_id))
        ).scalar_one_or_none()
    assignee_name: str | None = None
    if step.assignee_profile_id is not None:
        assignee = (
            (
                await db.execute(
                    select(Profile).where(Profile.id == step.assignee_profile_id)
                )
            )
            .scalars()
            .first()
        )
        if assignee is not None:
            assignee_name = assignee.full_name or assignee.email

    now = now_utc()
    actionable = step.status == "PENDING"
    blocked: str | None = None
    if actionable and step.step == 2:
        manager_status = (
            await db.execute(
                select(ApprovalRequest.status).where(
                    ApprovalRequest.revision_id == step.revision_id,
                    ApprovalRequest.step == 1,
                )
            )
        ).scalar_one_or_none()
        if manager_status != "APPROVED":
            actionable = False
            blocked = "Waiting for the manager step to be approved first."
    if actionable and revision is not None and quote is not None:
        if revision.id != quote.current_revision_id:
            actionable = False
            blocked = "This version has been superseded."

    worst: Decimal | None = None
    if revision is not None and isinstance(revision.risk_result, dict):
        raw = revision.risk_result.get("worstLineExcessPp")
        if raw is not None:
            try:
                worst = Decimal(str(raw))
            except ValueError:
                worst = None
    reasons: list[dict] = []
    if isinstance(step.reasons, list):
        for entry in step.reasons:
            if not isinstance(entry, dict):
                continue
            reasons.append(
                {
                    "code": entry.get("code"),
                    "lineKey": entry.get("lineKey"),
                    "description": entry.get("description"),
                    "observedValue": _decimal_or_raw(entry.get("observedValue")),
                    "thresholdValue": _decimal_or_raw(entry.get("thresholdValue")),
                    "unit": entry.get("unit"),
                    "requiredLevel": entry.get("requiredLevel"),
                    "message": entry.get("message"),
                }
            )
    return approval_queue_item_to_dict(
        step=step,
        quote=quote,
        revision=revision,
        customer_name=customer_name,
        assignee_name=assignee_name,
        actionable=actionable,
        blocked_reason=blocked,
        overdue=bool(step.status == "PENDING" and step.due_at is not None and step.due_at < now),
        worst_excess=worst,
        reasons=reasons,
    )


def _decimal_or_raw(value: object) -> Decimal | str | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except ValueError:
        return str(value)


# ------------------------------------------------------------------ decide ---


async def decide(
    db: AsyncSession, actor: Actor, step_id: uuid.UUID, request, key: str
) -> tuple[int, dict]:
    body = {
        "decision": request.decision,
        "expectedRevisionId": str(request.expectedRevisionId)
        if request.expectedRevisionId
        else None,
        "expectedRowVersion": request.expectedRowVersion,
        "reason": request.reason,
    }

    async def handler() -> tuple[int, dict, uuid.UUID | None]:
        peek = (
            (await db.execute(select(ApprovalRequest).where(ApprovalRequest.id == step_id)))
            .scalars()
            .first()
        )
        if peek is None:
            raise ApiException.not_found(f"Approval step {step_id}")
        quote = (
            (
                await db.execute(
                    select(Quote).where(Quote.id == peek.quote_id).with_for_update()
                )
            )
            .scalars()
            .first()
        )
        if quote is None:
            raise ApiException.not_found(f"Quotation {peek.quote_id}")
        step = (
            (
                await db.execute(
                    select(ApprovalRequest).where(ApprovalRequest.id == step_id).with_for_update()
                )
            )
            .scalars()
            .first()
        )
        if step is None:  # pragma: no cover
            raise ApiException.not_found(f"Approval step {step_id}")
        revision = (
            (
                await db.execute(
                    select(QuoteRevision).where(QuoteRevision.id == step.revision_id)
                )
            )
            .scalars()
            .first()
        )
        if revision is None:
            raise ApiException.not_found(f"Revision {step.revision_id}")

        await _authorise_decision(db, actor, quote, revision, step)
        _validate_decidable(quote, revision, step, request)

        now = now_utc()
        await _apply_decision(db, quote, revision, step, request, actor, now)
        quote.last_activity_at = now
        quote.last_progress_at = now
        quote.awaiting_external_since = None

        await audit_service.record(
            db, actor, f"APPROVAL_{request.decision}", "ApprovalRequest", step.id,
            quote_id=quote.id, revision_id=revision.id,
            after={"step": step.step, "role": step.required_role, "decision": request.decision},
            reason=request.reason,
        )
        await db.flush()
        await outbox_writer.publish(
            db, outbox_writer.APPROVAL_UPDATED, "Quote", quote.id, quote.row_version,
            {"revisionId": str(revision.id), "approvalStatus": revision.approval_status},
            {
                **outbox_writer.deal_scope(
                    quote.customer_id, quote.owner_profile_id, quote.team_id
                ),
                **outbox_writer.roles_scope("MANAGER", "FINANCE"),
            },
        )

        order_id: uuid.UUID | None = None
        finalization: str | None = None
        if revision.approval_status in APPROVAL_CLEARING:
            await hook_gates_cleared(db, actor, quote.id)
            order_id = await find_order_id(db, quote.id)
            finalization = "FINALIZED" if order_id is not None else "WAITING"
        payload = decision_to_dict(
            step=step,
            revision=revision,
            order_id=order_id,
            finalization_status=finalization,
            remaining_gates=_remaining_gates(revision),
        )
        return 200, payload, None

    status, payload, _, _ = await idempotency_service.execute(
        db, actor, f"approval-decision:{step_id}", key, body, handler
    )
    return status, payload


async def _authorise_decision(
    db: AsyncSession,
    actor: Actor,
    quote: Quote,
    revision: QuoteRevision,
    step: ApprovalRequest,
) -> None:
    if actor.role != step.required_role and not actor.is_admin:
        raise ApiException(
            ErrorCode.APPROVER_NOT_QUALIFIED,
            f"This step must be decided by {step.required_role.lower()}.",
        )
    if actor.profile_id == quote.owner_profile_id or (
        revision.created_by_profile_id is not None
        and actor.profile_id == revision.created_by_profile_id
    ):
        raise ApiException(
            ErrorCode.SELF_APPROVAL_FORBIDDEN,
            "A quotation cannot be approved by the person who submitted it.",
        )
    now = now_utc()
    approver = (
        (await db.execute(select(Profile).where(Profile.id == actor.profile_id)))
        .scalars()
        .first()
    )
    if approver is None:
        raise ApiException.not_found("Your profile")
    if not (
        approver.is_active
        and (approver.unavailable_until is None or approver.unavailable_until < now)
    ):
        raise ApiException(
            ErrorCode.PROFILE_INACTIVE,
            "This account is deactivated or on leave and cannot approve.",
        )
    if (
        step.assignee_profile_id is not None
        and step.assignee_profile_id != actor.profile_id
        and not await _has_delegation(db, actor, step, now)
        and not actor.is_admin
    ):
        same_team_manager = actor.role == step.required_role and (
            step.team_id is None or actor.team_id is None or actor.team_id == step.team_id
        )
        if not same_team_manager:
            raise ApiException.forbidden("This step is assigned to another approver.")
    if (
        not actor.is_admin
        and step.required_role == "MANAGER"
        and step.team_id is not None
        and actor.team_id is not None
        and actor.team_id != step.team_id
    ):
        raise ApiException.forbidden("This step belongs to another team.")


async def _has_delegation(
    db: AsyncSession, actor: Actor, step: ApprovalRequest, now: datetime
) -> bool:
    query = select(ApprovalDelegation).where(
        ApprovalDelegation.approver_role == step.required_role,
        ApprovalDelegation.delegate_profile_id == actor.profile_id,
        ApprovalDelegation.valid_from <= now,
        ApprovalDelegation.valid_until >= now,
    )
    if step.team_id is not None:
        query = query.where(
            (ApprovalDelegation.team_id.is_(None))
            | (ApprovalDelegation.team_id == step.team_id)
        )
    return (
        await db.execute(query)
    ).scalar_one_or_none() is not None


def _validate_decidable(
    quote: Quote,
    revision: QuoteRevision,
    step: ApprovalRequest,
    request,
) -> None:
    if step.status != "PENDING":
        raise ApiException.of(
            ErrorCode.APPROVAL_ALREADY_DECIDED,
            f"This step was already {step.status.lower()}.",
            status=step.status,
        )
    if revision.status != "SUBMITTED":
        raise ApiException(
            ErrorCode.CONFLICTING_STATE,
            "The version this step refers to is no longer active.",
        )
    if revision.id != quote.current_revision_id:
        raise ApiException.of(
            ErrorCode.STALE_QUOTE_VERSION,
            "The quotation was revised. Review the current version before deciding.",
            currentRevisionId=str(quote.current_revision_id),
        )
    if request.expectedRevisionId is not None and request.expectedRevisionId != revision.id:
        raise ApiException.of(
            ErrorCode.STALE_QUOTE_VERSION,
            "You are looking at an older version of this quotation.",
            currentRevisionId=str(revision.id),
        )
    if request.expectedRowVersion is not None and request.expectedRowVersion != step.row_version:
        raise ApiException.of(
            ErrorCode.STALE_VERSION,
            "This step changed. Refresh before deciding.",
            currentVersion=step.row_version,
        )


async def _validate_sequence(db: AsyncSession, revision: QuoteRevision, step: ApprovalRequest) -> None:
    if step.step == 2:
        manager = (
            (
                await db.execute(
                    select(ApprovalRequest).where(
                        ApprovalRequest.revision_id == revision.id,
                        ApprovalRequest.step == 1,
                    )
                )
            )
            .scalars()
            .first()
        )
        if manager is None or manager.status != "APPROVED":
            raise ApiException.of(
                ErrorCode.APPROVAL_SEQUENCE_VIOLATION,
                "The manager has not approved this version yet.",
                managerStepStatus=manager.status if manager else None,
            )


async def _apply_decision(
    db: AsyncSession,
    quote: Quote,
    revision: QuoteRevision,
    step: ApprovalRequest,
    request,
    actor: Actor,
    now: datetime,
) -> None:
    await _validate_sequence(db, revision, step)
    if request.decision == "APPROVE":
        step.status = "APPROVED"
        step.decided_by_profile_id = actor.profile_id
        step.decided_at = now
        step.decision_reason = request.reason
        following = (
            (
                await db.execute(
                    select(ApprovalRequest).where(
                        ApprovalRequest.revision_id == revision.id,
                        ApprovalRequest.step == step.step + 1,
                        ApprovalRequest.status == "PENDING",
                    )
                )
            )
            .scalars()
            .first()
        )
        revision.approval_status = "PENDING_FINANCE" if following is not None else "APPROVED"
    elif request.decision == "REJECT":
        step.status = "REJECTED"
        step.decided_by_profile_id = actor.profile_id
        step.decided_at = now
        step.decision_reason = request.reason
        revision.approval_status = "REJECTED"
        await _supersede_later(db, revision, step, actor, "An earlier step rejected this version.")
    else:  # RETURN_FOR_REVISION
        step.status = "REVISION_REQUIRED"
        step.decided_by_profile_id = actor.profile_id
        step.decided_at = now
        step.decision_reason = request.reason
        revision.approval_status = "REVISION_REQUIRED"
        await _supersede_later(
            db, revision, step, actor, "The version was returned for revision."
        )


async def _supersede_later(
    db: AsyncSession,
    revision: QuoteRevision,
    decided: ApprovalRequest,
    actor: Actor,
    reason: str,
) -> None:
    later = list(
        (
            await db.execute(
                select(ApprovalRequest)
                .where(
                    ApprovalRequest.revision_id == revision.id,
                    ApprovalRequest.step > decided.step,
                    ApprovalRequest.status == "PENDING",
                )
                .order_by(ApprovalRequest.step.asc())
            )
        )
        .scalars()
        .all()
    )
    for candidate in later:
        candidate.status = "SUPERSEDED"
        await audit_service.record(
            db, actor, "APPROVAL_SUPERSEDED", "ApprovalRequest", candidate.id,
            quote_id=revision.quote_id, revision_id=revision.id, reason=reason,
        )


def _remaining_gates(revision: QuoteRevision) -> list[str]:
    gates: list[str] = []
    if revision.approval_status not in APPROVAL_CLEARING:
        gates.append(f"Approval: {revision.approval_status}")
    if revision.seller_adopted_at is None:
        gates.append("Seller adoption")
    if revision.customer_accepted_at is None:
        gates.append("Customer acceptance")
    return gates


# ---------------------------------------------------------------- reassign ---


async def reassign(
    db: AsyncSession, actor: Actor, step_id: uuid.UUID, request
) -> dict:
    if not actor.is_admin:
        raise ApiException.forbidden("Only an administrator can reassign an approval step.")
    step = (
        (
            await db.execute(
                select(ApprovalRequest).where(ApprovalRequest.id == step_id).with_for_update()
            )
        )
        .scalars()
        .first()
    )
    if step is None:
        raise ApiException.not_found(f"Approval step {step_id}")
    if step.status != "PENDING":
        raise ApiException(
            ErrorCode.APPROVAL_ALREADY_DECIDED,
            "This step already has a decision and cannot be reassigned.",
        )
    target = (
        (await db.execute(select(Profile).where(Profile.id == request.assigneeProfileId)))
        .scalars()
        .first()
    )
    if target is None:
        raise ApiException.not_found(f"Profile {request.assigneeProfileId}")
    if target.role != step.required_role:
        raise ApiException(
            ErrorCode.APPROVER_NOT_QUALIFIED,
            f"That person is not a {step.required_role.lower()} and cannot take this step.",
        )
    now = now_utc()
    if not (
        target.is_active
        and (target.unavailable_until is None or target.unavailable_until < now)
    ):
        raise ApiException(
            ErrorCode.NO_AVAILABLE_APPROVER, "That person is deactivated or on leave."
        )
    previous = step.assignee_profile_id
    if step.original_assignee_profile_id is None:
        step.original_assignee_profile_id = step.assignee_profile_id
    step.assignee_profile_id = target.id
    step.reassignment_reason = request.reason

    await audit_service.record(
        db, actor, "APPROVAL_REASSIGNED", "ApprovalRequest", step.id,
        quote_id=step.quote_id, revision_id=step.revision_id,
        before={"assigneeProfileId": str(previous) if previous else None},
        after={"assigneeProfileId": str(target.id)},
        reason=request.reason,
    )
    await db.flush()
    await outbox_writer.publish(
        db, outbox_writer.APPROVAL_UPDATED, "Quote", step.quote_id, 0,
        {"reassignedTo": str(target.id)},
        outbox_writer.owner_scope(target.id),
    )
    return await _to_item(db, step)
