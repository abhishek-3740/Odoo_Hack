"""CATALOG + DISCOUNT-POLICY domain verification — offline + integration.

Offline: policy parse/validate shapes, enum parsing, search-pattern escaping.
Integration (dealflow_test): price-resolver precedence, CRUD role gates,
public storefront shape, policy publish/current/history, plan validation.
"""

from __future__ import annotations

import asyncio
import uuid
from contextlib import contextmanager
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.deps import get_current_actor
from app.api.v1.routers.catalog import router
from app.core.database import get_db
from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines.risk_engine import DiscountPolicyDefinition
from app.main import create_app
from app.models.auth import Profile
from app.models.catalog import (
    Category,
    Customer,
    PriceRule,
    Product,
    ProductVariant,
    SubscriptionPlan,
)
from app.models.fulfillment import StockLevel, Warehouse
from app.services import catalog_service, policy_service, price_resolver

import tests.itutil as itutil
from tests.itutil import TestSession, unique

app = create_app()
app.include_router(router)
client = TestClient(app, raise_server_exceptions=False)


@contextmanager
def use_deps(actor: Actor | None = None):
    app.dependency_overrides[get_db] = itutil._get_test_db
    if actor is not None:
        app.dependency_overrides[get_current_actor] = lambda: actor
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_actor, None)


def _run(coro):
    return asyncio.run(coro)


async def _actor(role: str = "ADMIN", customer_id: uuid.UUID | None = None) -> Actor:
    async with TestSession() as db:
        profile = Profile(
            auth_user_id=uuid.uuid4(),
            email=unique("t") + "@test.dev",
            full_name="T",
            role=role,
            customer_id=customer_id,
            is_active=True,
        )
        db.add(profile)
        await db.commit()
        return Actor(profile.id, profile.auth_user_id, profile.email,
                     role, profile.team_id, profile.customer_id)


async def _customer_actor() -> Actor:
    async with TestSession() as db:
        customer = Customer(name=unique("cust"), tier="BRONZE", currency="INR")
        db.add(customer)
        await db.commit()
        cid = customer.id
    return await _actor("CUSTOMER", cid)


async def _seed_catalog() -> dict:
    """Category + one-time STOCK product (100000/60000) + variant (+5000 extra)."""
    async with TestSession() as db:
        cat = Category(code=unique("CAT").upper().replace("-", "")[:30],
                       name=unique("cat"), kind="HARDWARE")
        db.add(cat)
        await db.flush()
        prod = Product(category_id=cat.id, code=unique("PRD"), name=unique("prod"),
                       base_price_minor=100000, base_cost_minor=60000,
                       fulfillment_kind="STOCK", charge_kind="ONE_TIME")
        db.add(prod)
        await db.flush()
        var = ProductVariant(product_id=prod.id, sku=unique("SKU"), name=unique("var"))
        var.attributes = {}
        var.price_extra_minor = 5000
        db.add(var)
        await db.flush()
        await db.commit()
        return {"category": cat, "product": prod, "variant": var}


def _policy_def(**overrides) -> dict:
    base = {
        "tierCeilingPercent": {"BRONZE": 5, "SILVER": 10, "GOLD": 15},
        "categoryCeilingPercent": {"HARDWARE": 15},
        "manager": {"anyPositiveExcess": True, "aggregateDiscountPercentAbove": 12,
                    "aggregateMarginPercentBelow": 20},
        "finance": {"worstLineExcessPpAtLeast": 8, "weightedExcessPpAtLeast": 3,
                    "excessValueMinorAtLeast": 500000, "aggregateMarginPercentBelow": 15,
                    "nonPositiveLineContribution": True},
    }
    base.update(overrides)
    return base


# ------------------------------------------------------------- offline ---


def test_policy_seed_round_trip():
    seed = DiscountPolicyDefinition.seed_default()
    wire = policy_service.definition_to_wire(seed)
    assert set(wire) == {"tierCeilingPercent", "categoryCeilingPercent", "manager", "finance"}
    assert policy_service.parse_definition(wire) == seed
    policy_service.validate_definition(seed)  # must not raise


