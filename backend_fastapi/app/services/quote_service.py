"""Quote service — port of quotes/service/QuoteService.java,
QuoteEvaluationService.java (read side), QuoteLineBuilder.java and
QuoteAccessPolicy.java.

Every mutating command locks the quotation aggregate first (SELECT ... FOR
UPDATE); submitted terms are immutable (edits supersede, never mutate);
services never commit (flush only).
"""

from __future__ import annotations

import json
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import shared_math as m
from app.engines.commercial_hash import commercial_hash
from app.engines.pricing_engine import LineInput, LineKind, PricingInput, PricingResult
from app.engines.pricing_engine import evaluate as pricing_evaluate
from app.engines.risk_engine import ApprovalLevel, DiscountPolicyDefinition
from app.engines.risk_engine import evaluate as risk_evaluate
from app.engines.risk_engine import FinanceTriggers, ManagerTriggers, RiskResult
from app.models.approvals import ApprovalRequest
from app.models.auth import Profile
from app.models.catalog import Category, Customer, Product, SubscriptionPlan
from app.models.orders import Order
from app.models.policy import DiscountPolicy
from app.models.portal import NegotiationRequest
from app.models.quotes import Quote, QuoteLine, QuoteRevision
from app.repositories import sequences
from app.schemas.quotes import (
    evaluation_to_dict,
    gates_to_dict,
    quote_summary_to_dict,
)
from app.services import audit_service, outbox_writer
from app.services import price_resolver
from app.services.clock import business_today, now_utc

TERMINAL_STAGES = frozenset({"CONFIRMED", "CANCELED", "LOST", "EXPIRED"})
LINE_SOURCES = frozenset({"MANUAL", "RECOMMENDATION", "COUNTER", "SCENARIO"})
APPROVAL_CLEARING = frozenset({"NOT_REQUIRED", "APPROVED"})


# ---------------------------------------------------------------- policy ---


def parse_policy_definition(raw: dict) -> DiscountPolicyDefinition:
    def dec(value: object) -> Decimal | None:
        return None if value is None else Decimal(str(value))

    mgr = raw.get("manager") or {}
    fin = raw.get("finance") or {}
    excess = fin.get("excessValueMinorAtLeast")
    return DiscountPolicyDefinition(
        tier_ceiling_percent={
            str(k): Decimal(str(v)) for k, v in (raw.get("tierCeilingPercent") or {}).items()
        },
        category_ceiling_percent={
            str(k): Decimal(str(v))
            for k, v in (raw.get("categoryCeilingPercent") or {}).items()
        },
        manager=ManagerTriggers(
            any_positive_excess=bool(mgr.get("anyPositiveExcess", True)),
            aggregate_discount_percent_above=dec(mgr.get("aggregateDiscountPercentAbove")),
            aggregate_margin_percent_below=dec(mgr.get("aggregateMarginPercentBelow")),
        ),
        finance=FinanceTriggers(
            worst_line_excess_pp_at_least=dec(fin.get("worstLineExcessPpAtLeast")),
            weighted_excess_pp_at_least=dec(fin.get("weightedExcessPpAtLeast")),
            excess_value_minor_at_least=None if excess is None else int(excess),
            aggregate_margin_percent_below=dec(fin.get("aggregateMarginPercentBelow")),
            non_positive_line_contribution=bool(fin.get("nonPositiveLineContribution", True)),
        ),
    )


