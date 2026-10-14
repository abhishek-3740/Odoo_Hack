"""Fulfillment tables: warehouses, stock_levels/movements, shipments, reservations, backorders."""

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


class Warehouse(TimestampedEntity):
    __tablename__ = "warehouses"

    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    shipping_fixed_cost_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    shipping_cost_per_kg_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )


class StockLevel(TimestampedEntity):
    __tablename__ = "stock_levels"
    __table_args__ = (
        UniqueConstraint("warehouse_id", "variant_id"),
        {"schema": SCHEMA},
    )

    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.warehouses.id"), nullable=False
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.product_variants.id"), nullable=False
    )
    on_hand: Mapped[Decimal] = mapped_column(
        Numeric(18, 3), nullable=False, server_default=text("0"), default=Decimal(0)
    )
    reserved: Mapped[Decimal] = mapped_column(
        Numeric(18, 3), nullable=False, server_default=text("0"), default=Decimal(0)
    )
    reorder_point: Mapped[Decimal] = mapped_column(
        Numeric(18, 3), nullable=False, server_default=text("0"), default=Decimal(0)
    )
    target_qty: Mapped[Decimal] = mapped_column(
        Numeric(18, 3), nullable=False, server_default=text("0"), default=Decimal(0)
    )
    expected_receipt_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expected_receipt_qty: Mapped[Decimal | None] = mapped_column(
        Numeric(18, 3), nullable=True
    )
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )

    __mapper_args__ = {"version_id_col": row_version}


class StockMovement(BaseEntity):
    __tablename__ = "stock_movements"

    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.product_variants.id"), nullable=False
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.warehouses.id"), nullable=False
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    movement_type: Mapped[str] = mapped_column(String(16), nullable=False)
    reference_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    request_key: Mapped[str | None] = mapped_column(Text, nullable=True, unique=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Shipment(TimestampedEntity):
    __tablename__ = "shipments"

    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.orders.id"), nullable=False
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.warehouses.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'RESERVED'"), default="RESERVED"
    )
    estimated_cost_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    dispatched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    dispatched_by_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    tracking_reference: Mapped[str | None] = mapped_column(Text, nullable=True)


class ShipmentLine(TimestampedEntity):
    __tablename__ = "shipment_lines"
    __table_args__ = (
        UniqueConstraint("shipment_id", "order_line_id"),
        {"schema": SCHEMA},
    )

    shipment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.shipments.id", ondelete="CASCADE"), nullable=False
    )
    order_line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.order_lines.id"), nullable=False
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.product_variants.id"), nullable=False
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)


class Reservation(TimestampedEntity):
    __tablename__ = "reservations"

    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.orders.id"), nullable=False
    )
    order_line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.order_lines.id"), nullable=False
    )
    shipment_line_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.shipment_lines.id", ondelete="SET NULL"), nullable=True
    )
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.warehouses.id"), nullable=False
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.product_variants.id"), nullable=False
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'HELD'"), default="HELD"
    )
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    released_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Backorder(TimestampedEntity):
    __tablename__ = "backorders"

    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.orders.id"), nullable=False
    )
    order_line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.order_lines.id"), nullable=False
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.product_variants.id"), nullable=False
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    expected_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'OPEN'"), default="OPEN"
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