def test_policy_validate_rejects_bad_shapes():
    seed = DiscountPolicyDefinition.seed_default()

    empty_tiers = policy_service.parse_definition(_policy_def(tierCeilingPercent={}))
    with pytest.raises(ApiException) as e:
        policy_service.validate_definition(empty_tiers)
    assert e.value.code == ErrorCode.VALIDATION_FAILED

    over_100 = policy_service.parse_definition(
        _policy_def(tierCeilingPercent={"BRONZE": 101}))
    with pytest.raises(ApiException) as e2:
        policy_service.validate_definition(over_100)
    assert e2.value.code == ErrorCode.VALIDATION_FAILED

    no_triggers = policy_service.parse_definition(
        {"tierCeilingPercent": {"BRONZE": 5}, "categoryCeilingPercent": {}})
    with pytest.raises(ApiException) as e3:
        policy_service.validate_definition(no_triggers)
    assert e3.value.code == ErrorCode.VALIDATION_FAILED

    inverted = DiscountPolicyDefinition(
        tier_ceiling_percent=dict(seed.tier_ceiling_percent),
        category_ceiling_percent=dict(seed.category_ceiling_percent),
        manager=seed.manager,
        finance=seed.finance.__class__(
            worst_line_excess_pp_at_least=seed.finance.worst_line_excess_pp_at_least,
            weighted_excess_pp_at_least=seed.finance.weighted_excess_pp_at_least,
            excess_value_minor_at_least=seed.finance.excess_value_minor_at_least,
            aggregate_margin_percent_below=seed.manager.aggregate_margin_percent_below + 1,
            non_positive_line_contribution=True,
        ),
    )
    with pytest.raises(ApiException) as e4:
        policy_service.validate_definition(inverted)
    assert e4.value.code == ErrorCode.VALIDATION_FAILED

    with pytest.raises(ApiException) as e5:
        policy_service.parse_definition(_policy_def(tierCeilingPercent={"PLATINUM": 5}))
    assert e5.value.code == ErrorCode.VALIDATION_FAILED


def test_parse_enum_case_insensitive_and_invalid():
    assert catalog_service.parse_enum("CustomerTier", "gold") == "GOLD"
    assert catalog_service.parse_enum("FulfillmentKind", "stock") == "STOCK"
    assert catalog_service.parse_enum("BillingAnchor", None, required=False) is None
    with pytest.raises(ApiException) as e:
        catalog_service.parse_enum("CustomerTier", "PLATINUM")
    assert e.value.code == ErrorCode.VALIDATION_FAILED
    with pytest.raises(ApiException) as e2:
        catalog_service.parse_enum("ChargeKind", None)
    assert e2.value.code == ErrorCode.VALIDATION_FAILED


def test_like_pattern_escapes_wildcards():
    assert catalog_service.like_pattern(None) == "%"
    assert catalog_service.like_pattern("   ") == "%"
    assert catalog_service.like_pattern("50%_\\") == "%50\\%\\_\\\\%"
    assert catalog_service.like_pattern("Acme") == "%acme%"


def test_rule_window_until_is_exclusive():
    async def check():
        async with TestSession() as db:
            rule = PriceRule(variant_id=uuid.uuid4(), tier="GOLD", currency="INR",
                             unit_price_minor=1, priority=0,
                             active_from=date(2026, 1, 1), active_until=date(2026, 6, 1))
            assert price_resolver.is_rule_active(rule, date(2026, 5, 31)) is True
            assert price_resolver.is_rule_active(rule, date(2026, 6, 1)) is False
            assert price_resolver.is_rule_active(rule, date(2025, 12, 31)) is False
    _run(check())


# ------------------------------------------------- resolver integration ---