async def effective_policy(db: AsyncSession) -> tuple[int, DiscountPolicyDefinition, dict]:
    """Latest DiscountPolicy row with effective_at <= now (local helper)."""
    row = (
        (
            await db.execute(
                select(DiscountPolicy)
                .where(DiscountPolicy.effective_at <= now_utc())
                .order_by(DiscountPolicy.effective_at.desc(), DiscountPolicy.version_no.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if row is None:
        raise ApiException(
            ErrorCode.POLICY_NOT_CONFIGURED,
            "No discount policy version is in effect. An administrator must publish one "
            "before quotations can be evaluated.",
        )
    definition = dict(row.definition or {})
    return row.version_no, parse_policy_definition(definition), definition


def risk_to_snapshot(risk: RiskResult) -> dict:
    return {
        "requiredLevel": risk.required_level.name,
        "reasons": [
            {
                "code": r.code,
                "lineKey": r.line_key,
                "description": r.description,
                "observedValue": str(r.observed_value),
                "thresholdValue": str(r.threshold_value),
                "unit": r.unit,
                "requiredLevel": r.required_level.name,
                "message": r.message,
            }
            for r in risk.reasons
        ],
        "worstLineExcessPp": str(risk.worst_line_excess_pp),
        "weightedExcessPp": str(risk.weighted_excess_pp),
        "excessValueMinor": risk.excess_value_minor,
        "aggregateDiscountPercent": str(risk.aggregate_discount_percent),
        "aggregateMarginPercent": (
            str(risk.aggregate_margin_percent) if risk.aggregate_margin_percent is not None else None
        ),
        "totalBaseMinor": risk.total_base_minor,
        "totalDiscountMinor": risk.total_discount_minor,
        "policyVersionNo": risk.policy_version_no,
    }


# ----------------------------------------------------------------- access ---


def _can_read(actor: Actor, quote: Quote) -> bool:
    if actor.role in ("ADMIN", "FINANCE"):
        return True
    if actor.role == "MANAGER":
        return actor.team_id is None or actor.team_id == quote.team_id
    if actor.role == "REP":
        return actor.profile_id == quote.owner_profile_id
    return False


def require_read(actor: Actor, quote: Quote) -> None:
    from app.api.deps import scope_404

    if actor.is_customer or not _can_read(actor, quote):
        raise scope_404()


def require_edit(actor: Actor, quote: Quote) -> None:
    require_read(actor, quote)
    if not (actor.is_admin or actor.profile_id == quote.owner_profile_id):
        raise ApiException.forbidden(
            "Only the rep who owns this quotation can change its terms."
        )
    if quote.stage in TERMINAL_STAGES:
        raise ApiException(
            ErrorCode.CONFLICTING_STATE,
            f"This quotation is {quote.stage.lower()} and its terms can no longer be changed.",
        )


def require_adopt(actor: Actor, quote: Quote) -> None:
    require_read(actor, quote)
    if not (actor.is_admin or actor.profile_id == quote.owner_profile_id):
        raise ApiException.forbidden(
            "Only the rep who owns this quotation can adopt proposed terms."
        )


# ------------------------------------------------------------------ loads ---


async def load_quote(db: AsyncSession, quote_id: uuid.UUID) -> Quote:
    quote = (
        (await db.execute(select(Quote).where(Quote.id == quote_id))).scalars().first()
    )
    if quote is None:
        raise ApiException.not_found(f"Quotation {quote_id}")
    return quote


async def lock_quote(db: AsyncSession, quote_id: uuid.UUID) -> Quote:
    quote = (
        (
            await db.execute(
                select(Quote).where(Quote.id == quote_id).with_for_update()
            )
        )
        .scalars()
        .first()
    )
    if quote is None:
        raise ApiException.not_found(f"Quotation {quote_id}")
    return quote


async def load_customer(db: AsyncSession, quote: Quote) -> Customer:
    customer = (
        (await db.execute(select(Customer).where(Customer.id == quote.customer_id)))
        .scalars()
        .first()
    )
    if customer is None:
        raise ApiException.not_found(f"Customer {quote.customer_id}")
    return customer


async def current_revision(db: AsyncSession, quote: Quote) -> QuoteRevision:
    if quote.current_revision_id is None:
        raise ApiException(
            ErrorCode.CONFLICTING_STATE, "This quotation has no active version."
        )
    revision = (
        (
            await db.execute(
                select(QuoteRevision).where(QuoteRevision.id == quote.current_revision_id)
            )
        )
        .scalars()
        .first()
    )
    if revision is None:
        raise ApiException.not_found(f"Revision {quote.current_revision_id}")
    return revision


async def find_order_id(db: AsyncSession, quote_id: uuid.UUID) -> uuid.UUID | None:
    return (
        await db.execute(select(Order.id).where(Order.quote_id == quote_id))
    ).scalar_one_or_none()


async def require_no_order(db: AsyncSession, quote: Quote) -> None:
    order_id = await find_order_id(db, quote.id)
    if order_id is not None:
        raise ApiException.of(
            ErrorCode.ALREADY_ORDERED,
            "An order already exists for this quotation. Changes now go through the order.",
            orderId=str(order_id),
        )


def check_expected_version(quote: Quote, expected: int | None) -> None:
    if expected is not None and expected != quote.row_version:
        raise ApiException.of(
            ErrorCode.STALE_QUOTE_VERSION,
            "This quotation changed. Refresh before continuing.",
            currentVersion=quote.row_version,
            expectedVersion=expected,
        )


# ------------------------------------------------------------ line build ---


async def build_line_inputs(
    db: AsyncSession, customer: Customer, requests: list, on_date: date
) -> list[LineInput]:
    if not requests:
        raise ApiException(ErrorCode.EMPTY_QUOTE)
    seen: set[str] = set()
    for request in requests:
        has_variant = request.variantId is not None
        has_plan = request.planId is not None
        if has_variant == has_plan:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED,
                "Each line needs exactly one of a product variant or a subscription plan.",
            )
        if request.lineKey and request.lineKey.strip() and request.lineKey in seen:
            raise ApiException.of(
                ErrorCode.VALIDATION_FAILED,
                f'Two lines share the key "{request.lineKey}".',
                lineKey=request.lineKey,
            )
        if request.lineKey and request.lineKey.strip():
            seen.add(request.lineKey)

    variant_ids = {r.variantId for r in requests if r.variantId is not None}
    plan_ids = {r.planId for r in requests if r.planId is not None}
    prices = (
        await price_resolver.resolve_all(db, variant_ids, customer.tier, customer.currency, on_date)
        if variant_ids
        else {}
    )
    plans_by_id: dict = {}
    if plan_ids:
        plans_by_id = {
            p.id: p
            for p in (
                await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.id.in_(plan_ids)))
            )
            .scalars()
            .all()
        }
    product_ids = {p.product_id for p in prices.values()} | {
        p.product_id for p in plans_by_id.values()
    }
    products_by_id = (
        {
            p.id: p
            for p in (
                await db.execute(select(Product).where(Product.id.in_(product_ids)))
            )
            .scalars()
            .all()
        }
        if product_ids
        else {}
    )
    categories_by_id = {
        c.id: c
        for c in (await db.execute(select(Category))).scalars().all()
    }

    lines: list[LineInput] = []
    for position, request in enumerate(requests):
        line_key = (
            request.lineKey.strip()
            if request.lineKey and request.lineKey.strip()
            else f"ln-{position}-{uuid.uuid4().hex[:8]}"
        )
        discount = request.lineDiscountBp or 0
        source = request.source or "MANUAL"
        if request.variantId is not None:
            price = prices.get(request.variantId)
            if price is None:
                raise ApiException.not_found(f"Product variant {request.variantId}")
            product = products_by_id.get(price.product_id)
            category = categories_by_id.get(price.category_id)
            if product is None or category is None:
                raise ApiException.not_found(f"Catalogue data for variant {request.variantId}")
            if product.charge_kind == "RECURRING":
                raise ApiException(
                    ErrorCode.VALIDATION_FAILED,
                    f'"{product.name}" is a recurring product. Add it by choosing a plan.',
                )
            _require_whole_units(product, request.quantity)
            lines.append(
                LineInput(
                    line_key=line_key,
                    position=position,
                    kind=LineKind.ONE_TIME,
                    product_id=product.id,
                    category_id=category.id,
                    category_code=category.code,
                    variant_id=price.variant_id,
                    plan_id=None,
                    description=price.name,
                    quantity=request.quantity,
                    unit_price_minor=price.unit_price_minor,
                    unit_cost_minor=price.unit_cost_minor,
                    tax_rate_bp=price.tax_rate_bp,
                    line_discount_bp=discount,
                    interval_months=None,
                    requires_stock=price.requires_stock,
                    source=source,
                )
            )
        else:
            plan = plans_by_id.get(request.planId)
            if plan is None or not plan.is_active:
                raise ApiException.not_found(f"Subscription plan {request.planId}")
            if plan.currency != customer.currency:
                raise ApiException(
                    ErrorCode.CURRENCY_MISMATCH,
                    f'"{plan.name}" is priced in {plan.currency}, not {customer.currency}.',
                )
            product = products_by_id.get(plan.product_id)
            if product is None:
                raise ApiException.not_found(f"Product for plan {plan.code}")
            category = categories_by_id.get(product.category_id)
            if category is None:
                raise ApiException.not_found(f"Category for plan {plan.code}")
            _require_whole_units(product, request.quantity)
            lines.append(
                LineInput(
                    line_key=line_key,
                    position=position,
                    kind=LineKind.RECURRING,
                    product_id=product.id,
                    category_id=category.id,
                    category_code=category.code,
                    variant_id=None,
                    plan_id=plan.id,
                    description=plan.name,
                    quantity=request.quantity,
                    unit_price_minor=plan.interval_price_minor,
                    unit_cost_minor=plan.interval_cost_minor,
                    tax_rate_bp=plan.tax_rate_bp,
                    line_discount_bp=discount,
                    interval_months=plan.interval_months,
                    requires_stock=False,
                    source=source,
                )
            )
    return lines


def _require_whole_units(product: Product, quantity: Decimal) -> None:
    if product.quantity_mode == "INTEGER" and quantity.normalize().as_tuple().exponent < 0:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, f'"{product.name}" is sold in whole units.'
        )


