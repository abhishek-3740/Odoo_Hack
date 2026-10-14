"""Money input type — exact Decimal from JSON string OR number.

Pydantic parses JSON 19.99 into float 19.99; Decimal(float) would carry binary
dust. Coerce via str() first so 19.99 -> Decimal("19.99") exactly.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from pydantic import BeforeValidator


def _coerce_money(value: object) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, int):
        return Decimal(value)
    return Decimal(str(value).strip())


MoneyInput = Annotated[Decimal, BeforeValidator(_coerce_money)]
