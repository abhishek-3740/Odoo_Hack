"""Discount policy table. Definition dataclass lives in risk_engine."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.engines.risk_engine import DiscountPolicyDefinition
from app.models.base import SCHEMA, BaseEntity

__all__ = ["DiscountPolicy", "DiscountPolicyDefinition"]


class DiscountPolicy(BaseEntity):
    __tablename__ = "discount_policies"

    version_no: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    definition: Mapped[dict] = mapped_column(JSONB, nullable=False)
    effective_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