def test_resolver_default_price_and_single_wrapper():
    seed = _run(_seed_catalog())

    async def check():
        async with TestSession() as db:
            out = await price_resolver.resolve_all(
                db, [seed["variant"].id], "GOLD", "INR", date(2026, 6, 1))
            assert set(out) == {seed["variant"].id}
            row = out[seed["variant"].id]
            assert row.unit_price_minor == 105000  # base + extra
            assert row.unit_cost_minor == 60000  # inherits product base
            assert row.source == "VARIANT_DEFAULT"
            assert row.requires_stock is True
            assert row.currency == "INR"
            assert row.tax_rate_bp == 0
            assert row.sku == seed["variant"].sku
            assert row.category_code == seed["category"].code
            one = await price_resolver.resolve_one(
                db, seed["variant"].id, "gold", "INR", date(2026, 6, 1))
            assert one == row
            assert await price_resolver.resolve_all(db, [], "GOLD", "INR", date(2026, 6, 1)) == {}
    _run(check())


def test_resolver_rule_beats_default_highest_priority_wins():
    seed = _run(_seed_catalog())
    vid = seed["variant"].id

    async def setup():
        async with TestSession() as db:
            db.add(PriceRule(variant_id=vid, tier="GOLD", currency="INR",
                             unit_price_minor=90000, priority=5,
                             active_from=date(2026, 1, 1)))
            db.add(PriceRule(variant_id=vid, tier="GOLD", currency="INR",
                             unit_price_minor=80000, priority=10,
                             active_from=date(2026, 1, 1)))
            db.add(PriceRule(variant_id=vid, tier="SILVER", currency="INR",
                             unit_price_minor=70000, priority=99,
                             active_from=date(2026, 1, 1)))
            db.add(PriceRule(variant_id=vid, tier="GOLD", currency="INR",
                             unit_price_minor=1000, priority=99,
                             active_from=date(2027, 1, 1)))  # future: ignored
            await db.commit()

    async def check():
        async with TestSession() as db:
            row = await price_resolver.resolve_one(db, vid, "GOLD", "INR", date(2026, 6, 1))
            assert row.unit_price_minor == 80000
            assert row.source == "PRICE_RULE"
    _run(setup())
    _run(check())


def test_resolver_equal_priority_tie_is_422():
    seed = _run(_seed_catalog())
    vid = seed["variant"].id

    async def setup():
        async with TestSession() as db:
            # Same priority, different start dates: still ambiguous (row order
            # must never decide a price). Distinct active_from satisfies the
            # price_rules_slot_uq slot constraint.
            for start, price in ((date(2026, 1, 1), 80000), (date(2026, 3, 1), 81000)):
                db.add(PriceRule(variant_id=vid, tier="GOLD", currency="INR",
                                 unit_price_minor=price, priority=10,
                                 active_from=start))
            await db.commit()

    async def check():
        async with TestSession() as db:
            with pytest.raises(ApiException) as e:
                await price_resolver.resolve_one(db, vid, "GOLD", "INR", date(2026, 6, 1))
            assert e.value.code == ErrorCode.AMBIGUOUS_PRICE_RULE
    _run(setup())
    _run(check())


def test_resolver_inactive_variant_or_product_is_422():
    seed = _run(_seed_catalog())

    async def deactivate_variant():
        async with TestSession() as db:
            row = (await db.execute(
                select(ProductVariant).where(ProductVariant.id == seed["variant"].id)
                .with_for_update())).scalars().first()
            row.is_active = False
            await db.commit()

    async def check_variant():
        async with TestSession() as db:
            with pytest.raises(ApiException) as e:
                await price_resolver.resolve_one(
                    db, seed["variant"].id, "GOLD", "INR", date(2026, 6, 1))
            assert e.value.code == ErrorCode.PRICE_NOT_RESOLVABLE
            assert e.value.message == f'"{seed["variant"].name}" is no longer available.'

    async def deactivate_product():
        async with TestSession() as db:
            var = (await db.execute(
                select(ProductVariant).where(ProductVariant.id == seed["variant"].id)
                .with_for_update())).scalars().first()
            var.is_active = True
            prod = (await db.execute(
                select(Product).where(Product.id == seed["product"].id)
                .with_for_update())).scalars().first()
            prod.is_active = False
            await db.commit()

    async def check_product():
        async with TestSession() as db:
            with pytest.raises(ApiException) as e:
                await price_resolver.resolve_one(
                    db, seed["variant"].id, "GOLD", "INR", date(2026, 6, 1))
            assert e.value.code == ErrorCode.PRICE_NOT_RESOLVABLE
    _run(deactivate_variant())
    _run(check_variant())
    _run(deactivate_product())
    _run(check_product())


