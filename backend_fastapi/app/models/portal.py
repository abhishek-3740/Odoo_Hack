"""Portal tables: negotiation_requests (deal_escalations stays raw SQL)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import SCHEMA, TimestampedEntity


class NegotiationRequest(TimestampedEntity):
    __tablename__ = "negotiation_requests"

    quote_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quotes.id"), nullable=False
    )
    revision_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.quote_revisions.id"), nullable=False
    )
    candidate_revision_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.quote_revisions.id"), nullable=True
    )
    actor_profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=False
    )
    line_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    request_type: Mapped[str] = mapped_column(String(16), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="OPEN")
    response_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    responded_by_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(f"{SCHEMA}.profiles.id"), nullable=True
    )
    responded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
