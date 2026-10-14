"""Approval request table."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import SCHEMA, TimestampedEntity


class ApprovalRequest(TimestampedEntity):
    __tablename__ = "approval_requests"
    __table_args__ = (
        UniqueConstraint("revision_id", "step"),
        {"schema": SCHEMA},
    )

    quote_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quotes.id"), nullable=False
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quote_revisions.id"), nullable=False
    )
    step: Mapped[int] = mapped_column(Integer, nullable=False)
    required_role: Mapped[str] = mapped_column(String(16), nullable=False)
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.teams.id"), nullable=True
    )
    assignee_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    original_assignee_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    due_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    reasons: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    decided_by_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    reassignment_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    row_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __mapper_args__ = {"version_id_col": row_version}