def test_resolver_currency_mismatch_and_missing_variant():
    seed = _run(_seed_catalog())

    async def check():
        async with TestSession() as db:
            with pytest.raises(ApiException) as e:
                await price_resolver.resolve_one(
                    db, seed["variant"].id, "GOLD", "USD", date(2026, 6, 1))
            assert e.value.code == ErrorCode.CURRENCY_MISMATCH
            missing = uuid.uuid4()
            with pytest.raises(ApiException) as e2:
                await price_resolver.resolve_one(db, missing, "GOLD", "INR", date(2026, 6, 1))
            assert e2.value.code == ErrorCode.NOT_FOUND
            assert str(missing) in e2.value.message
    _run(check())


# ------------------------------------------------------ CRUD role gates ---


def _product_payload(category_id: uuid.UUID, code: str) -> dict:
    return {"categoryId": str(category_id), "code": code, "name": "Widget " + code,
            "basePrice": "1000.00", "baseCost": "600.00",
            "fulfillmentKind": "stock", "chargeKind": "one_time"}


def test_customer_crud_role_gates():
    admin = _run(_actor("ADMIN"))
    rep = _run(_actor("REP"))
    mgr = _run(_actor("MANAGER"))
    customer = _run(_customer_actor())

    with use_deps(rep):
        r = client.post("/api/v1/customers", json={"name": unique("c"), "tier": "gold"})
        assert r.status_code == 201, r.text
        cid = r.json()["data"]["id"]
        assert r.json()["data"]["tier"] == "GOLD"
        # REP cannot create products (ADMIN-only write).
        r = client.post("/api/v1/products", json=_product_payload(uuid.uuid4(), unique("X")))
        assert r.status_code == 403, r.text

    with use_deps(rep):
        r = client.patch(f"/api/v1/customers/{cid}",
                         json={"name": "Nope", "tier": "SILVER"})
        assert r.status_code == 403, r.text

    with use_deps(mgr):
        r = client.patch(f"/api/v1/customers/{cid}",
                         json={"name": "New Name", "tier": "SILVER"})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["tier"] == "SILVER"

    with use_deps(customer):
        r = client.get("/api/v1/customers")
        assert r.status_code == 403, r.text
        assert r.json()["error"]["message"] == "The catalogue is internal."
        r = client.get(f"/api/v1/customers/{cid}")
        assert r.status_code == 403, r.text
        r = client.get("/api/v1/products")
        assert r.status_code == 403, r.text

    with use_deps(admin):
        r = client.get(f"/api/v1/customers/{cid}")
        assert r.status_code == 200, r.text
        r = client.get("/api/v1/customers/00000000-0000-0000-0000-000000000000")
        assert r.status_code == 404, r.text

    with use_deps():  # authenticated routes need a token
        r = client.get("/api/v1/customers")
        assert r.status_code == 401, r.text


