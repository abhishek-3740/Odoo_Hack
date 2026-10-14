"""ORDERS + FULFILLMENT domain tests — finalize, allocate, dispatch, movements."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines.commercial_hash import commercial_hash
from app.models.billing import Invoice
from app.models.catalog import Category, Customer, Product, ProductVariant
from app.models.fulfillment import (
    Backorder,
    Reservation,
    Shipment,
    ShipmentLine,
    StockLevel,
    StockMovement,
    Warehouse,
)
from app.models.auth import Profile
from app.models.orders import Order
from app.models.quotes import Quote, QuoteLine, QuoteRevision
from app.services import fulfillment_service as fulfillment
from app.services import order_finalization as finalization
from app.services.clock import business_today, now_utc
from tests.itutil import TestSession, unique

pytestmark = pytest.mark.asyncio


def _actor(profile_id, role="ADMIN") -> Actor:
    return Actor(
        profile_id=profile_id,
        auth_user_id=uuid.uuid4(),
        email=f"{unique('svc')}@test.dev",
        role=role,
    )


async def _seed_basis(db, *, stocked: bool, fulfillment_kind="STOCK"):
    profile = Profile(
        auth_user_id=uuid.uuid4(), email=f"{unique('rep')}@test.dev",
        full_name="Seed Rep", role="REP", is_active=True,
    )
    db.add(profile)
    await db.flush()
    customer = Customer(
        name=unique("Cust"), tier="BRONZE", currency="INR",
        owner_rep_profile_id=profile.id, is_active=True,
    )
    db.add(customer)
    await db.flush()
    category = Category(code=unique("CAT"), name="Seed Cat", kind="HARDWARE")
    db.add(category)
    await db.flush()
    product = Product(
        category_id=category.id, code=unique("PRD"), name="Seed Product",
        base_price_minor=10000, base_cost_minor=7000, currency="INR",
        tax_rate_bp=0, fulfillment_kind=fulfillment_kind if stocked else "NONE",
        charge_kind="ONE_TIME", is_active=True,
    )
    db.add(product)
    await db.flush()
    variant = None
    if stocked:
        variant = ProductVariant(
            product_id=product.id, sku=unique("SKU"), name="Seed Variant",
        )
        db.add(variant)
        await db.flush()
    warehouse = Warehouse(
        code=unique("WH"), name="Seed Warehouse",
        shipping_fixed_cost_minor=0, shipping_cost_per_kg_minor=0,
        sort_order=0, is_active=True,
    )
    db.add(warehouse)
    await db.flush()
    return {
        "profile": profile, "customer": customer, "category": category,
        "product": product, "variant": variant, "warehouse": warehouse,
    }


async def _seed_quote(db, basis, *, qty, backorder_terms, stocked,
                      on_hand=Decimal(0), expected_receipt=None):
    today = business_today()
    quote = Quote(
        reference=f"QT-{unique('q')}", customer_id=basis["customer"].id,
        owner_profile_id=basis["profile"].id, stage="SENT",
        valid_until=today + timedelta(days=30), revision_count=1,
    )
    db.add(quote)
    await db.flush()
    revision = QuoteRevision(
        quote_id=quote.id, revision_no=1, source="SELLER", status="SUBMITTED",
        currency="INR", approval_status="NOT_REQUIRED", required_level="NONE",
        backorder_terms=backorder_terms, invoicing_terms="ON_CONFIRMATION",
        one_time_net_minor=10000 * int(qty), one_time_tax_minor=0,
        seller_adopted_at=now_utc(), customer_accepted_at=now_utc(),
    )
    db.add(revision)
    await db.flush()
    line = QuoteLine(
        revision_id=revision.id, line_key="L1", position=0, line_kind="ONE_TIME",
        product_id=basis["product"].id, category_id=basis["category"].id,
        variant_id=basis["variant"].id if basis["variant"] else None,
        description="Seed line", quantity=qty,
        unit_price_minor=10000, unit_cost_minor=7000, tax_rate_bp=0,
        line_discount_bp=0, applied_order_discount_bp=0, effective_discount_bp=0,
        base_minor=10000 * int(qty), net_minor=10000 * int(qty), tax_minor=0,
        cost_total_minor=7000 * int(qty), margin_minor=3000 * int(qty),
        requires_stock=stocked, source="MANUAL",
    )
    db.add(line)
    await db.flush()
    revision.customer_accepted_hash = commercial_hash(
        "INR", 0, backorder_terms, "ON_CONFIRMATION", None,
        [{
            "line_key": "L1", "line_kind": "ONE_TIME",
            "variant_id": str(line.variant_id) if line.variant_id else "",
            "plan_id": "", "quantity": qty, "unit_price_minor": 10000,
            "tax_rate_bp": 0, "line_discount_bp": 0,
            "effective_discount_bp": 0, "net_minor": 10000 * int(qty),
            "interval_months": None, "promised_date": "",
        }],
    )
    quote.current_revision_id = revision.id
    if stocked:
        db.add(StockLevel(
            warehouse_id=basis["warehouse"].id, variant_id=basis["variant"].id,
            on_hand=on_hand, reserved=Decimal(0),
            expected_receipt_date=expected_receipt,
        ))
    await db.flush()
    return quote


async def _finalize(db, basis, **kwargs):
    quote = await _seed_quote(db, basis, **kwargs)
    result = await finalization.try_finalize(db, _actor(basis["profile"].id), quote.id)
    await db.flush()
    return quote, result


async def test_finalize_not_required_happy_path():
    async with TestSession() as db:
        basis = await _seed_basis(db, stocked=False)
        quote, result = await _finalize(
            db, basis, qty=Decimal(2), backorder_terms="ALLOW_BACKORDER", stocked=False,
        )
        assert result["status"] == "FINALIZED"
        assert result["reference"].startswith("SO-")
        assert result["hasShortage"] is False
        order = (
            await db.execute(select(Order).where(Order.id == result["orderId"]))
        ).scalars().one()
        assert order.order_status == "CONFIRMED"
        assert order.fulfillment_status == "NOT_REQUIRED"
        assert order.billing_status == "INITIALIZED"
        assert quote.stage == "CONFIRMED"
        invoice = (
            await db.execute(select(Invoice).where(Invoice.id == result["oneTimeInvoiceId"]))
        ).scalars().one()
        assert invoice.status == "ISSUED"
        assert invoice.total_minor == 20000
        assert invoice.due_date == invoice.issue_date + timedelta(days=15)
        await db.rollback()


async def test_finalize_in_stock_only_shortfall_rolls_back():
    async with TestSession() as db:
        basis = await _seed_basis(db, stocked=True)
        quote = await _seed_quote(
            db, basis, qty=Decimal(5), backorder_terms="IN_STOCK_ONLY",
            stocked=True, on_hand=Decimal(0),
        )
        with pytest.raises(ApiException) as exc:
            await finalization.try_finalize(db, _actor(basis["profile"].id), quote.id)
        assert exc.value.code == ErrorCode.INSUFFICIENT_STOCK
        await db.rollback()
        remaining = (
            await db.execute(select(Order).where(Order.quote_id == quote.id))
        ).scalars().all()
        assert remaining == []
        await db.rollback()


async def test_allow_backorder_reserves_and_backorders():
    async with TestSession() as db:
        basis = await _seed_basis(db, stocked=True)
        quote, result = await _finalize(
            db, basis, qty=Decimal(5), backorder_terms="ALLOW_BACKORDER",
            stocked=True, on_hand=Decimal(2),
            expected_receipt=date.today() + timedelta(days=7),
        )
        assert result["status"] == "FINALIZED"
        assert result["hasShortage"] is True
        order = (
            await db.execute(select(Order).where(Order.id == result["orderId"]))
        ).scalars().one()
        assert order.fulfillment_status == "PARTIALLY_RESERVED"
        level = (
            await db.execute(
                select(StockLevel).where(
                    StockLevel.variant_id == basis["variant"].id)
            )
        ).scalars().one()
        assert level.reserved == Decimal(2)
        backorders = (
            await db.execute(
                select(Backorder).where(Backorder.order_id == order.id)
            )
        ).scalars().all()
        assert len(backorders) == 1
        assert backorders[0].quantity == Decimal(3)
        assert backorders[0].status == "OPEN"
        assert backorders[0].expected_date == date.today() + timedelta(days=7)
        shipments = (
            await db.execute(
                select(Shipment).where(Shipment.order_id == order.id)
            )
        ).scalars().all()
        assert len(shipments) == 1
        await db.rollback()


async def test_dispatch_consumes_and_replays_idempotently():
    async with TestSession() as db:
        basis = await _seed_basis(db, stocked=True)
        actor = _actor(basis["profile"].id)
        _quote, result = await _finalize(
            db, basis, qty=Decimal(5), backorder_terms="ALLOW_BACKORDER",
            stocked=True, on_hand=Decimal(2),
        )
        order_id = result["orderId"]
        shipment = (
            await db.execute(select(Shipment).where(Shipment.order_id == order_id))
        ).scalars().one()
        first = await fulfillment.dispatch(db, actor, shipment.id, tracking="TRK-1")
        assert first["status"] == "DISPATCHED"
        assert first["trackingReference"] == "TRK-1"
        level = (
            await db.execute(
                select(StockLevel).where(
                    StockLevel.variant_id == basis["variant"].id)
            )
        ).scalars().one()
        assert level.on_hand == Decimal(0)
        assert level.reserved == Decimal(0)
        movements = (
            await db.execute(
                select(StockMovement).where(
                    StockMovement.reference_id == shipment.id)
            )
        ).scalars().all()
        assert len(movements) == 1
        assert movements[0].quantity == Decimal(-2)
        order = (
            await db.execute(select(Order).where(Order.id == order_id))
        ).scalars().one()
        assert order.fulfillment_status == "PARTIALLY_DISPATCHED"
        # Idempotent replay: no further stock change, no extra movement.
        second = await fulfillment.dispatch(db, actor, shipment.id, tracking="TRK-2")
        assert second["status"] == "DISPATCHED"
        assert second["trackingReference"] == "TRK-1"
        level2 = (
            await db.execute(
                select(StockLevel).where(
                    StockLevel.variant_id == basis["variant"].id)
            )
        ).scalars().one()
        assert level2.on_hand == Decimal(0)
        rerun = (
            await db.execute(
                select(StockMovement).where(
                    StockMovement.reference_id == shipment.id)
            )
        ).scalars().all()
        assert len(rerun) == 1
        await db.rollback()


async def test_stock_movement_receipt_replays_by_key():
    async with TestSession() as db:
        basis = await _seed_basis(db, stocked=True)
        actor = _actor(basis["profile"].id)
        key = unique("key")
        payload = {
            "variantId": basis["variant"].id,
            "warehouseId": basis["warehouse"].id,
            "quantity": Decimal(10),
            "movementType": "RECEIPT",
            "expectedNextReceiptDate": None,
            "expectedNextReceiptQty": None,
            "note": "goods in",
        }
        first = await fulfillment.record_movement(db, actor, dict(payload), key)
        assert first["replayed"] is False
        level = (
            await db.execute(
                select(StockLevel).where(
                    StockLevel.variant_id == basis["variant"].id)
            )
        ).scalars().one()
        assert level.on_hand == Decimal(10)
        replay = await fulfillment.record_movement(
            db, actor, dict(payload, quantity=Decimal(99)), key)
        assert replay["replayed"] is True
        assert replay["movement"]["id"] == first["movement"]["id"]
        level2 = (
            await db.execute(
                select(StockLevel).where(
                    StockLevel.variant_id == basis["variant"].id)
            )
        ).scalars().one()
        assert level2.on_hand == Decimal(10)
        await db.rollback()


async def test_override_infeasible_leaves_reservations_untouched():
    async with TestSession() as db:
        basis = await _seed_basis(db, stocked=True)
        actor = _actor(basis["profile"].id)
        _quote, result = await _finalize(
            db, basis, qty=Decimal(5), backorder_terms="ALLOW_BACKORDER",
            stocked=True, on_hand=Decimal(2),
        )
        order_id = result["orderId"]
        lines = await fulfillment._order_lines(db, order_id)
        held_before = (
            await db.execute(
                select(Reservation).where(
                    Reservation.order_id == order_id,
                    Reservation.status == "HELD",
                )
            )
        ).scalars().all()
        assert sum((r.quantity for r in held_before), Decimal(0)) == Decimal(2)
        with pytest.raises(ApiException) as exc:
            await fulfillment.override_allocation(
                db, actor, order_id,
                [{
                    "orderLineId": lines[0].id,
                    "warehouseId": basis["warehouse"].id,
                    "quantity": Decimal(100),
                }],
                reason="too much",
            )
        assert exc.value.code == ErrorCode.ALLOCATION_INFEASIBLE
        assert "problems" in exc.value.details
        held_after = (
            await db.execute(
                select(Reservation).where(
                    Reservation.order_id == order_id,
                    Reservation.status == "HELD",
                )
            )
        ).scalars().all()
        assert sum((r.quantity for r in held_after), Decimal(0)) == Decimal(2)
        level = (
            await db.execute(
                select(StockLevel).where(
                    StockLevel.variant_id == basis["variant"].id)
            )
        ).scalars().one()
        assert level.reserved == Decimal(2)
        await db.rollback()


async def test_replan_consolidates_into_open_shipment():
    async with TestSession() as db:
        basis = await _seed_basis(db, stocked=True)
        actor = _actor(basis["profile"].id)
        _quote, result = await _finalize(
            db, basis, qty=Decimal(5), backorder_terms="ALLOW_BACKORDER",
            stocked=True, on_hand=Decimal(2),
        )
        order_id = result["orderId"]
        before = await fulfillment.order_fulfillment(
            db,
            (await db.execute(select(Order).where(Order.id == order_id))).scalars().one(),
        )
        assert before["replanSuggested"] is False
        await fulfillment.record_movement(
            db, actor,
            {
                "variantId": basis["variant"].id,
                "warehouseId": basis["warehouse"].id,
                "quantity": Decimal(10),
                "movementType": "RECEIPT",
                "expectedNextReceiptDate": None,
                "expectedNextReceiptQty": None,
                "note": None,
            },
            unique("key"),
        )
        plan = await fulfillment.replan(db, actor, order_id)
        assert plan is not None
        assert plan["fullyFulfilled"] is True
        open_bos = (
            await db.execute(
                select(Backorder).where(
                    Backorder.order_id == order_id,
                    Backorder.status == "OPEN",
                )
            )
        ).scalars().all()
        assert open_bos == []
        order = (
            await db.execute(select(Order).where(Order.id == order_id))
        ).scalars().one()
        assert order.fulfillment_status == "RESERVED"
        open_shipments = (
            await db.execute(
                select(Shipment).where(
                    Shipment.order_id == order_id,
                    Shipment.status.in_(("DRAFT", "RESERVED")),
                )
            )
        ).scalars().all()
        assert len(open_shipments) == 1
        slines = (
            await db.execute(
                select(ShipmentLine).where(
                    ShipmentLine.shipment_id == open_shipments[0].id)
            )
        ).scalars().all()
        assert sum((s.quantity for s in slines), Decimal(0)) == Decimal(5)
        await db.rollback()


async def test_router_orders_and_allocation_wiring():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.deps import get_current_actor
    from app.api.v1.routers.orders import router as orders_router
    from app.core.database import get_db
    from tests.itutil import _get_test_db

    async with TestSession() as db:
        basis = await _seed_basis(db, stocked=False)
        quote, result = await _finalize(
            db, basis, qty=Decimal(1), backorder_terms="ALLOW_BACKORDER", stocked=False,
        )
        await db.commit()
        order_id = str(result["orderId"])
        actor = _actor(basis["profile"].id)

    app = FastAPI()
    app.include_router(orders_router)
    app.dependency_overrides[get_db] = _get_test_db
    app.dependency_overrides[get_current_actor] = lambda: actor
    client = TestClient(app, raise_server_exceptions=False)

    listed = client.get("/api/v1/orders")
    assert listed.status_code == 200, listed.text
    assert listed.json()["data"], "seeded order must be listed"

    detail = client.get(f"/api/v1/orders/{order_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["data"]["reference"].startswith("SO-")

    allocation = client.get(f"/api/v1/orders/{order_id}/allocation")
    assert allocation.status_code == 200, allocation.text
    assert allocation.json()["data"]["fullyFulfilled"] is True

    levels = client.get("/api/v1/stock-levels")
    assert levels.status_code == 200, levels.text
