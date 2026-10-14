"""Order finalization — port of orders/service/OrderFinalizationService.java.

The transaction coordinator: turns an accepted quotation into an order.
Creating the order, holding the stock and raising the first invoice succeed
or fail together in the caller's transaction (NEVER commit here).

Billing note: initialize_billing_for_order is intentionally LOCAL to this
module. The billing domain may later replace it with its own service; the
name is kept explicit so the takeover is a clean swap.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import shared_math as m
from app.engines.allocation_engine import (
    AllocationInput,
    Availability,
    Demand,
    Mode,
    WarehouseInfo,
    allocate,
)
from app.engines import proration_calculator as proration
from app.engines.commercial_hash import commercial_hash
from app.models.billing import Invoice, InvoiceLine, Subscription
from app.models.catalog import ProductVariant, SubscriptionPlan
from app.models.fulfillment import (
    Backorder,
    Reservation,
    Shipment,
    ShipmentLine,
    StockLevel,
    Warehouse,
)
from app.models.orders import Order, OrderLine
from app.models.quotes import Quote, QuoteLine, QuoteRevision
from app.repositories.sequences import (
    INVOICE_NUMBER_SEQ,
    ORDER_REFERENCE_SEQ,
    nextval,
)
from app.services import audit_service as audit
from app.services import outbox_writer as outbox
from app.services.clock import business_today, now_utc

APPROVALS_THAT_CLEAR = ("NOT_REQUIRED", "APPROVED")
EXTRA_SHIPMENT_PENALTY_MINOR = 5000
EXHAUSTIVE_WAREHOUSE_LIMIT = 8
INVOICE_DUE_DAYS = 15


async def hook_gates_cleared(db: AsyncSession, actor: Actor, quote_id: uuid.UUID) -> dict:
    """Gate-listener entry point: re-reads every gate, finalizes or WAITINGs."""
    return await try_finalize(db, actor, quote_id)


# Java-name alias: quotes/portal gate listeners call onGatesPossiblyCleared.
async def on_gates_possibly_cleared(
    db: AsyncSession, actor: Actor, quote_id: uuid.UUID
) -> dict:
    return await hook_gates_cleared(db, actor, quote_id)


async def try_finalize(db: AsyncSession, actor: Actor, quote_id: uuid.UUID) -> dict:
    quote = (
        await db.execute(
            select(Quote).where(Quote.id == quote_id).with_for_update()
        )
    ).scalars().first()
    if quote is None:
        raise ApiException.not_found(f"Quotation {quote_id}")

    existing = (
        await db.execute(select(Order).where(Order.quote_id == quote_id))
    ).scalars().first()
    if existing is not None:
        return {
            "status": "ALREADY_FINALIZED",
            "orderId": existing.id,
            "reference": existing.reference,
        }

    revision = (
        await db.execute(
            select(QuoteRevision).where(QuoteRevision.id == quote.current_revision_id)
        )
    ).scalars().first()
    if revision is None:
        raise ApiException.not_found(f"Current revision of quotation {quote_id}")

    blocking = _blocking_reasons(quote, revision)
    if blocking:
        return {"status": "WAITING", "reasons": blocking}

    lines = (
        await db.execute(
            select(QuoteLine)
            .where(QuoteLine.revision_id == revision.id)
            .order_by(QuoteLine.position)
        )
    ).scalars().all()
    if not lines:
        raise ApiException(ErrorCode.EMPTY_QUOTE)

    current_hash = commercial_hash(
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
    if (
        revision.customer_accepted_hash is not None
        and revision.customer_accepted_hash != current_hash
    ):
        raise ApiException.of(
            ErrorCode.ACCEPTANCE_HASH_MISMATCH,
            "These terms changed after the customer accepted them. "
            "A fresh acceptance is needed.",
            acceptedHash=revision.customer_accepted_hash,
            currentHash=current_hash,
        )

    now = now_utc()
    order = Order(
        reference=f"SO-{await nextval(db, ORDER_REFERENCE_SEQ)}",
        quote_id=quote.id,
        revision_id=revision.id,
        customer_id=quote.customer_id,
        owner_profile_id=quote.owner_profile_id,
        currency=revision.currency,
        order_status="CONFIRMED",
        fulfillment_status="UNALLOCATED",
        billing_status="PENDING",
        backorder_terms=revision.backorder_terms,
        one_time_net_minor=revision.one_time_net_minor,
        one_time_tax_minor=revision.one_time_tax_minor,
        confirmed_at=now,
    )
    db.add(order)
    await db.flush()

    created_lines: list[OrderLine] = []
    for ln in lines:
        copy = OrderLine(
            order_id=order.id,
            quote_line_id=ln.id,
            line_key=ln.line_key,
            position=ln.position,
            line_kind=ln.line_kind,
            product_id=ln.product_id,
            category_id=ln.category_id,
            variant_id=ln.variant_id,
            plan_id=ln.plan_id,
            description=ln.description,
            quantity=ln.quantity,
            unit_price_minor=ln.unit_price_minor,
            unit_cost_minor=ln.unit_cost_minor,
            tax_rate_bp=ln.tax_rate_bp,
            effective_discount_bp=ln.effective_discount_bp,
            net_minor=ln.net_minor,
            tax_minor=ln.tax_minor,
            interval_months=ln.interval_months,
            requires_stock=ln.requires_stock,
            promised_date=ln.promised_date,
        )
        db.add(copy)
        created_lines.append(copy)
    await db.flush()

    stocked = [ln for ln in created_lines if ln.requires_stock and ln.variant_id]
    has_shortage = False
    shortage_count = 0
    if not stocked:
        order.fulfillment_status = "NOT_REQUIRED"
    else:
        plan = await _reserve_for_order(db, actor, order, created_lines, stocked, now)
        has_shortage = plan.has_shortage()
        shortage_count = len(plan.shortages)

    billing = await initialize_billing_for_order(
        db,
        actor,
        order,
        created_lines,
        revision.invoicing_terms,
        revision.requested_activation_date,
    )

    quote.stage = "CONFIRMED"
    quote.last_activity_at = now
    quote.last_progress_at = now
    quote.awaiting_external_since = None
    revision.status = "SUBMITTED"

    await audit.record(
        db,
        actor,
        "ORDER_CREATED",
        "Order",
        order.id,
        quote_id=quote.id,
        revision_id=revision.id,
        order_id=order.id,
        after={
            "reference": order.reference,
            "oneTimeNetMinor": order.one_time_net_minor,
            "subscriptions": len(billing["subscriptionIds"]),
            "shortages": shortage_count,
        },
    )
    await outbox.publish(
        db,
        outbox.ORDER_CREATED,
        "Order",
        order.id,
        order.row_version,
        {"quoteId": str(quote.id), "reference": order.reference},
        outbox.deal_scope(quote.customer_id, quote.owner_profile_id, quote.team_id),
    )
    if has_shortage:
        await outbox.publish(
            db,
            outbox.BACKORDER_UPDATED,
            "Order",
            order.id,
            order.row_version,
            {"shortages": shortage_count},
            outbox.deal_scope(
                quote.customer_id, quote.owner_profile_id, quote.team_id
            ),
        )

    return {
        "status": "FINALIZED",
        "orderId": order.id,
        "reference": order.reference,
        "hasShortage": has_shortage,
        "oneTimeInvoiceId": billing["oneTimeInvoiceId"],
    }


def _blocking_reasons(quote: Quote, revision: QuoteRevision) -> list[str]:
    if quote.stage == "CANCELED":
        return ["This quotation was cancelled."]
    blocking: list[str] = []
    if revision.status != "SUBMITTED":
        blocking.append("The current version has not been submitted.")
    if revision.approval_status not in APPROVALS_THAT_CLEAR:
        blocking.append(
            f"Approval is not complete ({revision.approval_status})."
        )
    if quote.owner_profile_id is None:
        blocking.append("The quotation has no seller.")
    if quote.customer_id is None:
        blocking.append("The quotation has no customer.")
    if revision.seller_adopted_at is None:
        blocking.append("The sales rep has not adopted these terms.")
    if revision.customer_accepted_at is None:
        blocking.append("The customer has not accepted these terms.")
    if quote.valid_until is not None and business_today() > quote.valid_until:
        blocking.append("This quotation passed its validity date.")
    return blocking


async def _reserve_for_order(
    db: AsyncSession,
    actor: Actor,
    order: Order,
    created_lines: list[OrderLine],
    stocked: list[OrderLine],
    now,
):
    variant_ids = {ln.variant_id for ln in stocked}
    rows = (
        await db.execute(
            select(StockLevel)
            .where(StockLevel.variant_id.in_(variant_ids))
            .order_by(StockLevel.variant_id, StockLevel.warehouse_id)
            .with_for_update()
        )
    ).scalars().all()
    locked = {(r.variant_id, r.warehouse_id): r for r in rows}

    warehouses = (
        await db.execute(
            select(Warehouse)
            .where(Warehouse.is_active.is_(True))
            .order_by(Warehouse.sort_order, Warehouse.code)
        )
    ).scalars().all()
    variants = (
        await db.execute(
            select(ProductVariant).where(ProductVariant.id.in_(variant_ids))
        )
    ).scalars().all()
    weight_by_variant = {v.id: v.weight_grams or 0 for v in variants}

    demands = [
        Demand(
            ln.line_key,
            ln.id,
            ln.variant_id,
            ln.description,
            ln.quantity,
            weight_by_variant.get(ln.variant_id, 0),
        )
        for ln in stocked
    ]
    availability = [
        Availability(r.warehouse_id, r.variant_id, r.on_hand - r.reserved)
        for r in locked.values()
    ]
    try:
        mode = Mode(get_settings().allocation_mode)
    except ValueError:
        mode = Mode.BALANCED
    plan = allocate(
        AllocationInput(
            demands,
            availability,
            [
                WarehouseInfo(
                    w.id,
                    w.code,
                    w.name,
                    w.shipping_fixed_cost_minor,
                    w.shipping_cost_per_kg_minor,
                    w.sort_order,
                )
                for w in warehouses
            ],
            mode,
            EXTRA_SHIPMENT_PENALTY_MINOR,
            EXHAUSTIVE_WAREHOUSE_LIMIT,
        )
    )
    if plan.has_shortage() and order.backorder_terms == "IN_STOCK_ONLY":
        raise ApiException.of(
            ErrorCode.INSUFFICIENT_STOCK,
            "There is not enough stock to fulfil this order completely, and it "
            "was accepted on in-stock-only terms.",
            shortages=len(plan.shortages),
        )

    await _apply_plan(db, order, created_lines, plan, locked, warehouses, now)

    await audit.record(
        db,
        actor,
        "ORDER_ALLOCATED",
        "Order",
        order.id,
        order_id=order.id,
        after={
            "shipments": plan.shipment_count,
            "shortages": len(plan.shortages),
            "estimatedShippingCostMinor": plan.estimated_shipping_cost_minor,
        },
    )
    return plan


async def _apply_plan(
    db: AsyncSession,
    order: Order,
    created_lines: list[OrderLine],
    plan,
    locked: dict,
    warehouses: list,
    now,
) -> None:
    from app.services import fulfillment_service as _fs

    lines_by_id = {ln.id: ln for ln in created_lines}
    open_shipments = (
        await db.execute(
            select(Shipment).where(
                Shipment.order_id == order.id,
                Shipment.status.in_(("DRAFT", "RESERVED")),
            )
        )
    ).scalars().all()
    shipment_by_warehouse = {s.warehouse_id: s for s in open_shipments}
    fixed_by_warehouse = {w.id: w.shipping_fixed_cost_minor for w in warehouses}

    for alloc in plan.allocations:
        order_line = lines_by_id.get(alloc.order_line_id)
        if order_line is None:
            continue
        level = locked.get((alloc.variant_id, alloc.warehouse_id))
        if level is None:
            raise ApiException(
                ErrorCode.INSUFFICIENT_STOCK,
                f'Stock for "{alloc.description}" is no longer available at '
                f"{alloc.warehouse_name}.",
            )
        if (level.on_hand - level.reserved) < alloc.quantity:
            raise ApiException(
                ErrorCode.INSUFFICIENT_STOCK,
                f'Stock for "{alloc.description}" changed while the order was '
                "being confirmed. Try again.",
            )
        level.reserved = level.reserved + alloc.quantity

        shipment = shipment_by_warehouse.get(alloc.warehouse_id)
        if shipment is None:
            shipment = Shipment(
                order_id=order.id,
                warehouse_id=alloc.warehouse_id,
                status="RESERVED",
                estimated_cost_minor=fixed_by_warehouse.get(
                    alloc.warehouse_id, 0
                ),
            )
            db.add(shipment)
            await db.flush()
            shipment_by_warehouse[alloc.warehouse_id] = shipment

        shipment_line = (
            await db.execute(
                select(ShipmentLine).where(
                    ShipmentLine.shipment_id == shipment.id,
                    ShipmentLine.order_line_id == order_line.id,
                )
            )
        ).scalars().first()
        if shipment_line is None:
            shipment_line = ShipmentLine(
                shipment_id=shipment.id,
                order_line_id=order_line.id,
                variant_id=alloc.variant_id,
                quantity=alloc.quantity,
            )
            db.add(shipment_line)
            await db.flush()
        else:
            shipment_line.quantity = shipment_line.quantity + alloc.quantity

        db.add(
            Reservation(
                order_id=order.id,
                order_line_id=order_line.id,
                shipment_line_id=shipment_line.id,
                warehouse_id=alloc.warehouse_id,
                variant_id=alloc.variant_id,
                quantity=alloc.quantity,
                status="HELD",
            )
        )

    for shortage in plan.shortages:
        order_line = lines_by_id.get(shortage.order_line_id)
        if order_line is None:
            continue
        expected = None
        for (variant_id, _warehouse_id), level in locked.items():
            if variant_id == shortage.variant_id and level.expected_receipt_date:
                if expected is None or level.expected_receipt_date < expected:
                    expected = level.expected_receipt_date
        db.add(
            Backorder(
                order_id=order.id,
                order_line_id=order_line.id,
                variant_id=shortage.variant_id,
                quantity=shortage.quantity,
                expected_date=expected,
                status="OPEN",
            )
        )

    await _fs.recompute_fulfillment_status(db, order, created_lines)


def _discounted_unit_price(net_minor: int, quantity: Decimal) -> int:
    """Frozen discounted unit price: round(net / qty) HALF_UP, never from float."""
    if quantity is None or quantity == 0:
        return 0
    return int(
        (Decimal(net_minor) / quantity).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    )


async def initialize_billing_for_order(
    db: AsyncSession,
    actor: Actor,
    order: Order,
    order_lines: list[OrderLine],
    invoicing_terms: str,
    requested_activation_date: date | None,
) -> dict:
    """Local billing setup for a confirmed order (see module docstring)."""
    today = business_today()
    activation = requested_activation_date or today
    if activation < today:
        raise ApiException.of(
            ErrorCode.BACKDATED_CHANGE_REJECTED,
            "The requested activation date has passed. Re-quote with a current "
            "start date.",
            requestedActivationDate=activation.isoformat(),
            businessDate=today.isoformat(),
        )
    due = today + timedelta(days=INVOICE_DUE_DAYS)

    one_time = sorted(
        (ln for ln in order_lines if ln.line_kind == "ONE_TIME"),
        key=lambda ln: ln.position,
    )
    one_time_invoice_id = None
    if one_time:
        invoice_no = await nextval(db, INVOICE_NUMBER_SEQ)
        invoice = Invoice(
            invoice_no=invoice_no,
            reference=f"INV-{invoice_no}",
            customer_id=order.customer_id,
            order_id=order.id,
            invoice_kind="ONE_TIME",
            currency=order.currency,
            status="DRAFT",
            net_minor=0,
            tax_minor=0,
            total_minor=0,
            credited_minor=0,
            paid_minor=0,
        )
        db.add(invoice)
        await db.flush()
        for position, line in enumerate(one_time):
            db.add(
                InvoiceLine(
                    invoice_id=invoice.id,
                    order_line_id=line.id,
                    position=position,
                    description=line.description,
                    quantity=line.quantity,
                    unit_price_minor=line.unit_price_minor,
                    net_minor=line.net_minor,
                    tax_rate_bp=line.tax_rate_bp,
                    tax_minor=line.tax_minor,
                    line_type="ONE_TIME",
                    charge_key=f"order-line:{line.id}|ONE_TIME|base",
                )
            )
            invoice.net_minor += line.net_minor
            invoice.tax_minor += line.tax_minor
        invoice.total_minor = invoice.net_minor + invoice.tax_minor
        if invoicing_terms == "ON_CONFIRMATION":
            invoice.status = "ISSUED"
            invoice.issue_date = today
            invoice.due_date = due
        await audit.record(
            db,
            actor,
            "INVOICE_ISSUED",
            "Invoice",
            invoice.id,
            order_id=order.id,
            after={
                "reference": invoice.reference,
                "totalMinor": invoice.total_minor,
                "kind": "ONE_TIME",
            },
        )
        await outbox.publish(
            db,
            outbox.INVOICE_UPDATED,
            "Invoice",
            invoice.id,
            invoice.row_version,
            {"orderId": str(order.id)},
            outbox.deal_scope(order.customer_id, order.owner_profile_id, None),
        )
        one_time_invoice_id = invoice.id

    recurring = sorted(
        (
            ln
            for ln in order_lines
            if ln.line_kind == "RECURRING" and ln.plan_id is not None
        ),
        key=lambda ln: ln.position,
    )
    subscription_ids: list[uuid.UUID] = []
    recurring_invoice_ids: list[uuid.UUID] = []
    if recurring:
        plans = (
            await db.execute(
                select(SubscriptionPlan).where(
                    SubscriptionPlan.id.in_({ln.plan_id for ln in recurring})
                )
            )
        ).scalars().all()
        plans_by_id = {p.id: p for p in plans}

        invoices_by_group: dict[str, Invoice] = {}
        position_by_invoice: dict[uuid.UUID, int] = {}
        for line in recurring:
            plan = plans_by_id.get(line.plan_id)
            if plan is None:
                raise ApiException.not_found(f"Subscription plan {line.plan_id}")
            anchor_day = (
                1
                if plan.billing_anchor == "CALENDAR_MONTH_START"
                else activation.day
            )
            period_end = m.first_period_end(
                activation, anchor_day, plan.interval_months
            )
            unit_price = _discounted_unit_price(line.net_minor, line.quantity)
            subscription = Subscription(
                reference=f"SUB-{uuid.uuid4().hex[:8].upper()}",
                order_id=order.id,
                order_line_id=line.id,
                customer_id=order.customer_id,
                plan_id=plan.id,
                currency=order.currency,
                quantity=line.quantity,
                unit_interval_price_minor=unit_price,
                unit_interval_cost_minor=plan.interval_cost_minor,
                tax_rate_bp=line.tax_rate_bp,
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
            db.add(subscription)
            await db.flush()
            subscription_ids.append(subscription.id)

            first_charge = proration.first_period_charge(
                line.quantity,
                subscription.unit_interval_price_minor,
                activation,
                period_end,
                anchor_day,
                plan.interval_months,
                subscription.tax_rate_bp,
            )
            group_key = (
                f"{plan.interval_months}|{activation.isoformat()}|"
                f"{period_end.isoformat()}"
            )
            invoice = invoices_by_group.get(group_key)
            if invoice is None:
                invoice_no = await nextval(db, INVOICE_NUMBER_SEQ)
                invoice = Invoice(
                    invoice_no=invoice_no,
                    reference=f"INV-{invoice_no}",
                    customer_id=order.customer_id,
                    order_id=order.id,
                    subscription_id=subscription.id,
                    invoice_kind="RECURRING",
                    currency=order.currency,
                    status="DRAFT",
                    net_minor=0,
                    tax_minor=0,
                    total_minor=0,
                    credited_minor=0,
                    paid_minor=0,
                )
                db.add(invoice)
                await db.flush()
                invoices_by_group[group_key] = invoice
                position_by_invoice[invoice.id] = 0
            position = position_by_invoice[invoice.id]
            position_by_invoice[invoice.id] = position + 1
            db.add(
                InvoiceLine(
                    invoice_id=invoice.id,
                    subscription_id=subscription.id,
                    position=position,
                    description=(
                        f"{line.description} "
                        f"({m.cadence_label(plan.interval_months)}, "
                        f"{activation.isoformat()} to {period_end.isoformat()})"
                    ),
                    quantity=line.quantity,
                    unit_price_minor=subscription.unit_interval_price_minor,
                    net_minor=first_charge.net_minor,
                    tax_rate_bp=subscription.tax_rate_bp,
                    tax_minor=first_charge.tax_minor,
                    coverage_start=activation,
                    coverage_end=period_end,
                    line_type=(
                        "PRORATION"
                        if first_charge.remaining_fraction < Decimal(1)
                        else "RECURRING"
                    ),
                    charge_key=(
                        f"sub:{subscription.id}|{activation.isoformat()}|"
                        f"{period_end.isoformat()}|RECURRING|base"
                    ),
                )
            )
            invoice.net_minor += first_charge.net_minor
            invoice.tax_minor += first_charge.tax_minor

            await audit.record(
                db,
                actor,
                "SUBSCRIPTION_CREATED",
                "Subscription",
                subscription.id,
                order_id=order.id,
                after={
                    "reference": subscription.reference,
                    "quantity": str(line.quantity),
                    "unitIntervalPriceMinor": subscription.unit_interval_price_minor,
                    "intervalMonths": plan.interval_months,
                    "periodStart": activation.isoformat(),
                    "periodEnd": period_end.isoformat(),
                },
            )

        for invoice in invoices_by_group.values():
            invoice.total_minor = invoice.net_minor + invoice.tax_minor
            invoice.status = "ISSUED"
            invoice.issue_date = today
            invoice.due_date = due
            await audit.record(
                db,
                actor,
                "INVOICE_ISSUED",
                "Invoice",
                invoice.id,
                order_id=order.id,
                after={
                    "reference": invoice.reference,
                    "totalMinor": invoice.total_minor,
                    "kind": "RECURRING",
                },
            )
            await outbox.publish(
                db,
                outbox.INVOICE_UPDATED,
                "Invoice",
                invoice.id,
                invoice.row_version,
                {"orderId": str(order.id)},
                outbox.deal_scope(order.customer_id, order.owner_profile_id, None),
            )
            recurring_invoice_ids.append(invoice.id)
        for subscription_id in subscription_ids:
            subscription = (
                await db.execute(
                    select(Subscription).where(Subscription.id == subscription_id)
                )
            ).scalars().first()
            await outbox.publish(
                db,
                outbox.SUBSCRIPTION_UPDATED,
                "Subscription",
                subscription_id,
                subscription.row_version if subscription else 0,
                {
                    "orderId": str(order.id),
                    "reference": subscription.reference if subscription else None,
                },
                outbox.deal_scope(order.customer_id, order.owner_profile_id, None),
            )

    order.billing_status = "INITIALIZED"
    return {
        "oneTimeInvoiceId": one_time_invoice_id,
        "subscriptionIds": subscription_ids,
        "recurringInvoiceIds": recurring_invoice_ids,
    }