async def evaluate_request(
    db: AsyncSession, customer: Customer, requests: list, order_discount_bp: int
) -> tuple[PricingResult, RiskResult, int, dict]:
    inputs = await build_line_inputs(db, customer, requests, business_today())
    pricing = pricing_evaluate(
        PricingInput(currency=customer.currency, order_discount_bp=order_discount_bp, lines=inputs)
    )
    version_no, definition, snapshot = await effective_policy(db)
    risk = risk_evaluate(pricing, customer.tier, definition, version_no)
    return pricing, risk, version_no, snapshot


async def evaluate_stored(
    db: AsyncSession, customer: Customer, revision: QuoteRevision, lines: list[QuoteLine]
) -> tuple[PricingResult, RiskResult, int, dict]:
    categories = {
        c.id: c
        for c in (
            await db.execute(
                select(Category).where(Category.id.in_({ln.category_id for ln in lines}))
            )
        )
        .scalars()
        .all()
    } if lines else {}
    inputs = [
        LineInput(
            line_key=ln.line_key,
            position=ln.position,
            kind=LineKind(ln.line_kind),
            product_id=ln.product_id,
            category_id=ln.category_id,
            category_code=(
                categories[ln.category_id].code if ln.category_id in categories else "UNKNOWN"
            ),
            variant_id=ln.variant_id,
            plan_id=ln.plan_id,
            description=ln.description,
            quantity=ln.quantity,
            unit_price_minor=ln.unit_price_minor,
            unit_cost_minor=ln.unit_cost_minor,
            tax_rate_bp=ln.tax_rate_bp,
            line_discount_bp=ln.line_discount_bp,
            interval_months=ln.interval_months,
            requires_stock=ln.requires_stock,
            source=ln.source,
        )
        for ln in sorted(lines, key=lambda ln: ln.position)
    ]
    pricing = pricing_evaluate(
        PricingInput(
            currency=revision.currency, order_discount_bp=revision.order_discount_bp, lines=inputs
        )
    )
    if revision.status == "DRAFT" or revision.policy_version_no is None:
        version_no, definition, snapshot = await effective_policy(db)
    else:
        version_no = revision.policy_version_no
        snapshot = dict(revision.policy_snapshot or {})
        definition = parse_policy_definition(snapshot)
    risk = risk_evaluate(pricing, customer.tier, definition, version_no)
    return pricing, risk, version_no, snapshot


# ----------------------------------------------------------------- gates ---


