"""Step C verification — model metadata contract (offline, no DB)."""

from __future__ import annotations

import app.models  # noqa: F401
from app.models.base import SCHEMA, Base

EXPECTED_TABLES = {
    "teams", "profiles", "approval_delegations", "customers", "categories",
    "products", "product_variants", "price_rules", "subscription_plans",
    "discount_policies", "quotes", "quote_revisions", "quote_lines",
    "recommendation_dismissals", "approval_requests", "negotiation_requests",
    "warehouses", "stock_levels", "stock_movements", "shipments",
    "shipment_lines", "reservations", "backorders", "orders", "order_lines",
    "subscriptions", "subscription_changes", "invoices", "invoice_lines",
    "payments", "payment_allocations", "credit_notes", "credit_allocations",
    "refunds", "alerts", "notifications", "audit_events", "job_runs",
    "job_leases", "idempotency_requests", "outbox_events", "app_settings",
    "processed_events",
}


def test_all_tables_present_in_dealflow_schema():
    names = {t.name for t in Base.metadata.tables.values()}
    assert names == EXPECTED_TABLES
    for table in Base.metadata.tables.values():
        assert table.schema == SCHEMA, table.name
        assert table.primary_key.columns, table.name


def test_money_columns_are_bigint_and_qty_is_numeric():
    from app.models.billing import Invoice
    from app.models.quotes import QuoteLine

    assert str(Invoice.__table__.c.total_minor.type) == "BIGINT"
    assert "NUMERIC" in str(QuoteLine.__table__.c.quantity.type)


def test_version_cols_for_optimistic_locking():
    from app.models.orders import Order
    from app.models.quotes import Quote

    assert Order.__mapper__.version_id_col is not None
    assert Quote.__mapper__.version_id_col is not None


def test_sequence_names():
    from app.repositories import sequences as seq

    assert seq.QUOTE_REFERENCE_SEQ == "dealflow.quote_reference_seq"
    assert seq.INVOICE_NUMBER_SEQ == "dealflow.invoice_number_seq"
    assert seq.DISCOUNT_POLICY_VERSION_SEQ == "dealflow.discount_policy_version_seq"
