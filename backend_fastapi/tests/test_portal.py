"""PORTAL domain verification — customer self-service against dealflow_test.

Seeds its own catalogue/customer/quote/invoice rows (the shared test DB
starts empty) and drives the HTTP surface through TestClient with the
portal router mounted on a stock create_app() (main.py stays untouched).
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.api.v1.routers.portal import router as portal_router
from app.core.security import Actor, hash_password, verify_password
from app.main import create_app
from app.models.auth import Profile, Team
from app.models.billing import Invoice, InvoiceLine
from app.models.catalog import Category, Customer, Product, ProductVariant
from app.models.fulfillment import StockLevel, Warehouse
from app.models.orders import Order
from app.models.policy import DiscountPolicy
from app.models.quotes import Quote, QuoteLine, QuoteRevision
from app.services import portal_service
from tests.itutil import TestSession, override_app_deps, unique

POLICY_DEFINITION = {
    "tierCeilingPercent": {"BRONZE": 5, "SILVER": 10, "GOLD": 15},
    "categoryCeilingPercent": {"HARDWARE": 15, "SERVICE": 10, "SUBSCRIPTION": 10},
    "manager": {
        "anyPositiveExcess": True,
        "aggregateDiscountPercentAbove": 12,
        "aggregateMarginPercentBelow": 20,
    },
    "finance": {
        "worstLineExcessPpAtLeast": 8,
        "weightedExcessPpAtLeast": 3,
        "excessValueMinorAtLeast": 500000,
        "aggregateMarginPercentBelow": 15,
        "nonPositiveLineContribution": True,
    },
}

SEED: dict = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _next_policy_version(db) -> int:
    current = (await db.execute(select(func.max(DiscountPolicy.version_no)))).scalar()
    return (current or 0) + 1


async def _seed() -> dict:
    async with TestSession() as db:
        team = Team(name=unique("Team"))
        db.add(team)
        await db.flush()
        rep = Profile(
            auth_user_id=uuid.uuid4(), email=unique("rep") + "@test.dev",
            full_name="Rep One", role="REP", team_id=team.id, is_active=True,
        )
        db.add(rep)
        await db.flush()
        customer = Customer(
            name=unique("Acme"), tier="BRONZE", currency="INR",
            contact_email="buyer@acme.test", owner_rep_profile_id=rep.id,
            is_active=True,
        )
        db.add(customer)
        await db.flush()
        profile = Profile(
            auth_user_id=uuid.uuid4(), email=unique("buyer") + "@test.dev",
            full_name="Buyer", role="CUSTOMER", customer_id=customer.id,
            is_active=True, password_hash=hash_password("old-password-1"),
            preferences={},
        )
        db.add(profile)
        stranger_customer = Customer(
            name=unique("Stranger"), tier="GOLD", currency="INR", is_active=True,
        )
        db.add(stranger_customer)
        await db.flush()
        stranger = Profile(
            auth_user_id=uuid.uuid4(), email=unique("stranger") + "@test.dev",
            full_name="Stranger", role="CUSTOMER",
            customer_id=stranger_customer.id, is_active=True,
        )
        db.add(stranger)
        category = Category(code="HW-" + uuid.uuid4().hex[:6], name="Hardware", kind="HARDWARE")
        db.add(category)
        await db.flush()
        product = Product(
            category_id=category.id, code=unique("LAPTOP"), name="Laptop",
            base_price_minor=100000, base_cost_minor=60000, currency="INR",
            tax_rate_bp=1800, fulfillment_kind="STOCK", charge_kind="ONE_TIME",
            quantity_mode="INTEGER", promoted=True, is_active=True,
        )
        db.add(product)
        await db.flush()
        variant = ProductVariant(
            product_id=product.id, sku=unique("SKU"), name="Laptop Std",
            price_extra_minor=0, cost_minor=None, is_active=True,
        )
        db.add(variant)
        warehouse = Warehouse(code=unique("WH"), name="Main", is_active=True)
        db.add(warehouse)
        await db.flush()
        db.add(StockLevel(
            warehouse_id=warehouse.id, variant_id=variant.id,
            on_hand=100, reserved=0,
        ))
        db.add(DiscountPolicy(
            version_no=await _next_policy_version(db),
            definition=dict(POLICY_DEFINITION),
            effective_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        ))
        await db.flush()

        async def _quote(stage: str, with_order: bool = False) -> tuple[Quote, QuoteRevision]:
            quote = Quote(
                reference=unique("Q"), customer_id=customer.id,
                owner_profile_id=rep.id, team_id=team.id, title="Seed quote",
                stage=stage, valid_until=date.today() + timedelta_days(30),
                last_activity_at=_now(), last_progress_at=_now(),
                revision_count=1,
            )
            db.add(quote)
            await db.flush()
            revision = QuoteRevision(
                quote_id=quote.id, revision_no=1, source="SELLER", currency="INR",
                order_discount_bp=0, status="SUBMITTED",
                approval_status="NOT_REQUIRED", required_level="NONE",
                one_time_net_minor=200000, one_time_tax_minor=36000,
                one_time_cost_minor=120000,
                contribution_minor=80000, total_base_minor=200000,
                total_discount_minor=0, backorder_terms="ALLOW_BACKORDER",
                invoicing_terms="ON_CONFIRMATION",
                submitted_at=_now(), seller_adopted_at=_now(),
                seller_adopted_by=rep.id, created_by_profile_id=rep.id,
            )
            db.add(revision)
            await db.flush()
            db.add(QuoteLine(
                revision_id=revision.id, line_key="ln-1", position=0,
                line_kind="ONE_TIME", product_id=product.id, category_id=category.id,
                variant_id=variant.id, description="Laptop Std", quantity=2,
                unit_price_minor=100000, unit_cost_minor=60000, tax_rate_bp=1800,
                line_discount_bp=0, applied_order_discount_bp=0,
                effective_discount_bp=0, base_minor=200000, net_minor=200000,
                tax_minor=36000, cost_total_minor=120000, margin_minor=80000,
                requires_stock=True, source="MANUAL",
            ))
            await db.flush()
            revision.commercial_hash = portal_service.hash_lines(
                revision,
                list((await db.execute(
                    select(QuoteLine).where(QuoteLine.revision_id == revision.id)
                )).scalars().all()),
            )
            quote.current_revision_id = revision.id
            if with_order:
                db.add(Order(
                    reference=unique("SO"), quote_id=quote.id, revision_id=revision.id,
                    customer_id=customer.id, owner_profile_id=rep.id, currency="INR",
                    backorder_terms="ALLOW_BACKORDER",
                    one_time_net_minor=200000, one_time_tax_minor=36000,
                ))
            await db.flush()
            return quote, revision

        quote, revision = await _quote("SENT")
        accept_quote, accept_revision = await _quote("SENT")
        ordered_quote, _ordered_revision = await _quote("SENT", with_order=True)
        draft_quote = Quote(
            reference=unique("Q"), customer_id=customer.id, owner_profile_id=rep.id,
            team_id=team.id, title="Draft", stage="DRAFT",
            last_activity_at=_now(), last_progress_at=_now(), revision_count=0,
        )
        db.add(draft_quote)
        await db.flush()
        invoice = Invoice(
            invoice_no=uuid.uuid4().int % 10**9, reference=unique("INV"),
            customer_id=customer.id, invoice_kind="ONE_TIME", currency="INR",
            status="ISSUED", issue_date=date.today(),
            due_date=date.today() + timedelta_days(15),
            net_minor=200000, tax_minor=36000, total_minor=236000,
        )
        db.add(invoice)
        await db.flush()
        db.add(InvoiceLine(
            invoice_id=invoice.id, position=0, description="Laptop Std",
            quantity=2, unit_price_minor=100000, net_minor=200000,
            tax_rate_bp=1800, tax_minor=36000, line_type="ONE_TIME",
        ))
        draft_invoice = Invoice(
            invoice_no=uuid.uuid4().int % 10**9, reference=unique("INV"),
            customer_id=customer.id, invoice_kind="ONE_TIME", currency="INR",
            status="DRAFT", net_minor=100, tax_minor=0, total_minor=100,
        )
        db.add(draft_invoice)
        await db.commit()
        return {
            "team_id": team.id, "rep_id": rep.id,
            "customer_id": customer.id, "profile": profile,
            "stranger": stranger, "stranger_customer_id": stranger_customer.id,
            "category_id": category.id, "product_id": product.id,
            "variant_id": variant.id, "quote_id": quote.id,
            "revision_id": revision.id, "accept_quote_id": accept_quote.id,
            "accept_revision_id": accept_revision.id,
            "ordered_quote_id": ordered_quote.id,
            "draft_quote_id": draft_quote.id,
            "invoice_id": invoice.id, "draft_invoice_id": draft_invoice.id,
        }


def timedelta_days(n: int):
    from datetime import timedelta

    return timedelta(days=n)


def _actor(profile: Profile) -> Actor:
    return Actor(
        profile_id=profile.id, auth_user_id=profile.auth_user_id,
        email=profile.email, role=profile.role,
        team_id=profile.team_id, customer_id=profile.customer_id,
    )


_HELD: list = []  # keep override contexts alive for the session


def _client(actor: Actor) -> TestClient:
    app = create_app()
    app.include_router(portal_router)
    ctx = override_app_deps(app, actor)
    ctx.__enter__()
    _HELD.append(ctx)
    return TestClient(app, raise_server_exceptions=False)


def setup_module() -> None:
    global SEED
    SEED = asyncio.run(_seed())


def _own_client() -> TestClient:
    return _client(_actor(SEED["profile"]))


def _stranger_client() -> TestClient:
    return _client(_actor(SEED["stranger"]))


# ------------------------------------------------------------------ quotes ---


def test_list_and_isolation():
    client = _own_client()
    resp = client.get("/api/v1/portal/quotes")
    assert resp.status_code == 200, resp.text
    ids = [row["id"] for row in resp.json()["data"]]
    assert str(SEED["quote_id"]) in ids
    assert str(SEED["draft_quote_id"]) not in ids  # DRAFT hidden

    stranger = _stranger_client()
    assert stranger.get("/api/v1/portal/quotes").json()["data"] == []
    assert stranger.get(f"/api/v1/portal/quotes/{SEED['quote_id']}").status_code == 404
    # DRAFT is 404 even for the owner.
    assert client.get(f"/api/v1/portal/quotes/{SEED['draft_quote_id']}").status_code == 404


def test_quote_detail_has_no_internal_fields():
    client = _own_client()
    resp = client.get(f"/api/v1/portal/quotes/{SEED['quote_id']}")
    assert resp.status_code == 200, resp.text
    detail = resp.json()["data"]
    assert detail["status"] == "AWAITING_YOUR_REVIEW"
    assert detail["totals"]["dueOnConfirmation"] == "2360.00"
    line = detail["lines"][0]
    assert line["unitPrice"] == "1000.00"
    assert line["availabilityNote"] == "In stock"
    for forbidden in ("unitCost", "margin", "threshold", "approval"):
        assert forbidden not in resp.text.lower().replace("awaitinginternalapproval", "").replace(
            "awaiting internal approval", ""
        )


def test_quote_request_creates_review_quote():
    client = _own_client()
    resp = client.post(
        "/api/v1/portal/quote-requests",
        json={"title": "Need laptops", "lines": [
            {"variantId": str(SEED["variant_id"]), "quantity": 1}
        ]},
    )
    assert resp.status_code == 201, resp.text
    detail = resp.json()["data"]
    assert detail["status"] == "IN_PREPARATION"
    assert detail["lines"][0]["lineKey"] == "req-1"
    assert detail["lines"][0]["quantity"] == "1"

    bad = client.post(
        "/api/v1/portal/quote-requests",
        json={"lines": [{"quantity": 1}]},
    )
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "VALIDATION_FAILED"


def test_comment_then_counter():
    client = _own_client()
    key = uuid.uuid4().hex
    comment = client.post(
        f"/api/v1/portal/quotes/{SEED['quote_id']}/requests",
        headers={"Idempotency-Key": key},
        json={"requestType": "COMMENT", "message": "Can you do better?",
              "expectedRevisionId": str(SEED["revision_id"])},
    )
    assert comment.status_code == 200, comment.text
    assert comment.json()["data"]["revisionId"] == str(SEED["revision_id"])

    counter = client.post(
        f"/api/v1/portal/quotes/{SEED['quote_id']}/requests",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={"requestType": "COUNTER", "message": "Asking for 5%",
              "lines": [{"lineKey": "ln-1", "quantity": 2, "requestedDiscountBp": 500}],
              "expectedRevisionId": str(SEED["revision_id"])},
    )
    assert counter.status_code == 200, counter.text
    detail = counter.json()["data"]
    assert detail["status"] == "UNDER_DISCUSSION"
    assert detail["revisionId"] != str(SEED["revision_id"])
    assert detail["lines"][0]["lineDiscountPercentBp"] == 500
    assert detail["lines"][0]["discountPercentBp"] == 500


def test_ordered_quote_closed_to_negotiation():
    client = _own_client()
    ordered = client.get(f"/api/v1/portal/quotes/{SEED['ordered_quote_id']}")
    assert ordered.status_code == 200
    assert ordered.json()["data"]["status"] == "CONFIRMED"
    resp = client.post(
        f"/api/v1/portal/quotes/{SEED['ordered_quote_id']}/requests",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={"requestType": "COMMENT", "message": "late note",
              "expectedRevisionId": ordered.json()["data"]["revisionId"]},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "NEGOTIATION_CLOSED"


# --------------------------------------------------------------- acceptance ---


def test_accept_stale_hash_mismatch_then_happy_path():
    client = _own_client()
    quote_id = SEED["accept_quote_id"]
    revision_id = str(SEED["accept_revision_id"])
    detail = client.get(f"/api/v1/portal/quotes/{quote_id}").json()["data"]
    good_hash = detail["commercialHash"]

    stale = client.post(
        f"/api/v1/portal/quotes/{quote_id}/acceptances",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={"revisionId": str(uuid.uuid4()), "commercialHash": good_hash},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "STALE_QUOTE_VERSION"

    mismatch = client.post(
        f"/api/v1/portal/quotes/{quote_id}/acceptances",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={"revisionId": revision_id, "commercialHash": "0" * 64},
    )
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "ACCEPTANCE_HASH_MISMATCH"

    ok = client.post(
        f"/api/v1/portal/quotes/{quote_id}/acceptances",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={"revisionId": revision_id, "commercialHash": good_hash},
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()["data"]
    assert body["accepted"] is True
    # Gates were clear (NOT_REQUIRED + seller-adopted), so the finalization
    # hook created the order inline: unconditional acceptance with SO- reference.
    assert body["conditional"] is False
    assert body["orderReference"].startswith("SO-")
    assert body["remainingSteps"] == []

    # Replaying the acceptance that produced the order returns the same answer.
    replay = client.post(
        f"/api/v1/portal/quotes/{quote_id}/acceptances",
        headers={"Idempotency-Key": uuid.uuid4().hex},
        json={"revisionId": revision_id, "commercialHash": good_hash},
    )
    assert replay.status_code == 200
    assert replay.json()["data"]["orderReference"] == body["orderReference"]


# ----------------------------------------------------------------- account ---


def test_account_update_preferences_password():
    client = _own_client()
    me = client.get("/api/v1/portal/account")
    assert me.status_code == 200, me.text
    assert me.json()["data"]["organisation"]["name"] is not None

    upd = client.patch(
        "/api/v1/portal/account",
        json={"fullName": "  Buyer Two  ", "phone": "  ", "billingAddress": "New address"},
    )
    assert upd.status_code == 200, upd.text
    data = upd.json()["data"]
    assert data["fullName"] == "Buyer Two"
    assert data["phone"] is None
    assert data["organisation"]["billingAddress"] == "New address"

    prefs = client.put(
        "/api/v1/portal/account/preferences",
        json={"preferences": {"emailNotifications": True, "bogus": 1,
                              "defaultLanding": "x" * 101}},
    )
    assert prefs.status_code == 400
    assert prefs.json()["error"]["code"] == "VALIDATION_FAILED"

    prefs_ok = client.put(
        "/api/v1/portal/account/preferences",
        json={"preferences": {"emailNotifications": True, "bogusKey": "dropped"}},
    )
    assert prefs_ok.status_code == 200, prefs_ok.text
    stored = prefs_ok.json()["data"]["preferences"]
    assert stored["emailNotifications"] is True
    assert "bogusKey" not in stored

    wrong = client.post(
        "/api/v1/portal/account/password",
        json={"currentPassword": "nope-nope-1", "newPassword": "new-password-1"},
    )
    assert wrong.status_code == 400
    assert wrong.json()["error"]["code"] == "VALIDATION_FAILED"

    changed = client.post(
        "/api/v1/portal/account/password",
        json={"currentPassword": "old-password-1", "newPassword": "new-password-1"},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["data"] == {"changed": True}

    async def _check() -> bool:
        async with TestSession() as db:
            row = (await db.execute(
                select(Profile).where(Profile.id == SEED["profile"].id)
            )).scalars().first()
            return verify_password("new-password-1", row.password_hash)

    assert asyncio.run(_check()) is True


# ----------------------------------------------------------------- invoices ---


def test_invoices_and_export():
    client = _own_client()
    listed = client.get("/api/v1/portal/invoices")
    assert listed.status_code == 200, listed.text
    ids = [row["id"] for row in listed.json()["data"]]
    assert str(SEED["invoice_id"]) in ids
    assert str(SEED["draft_invoice_id"]) not in ids

    one = client.get(f"/api/v1/portal/invoices/{SEED['invoice_id']}")
    assert one.status_code == 200, one.text
    assert one.json()["data"]["total"] == "2360.00"
    assert client.get(f"/api/v1/portal/invoices/{SEED['draft_invoice_id']}").status_code == 404
    stranger = _stranger_client()
    assert stranger.get(f"/api/v1/portal/invoices/{SEED['invoice_id']}").status_code == 404

    pdf = client.get(f"/api/v1/portal/invoices/{SEED['invoice_id']}/export?format=pdf")
    assert pdf.status_code == 200, pdf.text
    assert pdf.content.startswith(b"%PDF-")
    xlsx = client.get(f"/api/v1/portal/invoices/{SEED['invoice_id']}/export?format=xlsx")
    assert xlsx.status_code == 200
    assert xlsx.content[:2] == b"PK"
    bad = client.get(f"/api/v1/portal/invoices/{SEED['invoice_id']}/export?format=exe")
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "VALIDATION_FAILED"
