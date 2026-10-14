"""Step G verification — demo seeder is idempotent and complete."""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import func, select

from app.models.auth import Profile
from app.models.catalog import Product, ProductVariant, SubscriptionPlan
from app.models.fulfillment import StockLevel, Warehouse
from app.models.policy import DiscountPolicy
from app.services import demo_seeder
from tests.itutil import TestSession

pytestmark = pytest.mark.asyncio


async def _counts():
    async with TestSession() as db:
        profiles = (await db.execute(select(func.count()).select_from(Profile))).scalar()
        products = (await db.execute(select(func.count()).select_from(Product))).scalar()
        variants = (await db.execute(select(func.count()).select_from(ProductVariant))).scalar()
        plans = (await db.execute(select(func.count()).select_from(SubscriptionPlan))).scalar()
        warehouses = (await db.execute(select(func.count()).select_from(Warehouse))).scalar()
        stock = (await db.execute(select(func.count()).select_from(StockLevel))).scalar()
        policies = (await db.execute(select(func.count()).select_from(DiscountPolicy))).scalar()
        return profiles, products, variants, plans, warehouses, stock, policies


async def test_seed_twice_same_result():
    async with TestSession() as db:
        await demo_seeder.seed(db)
        await db.commit()
    first = await _counts()
    async with TestSession() as db:
        await demo_seeder.seed(db)
        await db.commit()
    second = await _counts()
    assert first == second
    profiles, products, variants, plans, warehouses, stock, policies = second
    assert profiles >= 8 and products >= 4 and variants >= 5
    assert plans >= 3 and warehouses >= 2 and stock >= 4 and policies >= 1

    async with TestSession() as db:
        emails = (
            await db.execute(select(Profile.email).where(Profile.email.like("%@%.demo")))
        ).scalars().all()
        assert "rep.a@dealflow.demo" in emails
        assert "beta@customer.demo" in emails
        skus = (await db.execute(select(ProductVariant.sku))).scalars().all()
        assert "LAPTOP-16" in skus
