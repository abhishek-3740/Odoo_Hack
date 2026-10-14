"""Portal quote-request service — port of portal/service/PortalQuoteRequestService.

A customer asking for a quotation from the catalogue. The request becomes a
real quotation owned by the customer's account manager, priced by the same
engine a rep uses, left in REVIEW. The customer cannot set a price or a
discount, only say what they want and how many.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines.risk_engine import ApprovalLevel
from app.models.auth import Profile
from app.models.catalog import Customer
from app.models.portal import NegotiationRequest
from app.models.quotes import Quote, QuoteLine, QuoteRevision
from app.repositories import sequences
from app.schemas import portal as dto
from app.schemas.portal import QuoteRequest
from app.services import audit_service, outbox_writer
from app.services import portal_service
from app.services.clock import now_utc


async def _resolve_owner(db: AsyncSession, customer: Customer) -> Profile:
    if customer.owner_rep_profile_id is not None:
        owner = (
            await db.execute(
                select(Profile).where(Profile.id == customer.owner_rep_profile_id)
            )
        ).scalars().first()
        if owner is not None and owner.is_active and owner.role == "REP":
            return owner
    fallback = (
        await db.execute(
            select(Profile)
            .where(Profile.role == "REP", Profile.is_active.is_(True))
            .order_by(Profile.created_at.asc())
            .limit(1)
        )
    ).scalars().first()
    if fallback is None:
        raise ApiException(
            ErrorCode.CONFLICTING_STATE,
            "No sales representative is available to take this request right now.",
        )
    customer.owner_rep_profile_id = fallback.id
    return fallback


async def submit(
    db: AsyncSession, actor: Actor, request: QuoteRequest
) -> dict[str, Any]:
    customer_id = portal_service.require_customer_id(actor)
    customer = (
        await db.execute(select(Customer).where(Customer.id == customer_id))
    ).scalars().first()
    if customer is None:
        raise ApiException.not_found("Your organisation")
    owner = await _resolve_owner(db, customer)
    now = now_utc()

    specs = []
    for position, line in enumerate(request.lines, start=1):
        if (line.variantId is None) == (line.planId is None):
            raise ApiException(
                ErrorCode.VALIDATION_FAILED,
                "Each requested line needs exactly one of variantId or planId.",
            )
        specs.append(
            {
                "line_key": f"req-{position}",
                "variant_id": line.variantId,
                "plan_id": line.planId,
                "quantity": line.quantity,
                "discount_bp": 0,
                "source": "MANUAL",
            }
        )
    pricing, _risk, _version_no, _raw = await portal_service.evaluate_catalogue_lines(
        db, customer, specs, 0
    )

    reference = f"Q-{await sequences.nextval(db, sequences.QUOTE_REFERENCE_SEQ)}"
    quote = Quote(
        reference=reference,
        customer_id=customer.id,
        owner_profile_id=owner.id,
        team_id=owner.team_id,
        title=(request.title or "").strip()
        or f"Quotation request from {customer.name}",
        stage="REVIEW",
        last_activity_at=now,
        last_progress_at=now,
        revision_count=1,
    )
    db.add(quote)
    await db.flush()

    revision = QuoteRevision(
        quote_id=quote.id,
        revision_no=1,
        source="SELLER",
        currency=customer.currency,
        backorder_terms="ALLOW_BACKORDER",
        created_by_profile_id=owner.id,
    )
    db.add(revision)
    await db.flush()
    quote.current_revision_id = revision.id

    for position, result in enumerate(pricing.lines):
        db.add(
            QuoteLine(
                revision_id=revision.id,
                line_key=result.line_key,
                position=position,
                line_kind=result.kind.value,
                product_id=result.product_id,
                category_id=result.category_id,
                variant_id=result.variant_id,
                plan_id=result.plan_id,
                description=result.description,
                quantity=result.quantity,
                unit_price_minor=result.unit_price_minor,
                unit_cost_minor=result.unit_cost_minor,
                tax_rate_bp=result.tax_rate_bp,
                line_discount_bp=result.line_discount_bp,
                applied_order_discount_bp=result.applied_order_discount_bp,
                effective_discount_bp=result.effective_discount_bp,
                base_minor=result.base_minor,
                net_minor=result.net_minor,
                tax_minor=result.tax_minor,
                cost_total_minor=result.cost_total_minor,
                margin_minor=result.margin_minor,
                interval_months=result.interval_months,
                requires_stock=result.requires_stock,
                source="MANUAL",
            )
        )
    await db.flush()
    revision.one_time_net_minor = pricing.one_time_net_minor
    revision.one_time_tax_minor = pricing.one_time_tax_minor
    revision.one_time_cost_minor = pricing.one_time_cost_minor
    revision.recurring_first_cycle_net_minor = pricing.recurring_first_cycle_net_minor
    revision.recurring_first_cycle_tax_minor = pricing.recurring_first_cycle_tax_minor
    revision.recurring_first_cycle_cost_minor = pricing.recurring_first_cycle_cost_minor
    revision.contribution_minor = pricing.contribution_minor
    revision.margin_percent = pricing.contribution_percent
    revision.total_base_minor = pricing.total_base_minor
    revision.total_discount_minor = pricing.total_discount_minor
    revision.approval_status = "NOT_EVALUATED"
    revision.required_level = ApprovalLevel.NONE.name
    stored = (
        await db.execute(
            select(QuoteLine)
            .where(QuoteLine.revision_id == revision.id)
            .order_by(QuoteLine.position.asc())
        )
    ).scalars().all()
    revision.commercial_hash = portal_service.hash_lines(revision, list(stored))

    note = (request.note or "").strip() or "Quotation requested from the catalogue."
    db.add(
        NegotiationRequest(
            quote_id=quote.id,
            revision_id=revision.id,
            actor_profile_id=actor.profile_id,
            request_type="COMMENT",
            payload={"message": note, "origin": "CATALOGUE"},
            message=note,
            status="OPEN",
        )
    )
    quote.last_activity_at = now
    quote.last_progress_at = now
    quote.awaiting_external_since = None

    await audit_service.record(
        db, actor, "PORTAL_QUOTE_REQUESTED", "Quote", quote.id,
        quote_id=quote.id, revision_id=revision.id,
        after={
            "reference": quote.reference,
            "lineCount": len(pricing.lines),
            "ownerProfileId": str(owner.id),
        },
        reason=note,
    )
    await outbox_writer.publish(
        db,
        outbox_writer.NEGOTIATION_UPDATED,
        "Quote",
        quote.id,
        quote.row_version,
        {"stage": quote.stage, "origin": "CUSTOMER_REQUEST"},
        outbox_writer.deal_scope(customer.id, owner.id, owner.team_id),
    )
    await db.flush()
    return await dto.portal_quote_detail(db, quote, revision)
