"""Commercial hash — port of quotes/models/CommercialHash.

SHA-256 over the canonical commercial terms. Includes discounts and nets,
excludes unit costs (customer must be able to reproduce it from the portal view).
"""

from __future__ import annotations

import hashlib
from decimal import Decimal


def _plain(value: Decimal | None) -> str:
    if value is None:
        return ""
    normalized = value.normalize()
    if normalized.as_tuple().exponent > 0:
        normalized = normalized.quantize(Decimal(1))
    return format(normalized, "f")


def commercial_hash(
    currency: str,
    order_discount_bp: int,
    backorder_terms: str,
    invoicing_terms: str,
    requested_activation_date: str | None,
    lines: list[dict],
) -> str:
    """lines: dicts with line_key, line_kind, variant_id, plan_id, quantity
    (Decimal), unit_price_minor, tax_rate_bp, line_discount_bp,
    effective_discount_bp, net_minor, interval_months, promised_date."""
    head = "|".join(
        [
            "v1",
            currency,
            str(order_discount_bp),
            backorder_terms,
            invoicing_terms,
            requested_activation_date or "",
        ]
    )
    rows = []
    for line in sorted(lines, key=lambda ln: ln["line_key"]):
        rows.append(
            "|".join(
                [
                    str(line["line_key"]),
                    str(line["line_kind"]),
                    str(line.get("variant_id") or ""),
                    str(line.get("plan_id") or ""),
                    _plain(line["quantity"]),
                    str(line["unit_price_minor"]),
                    str(line["tax_rate_bp"]),
                    str(line["line_discount_bp"]),
                    str(line["effective_discount_bp"]),
                    str(line["net_minor"]),
                    str(line.get("interval_months") or ""),
                    str(line.get("promised_date") or ""),
                ]
            )
        )
    return hashlib.sha256((head + "\n" + "\n".join(rows)).encode("utf-8")).hexdigest()
