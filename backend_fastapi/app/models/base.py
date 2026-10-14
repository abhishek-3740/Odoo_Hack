"""Declarative base — port of shared/domain/{BaseEntity,TimestampedEntity}.

Pre-assigned UUID PKs (Persistable.isNew semantics: never merge on persist).
Every table lives in the dealflow schema (Flyway owns DDL; we validate).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

SCHEMA = "dealflow"


class Base(DeclarativeBase):
    pass


class BaseEntity(Base):
    __abstract__ = True
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class TimestampedEntity(BaseEntity):
    __abstract__ = True

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
