"""Shared commercial math — port of shared/money/{Money,Bp,ResidualAllocator}
and shared/time/BusinessCalendar. Pure functions, zero I/O.

Precision contract: intermediate work at 34 significant digits HALF_UP
(Java MathContext(34) / DECIMAL128), rounded to minor units exactly once.
Never build a Decimal from a float.
"""

from __future__ import annotations

import calendar as _calendar
from datetime import date
from decimal import ROUND_CEILING, ROUND_HALF_UP, Context, Decimal

CALC = Context(prec=34, rounding=ROUND_HALF_UP)

_ONE = Decimal(1)
_MINOR = Decimal("0.01")
_PCT4 = Decimal("0.0001")
_NORM10 = Decimal("0.0000000001")


def _q0(value: Decimal) -> int:
    return int(value.quantize(_ONE, rounding=ROUND_HALF_UP))


# ---------------------------------------------------------------- Money ---


def to_major(minor: int) -> Decimal:
    """Major-unit decimal (39300.00) for stored minor units (3930000)."""
    return Decimal(minor).scaleb(-2)


def to_minor(major: Decimal | str | int) -> int:
    """Stored minor units for a major-unit decimal. No floats accepted."""
    if isinstance(major, float):
        raise TypeError("never build money from a float")
    return _q0(Decimal(major) * 100)


def parse_major(text: str) -> int:
    return to_minor(Decimal(text))


def money_round(exact_minor: Decimal) -> int:
    return _q0(exact_minor)


def percent_of(part_minor: int, base_minor: int) -> Decimal | None:
    """4dp percentage, or None when base is zero (E03: undefined, not zero)."""
    if base_minor == 0:
        return None
    return (Decimal(part_minor) * 100 / Decimal(base_minor)).quantize(
        _PCT4, rounding=ROUND_HALF_UP
    )


def sum_amounts(*amounts: int) -> int:
    return sum(amounts)


def format_money(minor: int) -> str:
    return format(to_major(minor), "f")


def plain_quantity(value: Decimal | None) -> str | None:
    """Strip DB scale above 2 places; money at exactly scale 2 untouched."""
    if value is None:
        return None
    normalised = value
    if normalised.as_tuple().exponent < -2:
        normalised = normalised.normalize()
        if normalised.as_tuple().exponent > 0:
            normalised = normalised.quantize(_ONE)
    return format(normalised, "f")


# ------------------------------------------------------------------ Bp ---


ONE_HUNDRED_PERCENT = 10_000
MAX_DISCOUNT = 9_999  # 99.99% (E18)


def bp_fraction(bp: int) -> Decimal:
    return CALC.divide(Decimal(bp), Decimal(ONE_HUNDRED_PERCENT))


def bp_keep_fraction(bp: int) -> Decimal:
    return _ONE - bp_fraction(bp)


def bp_to_percent(bp: int) -> Decimal:
    return (Decimal(bp) / 100).quantize(_MINOR, rounding=ROUND_HALF_UP)


def bp_from_percent(percent: Decimal) -> int:
    return _q0(percent * 100)


def bp_combine(line_bp: int, order_bp: int) -> int:
    """1-(1-l)(1-o) in bp. 10%+10% = 1900bp, never 2000 (E01)."""
    kept = CALC.multiply(bp_keep_fraction(line_bp), bp_keep_fraction(order_bp))
    return _q0(CALC.multiply(_ONE - kept, Decimal(ONE_HUNDRED_PERCENT)))


# ---------------------------------------------------- ResidualAllocator ---


def round_preserving_total(
    exact_minor_amounts: list[Decimal], stable_keys: list[str]
) -> list[int]:
    """Round each line HALF_UP, then hand the residual to the lines that lost
    most in rounding (ties by stable key, ASC). Wraps if |residual| > n."""
    n = len(exact_minor_amounts)
    if n != len(stable_keys):
        raise ValueError("amounts and keys must be the same length")
    if n == 0:
        return []
    rounded = [_q0(exact) for exact in exact_minor_amounts]
    exact_total = sum(exact_minor_amounts, Decimal(0))
    target = _q0(exact_total)
    residual = target - sum(rounded)
    if residual == 0:
        return rounded
    losses = [exact - Decimal(r) for exact, r in zip(exact_minor_amounts, rounded)]
    ranked = sorted(range(n), key=lambda i: stable_keys[i])
    ranked = sorted(ranked, key=lambda i: losses[i], reverse=residual > 0)
    step = 1 if residual > 0 else -1
    remaining = abs(residual)
    passed = 0
    while remaining > 0:
        rounded[ranked[passed % n]] += step
        remaining -= 1
        passed += 1
    return rounded


# ------------------------------------------------------ BusinessCalendar ---


def _month_len(year: int, month: int) -> int:
    return _calendar.monthrange(year, month)[1]


def _add_months(current: date, months: int) -> tuple[int, int]:
    idx = (current.year * 12 + (current.month - 1)) + months
    return idx // 12, idx % 12 + 1


def next_boundary(current: date, anchor_day: int, interval_months: int) -> date:
    year, month = _add_months(current, interval_months)
    return date(year, month, min(anchor_day, _month_len(year, month)))


def previous_boundary(current: date, anchor_day: int, interval_months: int) -> date:
    year, month = _add_months(current, -interval_months)
    return date(year, month, min(anchor_day, _month_len(year, month)))


def first_period_end(activation: date, anchor_day: int, interval_months: int) -> date:
    clamped = min(anchor_day, _month_len(activation.year, activation.month))
    if activation.day == clamped:
        return next_boundary(activation, anchor_day, interval_months)
    year, month = activation.year, activation.month
    candidate = date(year, month, min(anchor_day, _month_len(year, month)))
    while candidate <= activation:
        year, month = _add_months(date(year, month, 1), 1)
        candidate = date(year, month, min(anchor_day, _month_len(year, month)))
    return candidate


def days_between(start: date, end: date) -> int:
    """Whole days in half-open [start, end)."""
    return (end - start).days


def remaining_fraction(effective: date, period_start: date, period_end: date) -> Decimal:
    """Exact unrounded share of [period_start, period_end) from effective on."""
    total = days_between(period_start, period_end)
    if total <= 0:
        raise ValueError("period end must follow period start")
    remaining = days_between(effective, period_end)
    if remaining <= 0:
        return Decimal(0)
    if remaining >= total:
        return _ONE
    return CALC.divide(Decimal(remaining), Decimal(total))


def elapsed_fraction(effective: date, period_start: date, period_end: date) -> Decimal:
    return _ONE - remaining_fraction(effective, period_start, period_end)


def cadence_label(interval_months: int) -> str:
    return {1: "monthly", 3: "quarterly", 12: "yearly"}.get(
        interval_months, f"{interval_months}-monthly"
    )


def monthly_normalisation_factor(interval_months: int) -> Decimal:
    return CALC.divide(_ONE, Decimal(interval_months)).quantize(
        _NORM10, rounding=ROUND_HALF_UP
    )


def kg_ceiling(grams: Decimal) -> Decimal:
    return (grams / 1000).quantize(Decimal("0.001"), rounding=ROUND_CEILING)
