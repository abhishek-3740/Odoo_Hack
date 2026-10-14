"""Proration calculator — port of billing/service/ProrationCalculator.java.
Pure calendar billing arithmetic. Round ONCE at the end (E15).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from app.engines import shared_math as m


@dataclass(frozen=True)
class Adjustment:
    net_minor: int  # +charge / -credit
    tax_minor: int
    remaining_fraction: Decimal
    remaining_days: int
    total_days: int
    coverage_start: date
    coverage_end: date

    def is_charge(self) -> bool:
        return self.net_minor > 0

    def is_credit(self) -> bool:
        return self.net_minor < 0

    def absolute_net_minor(self) -> int:
        return abs(self.net_minor)

    def absolute_tax_minor(self) -> int:
        return abs(self.tax_minor)


@dataclass(frozen=True)
class ChargeSegment:
    coverage_start: date | None
    coverage_end: date | None
    net_minor: int
    tax_minor: int


@dataclass(frozen=True)
class SegmentCredit:
    coverage_start: date | None
    coverage_end: date | None
    credited_from: date
    net_minor: int
    tax_minor: int
    remaining_fraction: Decimal


@dataclass(frozen=True)
class CreditBreakdown:
    net_minor: int
    tax_minor: int
    segments: list[SegmentCredit] = field(default_factory=list)


def tax_on(net_minor: int, tax_rate_bp: int) -> int:
    if tax_rate_bp == 0:
        return 0
    return m.money_round(m.CALC.multiply(Decimal(net_minor), m.bp_fraction(tax_rate_bp)))


def first_period_charge(
    quantity: Decimal,
    unit_interval_price_minor: int,
    period_start: date,
    period_end: date,
    anchor_day: int,
    interval_months: int,
    tax_rate_bp: int,
) -> Adjustment:
    full_start = m.previous_boundary(period_end, anchor_day, interval_months)
    total_days = m.days_between(full_start, period_end)
    covered_days = m.days_between(period_start, period_end)
    fraction = (
        m.CALC.divide(Decimal(covered_days), Decimal(total_days))
        if period_start > full_start
        else Decimal(1)
    )
    exact_net = m.CALC.multiply(
        m.CALC.multiply(quantity, Decimal(unit_interval_price_minor)), fraction
    )
    net = m.money_round(exact_net)
    return Adjustment(
        net, tax_on(net, tax_rate_bp), fraction, covered_days, total_days,
        period_start, period_end,
    )


def quantity_change(
    old_quantity: Decimal,
    new_quantity: Decimal,
    unit_interval_price_minor: int,
    effective_date: date,
    period_start: date,
    period_end: date,
    tax_rate_bp: int,
) -> Adjustment:
    fraction = m.remaining_fraction(effective_date, period_start, period_end)
    delta = new_quantity - old_quantity
    exact_net = m.CALC.multiply(
        m.CALC.multiply(delta, Decimal(unit_interval_price_minor)), fraction
    )
    net = m.money_round(exact_net)
    return Adjustment(
        net,
        tax_on(net, tax_rate_bp),
        fraction,
        m.days_between(effective_date, period_end),
        m.days_between(period_start, period_end),
        effective_date,
        period_end,
    )


def remainder_at_new_price(
    quantity: Decimal,
    unit_interval_price_minor: int,
    effective_date: date,
    period_start: date,
    period_end: date,
    tax_rate_bp: int,
) -> Adjustment:
    return quantity_change(
        Decimal(0),
        quantity,
        unit_interval_price_minor,
        effective_date,
        period_start,
        period_end,
        tax_rate_bp,
    )


def unused_coverage(
    segments: list[ChargeSegment], effective_date: date
) -> CreditBreakdown:
    credits: list[SegmentCredit] = []
    net_total = tax_total = 0
    for segment in segments:
        if segment.coverage_start is None or segment.coverage_end is None:
            continue
        if segment.coverage_end <= effective_date:
            continue  # fully consumed
        credit_from = (
            segment.coverage_start
            if effective_date < segment.coverage_start
            else effective_date
        )
        fraction = m.remaining_fraction(
            credit_from, segment.coverage_start, segment.coverage_end
        )
        if fraction <= 0:
            continue
        net = m.money_round(
            m.CALC.multiply(Decimal(segment.net_minor), fraction)
        )
        tax = m.money_round(
            m.CALC.multiply(Decimal(segment.tax_minor), fraction)
        )
        if net <= 0 and tax <= 0:
            continue
        credits.append(
            SegmentCredit(
                segment.coverage_start,
                segment.coverage_end,
                credit_from,
                net,
                tax,
                fraction,
            )
        )
        net_total = m.sum_amounts(net_total, net)
        tax_total = m.sum_amounts(tax_total, tax)
    return CreditBreakdown(net_total, tax_total, list(credits))
