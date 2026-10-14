"""Billing service — port of billing/service/BillingService.java."""

from __future__ import annotations

import random
import uuid
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import shared_math as m
from app.engines import proration_calculator as proration
from app.models.billing import Invoice, InvoiceLine, Subscription
from app.models.catalog import Customer, SubscriptionPlan
from app.models.orders import Order
from app.repositories.sequences import INVOICE_NUMBER_SEQ, nextval
from app.services import audit_service, clock, outbox_writer

INVOICE_DUE_DAYS = 15


def period_charge_key(sub_id: uuid.UUID, start: date, end: date) -> str:
    return f"sub:{sub_id}|{start}|{end}|RECURRING|base"


def adjustment_charge_key(sub_id: uuid.UUID, start: date, end: date, change_id: uuid.UUID) -> str:
    return f"sub:{sub_id}|{start}|{end}|PRORATION|{change_id}"


def one_time_charge_key(order_line_id: uuid.UUID) -> str:
    return f"order-line:{order_line_id}|ONE_TIME|base"


def discounted_unit_price(net_minor: int, quantity: Decimal) -> int:
    if quantity is None or Decimal(quantity) == 0:
        return 0
    return int((Decimal(net_minor) / Decimal(quantity)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


async def new_invoice(db: AsyncSession, customer_id: uuid.UUID, kind: str, currency: str) -> Invoice:
    n = await nextval(db, INVOICE_NUMBER_SEQ)
    inv = Invoice(
        invoice_no=n,
        reference=f"INV-{n}",
        customer_id=customer_id,
        invoice_kind=kind,
        currency=currency,
        status="DRAFT",
        net_minor=0,
        tax_minor=0,
        total_minor=0,
        credited_minor=0,
        paid_minor=0,
    )
    db.add(inv)
    await db.flush()
    return inv


def _next_subscription_reference() -> str:
    return "SUB-" + uuid.uuid4().hex[:8].upper()


async def initialize_billing_for_order(
    db: AsyncSession,
    actor: Actor,
    order: Any,
    order_lines: list[Any],
    invoicing_terms: str | None,
    requested_activation_date: date | None,
) -> dict:
    business_today = clock.business_today()
    activation = requested_activation_date or business_today
    if activation < business_today:
        raise ApiException.of(
            ErrorCode.BACKDATED_CHANGE_REJECTED,
            "The requested activation date has passed. Re-quote with a current start date.",
            requestedActivationDate=str(activation),
            businessDate=str(business_today),
        )
    one_time_id = await _create_one_time_invoice(db, actor, order, order_lines, invoicing_terms, business_today)
    sub_ids, recurring_ids = await _create_subscriptions(db, actor, order, order_lines, activation, business_today)
    order.billing_status = "INITIALIZED"
    initial_due = 0
    if one_time_id is not None:
        inv = (await db.execute(select(Invoice).where(Invoice.id == one_time_id))).scalars().first()
        if inv is not None:
            initial_due = inv.total_minor
    return {
        "oneTimeInvoiceId": one_time_id,
        "subscriptionIds": sub_ids,
        "recurringInvoiceIds": recurring_ids,
        "initialAmountDueMinor": initial_due,
    }


async def _create_one_time_invoice(db, actor, order, order_lines, invoicing_terms, business_today) -> uuid.UUID | None:
    one_time = sorted(
        [ln for ln in order_lines if getattr(ln, "line_kind", None) == "ONE_TIME"],
        key=lambda ln: getattr(ln, "position", 0) or 0,
    )
    if not one_time:
        return None
    invoice = await new_invoice(db, order.customer_id, "ONE_TIME", order.currency)
    invoice.order_id = order.id
    pos = 0
    for line in one_time:
        il = InvoiceLine(
            invoice_id=invoice.id,
            order_line_id=line.id,
            position=pos,
            description=line.description,
            quantity=line.quantity,
            unit_price_minor=line.unit_price_minor,
            net_minor=line.net_minor,
            tax_rate_bp=line.tax_rate_bp,
            tax_minor=line.tax_minor,
            line_type="ONE_TIME",
            charge_key=one_time_charge_key(line.id),
        )
        db.add(il)
        invoice.net_minor += line.net_minor
        invoice.tax_minor += line.tax_minor
        pos += 1
    invoice.total_minor = invoice.net_minor + invoice.tax_minor
    if invoicing_terms == "ON_CONFIRMATION":
        invoice.status = "ISSUED"
        invoice.issue_date = business_today
        invoice.due_date = business_today + timedelta(days=INVOICE_DUE_DAYS)
    await db.flush()
    await audit_service.record(
        db, actor, "INVOICE_ISSUED", "Invoice", invoice.id,
        order_id=order.id,
        after={"reference": invoice.reference, "totalMinor": invoice.total_minor, "kind": "ONE_TIME"},
    )
    await outbox_writer.publish(
        db, outbox_writer.INVOICE_UPDATED, "Invoice", invoice.id,
        invoice.row_version or 0,
        {"orderId": str(order.id)},
        outbox_writer.deal_scope(order.customer_id, getattr(order, "owner_profile_id", None), None),
    )
    return invoice.id


async def _create_subscriptions(db, actor, order, order_lines, activation, business_today):
    recurring = sorted(
        [ln for ln in order_lines if getattr(ln, "line_kind", None) == "RECURRING" and getattr(ln, "plan_id", None) is not None],
        key=lambda ln: getattr(ln, "position", 0) or 0,
    )
    if not recurring:
        return [], []
    plan_ids = {ln.plan_id for ln in recurring}
    plans_rows = (await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.id.in_(plan_ids)))).scalars().all()
    plans_by_id = {p.id: p for p in plans_rows}

    subscription_ids: list[uuid.UUID] = []
    invoices_by_group: dict[str, Invoice] = {}
    position_by_invoice: dict[uuid.UUID, int] = {}

    for line in recurring:
        plan = plans_by_id.get(line.plan_id)
        if plan is None:
            raise ApiException.not_found(f"Subscription plan {line.plan_id}")
        anchor_day = 1 if plan.billing_anchor == "CALENDAR_MONTH_START" else activation.day
        period_end = m.first_period_end(activation, anchor_day, plan.interval_months)
        unit_price = discounted_unit_price(line.net_minor, line.quantity)
        sub = Subscription(
            reference=_next_subscription_reference(),
            order_id=order.id,
            order_line_id=line.id,
            customer_id=order.customer_id,
            plan_id=plan.id,
            currency=order.currency,
            quantity=line.quantity,
            unit_interval_price_minor=unit_price,
            unit_interval_cost_minor=plan.interval_cost_minor or 0,
            tax_rate_bp=line.tax_rate_bp or 0,
            interval_months=plan.interval_months,
            anchor_day=anchor_day,
            billing_anchor=plan.billing_anchor,
            activation_date=activation,
            period_start=activation,
            period_end=period_end,
            next_bill_at=period_end,
            status="ACTIVE",
            proration_policy=plan.proration_policy,
            cancellation_policy=plan.cancellation_policy,
            clawback_policy=plan.clawback_policy,
        )
        db.add(sub)
        await db.flush()
        subscription_ids.append(sub.id)

        first = proration.first_period_charge(
            Decimal(line.quantity), unit_price, activation, period_end,
            anchor_day, plan.interval_months, sub.tax_rate_bp,
        )
        group_key = f"{plan.interval_months}|{activation}|{period_end}"
        invoice = invoices_by_group.get(group_key)
        if invoice is None:
            invoice = await new_invoice(db, order.customer_id, "RECURRING", order.currency)
            invoice.order_id = order.id
            invoice.subscription_id = sub.id
            invoices_by_group[group_key] = invoice
            position_by_invoice[invoice.id] = 0
        pos = position_by_invoice[invoice.id]
        position_by_invoice[invoice.id] = pos + 1
        il = InvoiceLine(
            invoice_id=invoice.id,
            subscription_id=sub.id,
            position=pos,
            description=f"{line.description} ({m.cadence_label(plan.interval_months)}, {activation} to {period_end})",
            quantity=line.quantity,
            unit_price_minor=unit_price,
            net_minor=first.net_minor,
            tax_rate_bp=sub.tax_rate_bp,
            tax_minor=first.tax_minor,
            coverage_start=activation,
            coverage_end=period_end,
            line_type="PRORATION" if first.remaining_fraction < Decimal(1) else "RECURRING",
            charge_key=period_charge_key(sub.id, activation, period_end),
        )
        db.add(il)
        invoice.net_minor += first.net_minor
        invoice.tax_minor += first.tax_minor
        invoice.total_minor = invoice.net_minor + invoice.tax_minor
        await audit_service.record(
            db, actor, "SUBSCRIPTION_CREATED", "Subscription", sub.id,
            order_id=order.id,
            after={
                "reference": sub.reference,
                "quantity": str(line.quantity),
                "unitIntervalPriceMinor": unit_price,
                "intervalMonths": plan.interval_months,
                "periodStart": str(activation),
                "periodEnd": str(period_end),
            },
        )
    for invoice in invoices_by_group.values():
        invoice.status = "ISSUED"
        invoice.issue_date = business_today
        invoice.due_date = business_today + timedelta(days=INVOICE_DUE_DAYS)
        await outbox_writer.publish(
            db, outbox_writer.INVOICE_UPDATED, "Invoice", invoice.id,
            invoice.row_version or 0,
            {"orderId": str(order.id)},
            outbox_writer.deal_scope(order.customer_id, getattr(order, "owner_profile_id", None), None),
        )
    await db.flush()
    return subscription_ids, [inv.id for inv in invoices_by_group.values()]


