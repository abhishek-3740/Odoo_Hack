"""Step G verification — end-to-end Flow A / Flow B / concurrency over HTTP.

Full app (all routers) against dealflow_test. Worlds are seeded per-test with
unique codes; actor switches via the override box.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_actor
from app.core.security import Actor
from app.main import create_app
from app.models.auth import Profile, Team
from app.models.catalog import Category, Customer, Product, ProductVariant
from app.models.fulfillment import StockLevel, Warehouse
from app.models.policy import DiscountPolicy
from tests.itutil import TestSession, _get_test_db, unique

pytestmark = pytest.mark.asyncio


class Ctx:
    def __init__(self, app, box):
        self.app = app
        self.box = box
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    def act(self, actor: Actor) -> "Ctx":
        self.box["actor"] = actor
        return self

    async def post(self, path, json=None, key=None, params=None):
        headers = {"Idempotency-Key": key} if key else None
        return await self.client.post(path, json=json or {}, headers=headers, params=params)

    async def get(self, path, params=None):
        return await self.client.get(path, params=params)


@pytest.fixture
def ctx():
    app = create_app()
    box = {"actor": None}
    from app.core.database import get_db

    app.dependency_overrides[get_db] = _get_test_db
    app.dependency_overrides[get_current_actor] = lambda: box["actor"]
    return Ctx(app, box)


def actor_of(profile: Profile) -> Actor:
    return Actor(
        profile_id=profile.id, auth_user_id=profile.auth_user_id, email=profile.email,
        role=profile.role, team_id=profile.team_id, customer_id=profile.customer_id,
    )


def policy_definition(hw: str, svc: str) -> dict:
    return {
        "tierCeilingPercent": {"BRONZE": "5", "SILVER": "10", "GOLD": "15"},
        "categoryCeilingPercent": {hw: "15", svc: "10", "SUBSCRIPTION": "10"},
        "manager": {"anyPositiveExcess": True, "aggregateDiscountPercentAbove": "12",
                    "aggregateMarginPercentBelow": "20"},
        "finance": {"worstLineExcessPpAtLeast": "8", "weightedExcessPpAtLeast": "3",
                    "excessValueMinorAtLeast": 500000,
                    "aggregateMarginPercentBelow": "15",
                    "nonPositiveLineContribution": True},
    }


async def seed_flow_world(*, laptop_stock: str = "4", dock_stock: str = "10"):
    async with TestSession() as s:
        team = Team(name=unique("team"))
        s.add(team)
        await s.flush()

        async def profile(role, team_id=None, customer_id=None):
            p = Profile(auth_user_id=uuid.uuid4(), email=unique("u") + "@t.dev",
                        full_name=role, role=role, team_id=team_id,
                        customer_id=customer_id, is_active=True)
            s.add(p)
            await s.flush()
            return p

        rep = await profile("REP", team.id)
        manager = await profile("MANAGER", team.id)
        finance = await profile("FINANCE")
        admin = await profile("ADMIN")
        bronze = Customer(name=unique("bronze"), tier="BRONZE", currency="INR", is_active=True)
        gold = Customer(name=unique("gold"), tier="GOLD", currency="INR", is_active=True)
        s.add_all([bronze, gold])
        await s.flush()
        buyer = await profile("CUSTOMER", None, bronze.id)
        buyer2 = await profile("CUSTOMER", None, gold.id)
        stranger_cust = Customer(name=unique("str"), tier="BRONZE", currency="INR", is_active=True)
        s.add(stranger_cust)
        await s.flush()
        stranger = await profile("CUSTOMER", None, stranger_cust.id)

        hw_code, svc_code = unique("HW"), unique("SVC")
        hw = Category(code=hw_code, name="Hardware", kind="HARDWARE", is_active=True)
        svc = Category(code=svc_code, name="Service", kind="SERVICE", is_active=True)
        s.add_all([hw, svc])
        await s.flush()
        laptop = Product(category_id=hw.id, code=unique("LAP"), name="Laptop",
                         base_price_minor=1_000_000, base_cost_minor=700_000,
                         currency="INR", tax_rate_bp=0, fulfillment_kind="STOCK",
                         charge_kind="ONE_TIME", quantity_mode="INTEGER", is_active=True)
        dock = Product(category_id=hw.id, code=unique("DOCK"), name="Dock",
                       base_price_minor=100_000, base_cost_minor=60_000,
                       currency="INR", tax_rate_bp=0, fulfillment_kind="STOCK",
                       charge_kind="ONE_TIME", quantity_mode="INTEGER", is_active=True)
        setup = Product(category_id=svc.id, code=unique("SETUP"), name="Setup",
                        base_price_minor=500_000, base_cost_minor=350_000,
                        currency="INR", tax_rate_bp=0, fulfillment_kind="NONE",
                        charge_kind="ONE_TIME", quantity_mode="INTEGER", is_active=True)
        s.add_all([laptop, dock, setup])
        await s.flush()
        lap_v = ProductVariant(product_id=laptop.id, sku=unique("SKU"), name="Lap", is_active=True)
        dock_v = ProductVariant(product_id=dock.id, sku=unique("SKU"), name="Dock", is_active=True)
        setup_v = ProductVariant(product_id=setup.id, sku=unique("SKU"), name="Setup", is_active=True)
        s.add_all([lap_v, dock_v, setup_v])
        await s.flush()
        main = Warehouse(code=unique("MAIN"), name="Main", shipping_fixed_cost_minor=10_000,
                         shipping_cost_per_kg_minor=0, sort_order=1, is_active=True)
        s.add(main)
        await s.flush()
        s.add_all([
            StockLevel(warehouse_id=main.id, variant_id=lap_v.id,
                       on_hand=Decimal(laptop_stock), reserved=Decimal(0),
                       reorder_point=Decimal(1), target_qty=Decimal(6)),
            StockLevel(warehouse_id=main.id, variant_id=dock_v.id,
                       on_hand=Decimal(dock_stock), reserved=Decimal(0),
                       reorder_point=Decimal(1), target_qty=Decimal(12)),
        ])
        version_no = ((await s.execute(select(func.max(DiscountPolicy.version_no)))).scalar() or 0) + 1
        s.add(DiscountPolicy(version_no=version_no, definition=policy_definition(hw_code, svc_code),
                             effective_at=datetime.now(timezone.utc), note="flow"))
        await s.commit()
        return {
            "rep": actor_of(rep), "manager": actor_of(manager),
            "finance": actor_of(finance), "admin": actor_of(admin),
            "buyer": actor_of(buyer), "buyer2": actor_of(buyer2),
            "stranger": actor_of(stranger), "bronze": bronze, "gold": gold,
            "lap_v": lap_v, "dock_v": dock_v, "setup_v": setup_v, "main": main,
        }


# ------------------------------------------------------------------ Flow A ---


async def test_flow_a_end_to_end(ctx: Ctx):
    w = await seed_flow_world()
    ctx.act(w["rep"])
    created = await ctx.post("/api/v1/quotes", {"customerId": str(w["bronze"].id)})
    assert created.status_code == 201, created.text
    qid = created.json()["data"]["quoteId"]

    draft = await ctx.post(f"/api/v1/quotes/{qid}/revisions", {
        "lines": [
            {"lineKey": "l1", "variantId": str(w["lap_v"].id), "quantity": "2"},
            {"lineKey": "l2", "variantId": str(w["dock_v"].id), "quantity": "1"},
        ],
        "orderDiscountBp": 0,
    })
    assert draft.status_code == 200, draft.text
    assert draft.json()["data"]["totals"]["oneTimeNet"] == "21000.00"
    rev = draft.json()["data"]["revisionId"]

    submitted = await ctx.post(f"/api/v1/quotes/{qid}/submissions", {"expectedRevisionId": rev})
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["data"]["gates"]["approvalStatus"] == "NOT_REQUIRED"

    shared = await ctx.post(f"/api/v1/quotes/{qid}/shares")
    assert shared.json()["data"]["stage"] == "SENT"

    ctx.act(w["buyer"])
    view = await ctx.get(f"/api/v1/portal/quotes/{qid}")
    assert view.status_code == 200, view.text
    detail = view.json()["data"]
    assert detail["acceptable"] is True
    assert detail["awaitingInternalApproval"] is False
    assert detail["totals"]["dueOnConfirmation"] == "21000.00"
    assert "unitCost" not in str(detail) and "margin" not in str(detail).lower().replace(
        "accountmanager", "")

    ctx.act(w["stranger"])
    assert (await ctx.get(f"/api/v1/portal/quotes/{qid}")).status_code == 404

    ctx.act(w["buyer"])
    accept = await ctx.post(f"/api/v1/portal/quotes/{qid}/acceptances",
                            {"revisionId": rev, "commercialHash": detail["commercialHash"]},
                            key=unique("acc"))
    assert accept.status_code == 200, accept.text
    body = accept.json()["data"]
    assert body["accepted"] is True and body["conditional"] is False
    assert body["orderReference"].startswith("SO-")

    ctx.act(w["rep"])
    orders = await ctx.get("/api/v1/orders", params={"customerId": str(w["bronze"].id)})
    assert orders.status_code == 200, orders.text
    order = orders.json()["data"][0]
    assert order["orderStatus"] == "CONFIRMED"
    assert order["fulfillmentStatus"] == "RESERVED"
    assert order["billingStatus"] == "INITIALIZED"

    fulfil = await ctx.get(f"/api/v1/orders/{order['id']}/fulfillment")
    fdata = fulfil.json()["data"]
    assert len(fdata["shipments"]) == 1 and fdata["backorders"] == []
    shipment_id = fdata["shipments"][0]["id"]

    invoices = await ctx.get("/api/v1/invoices", params={"orderId": order["id"]})
    inv = invoices.json()["data"][0]
    assert inv["status"] == "ISSUED" and inv["total"] == "21000.00"

    ctx.act(w["finance"])
    dispatch = await ctx.post(f"/api/v1/shipments/{shipment_id}/dispatches", {})
    assert dispatch.status_code == 200, dispatch.text
    assert dispatch.json()["data"]["status"] == "DISPATCHED"

    levels = await ctx.get("/api/v1/stock-levels", params={"variantId": str(w["lap_v"].id)})
    lap = levels.json()["data"][0]
    assert lap["onHand"] == "2" and lap["reserved"] == "0"

    ctx.act(w["rep"])
    denied_pay = await ctx.post("/api/v1/payments", {
        "customerId": str(w["bronze"].id), "amount": "1.00", "method": "BANK"},
        key=unique("k"))
    assert denied_pay.status_code == 403

    ctx.act(w["finance"])
    pay1 = await ctx.post("/api/v1/payments", {
        "customerId": str(w["bronze"].id), "amount": "5000.00", "method": "BANK"},
        key=unique("k"))
    assert pay1.status_code == 200, pay1.text
    inv1 = await ctx.get(f"/api/v1/invoices/{inv['id']}")
    assert inv1.json()["data"]["status"] == "PARTIALLY_PAID"
    pay2 = await ctx.post("/api/v1/payments", {
        "customerId": str(w["bronze"].id), "amount": "16000.00", "method": "BANK"},
        key=unique("k"))
    assert pay2.status_code == 200, pay2.text
    inv2 = await ctx.get(f"/api/v1/invoices/{inv['id']}")
    assert inv2.json()["data"]["status"] == "PAID"
    assert inv2.json()["data"]["outstanding"] == "0.00"

    ctx.act(w["buyer"])
    closed = await ctx.post(f"/api/v1/portal/quotes/{qid}/requests", {
        "requestType": "COUNTER", "expectedRevisionId": rev,
        "requestedOrderDiscountBp": 500}, key=unique("k"))
    assert closed.status_code == 409
    assert closed.json()["error"]["code"] == "NEGOTIATION_CLOSED"


# ------------------------------------------------------------------ Flow B ---


async def test_flow_b_negotiation_counter_and_backorder(ctx: Ctx):
    w = await seed_flow_world(laptop_stock="2")
    ctx.act(w["rep"])
    created = await ctx.post("/api/v1/quotes", {"customerId": str(w["gold"].id)})
    qid = created.json()["data"]["quoteId"]
    draft = await ctx.post(f"/api/v1/quotes/{qid}/revisions", {
        "lines": [
            {"lineKey": "l1", "variantId": str(w["lap_v"].id), "quantity": "4",
             "lineDiscountBp": 1200},
            {"lineKey": "l2", "variantId": str(w["setup_v"].id), "quantity": "1",
             "lineDiscountBp": 1800},
        ],
        "orderDiscountBp": 0,
    })
    assert draft.json()["data"]["totals"]["oneTimeNet"] == "39300.00"
    assert draft.json()["data"]["risk"]["requiredLevel"] == "MANAGER_FINANCE"
    rev1 = draft.json()["data"]["revisionId"]

    submitted = await ctx.post(f"/api/v1/quotes/{qid}/submissions", {"expectedRevisionId": rev1})
    steps = submitted.json()["data"]["approvals"]
    assert len(steps) == 2
    mgr_step = next(s for s in steps if s["step"] == 1)
    fin_step = next(s for s in steps if s["step"] == 2)

    ctx.act(w["manager"])
    assert (await ctx.post(
        f"/api/v1/approval-requests/{mgr_step['id']}/decisions",
        {"decision": "APPROVE"}, key=unique("k"))).status_code == 200
    ctx.act(w["finance"])
    fin = await ctx.post(
        f"/api/v1/approval-requests/{fin_step['id']}/decisions",
        {"decision": "APPROVE"}, key=unique("k"))
    assert fin.json()["data"]["revisionApprovalStatus"] == "APPROVED"
    assert fin.json()["data"]["finalizationStatus"] == "WAITING"

    ctx.act(w["buyer2"])
    counter = await ctx.post(f"/api/v1/portal/quotes/{qid}/requests", {
        "requestType": "COUNTER", "expectedRevisionId": rev1,
        "requestedOrderDiscountBp": 1000}, key=unique("k"))
    assert counter.status_code == 200, counter.text
    v2 = counter.json()["data"]
    # 1000bp order discount composes: L1 eff 2080bp -> 31680.00, L2 eff 2620bp -> 3690.00
    assert v2["totals"]["oneTimeSubtotal"] == "35370.00"
    assert v2["orderDiscountBp"] == 1000

    stale = await ctx.post(f"/api/v1/portal/quotes/{qid}/acceptances",
                           {"revisionId": rev1, "commercialHash": v2["commercialHash"]},
                           key=unique("k"))
    assert stale.status_code == 409

    accept = await ctx.post(f"/api/v1/portal/quotes/{qid}/acceptances",
                            {"revisionId": v2["revisionId"],
                             "commercialHash": v2["commercialHash"]},
                            key=unique("k"))
    assert accept.status_code == 200, accept.text
    assert accept.json()["data"]["conditional"] is True
    assert accept.json()["data"].get("orderReference") is None

    ctx.act(w["rep"])
    adopt = await ctx.post(f"/api/v1/quotes/{qid}/adoptions", {"revisionId": v2["revisionId"]})
    assert adopt.status_code == 200, adopt.text
    approvals = adopt.json()["data"]["approvals"]
    assert len(approvals) == 2
    mgr2 = next(s for s in approvals if s["step"] == 1)
    fin2 = next(s for s in approvals if s["step"] == 2)

    ctx.act(w["manager"])
    assert (await ctx.post(
        f"/api/v1/approval-requests/{mgr2['id']}/decisions",
        {"decision": "APPROVE"}, key=unique("k"))).status_code == 200
    ctx.act(w["finance"])
    final = await ctx.post(
        f"/api/v1/approval-requests/{fin2['id']}/decisions",
        {"decision": "APPROVE"}, key=unique("k"))
    assert final.json()["data"]["finalizationStatus"] == "FINALIZED"
    assert final.json()["data"]["orderId"] is not None

    ctx.act(w["rep"])
    orders = await ctx.get("/api/v1/orders", params={"customerId": str(w["gold"].id)})
    order = orders.json()["data"][0]
    assert order["reference"].startswith("SO-")
    assert order["fulfillmentStatus"] == "PARTIALLY_RESERVED"
    fulfil = await ctx.get(f"/api/v1/orders/{order['id']}/fulfillment")
    fdata = fulfil.json()["data"]
    assert len(fdata["backorders"]) == 1
    assert fdata["backorders"][0]["quantity"] == "2"


async def test_in_stock_only_shortfall_rolls_back(ctx: Ctx):
    w = await seed_flow_world(laptop_stock="1")
    ctx.act(w["rep"])
    created = await ctx.post("/api/v1/quotes", {"customerId": str(w["gold"].id)})
    qid = created.json()["data"]["quoteId"]
    draft = await ctx.post(f"/api/v1/quotes/{qid}/revisions", {
        "lines": [{"lineKey": "l1", "variantId": str(w["lap_v"].id), "quantity": "5"}],
        "orderDiscountBp": 0, "backorderTerms": "IN_STOCK_ONLY",
    })
    rev = draft.json()["data"]["revisionId"]
    await ctx.post(f"/api/v1/quotes/{qid}/submissions", {"expectedRevisionId": rev})
    await ctx.post(f"/api/v1/quotes/{qid}/shares")

    ctx.act(w["buyer2"])
    view = await ctx.get(f"/api/v1/portal/quotes/{qid}")
    accept = await ctx.post(f"/api/v1/portal/quotes/{qid}/acceptances",
                            {"revisionId": rev,
                             "commercialHash": view.json()["data"]["commercialHash"]},
                            key=unique("k"))
    assert accept.status_code == 409
    assert accept.json()["error"]["code"] == "INSUFFICIENT_STOCK"

    ctx.act(w["rep"])
    orders = await ctx.get("/api/v1/orders", params={"customerId": str(w["gold"].id)})
    assert orders.json()["data"] == []


# ------------------------------------------------- concurrency/idempotency ---


async def test_parallel_accepts_create_single_order(ctx: Ctx):
    w = await seed_flow_world()
    ctx.act(w["rep"])
    qid = (await ctx.post("/api/v1/quotes", {"customerId": str(w["bronze"].id)})).json()["data"]["quoteId"]
    rev = (await ctx.post(f"/api/v1/quotes/{qid}/revisions", {
        "lines": [{"lineKey": "l1", "variantId": str(w["lap_v"].id), "quantity": "1"}],
        "orderDiscountBp": 0})).json()["data"]["revisionId"]
    await ctx.post(f"/api/v1/quotes/{qid}/submissions", {"expectedRevisionId": rev})
    await ctx.post(f"/api/v1/quotes/{qid}/shares")
    ctx.act(w["buyer"])
    chash = (await ctx.get(f"/api/v1/portal/quotes/{qid}")).json()["data"]["commercialHash"]

    async def accept(key):
        return await ctx.post(f"/api/v1/portal/quotes/{qid}/acceptances",
                              {"revisionId": rev, "commercialHash": chash}, key=key)

    first, second = await asyncio.gather(accept(unique("a")), accept(unique("b")))
    assert first.status_code == 200 and second.status_code == 200
    ctx.act(w["rep"])
    orders = await ctx.get("/api/v1/orders", params={"customerId": str(w["bronze"].id)})
    assert len(orders.json()["data"]) == 1


async def test_payment_idempotency_matrix_and_stale_version(ctx: Ctx):
    w = await seed_flow_world()
    ctx.act(w["finance"])
    key = unique("k")
    one = await ctx.post("/api/v1/payments", {
        "customerId": str(w["bronze"].id), "amount": "10.00", "method": "BANK"}, key=key)
    two = await ctx.post("/api/v1/payments", {
        "customerId": str(w["bronze"].id), "amount": "10.00", "method": "BANK"}, key=key)
    assert one.json()["data"]["id"] == two.json()["data"]["id"]
    reused = await ctx.post("/api/v1/payments", {
        "customerId": str(w["bronze"].id), "amount": "11.00", "method": "BANK"}, key=key)
    assert reused.status_code == 409
    assert reused.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED"
    missing = await ctx.post("/api/v1/payments", {
        "customerId": str(w["bronze"].id), "amount": "10.00", "method": "BANK"})
    assert missing.status_code == 400
    assert missing.json()["error"]["code"] == "IDEMPOTENCY_KEY_REQUIRED"

    ctx.act(w["rep"])
    qid = (await ctx.post("/api/v1/quotes", {"customerId": str(w["bronze"].id)})).json()["data"]["quoteId"]
    stale = await ctx.post(f"/api/v1/quotes/{qid}/revisions", {
        "lines": [{"lineKey": "l1", "variantId": str(w["lap_v"].id), "quantity": "1"}],
        "orderDiscountBp": 0, "expectedRowVersion": 999})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "STALE_QUOTE_VERSION"
