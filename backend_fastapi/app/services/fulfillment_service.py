"""Fulfillment operations — port of fulfillment/service/{AllocationService,
StockOperationsService, StockAvailabilityService}.java and the read models of
fulfillment/controller/FulfillmentController.java.

Preview reads without locking; every mutation re-reads its stock rows under
SELECT ... FOR UPDATE in stable (variant_id, warehouse_id) order. Services
are async fns (db, actor, ...) first and NEVER commit.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, select
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
from app.models.catalog import Product, ProductVariant
from app.models.fulfillment import (
    Backorder,
    Reservation,
    Shipment,
    ShipmentLine,
    StockLevel,
    StockMovement,
    Warehouse,
)
from app.models.orders import Order, OrderLine
from app.services import audit_service as audit
from app.services import outbox_writer as outbox
from app.services.clock import now_utc

OPEN_SHIPMENTS = ("DRAFT", "RESERVED")
EXTRA_SHIPMENT_PENALTY_MINOR = 5000
EXHAUSTIVE_WAREHOUSE_LIMIT = 8


# ------------------------------------------------------------------ helpers


def _mode() -> Mode:
    try:
        return Mode(get_settings().allocation_mode)
    except ValueError:
        return Mode.BALANCED


async def _active_warehouses(db: AsyncSession) -> list[Warehouse]:
    return (
        await db.execute(
            select(Warehouse)
            .where(Warehouse.is_active.is_(True))
            .order_by(Warehouse.sort_order, Warehouse.code)
        )
    ).scalars().all()


def _warehouse_infos(warehouses: list[Warehouse]) -> list[WarehouseInfo]:
    return [
        WarehouseInfo(
            w.id,
            w.code,
            w.name,
            w.shipping_fixed_cost_minor,
            w.shipping_cost_per_kg_minor,
            w.sort_order,
        )
        for w in warehouses
    ]


async def _weights(db: AsyncSession, variant_ids: set) -> dict:
    if not variant_ids:
        return {}
    rows = (
        await db.execute(
            select(ProductVariant).where(ProductVariant.id.in_(variant_ids))
        )
    ).scalars().all()
    return {v.id: v.weight_grams or 0 for v in rows}


async def _order_lines(db: AsyncSession, order_id: uuid.UUID) -> list[OrderLine]:
    return (
        await db.execute(
            select(OrderLine)
            .where(OrderLine.order_id == order_id)
            .order_by(OrderLine.position)
        )
    ).scalars().all()


async def _locked_stock(
    db: AsyncSession, variant_ids: set
) -> dict[tuple, StockLevel]:
    rows = (
        await db.execute(
            select(StockLevel)
            .where(StockLevel.variant_id.in_(variant_ids))
            .order_by(StockLevel.variant_id, StockLevel.warehouse_id)
            .with_for_update()
        )
    ).scalars().all()
    return {(r.variant_id, r.warehouse_id): r for r in rows}


async def _own_held(
    db: AsyncSession, order_id: uuid.UUID
) -> dict[tuple, Decimal]:
    """HELD qty per (variant_id, warehouse_id) for one order."""
    rows = (
        await db.execute(
            select(Reservation).where(
                Reservation.order_id == order_id,
                Reservation.status == "HELD",
            )
        )
    ).scalars().all()
    totals: dict[tuple, Decimal] = {}
    for r in rows:
        key = (r.variant_id, r.warehouse_id)
        totals[key] = totals.get(key, Decimal(0)) + r.quantity
    return totals


async def _dispatched_by_line(db: AsyncSession, order_id: uuid.UUID) -> dict:
    rows = (
        await db.execute(
            select(Reservation).where(
                Reservation.order_id == order_id,
                Reservation.status == "CONSUMED",
            )
        )
    ).scalars().all()
    totals: dict = {}
    for r in rows:
        totals[r.order_line_id] = totals.get(r.order_line_id, Decimal(0)) + r.quantity
    return totals


async def recompute_fulfillment_status(
    db: AsyncSession, order: Order, order_lines: list[OrderLine]
) -> None:
    """Derives fulfillment status from HELD/CONSUMED sums, never by hand."""
    stocked = [ln for ln in order_lines if ln.requires_stock and ln.variant_id]
    if not stocked:
        order.fulfillment_status = "NOT_REQUIRED"
        return
    ordered = sum((ln.quantity for ln in stocked), Decimal(0))
    rows = (
        await db.execute(
            select(Reservation).where(Reservation.order_id == order.id)
        )
    ).scalars().all()
    held = sum(
        (r.quantity for r in rows if r.status == "HELD"), Decimal(0)
    )
    dispatched = sum(
        (r.quantity for r in rows if r.status == "CONSUMED"), Decimal(0)
    )
    if dispatched >= ordered:
        order.fulfillment_status = "DISPATCHED"
    elif dispatched > 0:
        order.fulfillment_status = "PARTIALLY_DISPATCHED"
    elif held >= ordered:
        order.fulfillment_status = "RESERVED"
    elif held > 0:
        order.fulfillment_status = "PARTIALLY_RESERVED"
    else:
        order.fulfillment_status = "UNALLOCATED"


async def load_visible_order(
    db: AsyncSession, actor: Actor, order_id: uuid.UUID
) -> Order:
    """REP sees own orders only; CUSTOMER always 404s here (portal has own views)."""
    order = (
        await db.execute(select(Order).where(Order.id == order_id))
    ).scalars().first()
    if order is None:
        raise ApiException.not_found(f"Order {order_id}")
    if actor.role in ("ADMIN", "FINANCE", "MANAGER"):
        return order
    if actor.role == "REP" and actor.profile_id == order.owner_profile_id:
        return order
    raise ApiException.not_found(f"Order {order_id}")


async def _earliest_receipts(
    db: AsyncSession, variant_ids: set
) -> dict:
    """Earliest real expected receipt per variant, active warehouses only."""
    if not variant_ids:
        return {}
    active_ids = {w.id for w in await _active_warehouses(db)}
    rows = (
        await db.execute(
            select(StockLevel).where(StockLevel.variant_id.in_(variant_ids))
        )
    ).scalars().all()
    earliest: dict = {}
    for r in rows:
        if r.warehouse_id not in active_ids or not r.expected_receipt_date:
            continue
        if (
            r.variant_id not in earliest
            or r.expected_receipt_date < earliest[r.variant_id]
        ):
            earliest[r.variant_id] = r.expected_receipt_date
    return earliest


async def _variant_availability(
    db: AsyncSession, variant_ids: set
) -> dict:
    """Active-warehouse available totals per variant (snapshot, never a promise)."""
    if not variant_ids:
        return {}
    active_ids = {w.id for w in await _active_warehouses(db)}
    rows = (
        await db.execute(
            select(StockLevel).where(StockLevel.variant_id.in_(variant_ids))
        )
    ).scalars().all()
    totals: dict = {}
    for r in rows:
        if r.warehouse_id not in active_ids:
            continue
        totals[r.variant_id] = (
            totals.get(r.variant_id, Decimal(0)) + (r.on_hand - r.reserved)
        )
    return totals


def _plan_response(order: Order, plan, preview: bool, expected: dict) -> dict:
    return {
        "orderId": str(order.id),
        "mode": plan.mode.value if isinstance(plan.mode, Mode) else str(plan.mode),
        "allocations": [
            {
                "warehouseId": str(a.warehouse_id),
                "warehouseCode": a.warehouse_code,
                "warehouseName": a.warehouse_name,
                "orderLineId": str(a.order_line_id) if a.order_line_id else None,
                "lineKey": a.line_key,
                "description": a.description,
                "quantity": a.quantity,
            }
            for a in plan.allocations
        ],
        "shortages": [
            {
                "orderLineId": str(s.order_line_id) if s.order_line_id else None,
                "lineKey": s.line_key,
                "description": s.description,
                "quantity": s.quantity,
                "expectedDate": (
                    expected.get(s.variant_id).isoformat()
                    if expected.get(s.variant_id)
                    else None
                ),
            }
            for s in plan.shortages
        ],
        "shipmentCount": plan.shipment_count,
        "estimatedShippingCost": m.to_major(plan.estimated_shipping_cost_minor),
        "score": m.to_major(plan.score_minor),
        "fullyFulfilled": plan.fully_fulfilled,
        "exhaustive": plan.exhaustive,
        "backorderTerms": order.backorder_terms,
        "preview": preview,
    }


# ------------------------------------------------------------------ preview


async def allocation_preview(db: AsyncSession, order: Order) -> dict:
    """Read-only plan. Holds nothing; confirmation must re-decide under lock."""
    lines = await _order_lines(db, order.id)
    stocked = [ln for ln in lines if ln.requires_stock and ln.variant_id]
    preview = order.fulfillment_status == "UNALLOCATED"
    if not stocked:
        plan = allocate(
            AllocationInput([], [], [], _mode(), EXTRA_SHIPMENT_PENALTY_MINOR,
                            EXHAUSTIVE_WAREHOUSE_LIMIT)
        )
        return _plan_response(order, plan, preview, {})
    variant_ids = {ln.variant_id for ln in stocked}
    weights = await _weights(db, variant_ids)
    warehouses = await _active_warehouses(db)
    rows = (
        await db.execute(
            select(StockLevel).where(StockLevel.variant_id.in_(variant_ids))
        )
    ).scalars().all()
    plan = allocate(
        AllocationInput(
            [
                Demand(ln.line_key, ln.id, ln.variant_id, ln.description,
                       ln.quantity, weights.get(ln.variant_id, 0))
                for ln in stocked
            ],
            [
                Availability(r.warehouse_id, r.variant_id, r.on_hand - r.reserved)
                for r in rows
            ],
            _warehouse_infos(warehouses),
            _mode(),
            EXTRA_SHIPMENT_PENALTY_MINOR,
            EXHAUSTIVE_WAREHOUSE_LIMIT,
        )
    )
    return _plan_response(order, plan, preview, await _earliest_receipts(db, variant_ids))


async def order_fulfillment(db: AsyncSession, order: Order) -> dict:
    shipments = (
        await db.execute(
            select(Shipment)
            .where(Shipment.order_id == order.id)
            .order_by(Shipment.created_at)
        )
    ).scalars().all()
    lines = await _order_lines(db, order.id)
    lines_by_id = {ln.id: ln for ln in lines}
    warehouses = (
        await db.execute(select(Warehouse))
    ).scalars().all()
    warehouses_by_id = {w.id: w for w in warehouses}

    shipment_rows = []
    for shipment in shipments:
        slines = (
            await db.execute(
                select(ShipmentLine).where(ShipmentLine.shipment_id == shipment.id)
            )
        ).scalars().all()
        warehouse = warehouses_by_id.get(shipment.warehouse_id)
        shipment_rows.append(
            {
                "id": str(shipment.id),
                "warehouseId": str(shipment.warehouse_id),
                "warehouseCode": warehouse.code if warehouse else None,
                "warehouseName": warehouse.name if warehouse else None,
                "status": shipment.status,
                "estimatedCost": m.to_major(shipment.estimated_cost_minor),
                "dispatchedAt": (
                    shipment.dispatched_at.isoformat()
                    if shipment.dispatched_at
                    else None
                ),
                "trackingReference": shipment.tracking_reference,
                "lines": [
                    {
                        "id": str(sl.id),
                        "orderLineId": str(sl.order_line_id),
                        "lineKey": (
                            lines_by_id[sl.order_line_id].line_key
                            if sl.order_line_id in lines_by_id
                            else None
                        ),
                        "description": (
                            lines_by_id[sl.order_line_id].description
                            if sl.order_line_id in lines_by_id
                            else None
                        ),
                        "quantity": sl.quantity,
                    }
                    for sl in slines
                ],
            }
        )

    backorders = (
        await db.execute(
            select(Backorder)
            .where(Backorder.order_id == order.id)
            .order_by(Backorder.created_at)
        )
    ).scalars().all()
    available = await _variant_availability(
        db, {b.variant_id for b in backorders}
    )
    backorder_rows = []
    replan_suggested = False
    for backorder in backorders:
        line = lines_by_id.get(backorder.order_line_id)
        consolidatable = (
            backorder.status == "OPEN"
            and available.get(backorder.variant_id, Decimal(0)) > 0
        )
        replan_suggested = replan_suggested or consolidatable
        backorder_rows.append(
            {
                "id": str(backorder.id),
                "orderLineId": str(backorder.order_line_id),
                "description": line.description if line else None,
                "quantity": backorder.quantity,
                "expectedDate": (
                    backorder.expected_date.isoformat()
                    if backorder.expected_date
                    else None
                ),
                "status": backorder.status,
                "consolidationAvailable": consolidatable,
            }
        )
    return {
        "orderId": str(order.id),
        "orderReference": order.reference,
        "fulfillmentStatus": order.fulfillment_status,
        "backorderTerms": order.backorder_terms,
        "shipments": shipment_rows,
        "backorders": backorder_rows,
        "replanSuggested": replan_suggested,
    }


# ------------------------------------------------------------------ override


async def override_allocation(
    db: AsyncSession,
    actor: Actor,
    order_id: uuid.UUID,
    allocations: list[dict],
    reason: str | None = None,
) -> dict:
    """Replaces the warehouse split with an explicit one; refused if infeasible.

    Existing reservations are untouched when the request is rejected.
    """
    order = (
        await db.execute(
            select(Order).where(Order.id == order_id).with_for_update()
        )
    ).scalars().first()
    if order is None:
        raise ApiException.not_found(f"Order {order_id}")
    lines = await _order_lines(db, order_id)
    lines_by_id = {ln.id: ln for ln in lines}

    variant_ids: set = set()
    for item in allocations:
        line = lines_by_id.get(item["orderLineId"])
        if line is None:
            raise ApiException.not_found(f"Order line {item['orderLineId']}")
        if not line.requires_stock or line.variant_id is None:
            raise ApiException(
                ErrorCode.ALLOCATION_INFEASIBLE,
                f'"{line.description}" is not a stocked item.',
            )
        variant_ids.add(line.variant_id)

    locked = await _locked_stock(db, variant_ids)
    own_held = await _own_held(db, order_id)

    demand_by_cell: dict[tuple, Decimal] = {}
    for item in allocations:
        line = lines_by_id[item["orderLineId"]]
        key = (line.variant_id, item["warehouseId"])
        demand_by_cell[key] = demand_by_cell.get(key, Decimal(0)) + item["quantity"]

    problems: list[str] = []
    for (variant_id, warehouse_id), wanted in demand_by_cell.items():
        level = locked.get((variant_id, warehouse_id))
        available_to_order = (
            (level.on_hand - level.reserved)
            + own_held.get((variant_id, warehouse_id), Decimal(0))
            if level is not None
            else Decimal(0)
        )
        if available_to_order < wanted:
            problems.append(
                f"Requested {m.plain_quantity(wanted)} but only "
                f"{m.plain_quantity(available_to_order)} is available at that "
                "warehouse."
            )
    if problems:
        feasible = await allocation_preview(db, order)
        raise ApiException.of(
            ErrorCode.ALLOCATION_INFEASIBLE,
            "That split cannot be fulfilled: " + " ".join(problems),
            problems=problems,
            proposedAllocations=len(feasible["allocations"]),
            proposedShortages=len(feasible["shortages"]),
        )

    requested_by_line: dict = {}
    for item in allocations:
        requested_by_line[item["orderLineId"]] = (
            requested_by_line.get(item["orderLineId"], Decimal(0)) + item["quantity"]
        )
    dispatched = await _dispatched_by_line(db, order_id)
    for line_id, wanted in requested_by_line.items():
        line = lines_by_id[line_id]
        unshipped = line.quantity - dispatched.get(line_id, Decimal(0))
        if wanted > unshipped:
            raise ApiException.of(
                ErrorCode.ALLOCATION_MISMATCH,
                f'"{line.description}" has only {m.plain_quantity(unshipped)} '
                "left to allocate.",
                orderLineId=str(line.id),
                unshipped=m.plain_quantity(unshipped),
            )

    now = now_utc()
    held = (
        await db.execute(
            select(Reservation).where(
                Reservation.order_id == order_id,
                Reservation.status == "HELD",
            )
        )
    ).scalars().all()
    for reservation in held:
        level = locked.get((reservation.variant_id, reservation.warehouse_id))
        if level is not None:
            level.reserved = level.reserved - reservation.quantity
        reservation.status = "RELEASED"
        reservation.released_at = now

    open_shipments = (
        await db.execute(
            select(Shipment).where(
                Shipment.order_id == order_id,
                Shipment.status.in_(OPEN_SHIPMENTS),
            )
        )
    ).scalars().all()
    for shipment in open_shipments:
        await db.execute(
            delete(ShipmentLine).where(ShipmentLine.shipment_id == shipment.id)
        )
        shipment.status = "CANCELED"

    warehouses = await _active_warehouses(db)
    fixed = {w.id: w.shipping_fixed_cost_minor for w in warehouses}
    new_shipments: dict = {}
    for item in allocations:
        line = lines_by_id[item["orderLineId"]]
        level = locked.get((line.variant_id, item["warehouseId"]))
        if level is None:
            raise ApiException(
                ErrorCode.ALLOCATION_INFEASIBLE,
                "There is no stock record for that item at that warehouse.",
            )
        level.reserved = level.reserved + item["quantity"]
        shipment = new_shipments.get(item["warehouseId"])
        if shipment is None:
            shipment = Shipment(
                order_id=order_id,
                warehouse_id=item["warehouseId"],
                status="RESERVED",
                estimated_cost_minor=fixed.get(item["warehouseId"], 0),
            )
            db.add(shipment)
            await db.flush()
            new_shipments[item["warehouseId"]] = shipment
        shipment_line = ShipmentLine(
            shipment_id=shipment.id,
            order_line_id=line.id,
            variant_id=line.variant_id,
            quantity=item["quantity"],
        )
        db.add(shipment_line)
        await db.flush()
        db.add(
            Reservation(
                order_id=order_id,
                order_line_id=line.id,
                shipment_line_id=shipment_line.id,
                warehouse_id=item["warehouseId"],
                variant_id=line.variant_id,
                quantity=item["quantity"],
                status="HELD",
            )
        )

    await _rebuild_backorders(db, order, lines, requested_by_line, now)
    await recompute_fulfillment_status(db, order, lines)

    await audit.record(
        db,
        actor,
        "ALLOCATION_OVERRIDDEN",
        "Order",
        order_id,
        order_id=order_id,
        after={"allocations": len(allocations)},
        reason=reason,
    )
    await outbox.publish(
        db,
        outbox.ALLOCATION_UPDATED,
        "Order",
        order_id,
        order.row_version,
        {"overridden": True},
        outbox.deal_scope(order.customer_id, order.owner_profile_id, None),
    )
    return await allocation_preview(db, order)


async def _rebuild_backorders(
    db: AsyncSession,
    order: Order,
    lines: list[OrderLine],
    allocated_by_line: dict,
    now,
) -> None:
    dispatched = await _dispatched_by_line(db, order.id)
    for line in lines:
        if not line.requires_stock or line.variant_id is None:
            continue
        shortfall = (
            line.quantity
            - dispatched.get(line.id, Decimal(0))
            - allocated_by_line.get(line.id, Decimal(0))
        )
        open_bo = (
            await db.execute(
                select(Backorder).where(
                    Backorder.order_line_id == line.id,
                    Backorder.status == "OPEN",
                )
            )
        ).scalars().first()
        if shortfall > 0:
            if open_bo is not None:
                open_bo.quantity = shortfall
            else:
                db.add(
                    Backorder(
                        order_id=order.id,
                        order_line_id=line.id,
                        variant_id=line.variant_id,
                        quantity=shortfall,
                        status="OPEN",
                    )
                )
        elif open_bo is not None:
            open_bo.status = "RESOLVED"
            open_bo.resolved_at = now


# ------------------------------------------------------------------- replan


async def replan(
    db: AsyncSession, actor: Actor, order_id: uuid.UUID
) -> dict | None:
    """Re-allocates open backorders after a receipt. None when nothing is open."""
    order = (
        await db.execute(
            select(Order).where(Order.id == order_id).with_for_update()
        )
    ).scalars().first()
    if order is None:
        raise ApiException.not_found(f"Order {order_id}")
    open_bos = (
        await db.execute(
            select(Backorder).where(
                Backorder.order_id == order_id,
                Backorder.status == "OPEN",
            )
        )
    ).scalars().all()
    if not open_bos:
        return None
    lines = await _order_lines(db, order_id)
    lines_by_id = {ln.id: ln for ln in lines}
    weights = await _weights(db, {b.variant_id for b in open_bos})

    demands = []
    for backorder in open_bos:
        line = lines_by_id.get(backorder.order_line_id)
        if line is None:
            continue
        demands.append(
            Demand(
                line.line_key,
                line.id,
                backorder.variant_id,
                line.description,
                backorder.quantity,
                weights.get(backorder.variant_id, 0),
            )
        )
    if not demands:
        return None

    variant_ids = {d.variant_id for d in demands}
    locked = await _locked_stock(db, variant_ids)
    own_held = await _own_held(db, order_id)
    warehouses = await _active_warehouses(db)
    plan = allocate(
        AllocationInput(
            demands,
            [
                Availability(
                    r.warehouse_id,
                    r.variant_id,
                    (r.on_hand - r.reserved)
                    + own_held.get((r.variant_id, r.warehouse_id), Decimal(0)),
                )
                for r in locked.values()
            ],
            _warehouse_infos(warehouses),
            _mode(),
            EXTRA_SHIPMENT_PENALTY_MINOR,
            EXHAUSTIVE_WAREHOUSE_LIMIT,
        )
    )
    if not plan.allocations:
        return _plan_response(
            order, plan, False, await _earliest_receipts(db, variant_ids)
        )

    now = now_utc()
    await _apply_replan_allocations(db, order, lines_by_id, plan, locked, warehouses)
    allocated_by_line: dict = {}
    for a in plan.allocations:
        allocated_by_line[a.order_line_id] = (
            allocated_by_line.get(a.order_line_id, Decimal(0)) + a.quantity
        )
    for backorder in open_bos:
        covered = allocated_by_line.get(backorder.order_line_id)
        if covered is None or covered <= 0:
            continue
        remaining = backorder.quantity - covered
        if remaining <= 0:
            backorder.status = "RESOLVED"
            backorder.resolved_at = now
        else:
            backorder.quantity = remaining
    await recompute_fulfillment_status(db, order, lines)

    await audit.record(
        db,
        actor,
        "ORDER_REPLANNED",
        "Order",
        order_id,
        order_id=order_id,
        after={
            "newlyAllocated": len(plan.allocations),
            "remainingShortages": len(plan.shortages),
        },
    )
    await outbox.publish(
        db,
        outbox.ALLOCATION_UPDATED,
        "Order",
        order_id,
        order.row_version,
        {"replanned": True},
        outbox.deal_scope(order.customer_id, order.owner_profile_id, None),
    )
    return _plan_response(
        order, plan, False, await _earliest_receipts(db, variant_ids)
    )


async def _apply_replan_allocations(
    db: AsyncSession,
    order: Order,
    lines_by_id: dict,
    plan,
    locked: dict,
    warehouses: list,
) -> None:
    open_shipments = (
        await db.execute(
            select(Shipment).where(
                Shipment.order_id == order.id,
                Shipment.status.in_(OPEN_SHIPMENTS),
            )
        )
    ).scalars().all()
    shipment_by_warehouse = {s.warehouse_id: s for s in open_shipments}
    fixed = {w.id: w.shipping_fixed_cost_minor for w in warehouses}
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
                "being replanned. Try again.",
            )
        level.reserved = level.reserved + alloc.quantity
        shipment = shipment_by_warehouse.get(alloc.warehouse_id)
        if shipment is None:
            shipment = Shipment(
                order_id=order.id,
                warehouse_id=alloc.warehouse_id,
                status="RESERVED",
                estimated_cost_minor=fixed.get(alloc.warehouse_id, 0),
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


# ----------------------------------------------------------------- dispatch


async def dispatch(
    db: AsyncSession,
    actor: Actor,
    shipment_id: uuid.UUID,
    tracking: str | None = None,
    note: str | None = None,
) -> dict:
    shipment = (
        await db.execute(select(Shipment).where(Shipment.id == shipment_id))
    ).scalars().first()
    if shipment is None:
        raise ApiException.not_found(f"Shipment {shipment_id}")
    if shipment.status == "DISPATCHED":
        return await _shipment_response(db, shipment)
    if shipment.status not in OPEN_SHIPMENTS:
        raise ApiException.of(
            ErrorCode.CONFLICTING_STATE,
            f"This shipment is {shipment.status.lower()}.",
            status=shipment.status,
        )

    order = (
        await db.execute(
            select(Order).where(Order.id == shipment.order_id).with_for_update()
        )
    ).scalars().first()
    if order is None:
        raise ApiException.not_found(f"Order {shipment.order_id}")

    slines = (
        await db.execute(
            select(ShipmentLine).where(ShipmentLine.shipment_id == shipment.id)
        )
    ).scalars().all()
    if not slines:
        raise ApiException(
            ErrorCode.NOTHING_TO_DISPATCH,
            "This shipment holds no reserved stock.",
        )

    now = now_utc()
    variant_ids = {sl.variant_id for sl in slines}
    rows = (
        await db.execute(
            select(StockLevel)
            .where(
                StockLevel.variant_id.in_(variant_ids),
                StockLevel.warehouse_id == shipment.warehouse_id,
            )
            .with_for_update()
        )
    ).scalars().all()
    locked = {r.variant_id: r for r in rows}

    for line in slines:
        held = (
            await db.execute(
                select(Reservation).where(
                    Reservation.shipment_line_id == line.id,
                    Reservation.status == "HELD",
                )
            )
        ).scalars().all()
        quantity = sum((r.quantity for r in held), Decimal(0))
        if quantity <= 0:
            continue
        level = locked.get(line.variant_id)
        if level is None:
            raise ApiException(
                ErrorCode.CONFLICTING_STATE,
                "The stock record for this shipment no longer exists.",
            )
        if level.on_hand < quantity or level.reserved < quantity:
            raise ApiException(
                ErrorCode.CONFLICTING_STATE,
                "Stock records disagree with this shipment. Recount before "
                "dispatching.",
            )
        level.on_hand = level.on_hand - quantity
        level.reserved = level.reserved - quantity
        db.add(
            StockMovement(
                variant_id=line.variant_id,
                warehouse_id=shipment.warehouse_id,
                quantity=-quantity,
                movement_type="DISPATCH",
                reference_type="Shipment",
                reference_id=shipment.id,
                note=note,
                actor_profile_id=actor.profile_id,
                occurred_at=now,
            )
        )
        for reservation in held:
            reservation.status = "CONSUMED"
            reservation.consumed_at = now

    shipment.status = "DISPATCHED"
    shipment.dispatched_by_profile_id = actor.profile_id
    shipment.dispatched_at = now
    shipment.tracking_reference = tracking

    await recompute_fulfillment_status(
        db, order, await _order_lines(db, order.id)
    )

    await audit.record(
        db,
        actor,
        "SHIPMENT_DISPATCHED",
        "Shipment",
        shipment.id,
        order_id=order.id,
        after={
            "warehouseId": str(shipment.warehouse_id),
            "lines": len(slines),
        },
    )
    await outbox.publish(
        db,
        outbox.ALLOCATION_UPDATED,
        "Order",
        order.id,
        order.row_version,
        {"shipmentId": str(shipment.id), "status": "DISPATCHED"},
        outbox.deal_scope(order.customer_id, order.owner_profile_id, None),
    )
    return await _shipment_response(db, shipment)


async def _shipment_response(db: AsyncSession, shipment: Shipment) -> dict:
    warehouse = (
        await db.execute(
            select(Warehouse).where(Warehouse.id == shipment.warehouse_id)
        )
    ).scalars().first()
    lines = await _order_lines(db, shipment.order_id)
    lines_by_id = {ln.id: ln for ln in lines}
    slines = (
        await db.execute(
            select(ShipmentLine).where(ShipmentLine.shipment_id == shipment.id)
        )
    ).scalars().all()
    return {
        "id": str(shipment.id),
        "warehouseId": str(shipment.warehouse_id),
        "warehouseCode": warehouse.code if warehouse else None,
        "warehouseName": warehouse.name if warehouse else None,
        "status": shipment.status,
        "estimatedCost": m.to_major(shipment.estimated_cost_minor),
        "dispatchedAt": (
            shipment.dispatched_at.isoformat() if shipment.dispatched_at else None
        ),
        "trackingReference": shipment.tracking_reference,
        "lines": [
            {
                "id": str(sl.id),
                "orderLineId": str(sl.order_line_id),
                "lineKey": (
                    lines_by_id[sl.order_line_id].line_key
                    if sl.order_line_id in lines_by_id
                    else None
                ),
                "description": (
                    lines_by_id[sl.order_line_id].description
                    if sl.order_line_id in lines_by_id
                    else None
                ),
                "quantity": sl.quantity,
            }
            for sl in slines
        ],
    }


# ------------------------------------------------------------------ movements


async def record_movement(
    db: AsyncSession,
    actor: Actor,
    data: dict,
    request_key: str | None,
) -> dict:
    """Goods receipt or correction. Replay by request_key changes no stock."""
    if request_key:
        existing = (
            await db.execute(
                select(StockMovement).where(StockMovement.request_key == request_key)
            )
        ).scalars().first()
        if existing is not None:
            return {
                "movement": _movement_response(existing, True),
                "replayed": True,
                "consolidatableOrderIds": [],
            }

    raw_type = str(data.get("movementType") or "")
    movement_type = raw_type.upper()
    if movement_type not in ("RECEIPT", "ADJUSTMENT"):
        raise ApiException(
            ErrorCode.VALIDATION_FAILED,
            "movementType must be RECEIPT or ADJUSTMENT.",
        )
    quantity = Decimal(str(data.get("quantity")))
    if movement_type == "RECEIPT" and quantity <= 0:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, "A receipt must be a positive quantity."
        )
    if movement_type == "ADJUSTMENT" and quantity == 0:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, "An adjustment cannot be zero."
        )

    warehouse = (
        await db.execute(
            select(Warehouse).where(Warehouse.id == data.get("warehouseId"))
        )
    ).scalars().first()
    if warehouse is None:
        raise ApiException.not_found(f"Warehouse {data.get('warehouseId')}")

    level = (
        await db.execute(
            select(StockLevel)
            .where(
                StockLevel.variant_id == data.get("variantId"),
                StockLevel.warehouse_id == data.get("warehouseId"),
            )
            .with_for_update()
        )
    ).scalars().first()
    if level is None:
        level = StockLevel(
            warehouse_id=data.get("warehouseId"),
            variant_id=data.get("variantId"),
        )
        db.add(level)
        await db.flush()

    new_on_hand = level.on_hand + quantity
    if new_on_hand < 0:
        raise ApiException.of(
            ErrorCode.VALIDATION_FAILED,
            "That adjustment would take stock below zero.",
            onHand=m.plain_quantity(level.on_hand),
        )
    if new_on_hand < level.reserved:
        raise ApiException.of(
            ErrorCode.CONFLICTING_STATE,
            "That adjustment would leave less stock than is already reserved "
            "for orders.",
            reserved=m.plain_quantity(level.reserved),
        )
    level.on_hand = new_on_hand

    expected_date = data.get("expectedNextReceiptDate")
    if expected_date is not None:
        if isinstance(expected_date, str):
            expected_date = date.fromisoformat(expected_date)
        level.expected_receipt_date = expected_date
        expected_qty = data.get("expectedNextReceiptQty")
        level.expected_receipt_qty = (
            Decimal(str(expected_qty)) if expected_qty is not None else None
        )
    elif movement_type == "RECEIPT":
        level.expected_receipt_date = None
        level.expected_receipt_qty = None

    now = now_utc()
    movement = StockMovement(
        variant_id=data.get("variantId"),
        warehouse_id=data.get("warehouseId"),
        quantity=quantity,
        movement_type=movement_type,
        request_key=request_key,
        note=data.get("note"),
        actor_profile_id=actor.profile_id,
        occurred_at=now,
    )
    db.add(movement)
    await db.flush()

    await audit.record(
        db,
        actor,
        f"STOCK_{movement_type}",
        "StockLevel",
        level.id,
        after={
            "variantId": str(data.get("variantId")),
            "warehouseId": str(data.get("warehouseId")),
            "quantity": m.plain_quantity(quantity),
            "onHand": m.plain_quantity(level.on_hand),
        },
        reason=data.get("note"),
    )

    consolidatable = await _open_backorder_orders(db, data.get("variantId"))
    await outbox.publish(
        db,
        outbox.STOCK_UPDATED,
        "StockLevel",
        level.id,
        level.row_version,
        {
            "variantId": str(data.get("variantId")),
            "warehouseId": str(data.get("warehouseId")),
            "onHand": m.plain_quantity(level.on_hand),
        },
        outbox.roles_scope("FINANCE", "ADMIN", "MANAGER"),
    )
    for order_id in consolidatable:
        await outbox.publish(
            db,
            outbox.BACKORDER_UPDATED,
            "Order",
            order_id,
            0,
            {
                "consolidationAvailable": True,
                "variantId": str(data.get("variantId")),
            },
            outbox.roles_scope("FINANCE", "ADMIN"),
        )
    return {
        "movement": _movement_response(movement, False),
        "replayed": False,
        "consolidatableOrderIds": [str(o) for o in consolidatable],
    }


def _movement_response(movement: StockMovement, replayed: bool) -> dict:
    return {
        "id": str(movement.id),
        "variantId": str(movement.variant_id),
        "warehouseId": str(movement.warehouse_id),
        "quantity": movement.quantity,
        "movementType": movement.movement_type,
        "note": movement.note,
        "occurredAt": (
            movement.occurred_at.isoformat() if movement.occurred_at else None
        ),
        "replayed": replayed,
    }


async def _open_backorder_orders(db: AsyncSession, variant_id) -> list:
    rows = (
        await db.execute(
            select(Backorder.order_id).where(
                Backorder.variant_id == variant_id,
                Backorder.status == "OPEN",
            )
        )
    ).all()
    seen: list = []
    for (order_id,) in rows:
        if order_id not in seen:
            seen.append(order_id)
    return seen


# -------------------------------------------------------------- stock levels


async def list_stock_levels(
    db: AsyncSession,
    warehouse_id=None,
    variant_id=None,
) -> list[dict]:
    query = select(StockLevel)
    if warehouse_id is not None:
        query = query.where(StockLevel.warehouse_id == warehouse_id)
    elif variant_id is not None:
        query = query.where(StockLevel.variant_id == variant_id)
    rows = (await db.execute(query)).scalars().all()
    return [await _stock_level_response(db, r) for r in rows]


async def update_stock_level(
    db: AsyncSession, actor: Actor, data: dict
) -> dict:
    level = (
        await db.execute(
            select(StockLevel).where(
                StockLevel.warehouse_id == data.get("warehouseId"),
                StockLevel.variant_id == data.get("variantId"),
            )
        )
    ).scalars().first()
    if level is None:
        level = StockLevel(
            warehouse_id=data.get("warehouseId"),
            variant_id=data.get("variantId"),
        )
        db.add(level)
        await db.flush()
    if data.get("reorderPoint") is not None:
        level.reorder_point = Decimal(str(data["reorderPoint"]))
    if data.get("targetQty") is not None:
        level.target_qty = Decimal(str(data["targetQty"]))
    expected_date = data.get("expectedReceiptDate")
    level.expected_receipt_date = (
        date.fromisoformat(expected_date)
        if isinstance(expected_date, str)
        else expected_date
    )
    expected_qty = data.get("expectedReceiptQty")
    level.expected_receipt_qty = (
        Decimal(str(expected_qty)) if expected_qty is not None else None
    )
    await db.flush()
    return await _stock_level_response(db, level)


async def _stock_level_response(db: AsyncSession, level: StockLevel) -> dict:
    variant = (
        await db.execute(
            select(ProductVariant).where(ProductVariant.id == level.variant_id)
        )
    ).scalars().first()
    product = None
    if variant is not None:
        product = (
            await db.execute(
                select(Product).where(Product.id == variant.product_id)
            )
        ).scalars().first()
    warehouse = (
        await db.execute(
            select(Warehouse).where(Warehouse.id == level.warehouse_id)
        )
    ).scalars().first()
    available = level.on_hand - level.reserved
    needs = level.reorder_point > 0 and available <= level.reorder_point
    shortfall = level.target_qty - available
    return {
        "variantId": str(level.variant_id),
        "sku": variant.sku if variant else None,
        "productName": product.name if product else None,
        "warehouseId": str(level.warehouse_id),
        "warehouseCode": warehouse.code if warehouse else None,
        "onHand": level.on_hand,
        "reserved": level.reserved,
        "available": available,
        "reorderPoint": level.reorder_point,
        "targetQty": level.target_qty,
        "expectedReceiptDate": (
            level.expected_receipt_date.isoformat()
            if level.expected_receipt_date
            else None
        ),
        "needsReplenishment": needs,
        "replenishmentSuggestion": shortfall if shortfall > 0 else Decimal(0),
    }
