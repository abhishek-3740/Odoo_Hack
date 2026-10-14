"""Identity tables: teams, profiles, approval_delegations."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import text

from app.models.base import SCHEMA, TimestampedEntity


class Team(TimestampedEntity):
    __tablename__ = "teams"

    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)


class Profile(TimestampedEntity):
    __tablename__ = "profiles"

    auth_user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, unique=True)
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    full_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.teams.id"), nullable=True
    )
    customer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.customers.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), default=True
    )
    unavailable_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    preferences: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict
    )


class ApprovalDelegation(TimestampedEntity):
    __tablename__ = "approval_delegations"

    approver_role: Mapped[str] = mapped_column(String(16), nullable=False)
    team_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.teams.id"), nullable=True
    )
    delegate_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=False
    )
    valid_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    valid_until: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    created_by_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=False
    )
