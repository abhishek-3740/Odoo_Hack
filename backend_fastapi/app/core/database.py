"""Async SQLAlchemy engine — mirrors datasource + JPA settings from application.yml.

- ddl-auto=validate equivalent: we never create/drop schema here (Flyway owns it).
- default_schema=dealflow equivalent: search_path server setting.
- Hikari max 5 -> asyncpg pool_size DB_POOL_MAX.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

_settings = get_settings()

engine = create_async_engine(
    _settings.sqlalchemy_url,
    pool_size=_settings.db_pool_max,
    max_overflow=0,
    pool_pre_ping=True,
    connect_args={"server_settings": {"search_path": "dealflow, public"}},
)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    session = SessionLocal()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()
