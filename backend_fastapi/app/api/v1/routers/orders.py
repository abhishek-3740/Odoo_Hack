"""Orders + fulfillment routes — read-only orders plus allocation, shipments
and stock operations. Single combined `router` (do NOT touch app/main.py)."""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_actor,
    idempotency_key,
    require_internal,
    require_roles,
    scope_404,
)
from app.api.paging import SORT_COLUMNS, parse_sort, page_size_or_default
from app.core.database import get_db
from app.core.exceptions import ApiException, ErrorCode
from app.core.response import ApiResponse, PageResponse
from app.core.security import Actor
from app.engines import shared_math as m
from app.models.catalog import Customer
from app.models.orders import Order, OrderLine
from app.services import fulfillment_service as fulfillment

router = APIRouter()

ORDER_SORTS = {"confirmedAt", "createdAt", "fulfillmentStatus"}


def _order_response(order: Order, lines: list[OrderLine], customer_name: str | None) -> dict:
    return {
        "id": str(order.id),
        "reference": order.reference,
        "quoteId": str(order.quote_id),
        "revisionId": str(order.revision_id),
        "customerId": str(order.customer_id),
        "customerName": customer_name,
        "ownerProfileId": str(order.owner_profile_id),
        "currency": order.currency,
        "orderStatus": order.order_status,
        "fulfillmentStatus": order.fulfillment_status,
        "billingStatus": order.billing_status,
        "backorderTerms": order.backorder_terms,
        "oneTimeNet": m.to_major(order.one_time_net_minor),
        "oneTimeTax": m.to_major(order.one_time_tax_minor),
        "confirmedAt": order.confirmed_at.isoformat() if order.confirmed_at else None,
        "lines": [
            {
                "id": str(ln.id),
                "lineKey": ln.line_key,
                "lineKind": ln.line_kind,
                "variantId": str(ln.variant_id) if ln.variant_id else None,
                "planId": str(ln.plan_id) if ln.plan_id else None,
                "description": ln.description,
                "quantity": ln.quantity,
                "unitPrice": m.to_major(ln.unit_price_minor),
                "effectiveDiscountBp": ln.effective_discount_bp,
                "net": m.to_major(ln.net_minor),
                "tax": m.to_major(ln.tax_minor),
                "intervalMonths": ln.interval_months,
                "requiresStock": ln.requires_stock,
                "promisedDate": ln.promised_date.isoformat() if ln.promised_date else None,
            }
            for ln in lines
        ],
        "rowVersion": order.row_version,
    }


async def _full_order(db: AsyncSession, order: Order) -> dict:
    lines = (
        await db.execute(
            select(OrderLine)
            .where(OrderLine.order_id == order.id)
            .order_by(OrderLine.position)
        )
    ).scalars().all()
    customer = (
        await db.execute(select(Customer).where(Customer.id == order.customer_id))
    ).scalars().first()
    return _order_response(order, lines, customer.name if customer else None)


@router.get("/api/v1/orders")
async def list_orders(
    customerId: uuid.UUID | None = Query(default=None),
    page: int | None = Query(default=None),
    pageSize: int | None = Query(default=None),
    sort: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    field, descending = parse_sort(sort, ORDER_SORTS, "confirmedAt")
    column = SORT_COLUMNS[field]
    query = select(Order)
    count_query = select(func.count()).select_from(Order)
    if customerId is not None:
        query = query.where(Order.customer_id == customerId)
        count_query = count_query.where(Order.customer_id == customerId)
    if actor.role == "REP":
        query = query.where(Order.owner_profile_id == actor.profile_id)
        count_query = count_query.where(Order.owner_profile_id == actor.profile_id)
    total = int((await db.execute(count_query)).scalar_one())
    size = page_size_or_default(pageSize)
    number = max(page or 0, 0)
    order_column = getattr(Order, column)
    rows = (
        await db.execute(
            query.order_by(
                order_column.desc() if descending else order_column.asc()
            )
            .offset(number * size)
            .limit(size)
        )
    ).scalars().all()
    items = [await _full_order(db, o) for o in rows]
    return PageResponse.of(items, number, size, total)


@router.get("/api/v1/orders/{order_id}")
async def get_order(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
):
    order = await fulfillment.load_visible_order(db, actor, order_id)
    return ApiResponse.of(await _full_order(db, order))


@router.get("/api/v1/orders/{order_id}/allocation")
async def get_allocation(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
):
    order = await fulfillment.load_visible_order(db, actor, order_id)
    return ApiResponse.of(await fulfillment.allocation_preview(db, order))


@router.get("/api/v1/orders/{order_id}/fulfillment")
async def get_fulfillment(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
):
    order = await fulfillment.load_visible_order(db, actor, order_id)
    return ApiResponse.of(await fulfillment.order_fulfillment(db, order))


@router.post("/api/v1/orders/{order_id}/allocations")
async def post_allocations(
    order_id: uuid.UUID,
    body: dict,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
):
    raw = body.get("allocations")
    if not raw:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, "At least one allocation is required."
        )
    allocations = []
    for item in raw:
        try:
            quantity = Decimal(str(item.get("quantity")))
        except Exception as exc:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED, "Each allocation needs a quantity."
            ) from exc
        if quantity <= 0:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED, "Each allocation needs a quantity."
            )
        try:
            allocations.append(
                {
                    "orderLineId": uuid.UUID(str(item.get("orderLineId"))),
                    "warehouseId": uuid.UUID(str(item.get("warehouseId"))),
                    "quantity": quantity,
                }
            )
        except (ValueError, AttributeError, TypeError) as exc:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED, "Each allocation needs an order line."
            ) from exc
    plan = await fulfillment.override_allocation(
        db, actor, order_id, allocations, body.get("reason")
    )
    return ApiResponse.of(plan)


