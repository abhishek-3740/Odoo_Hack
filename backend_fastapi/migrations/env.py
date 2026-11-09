"""Alembic environment — async engine bound to app settings and ORM metadata."""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.core.config import get_settings
from app.models import Base
from app.models.base import SCHEMA

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option(
    "sqlalchemy.url", get_settings().sqlalchemy_url.replace("%", "%%")
)

target_metadata = Base.metadata

CONNECT_ARGS = {"server_settings": {"search_path": f"{SCHEMA}, public"}}

# Bookkeeping tables and the raw-SQL deal_escalations table (see
# app/models/portal.py) are intentionally outside the ORM metadata.
_AUTOGENERATE_IGNORES = {"alembic_version", "flyway_schema_history", "deal_escalations"}


def include_object(object_, name, type_, reflected, compare_to) -> bool:  # noqa: ANN001
    if type_ == "table" and name in _AUTOGENERATE_IGNORES:
        return False
    if type_ == "index" and name == "deal_escalations_queue":
        return False
    return True


def run_migrations_offline() -> None:
    """Emit SQL without a DBAPI connection."""

    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema="public",
        compare_type=True,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_schema="public",
        compare_type=True,
        include_object=include_object,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an async engine and run migrations through a sync bridge."""

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args=CONNECT_ARGS,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode with asyncpg."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
