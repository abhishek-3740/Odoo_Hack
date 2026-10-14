"""Quote tables: quotes, quote_revisions, quote_lines, recommendation_dismissals."""

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
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import text

from app.models.base import SCHEMA, BaseEntity, TimestampedEntity


class Quote(TimestampedEntity):
    __tablename__ = "quotes"

    reference: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.customers.id"), nullable=False
    )
    owner_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=False
    )
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.teams.id"), nullable=True
    )
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    current_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.quote_revisions.id"), nullable=True
    )
    stage: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'DRAFT'"), default="DRAFT"
    )
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_progress_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    awaiting_external_since: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revision_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )

    __mapper_args__ = {"version_id_col": row_version}


class QuoteRevision(TimestampedEntity):
    __tablename__ = "quote_revisions"
    __table_args__ = (
        UniqueConstraint("quote_id", "revision_no"),
        {"schema": SCHEMA},
    )

    quote_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quotes.id"), nullable=False
    )
    revision_no: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'SELLER'"), default="SELLER"
    )
    status: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'DRAFT'"), default="DRAFT"
    )
    currency: Mapped[str] = mapped_column(
        String(3), nullable=False, server_default=text("'INR'"), default="INR"
    )
    order_discount_bp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    policy_version_no: Mapped[int | None] = mapped_column(Integer, nullable=True)
    policy_snapshot: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    risk_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    approval_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'NOT_EVALUATED'"),
        default="NOT_EVALUATED",
    )
    required_level: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'NONE'"), default="NONE"
    )
    commercial_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    one_time_net_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    one_time_tax_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    one_time_cost_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    recurring_first_cycle_net_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    recurring_first_cycle_tax_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    recurring_first_cycle_cost_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    contribution_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    margin_percent: Mapped[Decimal | None] = mapped_column(
        Numeric(9, 4), nullable=True
    )
    total_base_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    total_discount_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    backorder_terms: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'ALLOW_BACKORDER'"),
        default="ALLOW_BACKORDER",
    )
    invoicing_terms: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        server_default=text("'ON_CONFIRMATION'"),
        default="ON_CONFIRMATION",
    )
    requested_activation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    seller_adopted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    seller_adopted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    customer_accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    customer_accepted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    customer_accepted_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )


class QuoteLine(BaseEntity):
    __tablename__ = "quote_lines"
    __table_args__ = (
        UniqueConstraint("revision_id", "line_key"),
        {"schema": SCHEMA},
    )

    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quote_revisions.id", ondelete="CASCADE"), nullable=False
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
    line_discount_bp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    applied_order_discount_bp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    effective_discount_bp: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0"), default=0
    )
    base_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    net_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tax_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    cost_total_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    margin_minor: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=text("0"), default=0
    )
    interval_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    requires_stock: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false"), default=False
    )
    promised_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default=text("'MANUAL'"), default="MANUAL"
    )


class RecommendationDismissal(BaseEntity):
    __tablename__ = "recommendation_dismissals"
    __table_args__ = (
        UniqueConstraint("revision_id", "variant_id"),
        {"schema": SCHEMA},
    )

    quote_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quotes.id"), nullable=False
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quote_revisions.id", ondelete="CASCADE"), nullable=False
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.product_variants.id"), nullable=False
    )
    actor_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=False
    )