@router.post("/api/v1/orders/{order_id}/replans")
async def post_replan(
    order_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
):
    await fulfillment.replan(db, actor, order_id)
    order = (
        await db.execute(select(Order).where(Order.id == order_id))
    ).scalars().first()
    if order is None:
        raise scope_404()
    return ApiResponse.of(await fulfillment.order_fulfillment(db, order))


@router.post("/api/v1/shipments/{shipment_id}/dispatches")
async def post_dispatch(
    shipment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
    body: dict | None = None,
):
    payload = body or {}
    shipment = await fulfillment.dispatch(
        db, actor, shipment_id, payload.get("trackingReference"), payload.get("note")
    )
    return ApiResponse.of(shipment)


@router.post("/api/v1/stock-movements")
async def post_movement(
    body: dict,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
    key: str = Depends(idempotency_key),
):
    try:
        data = {
            "variantId": uuid.UUID(str(body.get("variantId"))),
            "warehouseId": uuid.UUID(str(body.get("warehouseId"))),
            "quantity": Decimal(str(body.get("quantity"))),
            "movementType": body.get("movementType"),
            "expectedNextReceiptDate": body.get("expectedNextReceiptDate"),
            "expectedNextReceiptQty": (
                Decimal(str(body["expectedNextReceiptQty"]))
                if body.get("expectedNextReceiptQty") is not None
                else None
            ),
            "note": body.get("note"),
        }
    except (ValueError, AttributeError, TypeError) as exc:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, "The request could not be read."
        ) from exc
    outcome = await fulfillment.record_movement(db, actor, data, key)
    return ApiResponse.of(
        outcome["movement"],
        {"consolidatableOrderIds": outcome["consolidatableOrderIds"]},
    )


@router.get("/api/v1/stock-levels")
async def get_stock_levels(
    warehouseId: uuid.UUID | None = Query(default=None),
    variantId: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
):
    if actor.is_customer:
        raise ApiException(ErrorCode.FORBIDDEN, "Stock is internal.")
    return ApiResponse.of(
        await fulfillment.list_stock_levels(db, warehouseId, variantId)
    )


@router.patch("/api/v1/stock-levels")
async def patch_stock_level(
    body: dict,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
):
    try:
        data = {
            "variantId": uuid.UUID(str(body.get("variantId"))),
            "warehouseId": uuid.UUID(str(body.get("warehouseId"))),
            "reorderPoint": (
                Decimal(str(body["reorderPoint"]))
                if body.get("reorderPoint") is not None
                else None
            ),
            "targetQty": (
                Decimal(str(body["targetQty"]))
                if body.get("targetQty") is not None
                else None
            ),
            "expectedReceiptDate": body.get("expectedReceiptDate"),
            "expectedReceiptQty": (
                Decimal(str(body["expectedReceiptQty"]))
                if body.get("expectedReceiptQty") is not None
                else None
            ),
        }
    except (ValueError, AttributeError, TypeError) as exc:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, "The request could not be read."
        ) from exc
    return ApiResponse.of(await fulfillment.update_stock_level(db, actor, data))
