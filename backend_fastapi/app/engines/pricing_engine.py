"""Pricing engine — port of quotes/service/PricingEngine.java + PricingModel.

Pure function: resolved prices in, priced quotation out. Zero I/O.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from uuid import UUID

from app.core.exceptions import ApiException, ErrorCode
from app.engines import shared_math as m


class LineKind(str, Enum):
    ONE_TIME = "ONE_TIME"
    RECURRING = "RECURRING"


@dataclass(frozen=True)
class LineInput:
    line_key: str
    position: int
    kind: LineKind
    product_id: UUID | None
    category_id: UUID | None
    category_code: str
    variant_id: UUID | None
    plan_id: UUID | None
    description: str
    quantity: Decimal
    unit_price_minor: int
    unit_cost_minor: int
    tax_rate_bp: int
    line_discount_bp: int
    interval_months: int | None
    requires_stock: bool
    source: str = "MANUAL"


@dataclass(frozen=True)
class PricingInput:
    currency: str
    order_discount_bp: int
    lines: list[LineInput]


@dataclass(frozen=True)
class LineResult:
    line_key: str
    position: int
    kind: LineKind
    product_id: UUID | None
    category_id: UUID | None
    category_code: str
    variant_id: UUID | None
    plan_id: UUID | None
    description: str
    quantity: Decimal
    unit_price_minor: int
    unit_cost_minor: int
    tax_rate_bp: int
    line_discount_bp: int
    applied_order_discount_bp: int
    effective_discount_bp: int
    base_minor: int
    net_minor: int
    tax_minor: int
    cost_total_minor: int
    margin_minor: int
    margin_percent: Decimal | None
    interval_months: int | None
    requires_stock: bool
    source: str

    def discount_minor(self) -> int:
        return self.base_minor - self.net_minor


@dataclass(frozen=True)
class RecurringGroup:
    interval_months: int
    cadence: str
    net_minor: int
    tax_minor: int
    cost_minor: int
    margin_minor: int
    margin_percent: Decimal | None


@dataclass(frozen=True)
class PricingResult:
    currency: str
    order_discount_bp: int
    lines: list[LineResult]
    one_time_net_minor: int
    one_time_tax_minor: int
    one_time_cost_minor: int
    recurring_first_cycle_net_minor: int
    recurring_first_cycle_tax_minor: int
    recurring_first_cycle_cost_minor: int
    recurring_by_cadence: dict[int, RecurringGroup] = field(default_factory=dict)
    total_base_minor: int = 0
    total_discount_minor: int = 0
    contribution_minor: int = 0
    contribution_percent: Decimal | None = None
    initial_amount_due_minor: int = 0
    monthly_recurring_revenue_minor: int = 0

    def comparison_net_minor(self) -> int:
        return self.one_time_net_minor + self.recurring_first_cycle_net_minor


def _group_key(line: LineInput) -> str:
    if line.kind == LineKind.ONE_TIME:
        return "ONE_TIME"
    return f"RECURRING:{line.interval_months if line.interval_months is not None else 1}"


def _validate(pricing_input: PricingInput) -> None:
    if not pricing_input.lines:
        raise ApiException(ErrorCode.EMPTY_QUOTE)
    if not 0 <= pricing_input.order_discount_bp <= m.MAX_DISCOUNT:
        raise ApiException(
            ErrorCode.DISCOUNT_OUT_OF_RANGE,
            "The order discount must be between 0% and 99.99%.",
            {"orderDiscountBp": pricing_input.order_discount_bp},
        )
    for line in pricing_input.lines:
        if not 0 <= line.line_discount_bp <= m.MAX_DISCOUNT:
            raise ApiException(
                ErrorCode.DISCOUNT_OUT_OF_RANGE,
                f'The discount on "{line.description}" must be between 0% and 99.99%.',
                {"lineKey": line.line_key, "lineDiscountBp": line.line_discount_bp},
            )
        if line.quantity is None or line.quantity <= 0:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED,
                f'"{line.description}" needs a quantity greater than zero.',
                {"lineKey": line.line_key},
            )
        if line.unit_price_minor < 0 or line.unit_cost_minor < 0:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED,
                "Prices and costs cannot be negative.",
                {"lineKey": line.line_key},
            )
        if line.kind == LineKind.RECURRING and line.interval_months is None:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED,
                "A recurring line needs a billing interval.",
                {"lineKey": line.line_key},
            )


def evaluate(pricing_input: PricingInput) -> PricingResult:
    _validate(pricing_input)
    order_bp = pricing_input.order_discount_bp
    lines = pricing_input.lines

    groups: dict[str, list[int]] = {}
    for i, line in enumerate(lines):
        groups.setdefault(_group_key(line), []).append(i)

    base_minor = [0] * len(lines)
    net_minor = [0] * len(lines)
    cost_minor = [0] * len(lines)

    for indices in groups.values():
        exact_base, exact_net, exact_cost, keys = [], [], [], []
        for index in indices:
            line = lines[index]
            base = m.CALC.multiply(line.quantity, Decimal(line.unit_price_minor))
            net = m.CALC.multiply(
                m.CALC.multiply(base, m.bp_keep_fraction(line.line_discount_bp)),
                m.bp_keep_fraction(order_bp),
            )
            cost = m.CALC.multiply(line.quantity, Decimal(line.unit_cost_minor))
            exact_base.append(base)
            exact_net.append(net)
            exact_cost.append(cost)
            keys.append(line.line_key)
        rb = m.round_preserving_total(exact_base, keys)
        rn = m.round_preserving_total(exact_net, keys)
        rc = m.round_preserving_total(exact_cost, keys)
        for slot, index in enumerate(indices):
            base_minor[index], net_minor[index], cost_minor[index] = (
                rb[slot],
                rn[slot],
                rc[slot],
            )

    results: list[LineResult] = []
    for i, line in enumerate(lines):
        net = net_minor[i]
        if net <= 0:  # E03: undefined margin — refuse before approval routing
            raise ApiException(
                ErrorCode.ZERO_NET_LINE,
                f'"{line.description}" is discounted to zero value. '
                "Reduce the discount or remove the line.",
                {"lineKey": line.line_key},
            )
        eff = m.bp_combine(line.line_discount_bp, order_bp)
        tax = m.money_round(m.CALC.multiply(Decimal(net), m.bp_fraction(line.tax_rate_bp)))
        margin = net - cost_minor[i]
        results.append(
            LineResult(
                line_key=line.line_key,
                position=line.position,
                kind=line.kind,
                product_id=line.product_id,
                category_id=line.category_id,
                category_code=line.category_code,
                variant_id=line.variant_id,
                plan_id=line.plan_id,
                description=line.description,
                quantity=line.quantity,
                unit_price_minor=line.unit_price_minor,
                unit_cost_minor=line.unit_cost_minor,
                tax_rate_bp=line.tax_rate_bp,
                line_discount_bp=line.line_discount_bp,
                applied_order_discount_bp=order_bp,
                effective_discount_bp=eff,
                base_minor=base_minor[i],
                net_minor=net,
                tax_minor=tax,
                cost_total_minor=cost_minor[i],
                margin_minor=margin,
                margin_percent=m.percent_of(margin, net),
                interval_months=line.interval_months,
                requires_stock=line.requires_stock,
                source=line.source,
            )
        )
    return _summarise(pricing_input.currency, order_bp, results)


def _summarise(
    currency: str, order_bp: int, lines: list[LineResult]
) -> PricingResult:
    one_net = one_tax = one_cost = 0
    rec_net = rec_tax = rec_cost = 0
    total_base = total_disc = 0
    mrr_exact = Decimal(0)
    cadence: dict[int, list[int]] = {}

    for line in lines:
        total_base = m.sum_amounts(total_base, line.base_minor)
        total_disc = m.sum_amounts(total_disc, line.discount_minor())
        if line.kind == LineKind.ONE_TIME:
            one_net = m.sum_amounts(one_net, line.net_minor)
            one_tax = m.sum_amounts(one_tax, line.tax_minor)
            one_cost = m.sum_amounts(one_cost, line.cost_total_minor)
        else:
            rec_net = m.sum_amounts(rec_net, line.net_minor)
            rec_tax = m.sum_amounts(rec_tax, line.tax_minor)
            rec_cost = m.sum_amounts(rec_cost, line.cost_total_minor)
            months = line.interval_months if line.interval_months is not None else 1
            bucket = cadence.setdefault(months, [0, 0, 0])
            bucket[0] = m.sum_amounts(bucket[0], line.net_minor)
            bucket[1] = m.sum_amounts(bucket[1], line.tax_minor)
            bucket[2] = m.sum_amounts(bucket[2], line.cost_total_minor)
            mrr_exact += m.CALC.multiply(
                Decimal(line.net_minor), m.monthly_normalisation_factor(months)
            )

    by_cadence: dict[int, RecurringGroup] = {}
    for months in sorted(cadence):
        net, tax, cost = cadence[months]
        margin = net - cost
        by_cadence[months] = RecurringGroup(
            months,
            m.cadence_label(months),
            net,
            tax,
            cost,
            margin,
            m.percent_of(margin, net),
        )

    comparison_net = m.sum_amounts(one_net, rec_net)
    comparison_cost = m.sum_amounts(one_cost, rec_cost)
    contribution = comparison_net - comparison_cost
    return PricingResult(
        currency=currency,
        order_discount_bp=order_bp,
        lines=lines,
        one_time_net_minor=one_net,
        one_time_tax_minor=one_tax,
        one_time_cost_minor=one_cost,
        recurring_first_cycle_net_minor=rec_net,
        recurring_first_cycle_tax_minor=rec_tax,
        recurring_first_cycle_cost_minor=rec_cost,
        recurring_by_cadence=by_cadence,
        total_base_minor=total_base,
        total_discount_minor=total_disc,
        contribution_minor=contribution,
        contribution_percent=m.percent_of(contribution, comparison_net),
        initial_amount_due_minor=m.sum_amounts(one_net, one_tax),
        monthly_recurring_revenue_minor=m.money_round(mrr_exact),
    )