def blocking_reasons(
    quote: Quote, revision: QuoteRevision, *, order_exists: bool, expired: bool
) -> list[str]:
    blocking: list[str] = []
    if revision.status != "SUBMITTED":
        blocking.append("This version has not been submitted yet.")
    if revision.approval_status not in APPROVAL_CLEARING:
        blocking.append(
            {
                "PENDING_MANAGER": "Waiting for manager approval.",
                "PENDING_FINANCE": "Waiting for finance approval.",
                "REJECTED": "This version was rejected.",
                "REVISION_REQUIRED": "This version was returned for revision.",
            }.get(revision.approval_status, "Approval has not been evaluated yet.")
        )
    if revision.seller_adopted_at is None:
        blocking.append("The sales rep has not adopted these terms.")
    if revision.customer_accepted_at is None:
        blocking.append("The customer has not accepted these terms.")
    if expired:
        blocking.append("This quotation passed its validity date.")
    if order_exists:
        return ["An order already exists for this quotation."]
    return blocking


async def hook_gates_cleared(db: AsyncSession, actor: Actor, quote_id: uuid.UUID) -> None:
    """Lets the orders domain finalize when the last gate clears.

    Delegates to app.services.order_finalization when present (it owns the
    hook); no-ops when that module — or the entrypoint — is absent.
    """
    try:
        from app.services import order_finalization  # type: ignore[import-not-found]
    except ImportError:
        return
    hook = getattr(order_finalization, "hook_gates_cleared", None) or getattr(
        order_finalization, "on_gates_possibly_cleared", None
    ) or getattr(order_finalization, "try_finalize", None)
    if hook is None:
        return
    await hook(db, actor, quote_id)


# ----------------------------------------------------------------- render ---


async def _approval_steps(db: AsyncSession, revision_id: uuid.UUID) -> list[dict]:
    steps = (
        (
            await db.execute(
                select(ApprovalRequest)
                .where(ApprovalRequest.revision_id == revision_id)
                .order_by(ApprovalRequest.step.asc())
            )
        )
        .scalars()
        .all()
    )
    if not steps:
        return []
    people = {
        p.id: (p.full_name or p.email)
        for p in (
            await db.execute(
                select(Profile).where(
                    Profile.id.in_(
                        {
                            pid
                            for s in steps
                            for pid in (s.assignee_profile_id, s.decided_by_profile_id)
                            if pid is not None
                        }
                    )
                )
            )
        )
        .scalars()
        .all()
    }
    return [
        {
            "id": str(s.id),
            "step": s.step,
            "requiredRole": s.required_role,
            "status": s.status,
            "assigneeProfileId": str(s.assignee_profile_id) if s.assignee_profile_id else None,
            "assigneeName": people.get(s.assignee_profile_id) if s.assignee_profile_id else None,
            "dueAt": s.due_at.isoformat() if s.due_at else None,
            "decidedByProfileId": (
                str(s.decided_by_profile_id) if s.decided_by_profile_id else None
            ),
            "decidedByName": people.get(s.decided_by_profile_id)
            if s.decided_by_profile_id
            else None,
            "decidedAt": s.decided_at.isoformat() if s.decided_at else None,
            "decisionReason": s.decision_reason,
        }
        for s in steps
    ]


async def render_evaluation(
    db: AsyncSession,
    quote: Quote,
    revision: QuoteRevision,
    customer: Customer,
    pricing: PricingResult,
    risk: RiskResult,
    *,
    promised_by_key: dict | None = None,
    preview: bool = False,
) -> dict:
    expired = quote.valid_until is not None and business_today() > quote.valid_until
    order_id = await find_order_id(db, quote.id)
    blocking = blocking_reasons(quote, revision, order_exists=order_id is not None, expired=expired)
    gates = gates_to_dict(
        submitted=revision.status == "SUBMITTED",
        approval_status=revision.approval_status,
        approval_clears=revision.approval_status in APPROVAL_CLEARING,
        seller_adopted=revision.seller_adopted_at is not None,
        customer_accepted=revision.customer_accepted_at is not None,
        expired=expired,
        order_exists=order_id is not None,
        order_id=order_id,
        blocking=blocking,
    )
    steps = [] if preview else await _approval_steps(db, revision.id)
    return evaluation_to_dict(
        quote=quote,
        revision=revision,
        customer=customer,
        pricing=pricing,
        risk=risk,
        promised_by_key=promised_by_key,
        approval_steps=steps,
        gates=gates,
        preview=preview,
    )


async def render_current(db: AsyncSession, quote: Quote) -> dict:
    customer = await load_customer(db, quote)
    revision = await current_revision(db, quote)
    lines = await _stored_lines(db, revision.id)
    if not lines:
        pricing, risk = _empty_pricing(revision), _empty_risk(revision)
    else:
        pricing, risk, _, _ = await evaluate_stored(db, customer, revision, lines)
    return await render_evaluation(
        db, quote, revision, customer, pricing, risk,
        promised_by_key={ln.line_key: ln.promised_date for ln in lines},
    )


async def render_revision(
    db: AsyncSession, quote: Quote, revision: QuoteRevision
) -> dict:
    customer = await load_customer(db, quote)
    lines = await _stored_lines(db, revision.id)
    if not lines:
        pricing, risk = _empty_pricing(revision), _empty_risk(revision)
    else:
        pricing, risk, _, _ = await evaluate_stored(db, customer, revision, lines)
    return await render_evaluation(
        db, quote, revision, customer, pricing, risk,
        promised_by_key={ln.line_key: ln.promised_date for ln in lines},
    )


async def _stored_lines(db: AsyncSession, revision_id: uuid.UUID) -> list[QuoteLine]:
    return list(
        (
            await db.execute(
                select(QuoteLine)
                .where(QuoteLine.revision_id == revision_id)
                .order_by(QuoteLine.position.asc())
            )
        )
        .scalars()
        .all()
    )


