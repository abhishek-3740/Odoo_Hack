"""Sales reporting — port of reporting/service/ReportService.

Role scoping lives here, not in the controller: a rep's filter is forced to
their own id, a manager's to their team, so an export can never contain a row
the screen would not have shown. Four money figures are reported and never
added together (one-time sales, MRR, invoiced, collected).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import shared_math as m
from app.models.auth import Profile
from app.models.billing import Invoice, Payment
from app.models.catalog import Category, Customer, Product
from app.models.orders import Order, OrderLine
from app.models.quotes import Quote, QuoteRevision
from app.services.clock import billing_zone, business_today, now_utc

DEFAULT_CURRENCY = "INR"
MAX_EXPORT_ROWS = 1000


def _midnight_instant(day: date, zone: ZoneInfo) -> datetime:
    return datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)


def _str(value: UUID | None) -> str | None:
    return str(value) if value is not None else None


def _display_name(profile: Profile) -> str:
    return profile.full_name or profile.email


async def sales_report(
    db: AsyncSession, requested: dict[str, Any] | None, actor: Actor
) -> dict[str, Any]:
    flt = _scope(requested or {}, actor)
    today = business_today()
    from_day: date = flt["from"] or (today - timedelta(days=90))
    to_inclusive: date | None = flt["to"]
    to_exclusive: date = (to_inclusive + timedelta(days=1)) if to_inclusive else (today + timedelta(days=1))
    if not to_exclusive > from_day:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED,
            "The report end date must be on or after the start date.",
        )

    zone = billing_zone()
    from_instant = _midnight_instant(from_day, zone)
    to_instant = _midnight_instant(to_exclusive, zone)

    # ---- quotations, by creation date, current revision only ----
    quote_stmt = (
        select(Quote)
        .where(Quote.created_at >= from_instant, Quote.created_at < to_instant)
        .order_by(Quote.created_at.desc())
        .limit(MAX_EXPORT_ROWS)
    )
    if flt["ownerProfileId"] is not None:
        quote_stmt = quote_stmt.where(Quote.owner_profile_id == flt["ownerProfileId"])
    if flt["teamId"] is not None:
        quote_stmt = quote_stmt.where(Quote.team_id == flt["teamId"])
    quote_rows = (await db.execute(quote_stmt)).scalars().all()
    if flt["customerId"] is not None:
        quote_rows = [q for q in quote_rows if q.customer_id == flt["customerId"]]
    if flt["stage"] is not None:
        quote_rows = [q for q in quote_rows if q.stage.upper() == flt["stage"].upper()]

    rev_ids = {q.current_revision_id for q in quote_rows if q.current_revision_id}
    current: dict[UUID, QuoteRevision] = {}
    if rev_ids:
        for rev in (await db.execute(
                select(QuoteRevision).where(QuoteRevision.id.in_(rev_ids)))).scalars().all():
            current[rev.id] = rev

    people: dict[UUID, Profile] = {}
    owner_ids = {q.owner_profile_id for q in quote_rows}
    if owner_ids:
        for p in (await db.execute(
                select(Profile).where(Profile.id.in_(owner_ids)))).scalars().all():
            people[p.id] = p
    customers: dict[UUID, Customer] = {}
    customer_ids = {q.customer_id for q in quote_rows}
    if customer_ids:
        for c in (await db.execute(
                select(Customer).where(Customer.id.in_(customer_ids)))).scalars().all():
            customers[c.id] = c

    # ---- orders, by confirmation date ----
    order_stmt = (
        select(Order)
        .where(Order.confirmed_at >= from_instant, Order.confirmed_at < to_instant)
        .order_by(Order.confirmed_at.desc())
    )
    if flt["ownerProfileId"] is not None:
        order_stmt = order_stmt.where(Order.owner_profile_id == flt["ownerProfileId"])
    order_rows = [o for o in (await db.execute(order_stmt)).scalars().all()
                  if o.order_status == "CONFIRMED"]
    if flt["customerId"] is not None:
        order_rows = [o for o in order_rows if o.customer_id == flt["customerId"]]
    if flt["teamId"] is not None:
        order_rows = [o for o in order_rows
                      if _belongs_to_team(o, people, flt["teamId"])]
    lines: list[OrderLine] = []
    if order_rows:
        lines = (await db.execute(select(OrderLine).where(
            OrderLine.order_id.in_([o.id for o in order_rows])))).scalars().all()
    if flt["categoryId"] is not None:
        lines = [ln for ln in lines if ln.category_id == flt["categoryId"]]

    # ---- invoices by issue date, payments by recorded date ----
    invoice_stmt = (
        select(Invoice)
        .where(Invoice.issue_date >= from_day, Invoice.issue_date < to_exclusive)
        .order_by(Invoice.issue_date.desc())
    )
    if flt["customerId"] is not None:
        invoice_stmt = invoice_stmt.where(Invoice.customer_id == flt["customerId"])
    invoice_rows = (await db.execute(invoice_stmt)).scalars().all()
    invoice_rows = [i for i in invoice_rows if i.status not in ("DRAFT", "VOID")]
    if flt["ownerProfileId"] is not None:
        invoice_rows = [i for i in invoice_rows
                        if _owned_by(i, order_rows, flt["ownerProfileId"])]
    payment_stmt = (
        select(Payment)
        .where(Payment.recorded_at >= from_instant, Payment.recorded_at < to_instant)
        .order_by(Payment.recorded_at.desc())
    )
    if flt["customerId"] is not None:
        payment_stmt = payment_stmt.where(Payment.customer_id == flt["customerId"])
    payment_rows = (await db.execute(payment_stmt)).scalars().all()

    # ---- headline figures, kept separate on purpose ----
    one_time_sales = 0
    mrr_exact = Decimal(0)
    for ln in lines:
        if ln.line_kind == "ONE_TIME":
            one_time_sales += ln.net_minor or 0
        elif ln.interval_months:
            mrr_exact += (Decimal(ln.net_minor or 0)
                          * m.monthly_normalisation_factor(ln.interval_months))
    mrr_minor = int(mrr_exact.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    invoiced = sum(i.total_minor or 0 for i in invoice_rows)
    outstanding = sum(max(0, (i.total_minor or 0) - (i.credited_minor or 0)
                          - (i.paid_minor or 0)) for i in invoice_rows)
    collected = sum(p.amount_minor or 0 for p in payment_rows)

    return {
        "filter": {
            "from": from_day.isoformat(),
            "to": (to_exclusive - timedelta(days=1)).isoformat(),
            "ownerProfileId": _str(flt["ownerProfileId"]),
            "teamId": _str(flt["teamId"]),
            "customerId": _str(flt["customerId"]),
            "stage": flt["stage"],
            "categoryId": _str(flt["categoryId"]),
        },
        "currency": DEFAULT_CURRENCY,
        "generatedAt": now_utc().isoformat(),
        "quotationCount": len(quote_rows),
        "orderCount": len(order_rows),
        "invoiceCount": len(invoice_rows),
        "paymentCount": len(payment_rows),
        "oneTimeSales": m.to_major(one_time_sales),
        "monthlyRecurringRevenue": m.to_major(mrr_minor),
        "invoicedRevenue": m.to_major(invoiced),
        "cashCollected": m.to_major(collected),
        "outstandingReceivables": m.to_major(outstanding),
        "pipeline": _pipeline(quote_rows, current),
        "byRep": await _by_rep(db, quote_rows, current, order_rows, lines, people),
        "byCategory": await _by_category(db, lines),
        "topProducts": await _top_products(db, lines),
        "quotations": _quote_rows(quote_rows, current, people, customers, zone),
    }


def _scope(requested: dict[str, Any], actor: Actor) -> dict[str, Any]:
    flt = {
        "from": requested.get("from"),
        "to": requested.get("to"),
        "ownerProfileId": requested.get("ownerProfileId"),
        "teamId": requested.get("teamId"),
        "customerId": requested.get("customerId"),
        "stage": requested.get("stage"),
        "categoryId": requested.get("categoryId"),
    }
    if actor.role == "REP":
        flt["ownerProfileId"] = actor.profile_id
        flt["teamId"] = None
    elif actor.role == "MANAGER":
        flt["teamId"] = actor.team_id if actor.team_id is not None else flt["teamId"]
    elif actor.role in ("FINANCE", "ADMIN"):
        pass
    elif actor.role == "CUSTOMER":
        raise ApiException(ErrorCode.FORBIDDEN, "Reports are not available on the portal.")
    else:
        raise ApiException(ErrorCode.FORBIDDEN, "You do not have access to this action.")
    return flt


def _belongs_to_team(order: Order, people: dict[UUID, Profile], team_id: UUID) -> bool:
    owner = people.get(order.owner_profile_id)
    return owner is not None and owner.team_id == team_id


def _owned_by(invoice: Invoice, order_rows: list[Order], owner_id: UUID) -> bool:
    if invoice.order_id is None:
        return False
    return any(o.id == invoice.order_id and o.owner_profile_id == owner_id
               for o in order_rows)


def _pipeline(quote_rows, current) -> list[dict[str, Any]]:
    buckets: dict[str, list] = defaultdict(lambda: [0, 0])
    for q in quote_rows:
        bucket = buckets[q.stage]
        bucket[0] += 1
        rev = current.get(q.current_revision_id) if q.current_revision_id else None
        if rev is not None:
            bucket[1] += rev.one_time_net_minor or 0
    return [{"stage": stage, "count": n, "oneTimeNet": m.to_major(net)}
            for stage, (n, net) in buckets.items() if n > 0]


async def _by_rep(db, quote_rows, current, order_rows, lines, people):
    quotes_by_owner: dict[UUID, list] = defaultdict(list)
    for q in quote_rows:
        quotes_by_owner[q.owner_profile_id].append(q)
    orders_by_owner: dict[UUID, list] = defaultdict(list)
    order_owner: dict[UUID, UUID] = {}
    for o in order_rows:
        orders_by_owner[o.owner_profile_id].append(o)
        order_owner[o.id] = o.owner_profile_id
    owners = set(quotes_by_owner) | set(orders_by_owner)
    rows = []
    for owner_id in owners:
        owner_quotes = quotes_by_owner.get(owner_id, [])
        owner_orders = orders_by_owner.get(owner_id, [])
        one_time = 0
        mrr = Decimal(0)
        for ln in lines:
            if order_owner.get(ln.order_id) != owner_id:
                continue
            if ln.line_kind == "ONE_TIME":
                one_time += ln.net_minor or 0
            elif ln.interval_months:
                mrr += Decimal(ln.net_minor or 0) * m.monthly_normalisation_factor(
                    ln.interval_months)
        discount_sum = Decimal(0)
        discount_count = 0
        for q in owner_quotes:
            rev = current.get(q.current_revision_id) if q.current_revision_id else None
            if rev is not None and (rev.total_base_minor or 0) > 0:
                discount_sum += (Decimal(rev.total_discount_minor or 0) * 100
                                 / Decimal(rev.total_base_minor)).quantize(
                                     Decimal("0.0001"), rounding=ROUND_HALF_UP)
                discount_count += 1
        owner = people.get(owner_id)
        if owner is None:
            owner = (await db.execute(
                select(Profile).where(Profile.id == owner_id))).scalars().first()
        rows.append({
            "ownerProfileId": str(owner_id),
            "ownerName": _display_name(owner) if owner else "Unknown",
            "quotations": len(owner_quotes),
            "orders": len(owner_orders),
            "oneTimeSales": m.to_major(one_time),
            "monthlyRecurringRevenue": m.to_major(
                int(mrr.quantize(Decimal("1"), rounding=ROUND_HALF_UP))),
            "averageDiscountPercent": (discount_sum / discount_count).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP) if discount_count else None,
        })
    rows.sort(key=lambda r: r["oneTimeSales"], reverse=True)
    return rows


async def _by_category(db, lines) -> list[dict[str, Any]]:
    categories = {c.id: c for c in
                  (await db.execute(select(Category))).scalars().all()}
    totals: dict[UUID, list] = defaultdict(lambda: [0, 0, 0, 0])
    for ln in lines:
        bucket = totals[ln.category_id]
        cost = int((ln.quantity * Decimal(ln.unit_cost_minor or 0)).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP))
        if ln.line_kind == "ONE_TIME":
            bucket[0] += ln.net_minor or 0
        else:
            bucket[1] += ln.net_minor or 0
        bucket[2] += (ln.net_minor or 0) - cost
        bucket[3] += 1
    rows = []
    for cat_id, (one, rec, contrib, n) in totals.items():
        cat = categories.get(cat_id)
        rows.append({
            "categoryId": str(cat_id),
            "categoryCode": cat.code if cat else "UNKNOWN",
            "categoryName": cat.name if cat else "Unknown",
            "oneTimeSales": m.to_major(one),
            "recurringFirstCycle": m.to_major(rec),
            "contribution": m.to_major(contrib),
            "contributionPercent": m.percent_of(contrib, one + rec),
            "lines": n,
        })
    rows.sort(key=lambda r: r["oneTimeSales"], reverse=True)
    return rows


async def _top_products(db, lines) -> list[dict[str, Any]]:
    product_ids = {ln.product_id for ln in lines}
    products = {}
    if product_ids:
        for p in (await db.execute(
                select(Product).where(Product.id.in_(product_ids)))).scalars().all():
            products[p.id] = p
    totals: dict[UUID, list] = {}
    for ln in lines:
        bucket = totals.setdefault(ln.product_id, [Decimal(0), 0, set()])
        bucket[0] += ln.quantity
        bucket[1] += ln.net_minor or 0
        bucket[2].add(ln.order_id)
    rows = []
    for prod_id, (qty, net, order_ids) in totals.items():
        prod = products.get(prod_id)
        rows.append({
            "productId": str(prod_id),
            "productCode": prod.code if prod else "?",
            "productName": prod.name if prod else "Unknown",
            "quantity": qty,
            "net": m.to_major(net),
            "orders": len(order_ids),
        })
    rows.sort(key=lambda r: r["net"], reverse=True)
    return rows[:10]


def _quote_rows(quote_rows, current, people, customers, zone) -> list[dict[str, Any]]:
    out = []
    for q in quote_rows:
        rev = current.get(q.current_revision_id) if q.current_revision_id else None
        owner = people.get(q.owner_profile_id)
        customer = customers.get(q.customer_id)
        out.append({
            "quoteId": str(q.id),
            "reference": q.reference,
            "customerName": customer.name if customer else "?",
            "ownerName": _display_name(owner) if owner else "?",
            "stage": q.stage,
            "approvalStatus": rev.approval_status if rev else "NOT_EVALUATED",
            "currency": rev.currency if rev else "INR",
            "oneTimeNet": m.to_major(rev.one_time_net_minor or 0) if rev else Decimal("0.00"),
            "recurringFirstCycleNet": m.to_major(
                rev.recurring_first_cycle_net_minor or 0) if rev else Decimal("0.00"),
            "contributionPercent": rev.margin_percent if rev else None,
            "createdOn": q.created_at.astimezone(zone).date().isoformat()
            if q.created_at else None,
        })
    return out
