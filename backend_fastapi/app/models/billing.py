"""Billing tables: subscriptions, invoices, payments, credits, refunds."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import text

from app.models.base import SCHEMA, BaseEntity, TimestampedEntity


class Subscription(TimestampedEntity):
    __tablename__ = "subscriptions"

    reference: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.orders.id"), nullable=False
    )
    order_line_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.order_lines.id"), unique=True, nullable=False
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.customers.id"), nullable=False
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.subscription_plans.id"), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    unit_interval_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    unit_interval_cost_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    tax_rate_bp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    interval_months: Mapped[int] = mapped_column(Integer, nullable=False)
    anchor_day: Mapped[int | None] = mapped_column(Integer, nullable=True)
    billing_anchor: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'ACTIVATION_DATE'"),
        default="ACTIVATION_DATE",
    )
    activation_date: Mapped[date] = mapped_column(Date, nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    next_bill_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'PENDING_ACTIVATION'"),
        default="PENDING_ACTIVATION",
    )
    cancel_effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    canceled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    proration_policy: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'IMMEDIATE_PRORATED'"),
        default="IMMEDIATE_PRORATED",
    )
    cancellation_policy: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'END_OF_PERIOD'"),
        default="END_OF_PERIOD",
    )
    clawback_policy: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'NONE'"), default="NONE"
    )
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )

    __mapper_args__ = {"version_id_col": row_version}


class SubscriptionChange(BaseEntity):
    __tablename__ = "subscription_changes"
    __table_args__ = (
        UniqueConstraint("subscription_id", "request_key"),
        {"schema": SCHEMA},
    )

    subscription_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.subscriptions.id"), nullable=False
    )
    change_type: Mapped[str] = mapped_column(String(16), nullable=False)
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    prior_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    new_snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    adjustment_invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.invoices.id"), nullable=True
    )
    credit_note_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.credit_notes.id"), nullable=True
    )
    request_key: Mapped[str] = mapped_column(Text, nullable=False)
    actor_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    applied_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Invoice(TimestampedEntity):
    __tablename__ = "invoices"

    invoice_no: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False)
    reference: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.customers.id"), nullable=False
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.orders.id"), nullable=True
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.subscriptions.id"), nullable=True
    )
    invoice_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'DRAFT'"), default="DRAFT"
    )
    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    net_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    tax_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    total_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    credited_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    paid_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )

    __mapper_args__ = {"version_id_col": row_version}

    def outstanding_minor(self) -> int:
        return max(0, self.total_minor - self.credited_minor - self.paid_minor)


class InvoiceLine(BaseEntity):
    __tablename__ = "invoice_lines"

    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.invoices.id", ondelete="CASCADE"), nullable=False
    )
    order_line_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.order_lines.id"), nullable=True
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.subscriptions.id"), nullable=True
    )
    position: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    description: Mapped[str] = mapped_column(Text, nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 3), nullable=False)
    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    net_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tax_rate_bp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    tax_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    coverage_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    coverage_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    line_type: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'ONE_TIME'"), default="ONE_TIME"
    )
    charge_key: Mapped[str | None] = mapped_column(Text, nullable=True)


class Payment(BaseEntity):
    __tablename__ = "payments"

    reference: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.customers.id"), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    method: Mapped[str] = mapped_column(Text, nullable=False)
    external_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PaymentAllocation(BaseEntity):
    __tablename__ = "payment_allocations"
    __table_args__ = (
        UniqueConstraint("payment_id", "invoice_id"),
        {"schema": SCHEMA},
    )

    payment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.payments.id"), nullable=False
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.invoices.id"), nullable=False
    )
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)


class CreditNote(TimestampedEntity):
    __tablename__ = "credit_notes"

    reference: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.customers.id"), nullable=False
    )
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.invoices.id"), nullable=True
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.subscriptions.id"), nullable=True
    )
    subscription_change_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.subscription_changes.id"), nullable=True
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    net_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tax_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    applied_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    refunded_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    coverage_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    coverage_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'ISSUED'"), default="ISSUED"
    )
    issued_by_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )

    def available_minor(self) -> int:
        return max(0, self.total_minor - self.applied_minor - self.refunded_minor)


class CreditAllocation(BaseEntity):
    __tablename__ = "credit_allocations"
    __table_args__ = (
        UniqueConstraint("credit_note_id", "invoice_id"),
        {"schema": SCHEMA},
    )

    credit_note_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.credit_notes.id"), nullable=False
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.invoices.id"), nullable=False
    )
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)


class Refund(BaseEntity):
    __tablename__ = "refunds"

    reference: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.customers.id"), nullable=False
    )
    credit_note_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.credit_notes.id"), nullable=False
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    method: Mapped[str] = mapped_column(Text, nullable=False)
    external_reference: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    recorded_by_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
