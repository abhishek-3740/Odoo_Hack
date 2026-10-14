"""Demo seeder — port of seed/DemoDataSeeder core reference data (idempotent).

Seeds team, staff/customer profiles, customers, delegation, catalogue
(HARDWARE/SERVICE/SUBSCRIPTION), warehouses, stock and policy v1.
Historical demo orders (HIST/SUB/LATE/STALLED) are intentionally deferred:
flow tests seed their own data; see MIGRATION_MEMORY.md.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.engines.risk_engine import DiscountPolicyDefinition
from app.models.auth import ApprovalDelegation, Profile, Team
from app.models.catalog import (
    Category,
    Customer,
    PriceRule,
    Product,
    ProductVariant,
    SubscriptionPlan,
)
from app.models.fulfillment import StockLevel, Warehouse
from app.models.policy import DiscountPolicy
from app.repositories.sequences import DISCOUNT_POLICY_VERSION_SEQ, nextval

log = logging.getLogger("dealflow")


async def _get_or_create_team(db: AsyncSession, name: str) -> Team:
    team = (
        await db.execute(select(Team).where(Team.name == name))
    ).scalars().first()
    if team is None:
        team = Team(name=name)
        db.add(team)
        await db.flush()
    return team


async def _get_or_create_customer(
    db: AsyncSession, name: str, tier: str, owner_id=None
) -> Customer:
    customer = (
        await db.execute(select(Customer).where(Customer.name == name))
    ).scalars().first()
    if customer is None:
        customer = Customer(
            name=name, tier=tier, currency="INR", owner_rep_profile_id=owner_id
        )
        db.add(customer)
        await db.flush()
    return customer


async def _ensure_profile(db: AsyncSession, **kwargs) -> Profile:
    email = kwargs["email"]
    profile = (
        await db.execute(select(Profile).where(Profile.email == email))
    ).scalars().first()
    if profile is None:
        profile = Profile(is_active=True, **kwargs)
        db.add(profile)
        await db.flush()
    elif profile.auth_user_id is None and kwargs.get("auth_user_id") is not None:
        profile.auth_user_id = kwargs["auth_user_id"]
        await db.flush()
    return profile


async def seed(db: AsyncSession) -> dict:
    now = datetime.now(timezone.utc)
    team = await _get_or_create_team(db, "Sales East")

    rep_a = await _ensure_profile(
        db,
        auth_user_id=uuid.UUID("00000000-0000-4000-8000-000000000002"),
        email="rep.a@dealflow.demo", full_name="Rep A (Sales)",
        role="REP", team_id=team.id,
    )
    rep_b = await _ensure_profile(
        db,
        auth_user_id=uuid.UUID("00000000-0000-4000-8000-000000000003"),
        email="rep.b@dealflow.demo", full_name="Rep B (Sales)",
        role="REP", team_id=team.id,
    )
    await _ensure_profile(
        db,
        auth_user_id=uuid.UUID("00000000-0000-4000-8000-000000000001"),
        email="admin@dealflow.demo", full_name="Demo Admin", role="ADMIN",
    )
    await _ensure_profile(
        db,
        auth_user_id=uuid.UUID("00000000-0000-4000-8000-000000000004"),
        email="manager.a@dealflow.demo", full_name="Manager A",
        role="MANAGER", team_id=team.id,
    )
    backup = await _ensure_profile(
        db,
        auth_user_id=uuid.UUID("00000000-0000-4000-8000-000000000005"),
        email="manager.backup@dealflow.demo", full_name="Backup Manager",
        role="MANAGER", team_id=team.id,
    )
    await _ensure_profile(
        db,
        auth_user_id=uuid.UUID("00000000-0000-4000-8000-000000000006"),
        email="finance@dealflow.demo", full_name="Finance Ops", role="FINANCE",
    )

    alpha = await _get_or_create_customer(db, "Alpha Traders", "BRONZE", rep_a.id)
    beta = await _get_or_create_customer(db, "Beta Systems", "GOLD", rep_a.id)
    await _get_or_create_customer(db, "Gamma Retail", "SILVER", rep_b.id)
    await _get_or_create_customer(db, "Delta Logistics", "SILVER", rep_a.id)
    await _get_or_create_customer(db, "Epsilon Labs", "GOLD", rep_b.id)
    await _ensure_profile(
        db,
        auth_user_id=uuid.UUID("00000000-0000-4000-8000-000000000007"),
        email="alpha@customer.demo", full_name="Alpha Buyer",
        role="CUSTOMER", customer_id=alpha.id,
    )
    await _ensure_profile(
        db,
        auth_user_id=uuid.UUID("00000000-0000-4000-8000-000000000008"),
        email="beta@customer.demo", full_name="Beta Buyer",
        role="CUSTOMER", customer_id=beta.id,
    )

    existing_delegation = (
        await db.execute(
            select(ApprovalDelegation).where(
                ApprovalDelegation.delegate_profile_id == backup.id,
                ApprovalDelegation.valid_until > now,
            )
        )
    ).scalars().first()
    if existing_delegation is None:
        admin = (
            await db.execute(select(Profile).where(Profile.email == "admin@dealflow.demo"))
        ).scalars().first()
        db.add(
            ApprovalDelegation(
                approver_role="MANAGER", team_id=team.id,
                delegate_profile_id=backup.id,
                valid_from=now - timedelta(days=1),
                valid_until=now + timedelta(days=30),
                reason="Manager A on leave",
                created_by_profile_id=admin.id if admin else backup.id,
            )
        )

    categories = {}
    for code, name, kind in [
        ("HARDWARE", "Hardware", "HARDWARE"),
        ("SERVICE", "Services", "SERVICE"),
        ("SUBSCRIPTION", "Subscriptions", "SUBSCRIPTION"),
    ]:
        cat = (
            await db.execute(select(Category).where(Category.code == code))
        ).scalars().first()
        if cat is None:
            cat = Category(code=code, name=name, kind=kind)
            db.add(cat)
            await db.flush()
        categories[code] = cat

    async def product(code, cat, name, price, cost, fulfillment, charge, qty_mode,
                      promoted=False, unit="unit", tax=0):
        prod = (
            await db.execute(select(Product).where(Product.code == code))
        ).scalars().first()
        if prod is None:
            prod = Product(
                category_id=categories[cat].id, code=code, name=name,
                base_price_minor=price, base_cost_minor=cost, currency="INR",
                tax_rate_bp=tax, fulfillment_kind=fulfillment, charge_kind=charge,
                quantity_mode=qty_mode, promoted=promoted, unit=unit,
            )
            db.add(prod)
            await db.flush()
        return prod

    laptop = await product("LAPTOP", "HARDWARE", "Laptop", 1_000_000, 700_000, "STOCK", "ONE_TIME", "INTEGER")
    dock = await product("DOCK", "HARDWARE", "Dock", 100_000, 60_000, "STOCK", "ONE_TIME", "INTEGER", promoted=True)
    setup = await product("SETUP", "SERVICE", "Setup", 500_000, 350_000, "NONE", "ONE_TIME", "DECIMAL")
    support = await product("SUPPORT", "SUBSCRIPTION", "Support seat", 30_000, 12_000, "NONE", "RECURRING", "INTEGER")

    async def variant(prod, sku, name, extra=0, cost=None, weight=0, group=None):
        var = (
            await db.execute(select(ProductVariant).where(ProductVariant.sku == sku))
        ).scalars().first()
        if var is None:
            var = ProductVariant(
                product_id=prod.id, sku=sku, name=name, attributes={},
                price_extra_minor=extra, cost_minor=cost, weight_grams=weight,
                substitution_group=group,
            )
            db.add(var)
            await db.flush()
        return var

    lap14 = await variant(laptop, "LAPTOP-14", "Laptop 14in", 0, None, 1400, "LAPTOP")
    lap16 = await variant(laptop, "LAPTOP-16", "Laptop 16in", 150_000, None, 1900, "LAPTOP")
    await variant(dock, "DOCK-STD", "Dock standard", 0, None, 400)
    await variant(setup, "SETUP-STD", "Setup standard")
    await variant(support, "SUPPORT-SEAT", "Support seat")

    rule = (
        await db.execute(
            select(PriceRule).where(
                PriceRule.variant_id == lap16.id, PriceRule.tier == "GOLD"
            )
        )
    ).scalars().first()
    if rule is None:
        db.add(
            PriceRule(
                variant_id=lap16.id, tier="GOLD", currency="INR",
                unit_price_minor=1_100_000, priority=10,
                active_from=date(2026, 1, 1), active_until=None,
            )
        )

    async def plan(prod, code, name, months, price, cost):
        existing = (
            await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.code == code))
        ).scalars().first()
        if existing is None:
            db.add(
                SubscriptionPlan(
                    product_id=prod.id, code=code, name=name,
                    interval_months=months, currency="INR",
                    interval_price_minor=price, interval_cost_minor=cost,
                    billing_anchor="CALENDAR_MONTH_START",
                    proration_policy="IMMEDIATE_PRORATED",
                    cancellation_policy="IMMEDIATE_PRORATED",
                )
            )

    await plan(support, "SUPPORT-M", "Support monthly", 1, 30_000, 12_000)
    await plan(support, "SUPPORT-Q", "Support quarterly", 3, 90_000, 36_000)
    await plan(support, "SUPPORT-Y", "Support yearly", 12, 360_000, 144_000)

    async def warehouse(code, name, fixed, order):
        wh = (
            await db.execute(select(Warehouse).where(Warehouse.code == code))
        ).scalars().first()
        if wh is None:
            wh = Warehouse(code=code, name=name, shipping_fixed_cost_minor=fixed, sort_order=order)
            db.add(wh)
            await db.flush()
        return wh

    main_wh = await warehouse("MAIN", "Mumbai", 10_000, 1)
    east_wh = await warehouse("EAST", "Kolkata", 15_000, 2)

    async def stock(wh, var, on_hand, reorder, target):
        level = (
            await db.execute(
                select(StockLevel).where(
                    StockLevel.warehouse_id == wh.id, StockLevel.variant_id == var.id
                )
            )
        ).scalars().first()
        if level is None:
            db.add(
                StockLevel(
                    warehouse_id=wh.id, variant_id=var.id,
                    on_hand=Decimal(on_hand), reserved=Decimal(0),
                    reorder_point=Decimal(reorder), target_qty=Decimal(target),
                )
            )

    lap14_id, lap16_id = lap14, lap16
    dock_var = (
        await db.execute(select(ProductVariant).where(ProductVariant.sku == "DOCK-STD"))
    ).scalars().first()
    await stock(main_wh, lap14_id, 4, 2, 6)
    await stock(main_wh, dock_var, 10, 3, 12)
    await stock(main_wh, lap16_id, 2, 1, 4)
    await stock(east_wh, lap14_id, 1, 1, 3)

    policy_count = (
        await db.execute(select(DiscountPolicy))
    ).scalars().first()
    if policy_count is None:
        seed = DiscountPolicyDefinition.seed_default()
        db.add(
            DiscountPolicy(
                version_no=await nextval(db, DISCOUNT_POLICY_VERSION_SEQ),
                definition={
                    "tierCeilingPercent": {k: str(v) for k, v in seed.tier_ceiling_percent.items()},
                    "categoryCeilingPercent": {k: str(v) for k, v in seed.category_ceiling_percent.items()},
                    "manager": {
                        "anyPositiveExcess": seed.manager.any_positive_excess,
                        "aggregateDiscountPercentAbove": str(seed.manager.aggregate_discount_percent_above),
                        "aggregateMarginPercentBelow": str(seed.manager.aggregate_margin_percent_below),
                    },
                    "finance": {
                        "worstLineExcessPpAtLeast": str(seed.finance.worst_line_excess_pp_at_least),
                        "weightedExcessPpAtLeast": str(seed.finance.weighted_excess_pp_at_least),
                        "excessValueMinorAtLeast": seed.finance.excess_value_minor_at_least,
                        "aggregateMarginPercentBelow": str(seed.finance.aggregate_margin_percent_below),
                        "nonPositiveLineContribution": seed.finance.non_positive_line_contribution,
                    },
                },
                effective_at=now,
                note="Seed policy v1",
            )
        )
    await db.flush()
    log.info("demo seed complete")
    return {"seeded": True}