def _empty_pricing(revision: QuoteRevision) -> PricingResult:
    return PricingResult(
        currency=revision.currency,
        order_discount_bp=revision.order_discount_bp,
        lines=[],
        one_time_net_minor=0,
        one_time_tax_minor=0,
        one_time_cost_minor=0,
        recurring_first_cycle_net_minor=0,
        recurring_first_cycle_tax_minor=0,
        recurring_first_cycle_cost_minor=0,
        recurring_by_cadence={},
        total_base_minor=0,
        total_discount_minor=0,
        contribution_minor=0,
        contribution_percent=None,
        initial_amount_due_minor=0,
        monthly_recurring_revenue_minor=0,
    )


def _empty_risk(revision: QuoteRevision) -> RiskResult:
    return RiskResult(
        required_level=ApprovalLevel.NONE,
        reasons=[],
        lines=[],
        policy_version_no=revision.policy_version_no or 0,
    )


# ------------------------------------------------------------------ create ---


async def create(db: AsyncSession, actor: Actor, request) -> dict:
    customer = (
        (await db.execute(select(Customer).where(Customer.id == request.customerId)))
        .scalars()
        .first()
    )
    if customer is None:
        raise ApiException.not_found(f"Customer {request.customerId}")
    if not customer.is_active:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, "That customer is no longer active."
        )
    owner = (
        (await db.execute(select(Profile).where(Profile.id == actor.profile_id)))
        .scalars()
        .first()
    )
    if owner is None:
        raise ApiException.not_found("Your profile")

    now = now_utc()
    quote = Quote(
        reference=f"Q-{await sequences.nextval(db, sequences.QUOTE_REFERENCE_SEQ)}",
        customer_id=customer.id,
        owner_profile_id=actor.profile_id,
        team_id=owner.team_id,
        title=request.title,
        valid_until=request.validUntil,
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
        created_by_profile_id=actor.profile_id,
    )
    db.add(revision)
    await db.flush()
    quote.current_revision_id = revision.id
    await db.flush()

    await audit_service.record(
        db, actor, "QUOTE_CREATED", "Quote", quote.id,
        quote_id=quote.id, revision_id=revision.id,
        after={"reference": quote.reference, "customerId": str(customer.id)},
    )
    pricing, risk = _empty_pricing(revision), _empty_risk(revision)
    return await render_evaluation(db, quote, revision, customer, pricing, risk)


# --------------------------------------------------------------- evaluate ---


async def evaluate_preview(db: AsyncSession, actor: Actor, quote_id: uuid.UUID, draft) -> dict:
    quote = await load_quote(db, quote_id)
    require_read(actor, quote)
    customer = await load_customer(db, quote)
    revision = await current_revision(db, quote)
    pricing, risk, _, _ = await evaluate_request(
        db, customer, draft.lines, draft.orderDiscountBp or 0
    )
    return await render_evaluation(
        db, quote, revision, customer, pricing, risk,
        promised_by_key={r.lineKey: r.promisedDate for r in draft.lines if r.lineKey},
        preview=True,
    )


async def get(db: AsyncSession, actor: Actor, quote_id: uuid.UUID) -> dict:
    quote = await load_quote(db, quote_id)
    require_read(actor, quote)
    return await render_current(db, quote)


async def get_revision(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID, revision_id: uuid.UUID
) -> dict:
    quote = await load_quote(db, quote_id)
    require_read(actor, quote)
    revision = (
        (
            await db.execute(
                select(QuoteRevision).where(
                    QuoteRevision.id == revision_id, QuoteRevision.quote_id == quote_id
                )
            )
        )
        .scalars()
        .first()
    )
    if revision is None:
        raise ApiException.not_found(f"Revision {revision_id}")
    return await render_revision(db, quote, revision)


# ------------------------------------------------------------------- edit ---


async def save_draft(db: AsyncSession, actor: Actor, quote_id: uuid.UUID, draft) -> dict:
    from app.services.approval_service import supersede_pending

    quote = await lock_quote(db, quote_id)
    require_edit(actor, quote)
    await require_no_order(db, quote)
    check_expected_version(quote, draft.expectedRowVersion)
    if len(draft.lines) > 100:
        raise ApiException.of(
            ErrorCode.VALIDATION_FAILED, "A quotation is limited to 100 lines.", limit=100
        )

    customer = await load_customer(db, quote)
    now = now_utc()
    pricing, risk, _, _ = await evaluate_request(
        db, customer, draft.lines, draft.orderDiscountBp or 0
    )

    current = await current_revision(db, quote)
    if current.status == "DRAFT":
        target = current
        for ln in await _stored_lines(db, target.id):
            await db.delete(ln)
        await db.flush()
        created_new_revision = False
    else:
        current.status = "SUPERSEDED"
        await supersede_pending(
            db, current, actor, "The quotation was revised before this step was decided."
        )
        await close_candidate_requests(
            db, current.id, actor, now, "SUPERSEDED",
            "Your account manager responded with revised terms.",
        )
        quote.revision_count += 1
        target = QuoteRevision(
            quote_id=quote.id,
            revision_no=quote.revision_count,
            source="SELLER",
            currency=customer.currency,
            created_by_profile_id=actor.profile_id,
        )
        db.add(target)
        await db.flush()
        quote.current_revision_id = target.id
        created_new_revision = True

    target.order_discount_bp = draft.orderDiscountBp or 0
    target.backorder_terms = draft.backorderTerms or "ALLOW_BACKORDER"
    target.requested_activation_date = draft.requestedActivationDate
    await _persist_lines(db, target, pricing, draft.lines)
    _apply_totals(target, pricing)
    target.approval_status = "NOT_EVALUATED"
    target.required_level = "NONE"

    quote.last_activity_at = now
    if created_new_revision and quote.stage != "UNDER_NEGOTIATION":
        quote.stage = "DRAFT"

    await audit_service.record(
        db, actor,
        "QUOTE_REVISED" if created_new_revision else "QUOTE_DRAFT_SAVED",
        "QuoteRevision", target.id,
        quote_id=quote.id, revision_id=target.id,
        after={
            "revisionNo": target.revision_no,
            "oneTimeNetMinor": target.one_time_net_minor,
            "lineCount": len(draft.lines),
        },
    )
    await db.flush()
    await outbox_writer.publish(
        db, outbox_writer.QUOTE_REVISED, "Quote", quote.id, quote.row_version,
        {"revisionId": str(target.id)},
        outbox_writer.deal_scope(quote.customer_id, quote.owner_profile_id, quote.team_id),
    )
    return await render_evaluation(
        db, quote, target, customer, pricing, risk,
        promised_by_key={r.lineKey: r.promisedDate for r in draft.lines if r.lineKey},
    )


