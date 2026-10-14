"""Discount anomaly detector — port of health/service/DiscountAnomalyDetector.
Pure statistics over a rep's own finalised quotations (E23).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal

from app.engines import shared_math as m

_ANALYSIS = m.Context(prec=20, rounding=m.ROUND_HALF_UP)


@dataclass(frozen=True)
class AnomalyConfig:
    minimum_observations: int = 5
    minimum_excess_pp: Decimal = Decimal("5")
    sigma_multiplier: Decimal = Decimal("2")
    std_dev_floor_pp: Decimal = Decimal("2")


@dataclass(frozen=True)
class Verdict:
    anomalous: bool
    insufficient_history: bool
    observations: int
    current_percent: Decimal
    mean_percent: Decimal | None
    standard_deviation: Decimal | None
    excess_pp: Decimal | None
    z_score: Decimal | None
    explanation: str


def _scale(value: Decimal) -> str:
    return format(
        value.quantize(Decimal("0.01"), rounding=m.ROUND_HALF_UP).normalize(), "f"
    )


def _mean(values: list[Decimal]) -> Decimal:
    total = sum(values, Decimal(0))
    return _ANALYSIS.divide(total, Decimal(len(values)))


def _stddev(values: list[Decimal], mean: Decimal) -> Decimal:
    diffs = [_ANALYSIS.subtract(v, mean) for v in values]
    squares = sum((_ANALYSIS.multiply(d, d) for d in diffs), Decimal(0))
    variance = _ANALYSIS.divide(squares, Decimal(len(values)))
    if variance <= 0:
        return Decimal(0)
    return Decimal(math.sqrt(float(variance))).quantize(
        Decimal("0.0001"), rounding=m.ROUND_HALF_UP
    )


def evaluate(
    current_discount_percent: Decimal,
    historical_percents: list[Decimal | float | int],
    config: AnomalyConfig | None = None,
) -> Verdict:
    config = config or AnomalyConfig()
    history = [Decimal(str(v)) for v in historical_percents]
    observations = len(history)
    if observations < config.minimum_observations:
        return Verdict(
            False,
            True,
            observations,
            current_discount_percent,
            None,
            None,
            None,
            None,
            f"Not enough finalised quotations yet ({observations} of "
            f"{config.minimum_observations} needed) to compare this discount against "
            "this rep's own history. Customer and category policy rules still apply.",
        )
    mean = _mean(history)
    deviation = _stddev(history, mean)
    effective = max(deviation, config.std_dev_floor_pp)
    excess = current_discount_percent - mean
    z = (
        Decimal(0)
        if effective == 0
        else (excess / effective).quantize(
            Decimal("0.0001"), rounding=m.ROUND_HALF_UP
        )
    )
    anomalous = excess >= config.minimum_excess_pp and z > config.sigma_multiplier
    explanation = (
        f"This discount is {_scale(excess)} points above this rep's average of "
        f"{_scale(mean)}% across {observations} finalised quotations "
        f"({_scale(z)} standard deviations). Worth a look, not a conclusion."
        if anomalous
        else f"Within this rep's usual range: average {_scale(mean)}%, this quotation "
        f"{_scale(current_discount_percent)}%."
    )
    return Verdict(
        anomalous, False, observations, current_discount_percent,
        mean, deviation, excess, z, explanation,
    )
