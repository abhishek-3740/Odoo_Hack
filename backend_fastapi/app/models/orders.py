"""Order tables: orders, order_lines."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import text

from app.models.base import SCHEMA, BaseEntity, TimestampedEntity


class Order(TimestampedEntity):
    __tablename__ = "orders"

    reference: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    quote_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quotes.id"), unique=True, nullable=False
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quote_revisions.id"), nullable=False
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.customers.id"), nullable=False
    )
    owner_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    order_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'CONFIRMED'"), default="CONFIRMED"
    )
    fulfillment_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'UNALLOCATED'"),
        default="UNALLOCATED",
    )
    billing_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'PENDING'"), default="PENDING"
    )
    backorder_terms: Mapped[str] = mapped_column(String(32), nullable=False)
    one_time_net_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    one_time_tax_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    confirmed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    canceled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )

    __mapper_args__ = {"version_id_col": row_version}


class OrderLine(BaseEntity):
    __tablename__ = "order_lines"
    __table_args__ = (
        UniqueConstraint("order_id", "line_key"),
        {"schema": SCHEMA},
    )

    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.orders.id"), nullable=False
    )
    quote_line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quote_lines.id"), nullable=False
    )
    line_key: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    line_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.products.id"), nullable=False
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.categories.id"), nullable=False
    )
    variant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.product_variants.id"), nullable=True
    )
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.subscription_plans.id"), nullable=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    unit_cost_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tax_rate_bp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    effective_discount_bp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    net_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tax_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    interval_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requires_stock: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    promised_date: Mapped[date | None] = mapped_column(Date, nullable=True)