async def _persist_lines(db: AsyncSession, revision: QuoteRevision, pricing, requests) -> None:
    request_by_key = {}
    for position, result in enumerate(pricing.lines):
        if position < len(requests) and requests[position].lineKey:
            request_by_key[result.line_key] = requests[position]
        elif result.line_key and position < len(requests):
            request_by_key.setdefault(result.line_key, requests[position])
    for result in pricing.lines:
        request = request_by_key.get(result.line_key)
        source = result.source if result.source in LINE_SOURCES else "MANUAL"
        db.add(
            QuoteLine(
                revision_id=revision.id,
                line_key=result.line_key,
                position=result.position,
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
                promised_date=request.promisedDate if request else None,
                source=source,
            )
        )


def _apply_totals(revision: QuoteRevision, pricing: PricingResult) -> None:
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


async def close_candidate_requests(
    db: AsyncSession,
    candidate_revision_id: uuid.UUID,
    actor: Actor,
    now,
    outcome: str,
    message: str,
) -> None:
    records = (
        (
            await db.execute(
                select(NegotiationRequest).where(
                    NegotiationRequest.candidate_revision_id == candidate_revision_id,
                    NegotiationRequest.status.in_(["OPEN", "ANSWERED"]),
                )
            )
        )
        .scalars()
        .all()
    )
    for record in records:
        record.status = outcome
        record.response_message = record.response_message or message
        record.responded_by_profile_id = actor.profile_id
        record.responded_at = now


# ----------------------------------------------------------------- submit ---


async def submit(db: AsyncSession, actor: Actor, quote_id: uuid.UUID, request) -> dict:
    from app.services.approval_service import create_chain

    quote = await lock_quote(db, quote_id)
    require_edit(actor, quote)
    await require_no_order(db, quote)
    check_expected_version(quote, request.expectedRowVersion)

    revision = await current_revision(db, quote)
    if revision.id != request.expectedRevisionId:
        raise ApiException.of(
            ErrorCode.STALE_QUOTE_VERSION,
            "This quotation changed. Refresh before submitting it.",
            currentRevisionId=str(revision.id),
        )
    if revision.status != "DRAFT":
        raise ApiException(
            ErrorCode.CONFLICTING_STATE, "This version has already been submitted."
        )
    now = now_utc()
    if quote.valid_until is not None and business_today() > quote.valid_until:
        raise ApiException(
            ErrorCode.QUOTE_EXPIRED,
            "This quotation passed its validity date. Extend it before submitting.",
        )

    customer = await load_customer(db, quote)
    lines = await _stored_lines(db, revision.id)
    if not lines:
        raise ApiException(ErrorCode.EMPTY_QUOTE)

    pricing, risk, version_no, snapshot = await evaluate_stored(db, customer, revision, lines)
    _apply_totals(revision, pricing)
    revision.policy_version_no = version_no
    revision.policy_snapshot = snapshot
    revision.risk_result = risk_to_snapshot(risk)
    revision.commercial_hash = commercial_hash(
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
                "variant_id": str(ln.variant_id) if ln.variant_id else None,
                "plan_id": str(ln.plan_id) if ln.plan_id else None,
                "quantity": ln.quantity,
                "unit_price_minor": ln.unit_price_minor,
                "tax_rate_bp": ln.tax_rate_bp,
                "line_discount_bp": ln.line_discount_bp,
                "effective_discount_bp": ln.effective_discount_bp,
                "net_minor": ln.net_minor,
                "interval_months": ln.interval_months,
                "promised_date": ln.promised_date.isoformat() if ln.promised_date else None,
            }
            for ln in lines
        ],
    )
    revision.status = "SUBMITTED"
    revision.submitted_at = now
    revision.seller_adopted_at = now
    revision.seller_adopted_by = actor.profile_id

    required = risk.required_level.name
    await create_chain(db, quote, revision, required, json.dumps(risk_to_snapshot(risk)["reasons"]), now)

    quote.stage = "REVIEW"
    quote.last_activity_at = now
    if quote.awaiting_external_since is None:
        quote.awaiting_external_since = now

    await audit_service.record(
        db, actor, "QUOTE_SUBMITTED", "QuoteRevision", revision.id,
        quote_id=quote.id, revision_id=revision.id,
        after={
            "revisionNo": revision.revision_no,
            "requiredLevel": required,
            "policyVersionNo": version_no,
            "commercialHash": revision.commercial_hash,
        },
        reason=request.note,
    )
    await db.flush()
    await outbox_writer.publish(
        db, outbox_writer.QUOTE_SUBMITTED, "Quote", quote.id, quote.row_version,
        {"revisionId": str(revision.id), "requiredLevel": required},
        {
            **outbox_writer.deal_scope(
                quote.customer_id, quote.owner_profile_id, quote.team_id
            ),
            **outbox_writer.roles_scope("MANAGER", "FINANCE"),
        },
    )
    await hook_gates_cleared(db, actor, quote.id)
    await db.flush()
    return await render_evaluation(
        db, quote, revision, customer, pricing, risk,
        promised_by_key={ln.line_key: ln.promised_date for ln in lines},
    )


