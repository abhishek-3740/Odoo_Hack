"""Baseline schema — legacy Flyway migrations V1 through V7.

Databases already provisioned by the Spring backend must be stamped
(``alembic stamp head``) instead of upgraded.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-11-09
"""

from __future__ import annotations

from pathlib import Path

from alembic import op
from sqlalchemy.util import await_only

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

_SQL_DIR = Path(__file__).resolve().parent.parent / "sql"
_SCRIPTS = (
    "V1__core_schema.sql",
    "V2__quotes_approvals.sql",
    "V3__orders_fulfillment.sql",
    "V4__billing.sql",
    "V5__ops_audit_outbox.sql",
    "V6__customer_self_service.sql",
    "V7__deal_escalations.sql",
)


def _run_script(sql: str) -> None:
    """Send a multi-statement script over asyncpg's simple-query protocol."""
    raw = op.get_bind().connection.driver_connection
    await_only(raw.execute(sql))


def upgrade() -> None:
    for name in _SCRIPTS:
        _run_script((_SQL_DIR / name).read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute("DROP SCHEMA IF EXISTS dealflow CASCADE")