async def charge_next_period(db: AsyncSession, sub: Subscription, actor: Actor) -> Invoice | None:
    coverage_start = sub.period_end
    anchor = sub.anchor_day if sub.anchor_day is not None else coverage_start.day
    coverage_end = m.next_boundary(coverage_start, anchor, sub.interval_months)
    if sub.status == "CANCEL_AT_PERIOD_END":
        sub.status = "CANCELED"
        sub.canceled_at = clock.now_utc()
        sub.next_bill_at = None
        await audit_service.record(
            db, None, "SUBSCRIPTION_ENDED", "Subscription", sub.id,
            after={"reason": "cancelled at period end"},
        )
        return None
    charge_key = period_charge_key(sub.id, coverage_start, coverage_end)
    existing = (await db.execute(select(InvoiceLine.id).where(InvoiceLine.charge_key == charge_key).limit(1))).first()
    if existing is not None:
        sub.period_start = coverage_start
        sub.period_end = coverage_end
        sub.next_bill_at = coverage_end
        return None
    net = int((Decimal(sub.quantity) * Decimal(sub.unit_interval_price_minor)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    tax = proration.tax_on(net, sub.tax_rate_bp or 0)
    invoice = await new_invoice(db, sub.customer_id, "RECURRING", sub.currency)
    invoice.subscription_id = sub.id
    invoice.order_id = sub.order_id
    line = InvoiceLine(
        invoice_id=invoice.id,
        subscription_id=sub.id,
        position=0,
        description=f"{m.cadence_label(sub.interval_months)} charge, {coverage_start} to {coverage_end}",
        quantity=sub.quantity,
        unit_price_minor=sub.unit_interval_price_minor,
        net_minor=net,
        tax_rate_bp=sub.tax_rate_bp or 0,
        tax_minor=tax,
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        line_type="RECURRING",
        charge_key=charge_key,
    )
    db.add(line)
    invoice.net_minor = net
    invoice.tax_minor = tax
    invoice.total_minor = net + tax
    today = clock.business_today()
    invoice.status = "ISSUED"
    invoice.issue_date = today
    invoice.due_date = today + timedelta(days=INVOICE_DUE_DAYS)
    sub.period_start = coverage_start
    sub.period_end = coverage_end
    sub.next_bill_at = coverage_end
    await db.flush()
    await audit_service.record(
        db, actor, "RECURRING_CHARGE_RAISED", "Invoice", invoice.id,
        after={
            "subscriptionId": str(sub.id),
            "coverageStart": str(coverage_start),
            "coverageEnd": str(coverage_end),
            "totalMinor": invoice.total_minor,
        },
    )
    await outbox_writer.publish(
        db, outbox_writer.INVOICE_UPDATED, "Invoice", invoice.id,
        invoice.row_version or 0,
        {"subscriptionId": str(sub.id)},
        outbox_writer.deal_scope(sub.customer_id, None, None),
    )
    return invoice


# ------------------------------------------------------------- reads ---

_INVOICE_SORTS = {"createdAt", "issueDate", "dueDate", "recordedAt"}
_INVOICE_COLS = {
    "createdAt": Invoice.created_at,
    "issueDate": Invoice.issue_date,
    "dueDate": Invoice.due_date,
    "recordedAt": Invoice.created_at,
}


async def _visible_invoice(db: AsyncSession, invoice: Invoice, actor: Actor) -> bool:
    if actor.role != "REP":
        return True
    if invoice.order_id is None:
        return False
    order = (await db.execute(select(Order).where(Order.id == invoice.order_id))).scalars().first()
    if order is None:
        return False
    return order.owner_profile_id == actor.profile_id


async def _visible_subscription(db: AsyncSession, sub: Subscription, actor: Actor) -> bool:
    if actor.role != "REP":
        return True
    order = (await db.execute(select(Order).where(Order.id == sub.order_id))).scalars().first()
    if order is None:
        return False
    return order.owner_profile_id == actor.profile_id


async def get_invoice(db: AsyncSession, actor: Actor, invoice_id: uuid.UUID) -> Invoice:
    invoice = (await db.execute(select(Invoice).where(Invoice.id == invoice_id))).scalars().first()
    if invoice is None:
        raise ApiException.not_found(f"Invoice {invoice_id}")
    if not await _visible_invoice(db, invoice, actor):
        raise ApiException.not_found(f"Invoice {invoice_id}")
    return invoice


async def list_invoices(
    db: AsyncSession,
    actor: Actor,
    *,
    customer_id: uuid.UUID | None = None,
    order_id: uuid.UUID | None = None,
    page: int | None = None,
    page_size: int | None = None,
    sort: str | None = None,
) -> tuple[list[Invoice], int, int, int]:
    from app.api.paging import page_size_or_default, parse_sort

    if order_id is not None:
        rows = (await db.execute(select(Invoice).where(Invoice.order_id == order_id))).scalars().all()
        visible = [r for r in rows if await _visible_invoice(db, r, actor)]
        return visible, 0, len(visible), len(visible)
    if customer_id is None:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "Filter invoices by customerId or orderId.")
    field, descending = parse_sort(sort, _INVOICE_SORTS, "createdAt")
    col = _INVOICE_COLS[field]
    order_col = col.desc() if descending else col.asc()
    pg = max(0, page or 0)
    size = page_size_or_default(page_size)
    total = (await db.execute(select(func.count()).select_from(Invoice).where(Invoice.customer_id == customer_id))).scalar_one()
    rows = (
        await db.execute(
            select(Invoice).where(Invoice.customer_id == customer_id).order_by(order_col).offset(pg * size).limit(size)
        )
    ).scalars().all()
    # REP masquerade drops rows but keeps DB total (PageResponse parity).
    visible = [r for r in rows if await _visible_invoice(db, r, actor)]
    return visible, pg, size, int(total)


async def get_subscription(db: AsyncSession, actor: Actor, subscription_id: uuid.UUID) -> Subscription:
    sub = (await db.execute(select(Subscription).where(Subscription.id == subscription_id))).scalars().first()
    if sub is None:
        raise ApiException.not_found(f"Subscription {subscription_id}")
    if not await _visible_subscription(db, sub, actor):
        raise ApiException.not_found(f"Subscription {subscription_id}")
    return sub


async def list_subscriptions(
    db: AsyncSession,
    actor: Actor,
    *,
    customer_id: uuid.UUID | None = None,
    order_id: uuid.UUID | None = None,
) -> list[Subscription]:
    if order_id is not None:
        rows = (await db.execute(select(Subscription).where(Subscription.order_id == order_id))).scalars().all()
    elif customer_id is not None:
        rows = (
            await db.execute(
                select(Subscription).where(Subscription.customer_id == customer_id).limit(100)
            )
        ).scalars().all()
    else:
        rows = []
    return [r for r in rows if await _visible_subscription(db, r, actor)]