# ------------------------------------------------------------------ share ---


async def share(db: AsyncSession, actor: Actor, quote_id: uuid.UUID) -> dict:
    quote = await lock_quote(db, quote_id)
    require_edit(actor, quote)
    revision = await current_revision(db, quote)
    if revision.status != "SUBMITTED":
        raise ApiException(
            ErrorCode.QUOTE_NOT_SUBMITTED,
            "Submit this quotation before sharing it with the customer.",
        )
    now = now_utc()
    if quote.stage in ("REVIEW", "DRAFT"):
        quote.stage = "SENT"
    quote.last_activity_at = now
    if quote.awaiting_external_since is None:
        quote.awaiting_external_since = now

    await audit_service.record(
        db, actor, "QUOTE_SHARED", "Quote", quote.id,
        quote_id=quote.id, revision_id=revision.id,
    )
    await db.flush()
    await outbox_writer.publish(
        db, outbox_writer.QUOTE_REVISED, "Quote", quote.id, quote.row_version,
        {"stage": quote.stage},
        outbox_writer.deal_scope(quote.customer_id, quote.owner_profile_id, quote.team_id),
    )
    return {
        "quoteId": str(quote.id),
        "stage": quote.stage,
        "portalPath": f"/portal/quotes/{quote.id}",
        "commercialHash": revision.commercial_hash,
    }


# ------------------------------------------------------------------ adopt ---


async def adopt(db: AsyncSession, actor: Actor, quote_id: uuid.UUID, request) -> dict:
    quote = await lock_quote(db, quote_id)
    require_adopt(actor, quote)
    await require_no_order(db, quote)
    check_expected_version(quote, request.expectedRowVersion)

    revision = (
        (
            await db.execute(
                select(QuoteRevision).where(
                    QuoteRevision.id == request.revisionId,
                    QuoteRevision.quote_id == quote_id,
                )
            )
        )
        .scalars()
        .first()
    )
    if revision is None:
        raise ApiException.not_found(f"Revision {request.revisionId}")
    if revision.id != quote.current_revision_id:
        raise ApiException.of(
            ErrorCode.STALE_QUOTE_VERSION,
            "That version is no longer the active one.",
            currentRevisionId=str(quote.current_revision_id),
        )
    if revision.status != "SUBMITTED":
        raise ApiException(
            ErrorCode.QUOTE_NOT_SUBMITTED,
            "This version has not been submitted for approval yet.",
        )
    now = now_utc()
    if revision.seller_adopted_at is None:
        revision.seller_adopted_at = now
        revision.seller_adopted_by = actor.profile_id
        quote.last_activity_at = now
        await close_candidate_requests(
            db, revision.id, actor, now, "ADOPTED",
            request.note.strip()
            if request.note and request.note.strip()
            else "Your proposed terms were accepted.",
        )
        await audit_service.record(
            db, actor, "REVISION_ADOPTED", "QuoteRevision", revision.id,
            quote_id=quote.id, revision_id=revision.id, reason=request.note,
        )
        await db.flush()
        await outbox_writer.publish(
            db, outbox_writer.NEGOTIATION_UPDATED, "Quote", quote.id, quote.row_version,
            {"revisionId": str(revision.id)},
            outbox_writer.deal_scope(quote.customer_id, quote.owner_profile_id, quote.team_id),
        )
    await hook_gates_cleared(db, actor, quote.id)
    await db.flush()
    return await render_current(db, quote)


# ----------------------------------------------------------------- cancel ---


async def cancel(db: AsyncSession, actor: Actor, quote_id: uuid.UUID, request) -> dict:
    from app.services.approval_service import supersede_pending

    quote = await lock_quote(db, quote_id)
    require_read(actor, quote)
    if not (actor.is_admin or actor.profile_id == quote.owner_profile_id):
        raise ApiException.forbidden(
            "Only the owning rep or an administrator can cancel this quotation."
        )
    await require_no_order(db, quote)
    check_expected_version(quote, request.expectedRowVersion)

    if quote.stage == "CANCELED":
        return await render_current(db, quote)
    if quote.stage in TERMINAL_STAGES:
        raise ApiException(
            ErrorCode.CONFLICTING_STATE,
            f"This quotation is {quote.stage.lower()} and cannot be cancelled.",
        )
    now = now_utc()
    revision = await current_revision(db, quote)
    await supersede_pending(db, revision, actor, "The quotation was cancelled.")
    revision.status = "CANCELED"
    quote.stage = "CANCELED"
    quote.last_activity_at = now

    await audit_service.record(
        db, actor, "QUOTE_CANCELED", "Quote", quote.id,
        quote_id=quote.id, revision_id=revision.id, reason=request.reason,
    )
    await db.flush()
    await outbox_writer.publish(
        db, outbox_writer.QUOTE_REVISED, "Quote", quote.id, quote.row_version,
        {"stage": "CANCELED"},
        outbox_writer.deal_scope(quote.customer_id, quote.owner_profile_id, quote.team_id),
    )
    return await render_current(db, quote)


