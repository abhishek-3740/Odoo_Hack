"""Portal service — port of portal/service/PortalService.java.

The customer's view of their own deals. Every method starts by binding the
request to the caller's own customer; a mismatch is a 404, never a 403.
Responses are built from the portal-only builders in app/schemas/portal.py,
which have no field for cost, margin or thresholds.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import scope_404
from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import shared_math as m
from app.engines.commercial_hash import commercial_hash
from app.engines.pricing_engine import LineInput, LineKind, PricingInput, evaluate
from app.engines.risk_engine import (
    ApprovalLevel,
    DiscountPolicyDefinition,
    FinanceTriggers,
    ManagerTriggers,
    evaluate as evaluate_risk,
)
from app.models.approvals import ApprovalRequest
from app.models.auth import Profile
from app.models.billing import Invoice
from app.models.catalog import (
    Category,
    Customer,
    PriceRule,
    Product,
    ProductVariant,
    SubscriptionPlan,
)
from app.models.orders import Order
from app.models.policy import DiscountPolicy
from app.models.portal import NegotiationRequest
from app.models.quotes import Quote, QuoteLine, QuoteRevision
from app.schemas import portal as dto
from app.services import audit_service, outbox_writer
from app.services.clock import business_today, now_utc

TERMINAL_STAGES = ("CONFIRMED", "CANCELED", "LOST", "EXPIRED")


class NegotiationType(str, Enum):
    COMMENT = "COMMENT"
    CHANGE = "CHANGE"
    COUNTER = "COUNTER"


# ------------------------------------------------------------- evaluation ---


def parse_policy_definition(raw: dict) -> DiscountPolicyDefinition:
    """Accepts the Java camelCase JSON (or snake_case) stored on the policy row."""
    tiers = {
        str(k): Decimal(str(v)) for k, v in (raw.get("tierCeilingPercent") or raw.get("tier_ceiling_percent") or {}).items()
    }
    cats = {
        str(k): Decimal(str(v)) for k, v in (raw.get("categoryCeilingPercent") or raw.get("category_ceiling_percent") or {}).items()
    }
    mgr = raw.get("manager") or {}
    fin = raw.get("finance") or {}

    def _dec(v: Any) -> Decimal | None:
        return None if v is None else Decimal(str(v))

    def _int(v: Any) -> int | None:
        return None if v is None else int(v)

    return DiscountPolicyDefinition(
        tier_ceiling_percent=tiers,
        category_ceiling_percent=cats,
        manager=ManagerTriggers(
            bool(mgr.get("anyPositiveExcess", mgr.get("any_positive_excess", True))),
            _dec(mgr.get("aggregateDiscountPercentAbove", mgr.get("aggregate_discount_percent_above"))),
            _dec(mgr.get("aggregateMarginPercentBelow", mgr.get("aggregate_margin_percent_below"))),
        ),
        finance=FinanceTriggers(
            _dec(fin.get("worstLineExcessPpAtLeast", fin.get("worst_line_excess_pp_at_least"))),
            _dec(fin.get("weightedExcessPpAtLeast", fin.get("weighted_excess_pp_at_least"))),
            _int(fin.get("excessValueMinorAtLeast", fin.get("excess_value_minor_at_least"))),
            _dec(fin.get("aggregateMarginPercentBelow", fin.get("aggregate_margin_percent_below"))),
            bool(fin.get("nonPositiveLineContribution", fin.get("non_positive_line_contribution", True))),
        ),
    )


def risk_to_json(risk: Any) -> dict:
    return {
        "requiredLevel": ApprovalLevel(risk.required_level).name,
        "reasons": [
            {"code": r.code, "lineKey": r.line_key, "message": r.message}
            for r in risk.reasons
        ],
        "worstLineExcessPp": str(risk.worst_line_excess_pp),
        "weightedExcessPp": str(risk.weighted_excess_pp),
        "excessValueMinor": risk.excess_value_minor,
        "aggregateDiscountPercent": str(risk.aggregate_discount_percent),
    }


async def effective_policy(db: AsyncSession) -> tuple[int, DiscountPolicyDefinition, dict]:
    """Latest DiscountPolicy row with effective_at <= now."""
    now = now_utc()
    row = (
        await db.execute(
            select(DiscountPolicy)
            .where(DiscountPolicy.effective_at <= now)
            .order_by(DiscountPolicy.effective_at.desc())
            .limit(1)
        )
    ).scalars().first()
    if row is None:
        raise ApiException(
            ErrorCode.POLICY_NOT_CONFIGURED,
            "No discount policy version is in effect.",
        )
    raw = dict(row.definition or {})
    return row.version_no, parse_policy_definition(raw), raw


async def resolve_price(
    db: AsyncSession,
    variant_id: uuid.UUID,
    tier: str,
    currency: str,
    on_date: date,
    cache: dict,
) -> dict:
    """Mirror of PriceResolver basics: rule (highest-priority in-date) else default."""
    if "variants" not in cache:
        cache["variants"] = {}
        cache["products"] = {}
        cache["categories"] = {}
        cache["rules"] = {}
    if variant_id not in cache["variants"]:
        variant = (
            await db.execute(select(ProductVariant).where(ProductVariant.id == variant_id))
        ).scalars().first()
        if variant is None:
            raise ApiException.not_found(f"Product variant {variant_id}")
        cache["variants"][variant_id] = variant
        product = (
            await db.execute(select(Product).where(Product.id == variant.product_id))
        ).scalars().first()
        if product is None:
            raise ApiException.not_found(f"Product for variant {variant_id}")
        cache["products"][product.id] = product
        category = (
            await db.execute(select(Category).where(Category.id == product.category_id))
        ).scalars().first()
        if category is None:
            raise ApiException.not_found(f"Category for variant {variant_id}")
        cache["categories"][category.id] = category
        rules = (
            await db.execute(
                select(PriceRule).where(
                    PriceRule.variant_id == variant_id,
                    PriceRule.tier == tier,
                    PriceRule.currency == currency,
                )
            )
        ).scalars().all()
        cache["rules"][variant_id] = list(rules)
    variant = cache["variants"][variant_id]
    product = cache["products"][variant.product_id]
    category = cache["categories"][product.category_id]
    if not product.is_active or not variant.is_active:
        raise ApiException(
            ErrorCode.PRICE_NOT_RESOLVABLE, f'"{variant.name}" is no longer available.'
        )
    if product.currency != currency:
        raise ApiException(
            ErrorCode.CURRENCY_MISMATCH,
            f'"{variant.name}" is priced in {product.currency}, not {currency}.',
        )
    if product.charge_kind == "RECURRING":
        raise ApiException(
            ErrorCode.VALIDATION_FAILED,
            f'"{product.name}" is a recurring product. Add it by choosing a plan.',
        )
    in_date = [
        r
        for r in cache["rules"][variant_id]
        if r.active_from <= on_date and (r.active_until is None or on_date < r.active_until)
    ]
    if not in_date:
        unit_price = product.base_price_minor + variant.price_extra_minor
    else:
        top = max(r.priority for r in in_date)
        winners = [r for r in in_date if r.priority == top]
        if len(winners) > 1:
            raise ApiException(
                ErrorCode.AMBIGUOUS_PRICE_RULE,
                f'Two price rules of equal priority match "{variant.name}".',
            )
        unit_price = winners[0].unit_price_minor
    return {
        "variant": variant,
        "product": product,
        "category": category,
        "unit_price": unit_price,
        "unit_cost": variant.cost_minor
        if variant.cost_minor is not None
        else product.base_cost_minor,
    }


async def evaluate_catalogue_lines(
    db: AsyncSession,
    customer: Customer,
    specs: list[dict],
    order_discount_bp: int,
) -> tuple[Any, Any, int, dict]:
    """Server-side pricing + risk for requested lines. Prices come from the
    catalogue; the caller supplies items, quantities and discounts only."""
    if not specs:
        raise ApiException(ErrorCode.EMPTY_QUOTE)
    today = business_today()
    cache: dict = {}
    inputs: list[LineInput] = []
    for position, spec in enumerate(specs):
        qty = spec["quantity"]
        disc = spec.get("discount_bp") or 0
        if spec.get("variant_id") is not None:
            resolved = await resolve_price(
                db, spec["variant_id"], customer.tier, customer.currency, today, cache
            )
            product = resolved["product"]
            if product.quantity_mode == "INTEGER" and Decimal(qty) % 1 != 0:
                raise ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    f'"{product.name}" is sold in whole units.',
                )
            inputs.append(
                LineInput(
                    line_key=spec["line_key"],
                    position=position,
                    kind=LineKind.ONE_TIME,
                    product_id=product.id,
                    category_id=resolved["category"].id,
                    category_code=resolved["category"].code,
                    variant_id=resolved["variant"].id,
                    plan_id=None,
                    description=resolved["variant"].name,
                    quantity=Decimal(str(qty)),
                    unit_price_minor=resolved["unit_price"],
                    unit_cost_minor=resolved["unit_cost"],
                    tax_rate_bp=product.tax_rate_bp,
                    line_discount_bp=disc,
                    interval_months=None,
                    requires_stock=product.fulfillment_kind == "STOCK",
                    source=spec.get("source", "MANUAL"),
                )
            )
        else:
            plan = (
                await db.execute(
                    select(SubscriptionPlan).where(
                        SubscriptionPlan.id == spec["plan_id"]
                    )
                )
            ).scalars().first()
            if plan is None or not plan.is_active:
                raise ApiException.not_found(f"Subscription plan {spec['plan_id']}")
            if plan.currency != customer.currency:
                raise ApiException(
                    ErrorCode.CURRENCY_MISMATCH,
                    f'"{plan.name}" is priced in {plan.currency}, not {customer.currency}.',
                )
            product = (
                await db.execute(select(Product).where(Product.id == plan.product_id))
            ).scalars().first()
            if product is None:
                raise ApiException.not_found(f"Product for plan {plan.code}")
            category = (
                await db.execute(
                    select(Category).where(Category.id == product.category_id)
                )
            ).scalars().first()
            if category is None:
                raise ApiException.not_found(f"Category for plan {plan.code}")
            if product.quantity_mode == "INTEGER" and Decimal(qty) % 1 != 0:
                raise ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    f'"{product.name}" is sold in whole units.',
                )
            inputs.append(
                LineInput(
                    line_key=spec["line_key"],
                    position=position,
                    kind=LineKind.RECURRING,
                    product_id=product.id,
                    category_id=category.id,
                    category_code=category.code,
                    variant_id=None,
                    plan_id=plan.id,
                    description=plan.name,
                    quantity=Decimal(str(qty)),
                    unit_price_minor=plan.interval_price_minor,
                    unit_cost_minor=plan.interval_cost_minor,
                    tax_rate_bp=plan.tax_rate_bp,
                    line_discount_bp=disc,
                    interval_months=plan.interval_months,
                    requires_stock=False,
                    source=spec.get("source", "MANUAL"),
                )
            )
    pricing = evaluate(PricingInput(customer.currency, order_discount_bp, inputs))
    version_no, definition, raw = await effective_policy(db)
    risk = evaluate_risk(pricing, customer.tier, definition, version_no)
    return pricing, risk, version_no, raw


def hash_lines(revision: QuoteRevision, lines: list[QuoteLine]) -> str:
    return commercial_hash(
        revision.currency,
        revision.order_discount_bp,
        revision.backorder_terms,
        revision.invoicing_terms,
        revision.requested_activation_date.isoformat()
        if revision.requested_activation_date
        else None,
        [
            {
                "line_key": ln.line_key,
                "line_kind": ln.line_kind,
                "variant_id": str(ln.variant_id) if ln.variant_id else "",
                "plan_id": str(ln.plan_id) if ln.plan_id else "",
                "quantity": ln.quantity,
                "unit_price_minor": ln.unit_price_minor,
                "tax_rate_bp": ln.tax_rate_bp,
                "line_discount_bp": ln.line_discount_bp,
                "effective_discount_bp": ln.effective_discount_bp,
                "net_minor": ln.net_minor,
                "interval_months": ln.interval_months,
                "promised_date": ln.promised_date.isoformat()
                if ln.promised_date
                else "",
            }
            for ln in lines
        ],
    )


async def create_approval_chain(
    db: AsyncSession,
    quote: Quote,
    revision: QuoteRevision,
    required: ApprovalLevel,
    reasons: list[str],
    now: datetime,
    actor: Actor,
) -> None:
    """Route from scratch: NONE -> NOT_REQUIRED else PENDING_MANAGER + step rows."""
    if required == ApprovalLevel.NONE:
        revision.required_level = "NONE"
        revision.approval_status = "NOT_REQUIRED"
        return
    due = now + timedelta(hours=48)
    roles = ["MANAGER"] if required == ApprovalLevel.MANAGER else ["MANAGER", "FINANCE"]
    for index, role in enumerate(roles):
        team_filter = quote.team_id if role == "MANAGER" else None
        query = select(Profile).where(
            Profile.role == role,
            Profile.is_active.is_(True),
        )
        if team_filter is not None:
            query = query.where(Profile.team_id == team_filter)
        candidates = (await db.execute(query)).scalars().all()
        candidates = [
            p
            for p in candidates
            if (p.unavailable_until is None or p.unavailable_until <= now)
            and p.id != quote.owner_profile_id
            and p.id != revision.created_by_profile_id
        ]
        step = ApprovalRequest(
            quote_id=quote.id,
            revision_id=revision.id,
            step=index + 1,
            required_role=role,
            team_id=team_filter,
            due_at=due,
            status="PENDING",
            reasons=list(reasons),
        )
        if len(candidates) == 1:
            step.assignee_profile_id = candidates[0].id
            step.original_assignee_profile_id = candidates[0].id
        db.add(step)
    revision.required_level = required.name
    revision.approval_status = "PENDING_MANAGER"


# ------------------------------------------------------------------ guards ---


def require_customer_id(actor: Actor) -> uuid.UUID:
    if actor.is_customer and actor.customer_id is not None:
        return actor.customer_id
    raise ApiException.forbidden("This area is for customer accounts.")


async def load_quote_for_customer(
    db: AsyncSession, quote_id: uuid.UUID, customer_id: uuid.UUID
) -> Quote:
    quote = (
        await db.execute(select(Quote).where(Quote.id == quote_id))
    ).scalars().first()
    if quote is None or quote.customer_id != customer_id or quote.stage == "DRAFT":
        raise scope_404()
    return quote


async def current_revision(db: AsyncSession, quote: Quote) -> QuoteRevision:
    revision = (
        await db.execute(
            select(QuoteRevision).where(QuoteRevision.id == quote.current_revision_id)
        )
    ).scalars().first()
    if revision is None:
        raise scope_404()
    return revision


async def existing_order(db: AsyncSession, quote_id: uuid.UUID) -> Order | None:
    return (
        await db.execute(select(Order).where(Order.quote_id == quote_id))
    ).scalars().first()


def require_negotiable(quote: Quote, order: Order | None) -> None:
    if order is not None:
        raise ApiException(
            ErrorCode.NEGOTIATION_CLOSED,
            "This quotation is confirmed. Please contact your account manager for changes.",
        )
    if quote.stage in TERMINAL_STAGES:
        raise ApiException(
            ErrorCode.NEGOTIATION_CLOSED,
            "This quotation is closed and can no longer be changed.",
        )


async def publish_negotiation_event(
    db: AsyncSession, quote: Quote
) -> None:
    await outbox_writer.publish(
        db,
        outbox_writer.NEGOTIATION_UPDATED,
        "Quote",
        quote.id,
        quote.row_version,
        {"stage": quote.stage},
        outbox_writer.deal_scope(
            quote.customer_id, quote.owner_profile_id, quote.team_id
        ),
    )


# -------------------------------------------------------------------- read ---


async def list_quotes(db: AsyncSession, actor: Actor) -> list[dict[str, Any]]:
    customer_id = require_customer_id(actor)
    quotes = (
        await db.execute(
            select(Quote)
            .where(Quote.customer_id == customer_id, Quote.stage != "DRAFT")
            .order_by(Quote.created_at.desc())
        )
    ).scalars().all()
    out = []
    for quote in quotes:
        revision = (
            await db.execute(
                select(QuoteRevision).where(
                    QuoteRevision.id == quote.current_revision_id
                )
            )
        ).scalars().first()
        out.append(dto.quote_summary(quote, revision))
    return out


async def get_quote(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID
) -> dict[str, Any]:
    customer_id = require_customer_id(actor)
    quote = await load_quote_for_customer(db, quote_id, customer_id)
    revision = await current_revision(db, quote)
    return await dto.portal_quote_detail(db, quote, revision)


# ------------------------------------------------------------- negotiation ---


def _parse_type(value: str) -> str:
    try:
        return NegotiationType[value.strip().upper()].name
    except (KeyError, AttributeError):
        raise ApiException(
            ErrorCode.VALIDATION_FAILED,
            "requestType must be COMMENT, CHANGE or COUNTER.",
        )


async def submit_request(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID, request: dto.PortalRequest
) -> dict[str, Any]:
    customer_id = require_customer_id(actor)
    quote = (
        await db.execute(
            select(Quote).where(Quote.id == quote_id).with_for_update()
        )
    ).scalars().first()
    if quote is None or quote.customer_id != customer_id or quote.stage == "DRAFT":
        raise scope_404()
    order = await existing_order(db, quote_id)
    require_negotiable(quote, order)

    current = await current_revision(db, quote)
    if current.id != request.expectedRevisionId:
        raise ApiException.of(
            ErrorCode.STALE_QUOTE_VERSION,
            "This quotation has been updated. Refresh to see the current version.",
            currentRevisionId=str(current.id),
        )

    req_type = _parse_type(request.requestType)
    now = now_utc()
    record = NegotiationRequest(
        quote_id=quote.id,
        revision_id=current.id,
        actor_profile_id=actor.profile_id,
        line_key=request.lineKey,
        request_type=req_type,
        payload={},
        message=request.message,
        status="OPEN",
    )

    if req_type == "COMMENT":
        record.payload = {"message": request.message or ""}
        db.add(record)
        quote.last_activity_at = now
        quote.last_progress_at = now
        quote.awaiting_external_since = None
        await audit_service.record(
            db, actor, "PORTAL_COMMENT", "Quote", quote.id,
            quote_id=quote.id, revision_id=current.id,
            after={"lineKey": str(request.lineKey)},
        )
        await publish_negotiation_event(db, quote)
        await db.flush()
        return await dto.portal_quote_detail(db, quote, current)

    candidate = await _build_candidate(db, actor, quote, current, request, now)
    record.candidate_revision_id = candidate.id
    record.payload = {
        "requestedOrderDiscountBp": request.requestedOrderDiscountBp or 0,
        "lines": [
            {
                "lineKey": ln.lineKey,
                "quantity": str(ln.quantity) if ln.quantity is not None else None,
                "requestedDiscountBp": ln.requestedDiscountBp,
            }
            for ln in (request.lines or [])
        ],
    }
    db.add(record)
    quote.stage = "UNDER_NEGOTIATION"
    quote.last_activity_at = now
    quote.last_progress_at = now
    quote.awaiting_external_since = None
    await audit_service.record(
        db, actor, "PORTAL_COUNTER", "QuoteRevision", candidate.id,
        quote_id=quote.id, revision_id=candidate.id,
        after={
            "revisionNo": candidate.revision_no,
            "requiredLevel": candidate.required_level,
        },
        reason=request.message,
    )
    await publish_negotiation_event(db, quote)
    await db.flush()
    return await dto.portal_quote_detail(db, quote, candidate)


async def _build_candidate(
    db: AsyncSession,
    actor: Actor,
    quote: Quote,
    current: QuoteRevision,
    request: dto.PortalRequest,
    now: datetime,
) -> QuoteRevision:
    customer = (
        await db.execute(select(Customer).where(Customer.id == quote.customer_id))
    ).scalars().first()
    if customer is None:
        raise scope_404()
    current_lines = (
        await db.execute(
            select(QuoteLine)
            .where(QuoteLine.revision_id == current.id)
            .order_by(QuoteLine.position.asc())
        )
    ).scalars().all()
    current_lines = list(current_lines)
    proposals = {ln.lineKey: ln for ln in (request.lines or [])}
    specs = []
    for line in current_lines:
        proposal = proposals.get(line.line_key)
        qty = proposal.quantity if proposal and proposal.quantity is not None else line.quantity
        disc = (
            proposal.requestedDiscountBp
            if proposal and proposal.requestedDiscountBp is not None
            else line.line_discount_bp
        )
        if disc is not None and disc > m.MAX_DISCOUNT:
            raise ApiException(
                ErrorCode.DISCOUNT_OUT_OF_RANGE,
                "A discount must be between 0% and 99.99%.",
            )
        specs.append(
            {
                "line_key": line.line_key,
                "variant_id": line.variant_id,
                "plan_id": line.plan_id,
                "quantity": qty,
                "discount_bp": disc or 0,
                "source": "COUNTER",
            }
        )
    order_bp = (
        request.requestedOrderDiscountBp
        if request.requestedOrderDiscountBp is not None
        else current.order_discount_bp
    )
    # Server-priced; the engine refuses a zero-net line before anything persists.
    pricing, risk, version_no, raw_policy = await evaluate_catalogue_lines(
        db, customer, specs, order_bp
    )

    current.status = "SUPERSEDED"
    pending = (
        await db.execute(
            select(ApprovalRequest).where(
                ApprovalRequest.revision_id == current.id,
                ApprovalRequest.status == "PENDING",
            )
        )
    ).scalars().all()
    for step in pending:
        step.status = "SUPERSEDED"

    stale = (
        await db.execute(
            select(NegotiationRequest).where(
                NegotiationRequest.quote_id == quote.id,
                NegotiationRequest.status == "OPEN",
                NegotiationRequest.candidate_revision_id.is_not(None),
            )
        )
    ).scalars().all()
    for row in stale:
        row.status = "SUPERSEDED"

    quote.revision_count = (quote.revision_count or 0) + 1
    candidate = QuoteRevision(
        quote_id=quote.id,
        revision_no=quote.revision_count,
        source="CUSTOMER_COUNTER",
        currency=customer.currency,
        order_discount_bp=order_bp,
        backorder_terms=current.backorder_terms,
        invoicing_terms=current.invoicing_terms,
        requested_activation_date=current.requested_activation_date,
        created_by_profile_id=actor.profile_id,
    )
    db.add(candidate)
    await db.flush()
    for position, result in enumerate(pricing.lines):
        db.add(
            QuoteLine(
                revision_id=candidate.id,
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
                source="COUNTER",
            )
        )
    await db.flush()
    candidate.one_time_net_minor = pricing.one_time_net_minor
    candidate.one_time_tax_minor = pricing.one_time_tax_minor
    candidate.one_time_cost_minor = pricing.one_time_cost_minor
    candidate.recurring_first_cycle_net_minor = pricing.recurring_first_cycle_net_minor
    candidate.recurring_first_cycle_tax_minor = pricing.recurring_first_cycle_tax_minor
    candidate.recurring_first_cycle_cost_minor = pricing.recurring_first_cycle_cost_minor
    candidate.contribution_minor = pricing.contribution_minor
    candidate.margin_percent = pricing.contribution_percent
    candidate.total_base_minor = pricing.total_base_minor
    candidate.total_discount_minor = pricing.total_discount_minor
    candidate.policy_version_no = version_no
    candidate.policy_snapshot = raw_policy
    candidate.risk_result = risk_to_json(risk)
    candidate.required_level = ApprovalLevel(risk.required_level).name
    candidate.status = "SUBMITTED"
    candidate.submitted_at = now
    stored = (
        await db.execute(
            select(QuoteLine)
            .where(QuoteLine.revision_id == candidate.id)
            .order_by(QuoteLine.position.asc())
        )
    ).scalars().all()
    candidate.commercial_hash = hash_lines(candidate, list(stored))
    await create_approval_chain(
        db, quote, candidate, ApprovalLevel(risk.required_level),
        [r["message"] for r in risk_to_json(risk)["reasons"]], now, actor,
    )
    quote.current_revision_id = candidate.id
    return candidate


# --------------------------------------------------------------- acceptance ---


async def accept(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID, request: dto.AcceptanceRequest
) -> dict[str, Any]:
    customer_id = require_customer_id(actor)
    quote = (
        await db.execute(
            select(Quote).where(Quote.id == quote_id).with_for_update()
        )
    ).scalars().first()
    if quote is None or quote.customer_id != customer_id or quote.stage == "DRAFT":
        raise scope_404()
    order = await existing_order(db, quote_id)
    current = await current_revision(db, quote)

    if order is not None:
        if current.customer_accepted_at is not None and request.revisionId == current.id:
            return dto.acceptance_response(
                quote_id, current.id, False, order.reference, []
            )
        raise ApiException(
            ErrorCode.ALREADY_ORDERED,
            "This quotation is already confirmed and can no longer be changed.",
        )

    require_negotiable(quote, None)
    if request.revisionId != current.id:
        raise ApiException.of(
            ErrorCode.STALE_QUOTE_VERSION,
            "These terms have been updated. Review the current version before accepting.",
            currentRevisionId=str(current.id),
        )
    if current.status != "SUBMITTED":
        raise ApiException(
            ErrorCode.QUOTE_NOT_SUBMITTED,
            "This version is not ready to accept yet.",
        )
    if quote.valid_until is not None and business_today() > quote.valid_until:
        raise ApiException(
            ErrorCode.QUOTE_EXPIRED,
            "This quotation has passed its validity date. Ask your contact to re-issue it.",
        )
    lines = (
        await db.execute(
            select(QuoteLine)
            .where(QuoteLine.revision_id == current.id)
            .order_by(QuoteLine.position.asc())
        )
    ).scalars().all()
    current_hash = hash_lines(current, list(lines))
    if current_hash != request.commercialHash:
        raise ApiException.of(
            ErrorCode.ACCEPTANCE_HASH_MISMATCH,
            "These terms changed since this page was opened. Refresh to see what is on offer now.",
            currentHash=current_hash,
        )

    now = now_utc()
    if current.customer_accepted_at is None:
        current.customer_accepted_at = now
        current.customer_accepted_by = actor.profile_id
        current.customer_accepted_hash = current_hash
        quote.last_activity_at = now
        quote.last_progress_at = now
        quote.awaiting_external_since = None
        await audit_service.record(
            db, actor, "PORTAL_ACCEPTED", "QuoteRevision", current.id,
            quote_id=quote.id, revision_id=current.id,
            after={"commercialHash": current_hash},
            reason=request.note,
        )

    try:
        from app.services import order_finalization as finalization
    except ImportError:
        finalization = None  # type: ignore[assignment]
    hook = getattr(finalization, "hook_gates_cleared", None) if finalization else None
    if hook is not None:
        await hook(db, None, quote_id)

    created = await existing_order(db, quote_id)
    conditional = created is None
    remaining: list[str] = []
    if conditional:
        if current.approval_status not in ("NOT_REQUIRED", "APPROVED"):
            remaining.append("Internal approval is still in progress.")
        if current.seller_adopted_at is None:
            remaining.append("Your contact has not yet confirmed these terms.")
    await publish_negotiation_event(db, quote)
    await db.flush()
    return dto.acceptance_response(
        quote_id,
        current.id,
        conditional,
        created.reference if created else None,
        remaining,
    )


# ----------------------------------------------------------------- invoices ---


async def list_invoices(db: AsyncSession, actor: Actor) -> list[dict[str, Any]]:
    customer_id = require_customer_id(actor)
    rows = (
        await db.execute(
            select(Invoice)
            .where(Invoice.customer_id == customer_id, Invoice.status != "DRAFT")
            .order_by(Invoice.created_at.desc())
            .limit(100)
        )
    ).scalars().all()
    return [dto.invoice_summary(inv) for inv in rows]


async def get_invoice(
    db: AsyncSession, actor: Actor, invoice_id: uuid.UUID
) -> dict[str, Any]:
    customer_id = require_customer_id(actor)
    invoice = (
        await db.execute(select(Invoice).where(Invoice.id == invoice_id))
    ).scalars().first()
    if (
        invoice is None
        or invoice.customer_id != customer_id
        or invoice.status == "DRAFT"
    ):
        raise scope_404()
    customer = (
        await db.execute(select(Customer).where(Customer.id == invoice.customer_id))
    ).scalars().first()
    return await dto.invoice_response(
        db, invoice, customer.name if customer else None
    )


async def export_invoice(
    db: AsyncSession, actor: Actor, invoice_id: uuid.UUID, format: str | None
) -> tuple[bytes, str, str]:
    from app.services import invoice_exporter

    invoice = await get_invoice(db, actor, invoice_id)
    customer = {"name": invoice.get("customerName")}
    lines = invoice.get("lines") or []
    fmt = (format or "pdf").strip().lower()
    if fmt == "pdf":
        return invoice_exporter.export_invoice_pdf(invoice, lines, customer), "application/pdf", "pdf"
    if fmt in ("xlsx", "excel"):
        return (
            invoice_exporter.export_invoice_xlsx(invoice, lines, customer),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xlsx",
        )
    if fmt in ("doc", "docx", "word"):
        return (
            invoice_exporter.export_invoice_doc(invoice, lines, customer),
            "application/msword",
            "doc",
        )
    raise ApiException(
        ErrorCode.VALIDATION_FAILED, "format must be pdf, xlsx or doc."
    )
