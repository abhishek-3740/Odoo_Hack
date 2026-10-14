"""Risk engine — port of quotes/service/RiskEngine.java + RiskModel +
policy/models/DiscountPolicyDefinition. Pure function, zero I/O.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import IntEnum

from app.engines import shared_math as m
from app.engines.pricing_engine import PricingResult


class ApprovalLevel(IntEnum):
    NONE = 0
    MANAGER = 1
    MANAGER_FINANCE = 2


@dataclass(frozen=True)
class RiskReason:
    code: str
    line_key: str | None
    description: str
    observed_value: Decimal
    threshold_value: Decimal
    unit: str
    required_level: ApprovalLevel
    message: str


@dataclass(frozen=True)
class LineRisk:
    line_key: str
    description: str
    category_code: str
    effective_discount_percent: Decimal
    allowed_percent: Decimal
    excess_pp: Decimal
    excess_value_minor: int
    base_minor: int
    margin_minor: int
    margin_percent: Decimal | None


@dataclass(frozen=True)
class RiskResult:
    required_level: ApprovalLevel
    reasons: list[RiskReason] = field(default_factory=list)
    lines: list[LineRisk] = field(default_factory=list)
    worst_line_excess_pp: Decimal = Decimal(0)
    weighted_excess_pp: Decimal = Decimal(0)
    excess_value_minor: int = 0
    aggregate_discount_percent: Decimal = Decimal(0)
    aggregate_margin_percent: Decimal | None = None
    total_base_minor: int = 0
    total_discount_minor: int = 0
    policy_version_no: int = 0

    def requires_approval(self) -> bool:
        return self.required_level != ApprovalLevel.NONE


@dataclass(frozen=True)
class ManagerTriggers:
    any_positive_excess: bool
    aggregate_discount_percent_above: Decimal | None
    aggregate_margin_percent_below: Decimal | None


@dataclass(frozen=True)
class FinanceTriggers:
    worst_line_excess_pp_at_least: Decimal | None
    weighted_excess_pp_at_least: Decimal | None
    excess_value_minor_at_least: int | None
    aggregate_margin_percent_below: Decimal | None
    non_positive_line_contribution: bool


@dataclass(frozen=True)
class DiscountPolicyDefinition:
    tier_ceiling_percent: dict[str, Decimal]
    category_ceiling_percent: dict[str, Decimal]
    manager: ManagerTriggers
    finance: FinanceTriggers

    def allowed_percent_for(self, tier: str, category_code: str) -> Decimal:
        tier_ceiling = self.tier_ceiling_percent.get(tier)
        cat_ceiling = self.category_ceiling_percent.get(category_code)
        if tier_ceiling is None and cat_ceiling is None:
            return Decimal(0)
        if tier_ceiling is None:
            return cat_ceiling  # type: ignore[return-value]
        if cat_ceiling is None:
            return tier_ceiling
        return min(tier_ceiling, cat_ceiling)

    @staticmethod
    def seed_default() -> "DiscountPolicyDefinition":
        return DiscountPolicyDefinition(
            tier_ceiling_percent={
                "BRONZE": Decimal("5"),
                "SILVER": Decimal("10"),
                "GOLD": Decimal("15"),
            },
            category_ceiling_percent={
                "HARDWARE": Decimal("15"),
                "SERVICE": Decimal("10"),
                "SUBSCRIPTION": Decimal("10"),
            },
            manager=ManagerTriggers(True, Decimal("12"), Decimal("20")),
            finance=FinanceTriggers(Decimal("8"), Decimal("3"), 500_000, Decimal("15"), True),
        )


def _trim(value: Decimal | None) -> str:
    if value is None:
        return "n/a"
    rounded = value.quantize(Decimal("0.01"), rounding=m.ROUND_HALF_UP).normalize()
    if rounded.as_tuple().exponent > 0:
        rounded = rounded.quantize(Decimal(1))
    return format(rounded, "f")


def evaluate(
    pricing: PricingResult,
    tier: str,
    policy: DiscountPolicyDefinition,
    policy_version_no: int,
) -> RiskResult:
    line_risks: list[LineRisk] = []
    reasons: list[RiskReason] = []
    worst = Decimal(0)
    excess_exact = Decimal(0)
    total_base = 0

    for line in pricing.lines:
        eff = m.bp_to_percent(line.effective_discount_bp)
        allowed = policy.allowed_percent_for(tier, line.category_code)
        excess = max(eff - allowed, Decimal(0))
        line_value = m.CALC.divide(
            m.CALC.multiply(Decimal(line.base_minor), excess), Decimal(100)
        )
        excess_exact += line_value
        total_base = m.sum_amounts(total_base, line.base_minor)
        worst = max(worst, excess)
        line_risks.append(
            LineRisk(
                line.line_key,
                line.description,
                line.category_code,
                eff,
                allowed,
                excess,
                m.money_round(line_value),
                line.base_minor,
                line.margin_minor,
                line.margin_percent,
            )
        )
        if excess > 0:
            reasons.append(
                RiskReason(
                    "LINE_DISCOUNT_OVER_CEILING",
                    line.line_key,
                    line.description,
                    eff,
                    allowed,
                    "percent",
                    ApprovalLevel.MANAGER,
                    f'"{line.description}" is discounted {_trim(eff)}%, which is '
                    f"{_trim(excess)} points over its {_trim(allowed)}% ceiling.",
                )
            )
        if line.net_minor > 0 and line.margin_minor <= 0:
            reasons.append(
                RiskReason(
                    "LINE_NON_POSITIVE_CONTRIBUTION",
                    line.line_key,
                    line.description,
                    Decimal(line.margin_minor),
                    Decimal(0),
                    "minor",
                    ApprovalLevel.MANAGER_FINANCE
                    if policy.finance.non_positive_line_contribution
                    else ApprovalLevel.MANAGER,
                    f'"{line.description}" contributes {m.format_money(line.margin_minor)} '
                    f"at a selling price of {m.format_money(line.net_minor)}.",
                )
            )

    excess_minor = m.money_round(excess_exact)
    if total_base == 0:
        weighted = Decimal(0)
        agg_disc = Decimal(0)
    else:
        weighted = m.CALC.divide(
            m.CALC.multiply(excess_exact, Decimal(100)), Decimal(total_base)
        ).quantize(Decimal("0.0001"), rounding=m.ROUND_HALF_UP)
        agg_disc = m.CALC.divide(
            m.CALC.multiply(Decimal(pricing.total_discount_minor), Decimal(100)),
            Decimal(total_base),
        ).quantize(Decimal("0.0001"), rounding=m.ROUND_HALF_UP)
    agg_margin = pricing.contribution_percent

    manager, finance = policy.manager, policy.finance
    if manager.any_positive_excess and excess_minor > 0 and not reasons:
        reasons.append(
            RiskReason(
                "AGGREGATE_EXCESS_PRESENT",
                None,
                "Quotation",
                weighted,
                Decimal(0),
                "pp",
                ApprovalLevel.MANAGER,
                f"This quotation concedes {m.format_money(excess_minor)} "
                "beyond the configured ceilings.",
            )
        )
    if (
        manager.aggregate_discount_percent_above is not None
        and agg_disc > manager.aggregate_discount_percent_above
    ):
        reasons.append(
            RiskReason(
                "AGGREGATE_DISCOUNT_OVER_CEILING",
                None,
                "Quotation",
                agg_disc,
                manager.aggregate_discount_percent_above,
                "percent",
                ApprovalLevel.MANAGER,
                f"The overall discount is {_trim(agg_disc)}%, above the "
                f"{_trim(manager.aggregate_discount_percent_above)}% limit for a single deal.",
            )
        )
    if (
        manager.aggregate_margin_percent_below is not None
        and agg_margin is not None
        and agg_margin < manager.aggregate_margin_percent_below
    ):
        reasons.append(
            RiskReason(
                "AGGREGATE_MARGIN_BELOW_FLOOR",
                None,
                "Quotation",
                agg_margin,
                manager.aggregate_margin_percent_below,
                "percent",
                ApprovalLevel.MANAGER,
                f"Quotation contribution is {_trim(agg_margin)}%, below the "
                f"{_trim(manager.aggregate_margin_percent_below)}% floor.",
            )
        )
    if (
        finance.worst_line_excess_pp_at_least is not None
        and worst >= finance.worst_line_excess_pp_at_least
    ):
        reasons.append(
            RiskReason(
                "WORST_LINE_EXCESS",
                None,
                "Quotation",
                worst,
                finance.worst_line_excess_pp_at_least,
                "pp",
                ApprovalLevel.MANAGER_FINANCE,
                f"One line is {_trim(worst)} points over its ceiling, at or above the "
                f"{_trim(finance.worst_line_excess_pp_at_least)}-point finance threshold.",
            )
        )
    if (
        finance.weighted_excess_pp_at_least is not None
        and weighted >= finance.weighted_excess_pp_at_least
    ):
        reasons.append(
            RiskReason(
                "WEIGHTED_EXCESS",
                None,
                "Quotation",
                weighted,
                finance.weighted_excess_pp_at_least,
                "pp",
                ApprovalLevel.MANAGER_FINANCE,
                f"Value-weighted excess is {_trim(weighted)} points, at or above the "
                f"{_trim(finance.weighted_excess_pp_at_least)}-point finance threshold.",
            )
        )
    if (
        finance.excess_value_minor_at_least is not None
        and excess_minor >= finance.excess_value_minor_at_least
    ):
        reasons.append(
            RiskReason(
                "EXCESS_CONCESSION_VALUE",
                None,
                "Quotation",
                Decimal(excess_minor),
                Decimal(finance.excess_value_minor_at_least),
                "minor",
                ApprovalLevel.MANAGER_FINANCE,
                f"Total concession beyond ceilings is {m.format_money(excess_minor)}, "
                f"at or above the {m.format_money(finance.excess_value_minor_at_least)} "
                "finance threshold.",
            )
        )
    if (
        finance.aggregate_margin_percent_below is not None
        and agg_margin is not None
        and agg_margin < finance.aggregate_margin_percent_below
    ):
        reasons.append(
            RiskReason(
                "AGGREGATE_MARGIN_BELOW_FINANCE_FLOOR",
                None,
                "Quotation",
                agg_margin,
                finance.aggregate_margin_percent_below,
                "percent",
                ApprovalLevel.MANAGER_FINANCE,
                f"Quotation contribution is {_trim(agg_margin)}%, below the "
                f"{_trim(finance.aggregate_margin_percent_below)}% finance floor.",
            )
        )

    required = ApprovalLevel.NONE
    for reason in reasons:
        required = max(required, reason.required_level)
    return RiskResult(
        required,
        list(reasons),
        list(line_risks),
        worst,
        weighted,
        excess_minor,
        agg_disc,
        agg_margin,
        total_base,
        pricing.total_discount_minor,
        policy_version_no,
    )