# ------------------------------------------------------------------- list ---


async def list_quotes(
    db: AsyncSession,
    actor: Actor,
    *,
    stage: str | None,
    customer_id: uuid.UUID | None,
    owner_profile_id: uuid.UUID | None,
    page: int,
    size: int,
    sort_field: str,
    descending: bool,
) -> tuple[list[dict], int]:
    stage_filter: str | None = None
    if stage and stage.strip():
        candidate = stage.strip().upper()
        if candidate not in (
            "DRAFT", "REVIEW", "SENT", "UNDER_NEGOTIATION",
            "CONFIRMED", "CANCELED", "LOST", "EXPIRED",
        ):
            raise ApiException(
                ErrorCode.VALIDATION_FAILED, f'Unknown stage "{stage}".'
            )
        stage_filter = candidate
    owner = actor.profile_id if actor.role == "REP" else owner_profile_id
    team = actor.team_id if actor.role == "MANAGER" else None

    query = select(Quote)
    count_query = select(func.count()).select_from(Quote)
    if owner is not None:
        query = query.where(Quote.owner_profile_id == owner)
        count_query = count_query.where(Quote.owner_profile_id == owner)
    if team is not None:
        query = query.where(Quote.team_id == team)
        count_query = count_query.where(Quote.team_id == team)
    if customer_id is not None:
        query = query.where(Quote.customer_id == customer_id)
        count_query = count_query.where(Quote.customer_id == customer_id)
    if stage_filter is not None:
        query = query.where(Quote.stage == stage_filter)
        count_query = count_query.where(Quote.stage == stage_filter)

    column = {
        "createdAt": Quote.created_at,
        "updatedAt": Quote.updated_at,
        "lastActivityAt": Quote.last_activity_at,
        "stage": Quote.stage,
    }[sort_field]
    query = query.order_by(column.desc() if descending else column.asc())
    page = max(page, 0)
    rows = list(
        (await db.execute(query.offset(page * size).limit(size))).scalars().all()
    )
    total = int((await db.execute(count_query)).scalar_one())

    revisions = (
        {
            r.id: r
            for r in (
                await db.execute(
                    select(QuoteRevision).where(
                        QuoteRevision.id.in_(
                            {q.current_revision_id for q in rows if q.current_revision_id}
                        )
                    )
                )
            )
            .scalars()
            .all()
        }
        if rows
        else {}
    )
    customers = (
        {
            c.id: c.name
            for c in (
                await db.execute(
                    select(Customer).where(Customer.id.in_({q.customer_id for q in rows}))
                )
            )
            .scalars()
            .all()
        }
        if rows
        else {}
    )
    owners = (
        {
            p.id: (p.full_name or p.email)
            for p in (
                await db.execute(
                    select(Profile).where(Profile.id.in_({q.owner_profile_id for q in rows}))
                )
            )
            .scalars()
            .all()
        }
        if rows
        else {}
    )
    return [
        quote_summary_to_dict(
            q,
            revisions.get(q.current_revision_id) if q.current_revision_id else None,
            customers.get(q.customer_id),
            owners.get(q.owner_profile_id),
        )
        for q in rows
    ], total


async def revision_list(db: AsyncSession, actor: Actor, quote_id: uuid.UUID) -> list[dict]:
    quote = await load_quote(db, quote_id)
    require_read(actor, quote)
    revisions = list(
        (
            await db.execute(
                select(QuoteRevision)
                .where(QuoteRevision.quote_id == quote_id)
                .order_by(QuoteRevision.revision_no.desc())
            )
        )
        .scalars()
        .all()
    )
    return [
        {
            "id": str(r.id),
            "revisionNo": r.revision_no,
            "status": r.status,
            "source": r.source,
            "approvalStatus": r.approval_status,
            "oneTimeNet": m.to_major(r.one_time_net_minor),
            "recurringFirstCycleNet": m.to_major(r.recurring_first_cycle_net_minor),
            "submittedAt": r.submitted_at.isoformat() if r.submitted_at else None,
            "customerAcceptedAt": (
                r.customer_accepted_at.isoformat() if r.customer_accepted_at else None
            ),
            "current": r.id == quote.current_revision_id,
        }
        for r in revisions
    ]


async def history(db: AsyncSession, actor: Actor, quote_id: uuid.UUID) -> list[dict]:
    from app.models.ops import AuditEvent

    quote = await load_quote(db, quote_id)
    require_read(actor, quote)
    events = list(
        (
            await db.execute(
                select(AuditEvent)
                .where(AuditEvent.quote_id == quote_id)
                .order_by(AuditEvent.occurred_at.desc())
            )
        )
        .scalars()
        .all()
    )
    people = (
        {
            p.id: (p.full_name or p.email)
            for p in (
                await db.execute(
                    select(Profile).where(
                        Profile.id.in_(
                            {e.actor_profile_id for e in events if e.actor_profile_id}
                        )
                    )
                )
            )
            .scalars()
            .all()
        }
        if events
        else {}
    )
    return [
        {
            "id": str(e.id),
            "action": e.action,
            "entityType": e.entity_type,
            "actor": (
                people.get(e.actor_profile_id)
                if e.actor_profile_id
                else e.actor_kind
            ),
            "reason": e.reason,
            "after": e.after_summary,
            "occurredAt": e.occurred_at.isoformat() if e.occurred_at else None,
        }
        for e in events
    ]
