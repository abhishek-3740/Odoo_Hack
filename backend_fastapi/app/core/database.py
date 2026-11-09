"""Async SQLAlchemy engine — mirrors datasource + JPA settings from application.yml.

- Schema lifecycle: we never create/drop schema here (Alembic owns it).
- default_schema=dealflow equivalent: search_path server setting.
- asyncpg pool: 10 connections with 20 overflow, recycled hourly.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

_settings = get_settings()

engine = create_async_engine(
    _settings.sqlalchemy_url,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args={"server_settings": {"search_path": "dealflow, public"}},
)

SessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
