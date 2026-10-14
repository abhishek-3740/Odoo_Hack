"""Step E verification — quotes + approvals + escalations + recommendations.

Flow-A style draft totals with a NOT_REQUIRED submit path, Flow-B style
MANAGER_FINANCE chain (sequence violation, self-approval, stale version),
idempotent cancel, escalation replay/resolve and the recommendation
dismiss/apply flow. Minimal catalog is seeded in-test with unique codes.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.api.deps import get_current_actor
from app.api.v1.routers.quotes import router as quotes_router
from app.core.database import get_db
from app.core.security import Actor
from app.main import create_app
from app.models.auth import Profile, Team
from app.models.catalog import Category, Customer, Product, ProductVariant
from app.models.policy import DiscountPolicy
from tests.itutil import TestSession, _get_test_db, unique

pytestmark = pytest.mark.asyncio


def seed_policy_definition(hw_code: str = "HARDWARE", svc_code: str = "SERVICE") -> dict:
    return {
        "tierCeilingPercent": {"BRONZE": "5", "SILVER": "10", "GOLD": "15"},
        "categoryCeilingPercent": {hw_code: "15", svc_code: "10", "SUBSCRIPTION": "10"},
        "manager": {
            "anyPositiveExcess": True,
            "aggregateDiscountPercentAbove": "12",
            "aggregateMarginPercentBelow": "20",
        },
        "finance": {
            "worstLineExcessPpAtLeast": "8",
            "weightedExcessPpAtLeast": "3",
            "excessValueMinorAtLeast": 500000,
            "aggregateMarginPercentBelow": "15",
            "nonPositiveLineContribution": True,
        },
    }


class Ctx:
    def __init__(self, app, box):
        self.app = app
        self.box = box
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    def act(self, actor: Actor) -> "Ctx":
        self.box["actor"] = actor
        return self

    async def post(self, path: str, json: dict | None = None, key: str | None = None):
        headers = {"Idempotency-Key": key} if key else None
        return await self.client.post(path, json=json or {}, headers=headers)

    async def get(self, path: str):
        return await self.client.get(path)


@pytest.fixture
def ctx():
    app = create_app()
    app.include_router(quotes_router)
    box = {"actor": None}
    app.dependency_overrides[get_db] = _get_test_db
    app.dependency_overrides[get_current_actor] = lambda: box["actor"]
    return Ctx(app, box)


def actor_of(profile: Profile) -> Actor:
    return Actor(
        profile_id=profile.id,
        auth_user_id=profile.auth_user_id,
        email=profile.email,
        role=profile.role,
        team_id=profile.team_id,
        customer_id=profile.customer_id,
    )


async def make_profile(s, role: str, team_id=None, customer_id=None) -> Profile:
    profile = Profile(
        auth_user_id=uuid.uuid4(),
        email=unique("user") + "@test.dev",
        full_name=f"{role} {uuid.uuid4().hex[:4]}",
        role=role,
        team_id=team_id,
        customer_id=customer_id,
        is_active=True,
    )
    s.add(profile)
    await s.flush()
    return profile


async def seed_world(
    tier: str = "BRONZE",
    owner_role: str = "REP",
    with_service: bool = False,
    promoted_extra: int = 0,
):
    """Seed team, staff, customer, hardware catalog and a live policy."""
    async with TestSession() as s:
        team = Team(name=unique("team"))
        s.add(team)
        await s.flush()
        owner = await make_profile(s, owner_role, team.id)
        manager = await make_profile(s, "MANAGER", team.id)
        finance = await make_profile(s, "FINANCE", None)
        admin = await make_profile(s, "ADMIN", None)
        customer = Customer(name=unique("cust"), tier=tier, currency="INR", is_active=True)
        s.add(customer)
        await s.flush()
        hw = Category(code=unique("HW"), name="Hardware", kind="HARDWARE", is_active=True)
        s.add(hw)
        await s.flush()
        svc_code = unique("SVC")
        if with_service:
            svc = Category(code=svc_code, name="Service", kind="SERVICE", is_active=True)
            s.add(svc)
            await s.flush()
        laptop = Product(
            category_id=hw.id, code=unique("LAP"), name="Laptop", base_price_minor=1_000_000,
            base_cost_minor=700_000, currency="INR", tax_rate_bp=0,
            fulfillment_kind="STOCK", charge_kind="ONE_TIME", quantity_mode="INTEGER",
            promoted=False, is_active=True,
        )
        dock = Product(
            category_id=hw.id, code=unique("DOCK"), name="Dock", base_price_minor=100_000,
            base_cost_minor=70_000, currency="INR", tax_rate_bp=0,
            fulfillment_kind="NONE", charge_kind="ONE_TIME", quantity_mode="INTEGER",
            promoted=False, is_active=True,
        )
        s.add_all([laptop, dock])
        await s.flush()
        laptop_v = ProductVariant(
            product_id=laptop.id, sku=unique("SKU"), name="Laptop 16", is_active=True)
        dock_v = ProductVariant(
            product_id=dock.id, sku=unique("SKU"), name="Dock Pro", is_active=True)
        s.add_all([laptop_v, dock_v])
        setup_v = None
        if with_service:
            setup = Product(
                category_id=svc.id, code=unique("SETUP"), name="Setup",
                base_price_minor=500_000, base_cost_minor=350_000, currency="INR",
                tax_rate_bp=0, fulfillment_kind="NONE", charge_kind="ONE_TIME",
                quantity_mode="INTEGER", promoted=False, is_active=True,
            )
            s.add(setup)
            await s.flush()
            setup_v = ProductVariant(
                product_id=setup.id, sku=unique("SKU"), name="Setup visit", is_active=True)
            s.add(setup_v)
        extras = []
        for _ in range(promoted_extra):
            extra = Product(
                category_id=hw.id, code=unique("EXTRA"), name="Extra " + unique("x"),
                base_price_minor=50_000, base_cost_minor=20_000, currency="INR",
                tax_rate_bp=0, fulfillment_kind="NONE", charge_kind="ONE_TIME",
                quantity_mode="INTEGER", promoted=True, is_active=True,
            )
            s.add(extra)
            await s.flush()
            extra_v = ProductVariant(
                product_id=extra.id, sku=unique("SKU"), name=extra.name, is_active=True)
            s.add(extra_v)
            await s.flush()
            extras.append(extra_v)
        version_no = ((await s.execute(select(func.max(DiscountPolicy.version_no)))).scalar() or 0) + 1
        s.add(DiscountPolicy(
            version_no=version_no,
            definition=seed_policy_definition(hw.code, svc_code),
            effective_at=datetime.now(timezone.utc), note="test",
        ))
        await s.commit()
        return {
            "team": team, "owner": owner, "manager": manager, "finance": finance,
            "admin": admin, "customer": customer, "laptop_v": laptop_v,
            "dock_v": dock_v, "setup_v": setup_v, "extras": extras,
        }


async def create_and_draft(ctx: Ctx, world: dict, lines: list[dict]) -> dict:
    ctx.act(actor_of(world["owner"]))
    response = await ctx.post("/api/v1/quotes", {"customerId": str(world["customer"].id)})
    assert response.status_code == 201, response.text
    quote_id = response.json()["data"]["quoteId"]
    response = await ctx.post(
        f"/api/v1/quotes/{quote_id}/revisions", {"lines": lines, "orderDiscountBp": 0})
    assert response.status_code == 200, response.text
    return {"quote_id": quote_id, "draft": response.json()["data"]}


# ------------------------------------------------------------------ Flow A ---


async def test_flow_a_draft_totals_and_not_required_submit(ctx: Ctx):
    world = await seed_world(tier="BRONZE")
    ctx.act(actor_of(world["owner"]))
    created = await create_and_draft(ctx, world, [
        {"lineKey": "a", "variantId": str(world["laptop_v"].id), "quantity": "2"},
        {"lineKey": "b", "variantId": str(world["dock_v"].id), "quantity": "1"},
    ])
    draft = created["draft"]
    assert draft["totals"]["oneTimeNet"] == "21000.00"
    assert draft["risk"]["requiredLevel"] == "NONE"
    assert draft["lines"][0]["quantity"] == "2"

    submitted = await ctx.post(
        f"/api/v1/quotes/{created['quote_id']}/submissions",
        {"expectedRevisionId": draft["revisionId"]})
    assert submitted.status_code == 200, submitted.text
    data = submitted.json()["data"]
    assert data["gates"]["approvalStatus"] == "NOT_REQUIRED"
    assert data["gates"]["sellerAdopted"] is True
    assert data["gates"]["customerAccepted"] is False
    assert data["approvals"] == []

    shared = await ctx.post(f"/api/v1/quotes/{created['quote_id']}/shares")
    assert shared.status_code == 200, shared.text
    assert shared.json()["data"]["stage"] == "SENT"
    assert shared.json()["data"]["portalPath"].endswith(created["quote_id"])

    history = await ctx.get(f"/api/v1/quotes/{created['quote_id']}/history")
    actions = [event["action"] for event in history.json()["data"]]
    assert {"QUOTE_CREATED", "QUOTE_SUBMITTED", "QUOTE_SHARED"} <= set(actions)

    customer = await make_profile_holder(world)
    ctx.act(customer)
    denied = await ctx.get("/api/v1/quotes")
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "FORBIDDEN"


async def make_profile_holder(world: dict) -> Actor:
    async with TestSession() as s:
        buyer = await make_profile(s, "CUSTOMER", None, world["customer"].id)
        await s.commit()
        return actor_of(buyer)


async def test_approval_single_get_customer_404(ctx: Ctx):
    world = await seed_world(tier="BRONZE")
    created = await create_and_draft(ctx, world, [
        {"lineKey": "a", "variantId": str(world["laptop_v"].id), "quantity": "1"},
    ])
    submitted = await ctx.post(
        f"/api/v1/quotes/{created['quote_id']}/submissions",
        {"expectedRevisionId": created["draft"]["revisionId"]})
    assert submitted.status_code == 200
    ctx.act(await make_profile_holder(world))
    missing = await ctx.get(f"/api/v1/approval-requests/{uuid.uuid4()}")
    assert missing.status_code == 404


# ------------------------------------------------------------------ Flow B ---


async def test_flow_b_manager_finance_chain(ctx: Ctx):
    world = await seed_world(tier="GOLD", owner_role="MANAGER", with_service=True)
    created = await create_and_draft(ctx, world, [
        {"lineKey": "laptops", "variantId": str(world["laptop_v"].id),
         "quantity": "4", "lineDiscountBp": 1200},
        {"lineKey": "setup", "variantId": str(world["setup_v"].id),
         "quantity": "1", "lineDiscountBp": 1800},
    ])
    draft = created["draft"]
    assert draft["totals"]["oneTimeNet"] == "39300.00"
    assert draft["totals"]["contribution"] == "7800.00"
    assert draft["risk"]["requiredLevel"] == "MANAGER_FINANCE"

    ctx.act(actor_of(world["owner"]))
    submitted = await ctx.post(
        f"/api/v1/quotes/{created['quote_id']}/submissions",
        {"expectedRevisionId": draft["revisionId"]})
    assert submitted.status_code == 200, submitted.text
    data = submitted.json()["data"]
    assert data["gates"]["approvalStatus"] == "PENDING_MANAGER"
    assert len(data["approvals"]) == 2
    manager_step = next(s for s in data["approvals"] if s["step"] == 1)
    finance_step = next(s for s in data["approvals"] if s["step"] == 2)

    # Finance cannot act before the manager step.
    ctx.act(actor_of(world["finance"]))
    too_early = await ctx.post(
        f"/api/v1/approval-requests/{finance_step['id']}/decisions",
        {"decision": "APPROVE"}, key=unique("k"))
    assert too_early.status_code == 409
    assert too_early.json()["error"]["code"] == "APPROVAL_SEQUENCE_VIOLATION"

    # The owning manager cannot approve their own deal.
    ctx.act(actor_of(world["owner"]))
    own = await ctx.post(
        f"/api/v1/approval-requests/{manager_step['id']}/decisions",
        {"decision": "APPROVE"}, key=unique("k"))
    assert own.status_code == 403
    assert own.json()["error"]["code"] == "SELF_APPROVAL_FORBIDDEN"

    # Stale step version.
    ctx.act(actor_of(world["manager"]))
    stale = await ctx.post(
        f"/api/v1/approval-requests/{manager_step['id']}/decisions",
        {"decision": "APPROVE", "expectedRowVersion": 999}, key=unique("k"))
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "STALE_VERSION"

    first = await ctx.post(
        f"/api/v1/approval-requests/{manager_step['id']}/decisions",
        {"decision": "APPROVE"}, key=unique("k"))
    assert first.status_code == 200, first.text
    assert first.json()["data"]["revisionApprovalStatus"] == "PENDING_FINANCE"

    ctx.act(actor_of(world["finance"]))
    second = await ctx.post(
        f"/api/v1/approval-requests/{finance_step['id']}/decisions",
        {"decision": "APPROVE"}, key=unique("k"))
    assert second.status_code == 200, second.text
    assert second.json()["data"]["revisionApprovalStatus"] == "APPROVED"
    assert second.json()["data"]["finalizationStatus"] == "WAITING"

    # A decided step is immutable.
    ctx.act(actor_of(world["manager"]))
    again = await ctx.post(
        f"/api/v1/approval-requests/{manager_step['id']}/decisions",
        {"decision": "REJECT"}, key=unique("k"))
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "APPROVAL_ALREADY_DECIDED"

    # Manager queue is team-scoped and shows the decided steps.
    queued = await ctx.get("/api/v1/approval-requests?status=APPROVED")
    assert queued.status_code == 200
    assert any(item["quoteReference"] for item in queued.json()["data"])


# ------------------------------------------------------------- cancel etc ---


async def test_cancel_idempotent_and_stale_draft(ctx: Ctx):
    world = await seed_world(tier="BRONZE")
    created = await create_and_draft(ctx, world, [
        {"lineKey": "a", "variantId": str(world["dock_v"].id), "quantity": "1"},
    ])
    ctx.act(actor_of(world["owner"]))
    stale = await ctx.post(
        f"/api/v1/quotes/{created['quote_id']}/revisions",
        {"lines": [{"lineKey": "a", "variantId": str(world['dock_v'].id), "quantity": "1"}],
         "expectedRowVersion": 999})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "STALE_QUOTE_VERSION"

    first = await ctx.post(f"/api/v1/quotes/{created['quote_id']}/cancellations", {"reason": "no"})
    assert first.status_code == 200
    assert first.json()["data"]["stage"] == "CANCELED"
    second = await ctx.post(f"/api/v1/quotes/{created['quote_id']}/cancellations", {"reason": "no"})
    assert second.status_code == 200
    assert second.json()["data"]["stage"] == "CANCELED"


# -------------------------------------------------------------- escalation ---


async def test_escalation_create_list_resolve_replay(ctx: Ctx):
    world = await seed_world(tier="BRONZE")
    created = await create_and_draft(ctx, world, [
        {"lineKey": "a", "variantId": str(world["laptop_v"].id), "quantity": "1"},
    ])
    ctx.act(actor_of(world["owner"]))
    submitted = await ctx.post(
        f"/api/v1/quotes/{created['quote_id']}/submissions",
        {"expectedRevisionId": created["draft"]["revisionId"]})
    assert submitted.status_code == 200
    revision_id = submitted.json()["data"]["revisionId"]
    key = str(uuid.uuid4())
    payload = {
        "quoteId": created["quote_id"], "expectedRevisionId": revision_id,
        "requestKey": key, "category": "DISCOUNT", "reason": "Need a deeper cut.",
    }
    opened = await ctx.post("/api/v1/escalations", payload)
    assert opened.status_code == 200, opened.text
    assert opened.json()["data"]["targetRole"] == "FINANCE"
    escalation_id = opened.json()["data"]["id"]

    listed = await ctx.get(f"/api/v1/escalations?quoteId={created['quote_id']}")
    assert listed.status_code == 200
    assert any(e["id"] == escalation_id for e in listed.json()["data"])

    replay = await ctx.post("/api/v1/escalations", payload)
    assert replay.status_code == 200
    assert replay.json()["data"]["id"] == escalation_id

    ctx.act(actor_of(world["finance"]))
    resolved = await ctx.post(
        f"/api/v1/escalations/{escalation_id}/resolutions", {"resolution": "Granted 2pp."})
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["data"]["status"] == "RESOLVED"

    again = await ctx.post(
        f"/api/v1/escalations/{escalation_id}/resolutions", {"resolution": "Again."})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "CONFLICTING_STATE"


# ---------------------------------------------------------- recommendations ---


async def test_recommendation_dismiss_and_apply(ctx: Ctx):
    world = await seed_world(tier="BRONZE", promoted_extra=2)
    assert len(world["extras"]) == 2
    created = await create_and_draft(ctx, world, [
        {"lineKey": "a", "variantId": str(world["laptop_v"].id), "quantity": "1"},
    ])
    ctx.act(actor_of(world["owner"]))

    first = await ctx.get(f"/api/v1/quotes/{created['quote_id']}/recommendations")
    assert first.status_code == 200, first.text
    data = first.json()["data"]
    assert data["limitedHistory"] is True
    # The shared test DB holds other seeds too: work with what is offered.
    assert len(data["suggestions"]) >= 2, data["suggestions"]
    assert all(s["basis"] == "LIMITED_HISTORY" for s in data["suggestions"])
    drop, keep = data["suggestions"][0], data["suggestions"][1]

    dismissed = await ctx.post(
        f"/api/v1/quotes/{created['quote_id']}/recommendation-dismissals",
        {"variantId": drop["variantId"]})
    assert dismissed.status_code == 200
    assert dismissed.json()["data"]["dismissed"] is True

    second = await ctx.get(f"/api/v1/quotes/{created['quote_id']}/recommendations")
    remaining = {s["variantId"] for s in second.json()["data"]["suggestions"]}
    assert drop["variantId"] not in remaining
    assert keep["variantId"] in remaining

    applied = await ctx.post(
        f"/api/v1/quotes/{created['quote_id']}/recommendation-applications",
        {"variantId": keep["variantId"],
         "expectedRevisionId": second.json()["data"]["revisionId"],
         "expectedRowVersion": second.json()["data"]["rowVersion"]})
    assert applied.status_code == 200, applied.text
    assert len(applied.json()["data"]["lines"]) == 2