def test_customer_list_search_sort_and_validation():
    admin = _run(_actor("ADMIN"))
    probe = unique("probe")
    with use_deps(admin):
        for suffix in ("-alpha", "-beta"):
            r = client.post("/api/v1/customers", json={"name": probe + suffix, "tier": "BRONZE"})
            assert r.status_code == 201, r.text
        r = client.get("/api/v1/customers", params={"search": probe, "sort": "name,asc"})
        assert r.status_code == 200, r.text
        names = [c["name"] for c in r.json()["data"]]
        assert names == sorted(names)
        assert all(probe in n for n in names)
        # User wildcards are escaped: a literal % matches nothing, never everything.
        r = client.get("/api/v1/customers", params={"search": probe + "%"})
        assert r.status_code == 200, r.text
        assert r.json()["data"] == []
        r = client.get("/api/v1/customers", params={"sort": "bogus,asc"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "VALIDATION_FAILED"
        # Blank name is rejected.
        r = client.post("/api/v1/customers", json={"name": "   ", "tier": "BRONZE"})
        assert r.status_code == 400, r.text


def test_category_product_variant_rule_warehouse_crud():
    admin = _run(_actor("ADMIN"))
    with use_deps(admin):
        code = unique("KIND").upper().replace("-", "")
        r = client.post("/api/v1/categories",
                        json={"code": code.lower(), "name": "Kind " + code, "kind": "hardware"})
        assert r.status_code == 201, r.text
        assert r.json()["data"]["code"] == code  # uppercased
        cat_id = r.json()["data"]["id"]

        r = client.get("/api/v1/categories")
        assert r.status_code == 200, r.text
        assert any(c["code"] == code for c in r.json()["data"])

        pcode = unique("PRD")
        r = client.post("/api/v1/products", json=_product_payload(uuid.UUID(cat_id), pcode))
        assert r.status_code == 201, r.text
        assert r.json()["data"]["basePrice"] == "1000.00"
        assert r.json()["data"]["fulfillmentKind"] == "STOCK"
        prod_id = r.json()["data"]["id"]

        r = client.get("/api/v1/products", params={"categoryId": cat_id, "search": pcode})
        assert r.status_code == 200, r.text
        assert r.json()["meta"]["total"] == 1

        sku = unique("SKU")
        r = client.post("/api/v1/variants",
                        json={"productId": prod_id, "sku": sku, "name": "V " + sku,
                              "priceExtra": "50.00"})
        assert r.status_code == 201, r.text
        assert r.json()["data"]["priceExtra"] == "50.00"
        var_id = r.json()["data"]["id"]

        r = client.get("/api/v1/variants", params={"productId": prod_id})
        assert r.status_code == 200, r.text
        assert [v["sku"] for v in r.json()["data"]] == [sku]

        r = client.post("/api/v1/price-rules",
                        json={"variantId": var_id, "tier": "gold",
                              "unitPrice": "900.00", "activeFrom": "2026-01-01"})
        assert r.status_code == 201, r.text
        assert r.json()["data"]["currency"] == "INR"  # default
        assert r.json()["data"]["priority"] == 0  # default
        rule_id = r.json()["data"]["id"]

        r = client.get("/api/v1/price-rules", params={"variantId": var_id})
        assert r.status_code == 200, r.text
        assert len(r.json()["data"]) == 1

        r = client.patch(f"/api/v1/price-rules/{rule_id}",
                         json={"variantId": var_id, "tier": "GOLD", "unitPrice": "850.00",
                               "priority": 3, "activeFrom": "2026-01-01"})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["unitPrice"] == "850.00"

        wcode = unique("WH")
        r = client.post("/api/v1/warehouses", json={"code": wcode, "name": "W " + wcode})
        assert r.status_code == 201, r.text
        assert r.json()["data"]["shippingFixedCost"] == "0.00"
        wh_id = r.json()["data"]["id"]

        r = client.patch(f"/api/v1/warehouses/{wh_id}",
                         json={"code": wcode, "name": "W2",
                               "shippingFixedCost": "120.50", "sortOrder": 7})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["shippingFixedCost"] == "120.50"

        # Missing parents are 404, not 500.
        r = client.post("/api/v1/products",
                        json=_product_payload(uuid.uuid4(), unique("ZZ")))
        assert r.status_code == 404, r.text


def test_plan_interval_and_recurring_validation():
    admin = _run(_actor("ADMIN"))
    with use_deps(admin):
        r = client.post("/api/v1/categories",
                        json={"code": unique("PLANC").upper().replace("-", ""),
                              "name": unique("c"), "kind": "SUBSCRIPTION"})
        cat_id = r.json()["data"]["id"]

        one_time = client.post("/api/v1/products",
                               json=_product_payload(uuid.UUID(cat_id), unique("OT"))).json()["data"]
        r = client.post("/api/v1/subscription-plans",
                        json={"productId": one_time["id"], "code": unique("PL"),
                              "name": "P", "intervalMonths": 1, "intervalPrice": "99.00"})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "VALIDATION_FAILED"

        rec = client.post(
            "/api/v1/products",
            json={**_product_payload(uuid.UUID(cat_id), unique("RC")),
                  "fulfillmentKind": "NONE", "chargeKind": "RECURRING"}).json()["data"]
        r = client.post("/api/v1/subscription-plans",
                        json={"productId": rec["id"], "code": unique("PL"),
                              "name": "P", "intervalMonths": 6, "intervalPrice": "99.00"})
        assert r.status_code == 400, r.text

        r = client.post("/api/v1/subscription-plans",
                        json={"productId": rec["id"], "code": unique("PL"),
                              "name": "Quarterly", "intervalMonths": 3,
                              "intervalPrice": "299.00"})
        assert r.status_code == 201, r.text
        assert r.json()["data"]["intervalPrice"] == "299.00"
        plan_id = r.json()["data"]["id"]

        r = client.get("/api/v1/subscription-plans", params={"productId": rec["id"]})
        assert r.status_code == 200, r.text
        assert [p["id"] for p in r.json()["data"]] == [plan_id]


# -------------------------------------------------------------- storefront ---


def test_public_catalog_hides_cost_and_shows_instock():
    seed = _run(_seed_catalog())

    async def setup():
        async with TestSession() as db:
            prod = (await db.execute(
                select(Product).where(Product.id == seed["product"].id))).scalars().first()
            prod.promoted = True
            prod.name = "aaa-promoted-" + unique("p")
            plain = Product(category_id=seed["category"].id, code=unique("PLN"),
                            name="zzz-plain-" + unique("p"),
                            base_price_minor=200000, base_cost_minor=100000,
                            fulfillment_kind="NONE", charge_kind="ONE_TIME")
            db.add(plain)
            await db.flush()
            bare = ProductVariant(product_id=seed["product"].id,
                                  sku=unique("BARE"), name="bare-" + unique("v"))
            bare.attributes = {}
            db.add(bare)
            await db.flush()
            rec = Product(category_id=seed["category"].id, code=unique("REC"),
                          name="rec-" + unique("p"),
                          base_price_minor=50000, base_cost_minor=10000,
                          fulfillment_kind="NONE", charge_kind="RECURRING")
            db.add(rec)
            await db.flush()
            rec_var = ProductVariant(product_id=rec.id, sku=unique("RECVAR"),
                                     name="recvar-" + unique("v"))
            rec_var.attributes = {}
            db.add(rec_var)
            await db.flush()
            plan = SubscriptionPlan(product_id=rec.id, code=unique("PLAN"),
                                    name="Monthly", interval_months=1,
                                    interval_price_minor=50000, interval_cost_minor=10000)
            db.add(plan)
            wh = Warehouse(code=unique("STW"), name="Stock " + unique("w"), sort_order=1)
            db.add(wh)
            await db.flush()
            from decimal import Decimal as D
            db.add(StockLevel(warehouse_id=wh.id, variant_id=seed["variant"].id,
                              on_hand=D("5"), reserved=D("1")))
            await db.commit()
            return {"bare_sku": bare.sku, "recv_sku": rec_var.sku,
                    "plan_code": plan.code, "cat_code": seed["category"].code,
                    "promo_name": prod.name, "plain_name": plain.name,
                    "variant_sku": seed["variant"].sku}
    ids = _run(setup())

    with use_deps():  # anonymous: no actor, only test DB
        r = client.get("/api/v1/public/catalog")
    assert r.status_code == 200, r.text
    body = r.json()["data"]
    assert set(body) == {"categories", "products", "variants", "plans"}

    text = r.text.lower()
    assert "cost" not in text
    assert "margin" not in text

    variants = {v["sku"]: v for v in body["variants"]}
    assert ids["variant_sku"] in variants
    assert variants[ids["variant_sku"]]["listPrice"] == "1050.00"
    assert variants[ids["variant_sku"]]["inStock"] is True
    assert variants[ids["bare_sku"]]["inStock"] is False  # STOCK product, no rows
    assert ids["recv_sku"] not in variants  # recurring products sell plans, not variants

    plans = {p["code"]: p for p in body["plans"]}
    assert ids["plan_code"] in plans
    assert plans[ids["plan_code"]]["intervalPrice"] == "500.00"

    names = [p["name"] for p in body["products"]
             if p["name"] in (ids["promo_name"], ids["plain_name"])]
    assert names == [ids["promo_name"], ids["plain_name"]]  # promoted first


# ------------------------------------------------------------------ policy ---


def test_policy_publish_validate_current_history():
    admin = _run(_actor("ADMIN"))
    mgr = _run(_actor("MANAGER"))
    rep = _run(_actor("REP"))
    customer = _run(_customer_actor())

    with use_deps(rep):
        r = client.post("/api/v1/discount-policies", json={"definition": _policy_def()})
        assert r.status_code == 403, r.text

    with use_deps(customer):
        r = client.get("/api/v1/discount-policies/current")
        assert r.status_code == 403, r.text
        assert r.json()["error"]["message"] == "Discount policy is internal."

    with use_deps(mgr):
        bad = _policy_def()
        bad["manager"]["aggregateMarginPercentBelow"] = 10
        bad["finance"]["aggregateMarginPercentBelow"] = 15
        r = client.post("/api/v1/discount-policies", json={"definition": bad})
        assert r.status_code == 400, r.text
        assert r.json()["error"]["code"] == "VALIDATION_FAILED"

        r = client.post("/api/v1/discount-policies",
                        json={"definition": _policy_def(tierCeilingPercent={})})
        assert r.status_code == 400, r.text

    with use_deps(admin):
        r = client.post("/api/v1/discount-policies",
                        json={"definition": _policy_def(), "note": "first"})
        assert r.status_code == 201, r.text
        v1 = r.json()["data"]["versionNo"]
        assert r.json()["data"]["current"] is True
        assert r.json()["meta"]["published"] is True

        r = client.post("/api/v1/discount-policies",
                        json={"definition": _policy_def(), "note": "second"})
        assert r.status_code == 201, r.text
        v2 = r.json()["data"]["versionNo"]
        assert v2 > v1

        r = client.get("/api/v1/discount-policies/current")
        assert r.status_code == 200, r.text
        assert r.json()["data"]["versionNo"] >= v2
        assert r.json()["data"]["current"] is True
        assert r.json()["data"]["definition"]["tierCeilingPercent"]["GOLD"] == "15"

        r = client.get("/api/v1/discount-policies")
        assert r.status_code == 200, r.text
        versions = [p["versionNo"] for p in r.json()["data"]]
        assert versions == sorted(versions, reverse=True)
        assert versions.index(v2) < versions.index(v1)


def test_policy_by_version_and_effective_at_service():
    admin = _run(_actor("ADMIN"))

    async def check():
        async with TestSession() as db:
            policy = await policy_service.publish(db, admin, _policy_def(), "svc")
            await db.commit()
            parsed = await policy_service.by_version(db, policy.version_no)
            assert parsed.tier_ceiling_percent["GOLD"] == 15
            assert parsed.manager.any_positive_excess is True
            with pytest.raises(ApiException) as e:
                await policy_service.by_version(db, 2_147_483_000)
            assert e.value.code == ErrorCode.NOT_FOUND
    _run(check())
