"""Subscription + plan-switch service — port of SubscriptionService and PlanSwitchService."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import shared_math as m
from app.engines import proration_calculator as proration
from app.engines.proration_calculator import ChargeSegment
from app.models.billing import CreditNote, Invoice, InvoiceLine, Subscription, SubscriptionChange
from app.models.catalog import Product, SubscriptionPlan
from app.repositories.sequences import CREDIT_NOTE_REFERENCE_SEQ, nextval
from app.schemas.billing import change_preview, plan_preview
from app.services import audit_service, billing_service, clock, outbox_writer
from app.services.settlement_service import apply_credit_to_open_invoices


def _live_only(sub: Subscription) -> None:
    if sub.status not in ("ACTIVE", "CANCEL_AT_PERIOD_END"):
        raise ApiException.of(
            ErrorCode.SUBSCRIPTION_NOT_ACTIVE,
            f"This subscription is {sub.status.lower()}.",
            status=sub.status,
        )


def _resolve_effective_date(sub: Subscription, requested: date | None) -> date:
    today = clock.business_today()
    effective = requested or today
    if effective < today:
        raise ApiException.of(
            ErrorCode.BACKDATED_CHANGE_REJECTED,
            "A change cannot take effect before today. Use a scheduled change for a future date, or contact finance for a historical correction.",
            requested=str(effective),
            businessDate=str(today),
        )
    if effective < sub.period_start or not (effective < sub.period_end):
        raise ApiException.of(
            ErrorCode.EFFECTIVE_DATE_OUT_OF_PERIOD,
            f"The effective date must fall inside the current period ({sub.period_start} to {sub.period_end}).",
            periodStart=str(sub.period_start),
            periodEnd=str(sub.period_end),
        )
    return effective


def _parse_cancel_policy(value: str | None, default: str) -> str:
    if value is None:
        return default
    try:
        return {"END_OF_PERIOD": "END_OF_PERIOD", "IMMEDIATE_PRORATED": "IMMEDIATE_PRORATED"}[value.upper()]
    except KeyError:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "policy must be END_OF_PERIOD or IMMEDIATE_PRORATED.")


def _snapshot(sub: Subscription) -> dict:
    return {
        "quantity": str(sub.quantity),
        "unitIntervalPriceMinor": sub.unit_interval_price_minor,
        "intervalMonths": sub.interval_months,
        "periodStart": str(sub.period_start),
        "periodEnd": str(sub.period_end),
        "status": sub.status,
    }


async def unused_at(db: AsyncSession, subscription_id: uuid.UUID, effective: date) -> tuple[int, int]:
    lines = (
        await db.execute(
            select(InvoiceLine).where(InvoiceLine.subscription_id == subscription_id).order_by(InvoiceLine.coverage_start.asc())
        )
    ).scalars().all()
    charged = proration.unused_coverage(
        [ChargeSegment(l.coverage_start, l.coverage_end, l.net_minor, l.tax_minor) for l in lines],
        effective,
    )
    notes = (
        await db.execute(select(CreditNote).where(CreditNote.subscription_id == subscription_id))
    ).scalars().all()
    credited = proration.unused_coverage(
        [ChargeSegment(n.coverage_start, n.coverage_end, n.net_minor, n.tax_minor) for n in notes],
        effective,
    )
    return max(0, charged.net_minor - credited.net_minor), max(0, charged.tax_minor - credited.tax_minor)


def _explain(adj) -> str:
    if adj.net_minor == 0:
        return "No adjustment is due for the remainder of this period."
    verb = "Additional charge of " if adj.is_charge() else "Credit of "
    return f"{verb}{m.format_money(adj.absolute_net_minor())} for {adj.remaining_days} of {adj.total_days} days remaining in the period."


def _to_change_preview(sub, change_type, effective, new_qty, adj, inv_id, cn_id, applied) -> dict:
    return change_preview(
        subscription_id=sub.id,
        change_type=change_type,
        effective_date=effective,
        period_start=sub.period_start,
        period_end=sub.period_end,
        remaining_days=adj.remaining_days,
        total_days=adj.total_days,
        remaining_fraction=adj.remaining_fraction,
        prior_quantity=Decimal(sub.quantity),
        new_quantity=Decimal(new_qty),
        adjustment_net_minor=adj.net_minor,
        adjustment_tax_minor=adj.tax_minor,
        explanation=_explain(adj),
        adjustment_invoice_id=inv_id,
        credit_note_id=cn_id,
        applied=applied,
    )


# -------------------------------------------------------------- preview ---

async def preview_quantity_change(db: AsyncSession, subscription_id: uuid.UUID, request) -> dict:
    sub = (await db.execute(select(Subscription).where(Subscription.id == subscription_id))).scalars().first()
    if sub is None:
        raise ApiException.not_found(f"Subscription {subscription_id}")
    effective = _resolve_effective_date(sub, request.effectiveDate)
    adj = proration.quantity_change(
        Decimal(sub.quantity), Decimal(request.newQuantity),
        sub.unit_interval_price_minor, effective,
        sub.period_start, sub.period_end, sub.tax_rate_bp or 0,
    )
    return _to_change_preview(sub, "QUANTITY", effective, Decimal(request.newQuantity), adj, None, None, False)


# ------------------------------------------------------- quantity change ---

async def apply_quantity_change(db: AsyncSession, actor: Actor, subscription_id: uuid.UUID, request_key: str, request) -> dict:
    sub = (
        await db.execute(select(Subscription).where(Subscription.id == subscription_id).with_for_update())
    ).scalars().first()
    if sub is None:
        raise ApiException.not_found(f"Subscription {subscription_id}")
    _live_only(sub)
    existing = (
        await db.execute(
            select(SubscriptionChange).where(
                SubscriptionChange.subscription_id == subscription_id,
                SubscriptionChange.request_key == request_key,
            )
        )
    ).scalars().first()
    if existing is not None:
        return _replay_of(sub, existing)
    effective = _resolve_effective_date(sub, request.effectiveDate)
    prior = Decimal(sub.quantity)
    new_qty = Decimal(request.newQuantity)
    if prior == new_qty:
        raise ApiException(ErrorCode.VALIDATION_FAILED, f"The quantity is already {new_qty}.")
    adj = proration.quantity_change(
        prior, new_qty, sub.unit_interval_price_minor, effective,
        sub.period_start, sub.period_end, sub.tax_rate_bp or 0,
    )
    change = SubscriptionChange(
        subscription_id=sub.id,
        change_type="QUANTITY",
        effective_date=effective,
        prior_snapshot=_snapshot(sub),
        new_snapshot={**_snapshot(sub), "quantity": str(new_qty)},
        request_key=request_key,
        actor_profile_id=actor.profile_id,
        applied_at=clock.now_utc(),
    )
    db.add(change)
    await db.flush()
    inv_id = None
    cn_id = None
    if sub.proration_policy == "IMMEDIATE_PRORATED" and adj.net_minor != 0:
        if adj.is_charge():
            inv_id = await _raise_adjustment_invoice(db, actor, sub, change, adj, effective, new_qty - prior)
            change.adjustment_invoice_id = inv_id
        else:
            note = await _raise_credit_note(
                db, actor, sub, change, adj.absolute_net_minor(), adj.absolute_tax_minor(),
                effective, sub.period_end, "Reduced quantity for the remainder of the period",
            )
            cn_id = note.id
            change.credit_note_id = cn_id
            await apply_credit_to_open_invoices(db, note, actor)
    if sub.proration_policy == "IMMEDIATE_PRORATED":
        sub.quantity = new_qty
    await audit_service.record(
        db, actor, "SUBSCRIPTION_QUANTITY_CHANGED", "Subscription", sub.id,
        before={"quantity": str(prior)},
        after={"quantity": str(new_qty), "effectiveDate": str(effective), "adjustmentNetMinor": adj.net_minor, "policy": sub.proration_policy},
        reason=request.note,
    )
    await outbox_writer.publish(
        db, outbox_writer.SUBSCRIPTION_UPDATED, "Subscription", sub.id,
        sub.row_version or 0,
        {"changeType": "QUANTITY", "effectiveDate": str(effective)},
        outbox_writer.deal_scope(sub.customer_id, None, None),
    )
    await db.flush()
    return _to_change_preview(sub, "QUANTITY", effective, new_qty, adj, inv_id, cn_id, True)


async def _raise_adjustment_invoice(db, actor, sub, change, adj, effective, delta_qty) -> uuid.UUID:
    invoice = await billing_service.new_invoice(db, sub.customer_id, "ADJUSTMENT", sub.currency)
    invoice.subscription_id = sub.id
    invoice.order_id = sub.order_id
    line = InvoiceLine(
        invoice_id=invoice.id,
        subscription_id=sub.id,
        position=0,
        description=f"Quantity change ({delta_qty} units, {effective} to {sub.period_end})",
        quantity=delta_qty,
        unit_price_minor=sub.unit_interval_price_minor,
        net_minor=adj.net_minor,
        tax_rate_bp=sub.tax_rate_bp or 0,
        tax_minor=adj.tax_minor,
        coverage_start=effective,
        coverage_end=sub.period_end,
        line_type="PRORATION",
        charge_key=billing_service.adjustment_charge_key(sub.id, effective, sub.period_end, change.id),
    )
    db.add(line)
    invoice.net_minor = adj.net_minor
    invoice.tax_minor = adj.tax_minor
    invoice.total_minor = adj.net_minor + adj.tax_minor
    today = clock.business_today()
    invoice.status = "ISSUED"
    invoice.issue_date = today
    invoice.due_date = today + timedelta(days=billing_service.INVOICE_DUE_DAYS)
    await db.flush()
    await outbox_writer.publish(
        db, outbox_writer.INVOICE_UPDATED, "Invoice", invoice.id,
        invoice.row_version or 0,
        {"kind": "ADJUSTMENT"},
        outbox_writer.deal_scope(sub.customer_id, None, None),
    )
    return invoice.id


async def _raise_credit_note(db, actor, sub, change, net_minor, tax_minor, cov_start, cov_end, reason) -> CreditNote:
    n = await nextval(db, CREDIT_NOTE_REFERENCE_SEQ)
    note = CreditNote(
        reference=f"CN-{n}",
        customer_id=sub.customer_id,
        currency=sub.currency,
        reason=reason,
        net_minor=net_minor,
        tax_minor=tax_minor,
        total_minor=net_minor + tax_minor,
        applied_minor=0,
        refunded_minor=0,
        coverage_start=cov_start,
        coverage_end=cov_end,
        status="ISSUED",
        issued_by_profile_id=actor.profile_id,
        subscription_id=sub.id,
        subscription_change_id=change.id,
    )
    db.add(note)
    await db.flush()
    await audit_service.record(
        db, actor, "CREDIT_NOTE_ISSUED", "CreditNote", note.id,
        after={"reference": note.reference, "totalMinor": note.total_minor, "subscriptionId": str(sub.id)},
        reason=reason,
    )
    return note


def _replay_of(sub: Subscription, change: SubscriptionChange) -> dict:
    return change_preview(
        subscription_id=sub.id,
        change_type=change.change_type,
        effective_date=change.effective_date,
        period_start=sub.period_start,
        period_end=sub.period_end,
        remaining_days=m.days_between(change.effective_date, sub.period_end),
        total_days=m.days_between(sub.period_start, sub.period_end),
        remaining_fraction=Decimal(0),
        prior_quantity=Decimal(sub.quantity),
        new_quantity=Decimal(sub.quantity),
        adjustment_net_minor=0,
        adjustment_tax_minor=0,
        explanation="This change was already applied; no further adjustment was raised.",
        adjustment_invoice_id=change.adjustment_invoice_id,
        credit_note_id=change.credit_note_id,
        applied=True,
    )


# --------------------------------------------------------- cancellation ---

async def cancel_subscription(db: AsyncSession, actor: Actor, subscription_id: uuid.UUID, request_key: str, request) -> dict:
    sub = (
        await db.execute(select(Subscription).where(Subscription.id == subscription_id).with_for_update())
    ).scalars().first()
    if sub is None:
        raise ApiException.not_found(f"Subscription {subscription_id}")
    existing = (
        await db.execute(
            select(SubscriptionChange).where(
                SubscriptionChange.subscription_id == subscription_id,
                SubscriptionChange.request_key == request_key,
            )
        )
    ).scalars().first()
    if existing is not None:
        return _replay_of(sub, existing)
    if sub.status == "CANCELED":
        raise ApiException(ErrorCode.SUBSCRIPTION_NOT_ACTIVE, "This subscription is already cancelled.")
    _live_only(sub)
    policy = _parse_cancel_policy(request.policy, sub.cancellation_policy or "END_OF_PERIOD")
    if policy == "END_OF_PERIOD":
        effective = sub.period_end
    else:
        effective = _resolve_effective_date(sub, request.effectiveDate)
    change = SubscriptionChange(
        subscription_id=sub.id,
        change_type="CANCEL",
        effective_date=effective,
        prior_snapshot=_snapshot(sub),
        new_snapshot={"status": "CANCELED", "policy": policy},
        request_key=request_key,
        actor_profile_id=actor.profile_id,
        applied_at=clock.now_utc(),
    )
    db.add(change)
    await db.flush()
    cn_id = None
    credit_net = 0
    credit_tax = 0
    if policy == "IMMEDIATE_PRORATED":
        credit_net, credit_tax = await unused_at(db, sub.id, effective)
        if credit_net + credit_tax > 0:
            note = await _raise_credit_note(
                db, actor, sub, change, credit_net, credit_tax,
                effective, sub.period_end, "Unused service after cancellation",
            )
            cn_id = note.id
            change.credit_note_id = cn_id
            await apply_credit_to_open_invoices(db, note, actor)
        sub.status = "CANCELED"
        sub.canceled_at = clock.now_utc()
        sub.next_bill_at = None
    else:
        sub.status = "CANCEL_AT_PERIOD_END"
    sub.cancel_effective_date = effective
    await audit_service.record(
        db, actor, "SUBSCRIPTION_CANCELED", "Subscription", sub.id,
        after={"policy": policy, "effectiveDate": str(effective), "creditNetMinor": credit_net, "creditTaxMinor": credit_tax},
        reason=request.reason,
    )
    await outbox_writer.publish(
        db, outbox_writer.SUBSCRIPTION_UPDATED, "Subscription", sub.id,
        sub.row_version or 0,
        {"status": sub.status},
        outbox_writer.deal_scope(sub.customer_id, None, None),
    )
    await db.flush()
    adj = proration.quantity_change(Decimal(0), Decimal(0), 0, effective, sub.period_start, sub.period_end, 0)
    # Represent the credit as a negative adjustment for the preview.
    from app.engines.proration_calculator import Adjustment as Adj

    as_adj = Adj(-credit_net, -credit_tax, Decimal(0),
                 m.days_between(effective, sub.period_end),
                 m.days_between(sub.period_start, sub.period_end),
                 effective, sub.period_end)
    return _to_change_preview(sub, "CANCEL", effective, Decimal(sub.quantity), as_adj, None, cn_id, True)


# ---------------------------------------------------------- plan switch ---

async def preview_plan_change(db: AsyncSession, subscription_id: uuid.UUID, request) -> dict:
    sub = (await db.execute(select(Subscription).where(Subscription.id == subscription_id))).scalars().first()
    if sub is None:
        raise ApiException.not_found("Subscription")
    calc = await _calculate(db, sub, request)
    return _plan_response(sub, calc, None, None, False)


async def apply_plan_change(db: AsyncSession, actor: Actor, subscription_id: uuid.UUID, request_key: str, request) -> dict:
    sub = (
        await db.execute(select(Subscription).where(Subscription.id == subscription_id).with_for_update())
    ).scalars().first()
    if sub is None:
        raise ApiException.not_found("Subscription")
    if request.expectedRowVersion is None or int(request.expectedRowVersion) != int(sub.row_version or 0):
        raise ApiException(ErrorCode.CONFLICTING_STATE, "Subscription changed. Preview the latest terms first.")
    calc = await _calculate(db, sub, request)
    plan = calc["plan"]
    eff = calc["date"]
    end = calc["end"]
    before = {"planId": str(sub.plan_id), "priceMinor": sub.unit_interval_price_minor, "quantity": str(sub.quantity), "periodStart": str(sub.period_start), "periodEnd": str(sub.period_end)}
    change = SubscriptionChange(
        subscription_id=sub.id,
        change_type="PLAN",
        effective_date=eff,
        prior_snapshot=before,
        new_snapshot={"planId": str(plan.id), "periodEnd": str(end)},
        request_key=request_key,
        actor_profile_id=actor.profile_id,
        applied_at=clock.now_utc(),
    )
    db.add(change)
    await db.flush()
    credit = None
    if calc["credit_net"] + calc["credit_tax"] > 0:
        n = await nextval(db, CREDIT_NOTE_REFERENCE_SEQ)
        credit = CreditNote(
            reference=f"CN-{n}",
            customer_id=sub.customer_id,
            currency=sub.currency,
            reason="Unused coverage before plan switch",
            net_minor=calc["credit_net"],
            tax_minor=calc["credit_tax"],
            total_minor=calc["credit_net"] + calc["credit_tax"],
            applied_minor=0,
            refunded_minor=0,
            coverage_start=eff,
            coverage_end=sub.period_end,
            status="ISSUED",
            issued_by_profile_id=actor.profile_id,
            subscription_id=sub.id,
            subscription_change_id=change.id,
        )
        db.add(credit)
        await db.flush()
        change.credit_note_id = credit.id
    invoice = await billing_service.new_invoice(db, sub.customer_id, "ADJUSTMENT", sub.currency)
    invoice.subscription_id = sub.id
    invoice.order_id = sub.order_id
    line = InvoiceLine(
        invoice_id=invoice.id,
        subscription_id=sub.id,
        position=0,
        description=f"Plan switch to {plan.name}",
        quantity=sub.quantity,
        unit_price_minor=plan.interval_price_minor,
        net_minor=calc["charge"].net_minor,
        tax_rate_bp=plan.tax_rate_bp or 0,
        tax_minor=calc["charge"].tax_minor,
        coverage_start=eff,
        coverage_end=end,
        line_type="PRORATION",
        charge_key=billing_service.adjustment_charge_key(sub.id, eff, end, change.id),
    )
    db.add(line)
    invoice.net_minor = calc["charge"].net_minor
    invoice.tax_minor = calc["charge"].tax_minor
    invoice.total_minor = calc["charge"].net_minor + calc["charge"].tax_minor
    today = clock.business_today()
    invoice.status = "ISSUED"
    invoice.issue_date = today
    invoice.due_date = today + timedelta(days=billing_service.INVOICE_DUE_DAYS)
    change.adjustment_invoice_id = invoice.id
    if credit is not None:
        await apply_credit_to_open_invoices(db, credit, actor)
    sub.plan_id = plan.id
    sub.unit_interval_price_minor = plan.interval_price_minor
    sub.unit_interval_cost_minor = plan.interval_cost_minor or 0
    sub.tax_rate_bp = plan.tax_rate_bp or 0
    sub.proration_policy = plan.proration_policy
    sub.cancellation_policy = plan.cancellation_policy
    if calc["interval_changed"]:
        sub.interval_months = plan.interval_months
        sub.period_start = eff
        sub.period_end = end
        sub.anchor_day = eff.day
        sub.billing_anchor = "ACTIVATION_DATE"
        sub.next_bill_at = end
    await audit_service.record(
        db, actor, "SUBSCRIPTION_PLAN_CHANGED", "Subscription", sub.id,
        before={"snapshot": before},
        after={"newPlanId": str(plan.id), "creditNet": calc["credit_net"], "chargeNet": calc["charge"].net_minor},
        reason=request.note,
    )
    await outbox_writer.publish(
        db, outbox_writer.SUBSCRIPTION_UPDATED, "Subscription", sub.id,
        sub.row_version or 0,
        {"changeType": "PLAN"},
        outbox_writer.deal_scope(sub.customer_id, None, None),
    )
    await outbox_writer.publish(
        db, outbox_writer.INVOICE_UPDATED, "Invoice", invoice.id,
        invoice.row_version or 0,
        {"kind": "ADJUSTMENT"},
        outbox_writer.deal_scope(sub.customer_id, None, None),
    )
    await db.flush()
    # refresh row_version after flush
    await db.refresh(sub)
    return _plan_response(sub, calc, invoice.id, credit.id if credit else None, True)


async def _calculate(db: AsyncSession, sub: Subscription, request) -> dict:
    if sub.status != "ACTIVE":
        raise ApiException(ErrorCode.SUBSCRIPTION_NOT_ACTIVE, "Only active subscriptions can switch plans.")
    eff = request.effectiveDate or clock.business_today()
    if eff != clock.business_today():
        raise ApiException(ErrorCode.BACKDATED_CHANGE_REJECTED, "An immediate plan switch must take effect today.")
    if eff < sub.period_start or not (eff < sub.period_end):
        raise ApiException(ErrorCode.EFFECTIVE_DATE_OUT_OF_PERIOD, "Run due billing before switching this plan.")
    plan = (await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.id == request.newPlanId))).scalars().first()
    if plan is None:
        raise ApiException.not_found("Plan")
    old = (await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.id == sub.plan_id))).scalars().first()
    if old is None:
        raise ApiException.not_found("Current plan")
    product = (await db.execute(select(Product).where(Product.id == plan.product_id))).scalars().first()
    if product is None or not product.is_active:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "Select a different active plan for the same product and currency.")
    if not plan.is_active or plan.product_id != old.product_id or plan.currency != sub.currency or plan.id == old.id:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "Select a different active plan for the same product and currency.")
    changed = plan.interval_months != sub.interval_months
    if changed:
        end = _add_months(eff, plan.interval_months)
    else:
        end = sub.period_end
    charge = proration.remainder_at_new_price(
        Decimal(sub.quantity), plan.interval_price_minor, eff,
        eff if changed else sub.period_start, end, plan.tax_rate_bp or 0,
    )
    credit_net, credit_tax = await unused_at(db, sub.id, eff)
    return {
        "plan": plan, "date": eff, "end": end,
        "credit_net": credit_net, "credit_tax": credit_tax,
        "charge": charge, "interval_changed": changed,
    }


def _add_months(d: date, months: int) -> date:
    idx = d.year * 12 + (d.month - 1) + months
    y, mo = idx // 12, idx % 12 + 1
    import calendar as _cal

    return date(y, mo, min(d.day, _cal.monthrange(y, mo)[1]))


def _plan_response(sub, calc, invoice_id, credit_id, applied) -> dict:
    changed = calc["interval_changed"]
    explanation = (
        "Old coverage is credited separately; new service uses the selected plan's current catalog price. "
        + ("A full new calendar interval starts today." if changed else "The current period end is preserved.")
    )
    return plan_preview(
        subscription_id=sub.id,
        new_plan_id=calc["plan"].id,
        new_plan_name=calc["plan"].name,
        row_version=int(sub.row_version or 0),
        effective_date=calc["date"],
        coverage_end=calc["end"],
        old_credit_net_minor=calc["credit_net"],
        old_credit_tax_minor=calc["credit_tax"],
        new_charge_net_minor=calc["charge"].net_minor,
        new_charge_tax_minor=calc["charge"].tax_minor,
        interval_changed=changed,
        explanation=explanation,
        invoice_id=invoice_id,
        credit_note_id=credit_id,
        applied=applied,
    )
