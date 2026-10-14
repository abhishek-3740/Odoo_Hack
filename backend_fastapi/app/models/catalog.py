"""Catalog tables: customers, categories, products, variants, price rules, plans."""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import BigInteger, Boolean, Date, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import text

from app.models.base import SCHEMA, TimestampedEntity


class Customer(TimestampedEntity):
    __tablename__ = "customers"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    tier: Mapped[str] = mapped_column(String(16), nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'INR'"), default="INR"
    )
    contact_email: Mapped[str | None] = mapped_column(Text, nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    billing_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_rep_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )


class Category(TimestampedEntity):
    __tablename__ = "categories"

    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )


class Product(TimestampedEntity):
    __tablename__ = "products"

    category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.categories.id"), nullable=False
    )
    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'unit'"), default="unit"
    )
    base_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    base_cost_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'INR'"), default="INR"
    )
    tax_rate_bp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    fulfillment_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    charge_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    quantity_mode: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'INTEGER'"), default="INTEGER"
    )
    promoted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )


class ProductVariant(TimestampedEntity):
    __tablename__ = "product_variants"

    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.products.id"), nullable=False
    )
    sku: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    attributes: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict
    )
    price_extra_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    cost_minor: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    weight_grams: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    substitution_group: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )


class PriceRule(TimestampedEntity):
    __tablename__ = "price_rules"

    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.product_variants.id"), nullable=False
    )
    tier: Mapped[str] = mapped_column(String(16), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    priority: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    active_from: Mapped[date] = mapped_column(Date, nullable=False)
    active_until: Mapped[date | None] = mapped_column(Date, nullable=True)


class SubscriptionPlan(TimestampedEntity):
    __tablename__ = "subscription_plans"

    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.products.id"), nullable=False
    )
    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    interval_months: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'INR'"), default="INR"
    )
    interval_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    interval_cost_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    tax_rate_bp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    billing_anchor: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'ACTIVATION_DATE'")
    )
    proration_policy: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'IMMEDIATE_PRORATED'")
    )
    cancellation_policy: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'END_OF_PERIOD'")
    )
    clawback_policy: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'NONE'")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )
