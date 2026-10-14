"""Step B verification — engine parity tests ported 1:1 from the Java suite.

Sources: PricingEngineTest, RiskEngineTest, AllocationEngineTest,
ProrationCalculatorTest, DiscountAnomalyDetectorTest. Pure, no DB.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest

from app.core.exceptions import ApiException, ErrorCode
from app.engines import shared_math as m
from app.engines.allocation_engine import (
    AllocationInput,
    AllocationResult,
    Availability,
    Demand,
    Mode,
    WarehouseInfo,
    allocate,
)
from app.engines.anomaly import evaluate as anomaly_evaluate
from app.engines.commercial_hash import commercial_hash
from app.engines.pricing_engine import (
    LineInput,
    LineKind,
    PricingInput,
    PricingResult,
    evaluate as price,
)
from app.engines.proration_calculator import (
    ChargeSegment,
    first_period_charge,
    quantity_change,
    unused_coverage,
)
from app.engines.risk_engine import (
    ApprovalLevel,
    DiscountPolicyDefinition,
    evaluate as assess,
)

POLICY = DiscountPolicyDefinition.seed_default()


def one_time(key, desc, cat, qty, price_minor, cost_minor, disc_bp, tax_bp=0):
    return LineInput(
        key, 0, LineKind.ONE_TIME, uuid4(), uuid4(), cat, uuid4(), None,
        desc, Decimal(qty), price_minor, cost_minor, tax_bp, disc_bp,
        None, True, "MANUAL",
    )


def recurring(key, desc, qty, price_minor, cost_minor, disc_bp, months):
    return LineInput(
        key, 0, LineKind.RECURRING, uuid4(), uuid4(), "SUBSCRIPTION", None, uuid4(),
        desc, Decimal(qty), price_minor, cost_minor, 0, disc_bp,
        months, False, "MANUAL",
    )


def line_of(result: PricingResult, key: str):
    return next(ln for ln in result.lines if ln.line_key == key)


def codes_of(result) -> list[str]:
    return [r.code for r in result.reasons]


# ------------------------------------------------------- discount composition


def test_stacked_discounts_compose_to_19_percent():
    result = price(PricingInput("INR", 1000, [one_time("L1", "Laptop", "HARDWARE", "1", 1_000_000, 700_000, 1000)]))
    assert line_of(result, "L1").effective_discount_bp == 1900
    assert line_of(result, "L1").net_minor == 810_000


def test_order_discount_reaches_every_line():
    result = price(
        PricingInput(
            "INR",
            1000,
            [
                one_time("L1", "Laptop", "HARDWARE", "1", 1_000_000, 700_000, 500),
                one_time("L2", "Setup", "SERVICE", "1", 500_000, 350_000, 0),
            ],
        )
    )
    assert line_of(result, "L1").effective_discount_bp == 1450
    assert line_of(result, "L2").effective_discount_bp == 1000


def _flow_b() -> PricingResult:
    return price(
        PricingInput(
            "INR",
            0,
            [
                one_time("L1", "Laptop", "HARDWARE", "4", 1_000_000, 700_000, 1200),
                one_time("L2", "Setup service", "SERVICE", "1", 500_000, 350_000, 1800),
                recurring("L3", "Support seat", "10", 30_000, 12_000, 0, 1),
            ],
        )
    )


def test_flow_b_separates_one_time_from_recurring():
    result = _flow_b()
    assert result.one_time_net_minor == 3_930_000
    assert result.recurring_first_cycle_net_minor == 300_000
    assert set(result.recurring_by_cadence) == {1}
    assert result.recurring_by_cadence[1].cadence == "monthly"


def test_flow_b_contribution():
    result = _flow_b()
    assert result.comparison_net_minor() == 4_230_000
    assert result.contribution_minor == 960_000
    assert result.contribution_percent == Decimal("22.6950")


def test_flow_b_initial_due_excludes_recurring():
    assert _flow_b().initial_amount_due_minor == 3_930_000


def _rounding_input() -> PricingInput:
    return PricingInput(
        "INR",
        3333,
        [
            one_time("L1", "Item A", "HARDWARE", "1", 10_001, 1, 0),
            one_time("L2", "Item B", "HARDWARE", "1", 10_001, 1, 0),
            one_time("L3", "Item C", "HARDWARE", "1", 10_001, 1, 0),
        ],
    )


def test_residual_redistributed_so_lines_reconcile():
    result = price(_rounding_input())
    assert sum(ln.net_minor for ln in result.lines) == result.one_time_net_minor


def test_residual_allocation_deterministic():
    first = [ln.net_minor for ln in price(_rounding_input()).lines]
    second = [ln.net_minor for ln in price(_rounding_input()).lines]
    assert first == second


def test_hundred_percent_discount_refused_as_out_of_range():
    with pytest.raises(ApiException) as exc:
        price(PricingInput("INR", 0, [one_time("L1", "Laptop", "HARDWARE", "1", 1_000_000, 700_000, 10_000)]))
    assert exc.value.code == ErrorCode.DISCOUNT_OUT_OF_RANGE


def test_zero_net_line_refused():
    with pytest.raises(ApiException) as exc:
        price(PricingInput("INR", 0, [one_time("L1", "Rounding dust", "HARDWARE", "1", 1, 0, 9999)]))
    assert exc.value.code == ErrorCode.ZERO_NET_LINE


def test_margin_percent_null_at_zero_revenue():
    assert m.percent_of(0, 0) is None


def test_cadences_reported_separately_and_mrr_normalised():
    result = price(
        PricingInput(
            "INR",
            0,
            [
                recurring("M", "Monthly seat", "1", 30_000, 0, 0, 1),
                recurring("Q", "Quarterly seat", "1", 90_000, 0, 0, 3),
                recurring("Y", "Yearly seat", "1", 360_000, 0, 0, 12),
            ],
        )
    )
    assert set(result.recurring_by_cadence) == {1, 3, 12}
    assert result.monthly_recurring_revenue_minor == 90_000
    assert result.recurring_first_cycle_net_minor == 480_000


# ------------------------------------------------------------------ risk


def _assess(tier, order_bp, lines):
    return assess(price(PricingInput("INR", order_bp, lines)), tier, POLICY, 1)


def _flow_b_risk():
    return _assess(
        "GOLD",
        0,
        [
            one_time("L1", "Laptop", "HARDWARE", "4", 1_000_000, 700_000, 1200),
            one_time("L2", "Setup service", "SERVICE", "1", 500_000, 350_000, 1800),
            recurring("L3", "Support seat", "10", 30_000, 12_000, 0, 1),
        ],
    )


def test_flow_b_service_line_forces_manager_then_finance():
    result = _flow_b_risk()
    assert result.required_level == ApprovalLevel.MANAGER_FINANCE
    assert "LINE_DISCOUNT_OVER_CEILING" in codes_of(result)
    assert "WORST_LINE_EXCESS" in codes_of(result)


def test_flow_b_metrics_match_worked_example():
    result = _flow_b_risk()
    assert result.worst_line_excess_pp == Decimal("8")
    assert result.excess_value_minor == 40_000
    assert result.weighted_excess_pp == Decimal("0.8333")
    assert result.total_base_minor == 4_800_000


def test_small_blended_excess_still_routes_to_finance():
    result = _flow_b_risk()
    assert result.weighted_excess_pp < POLICY.finance.weighted_excess_pp_at_least
    assert result.excess_value_minor < POLICY.finance.excess_value_minor_at_least
    assert result.required_level == ApprovalLevel.MANAGER_FINANCE


def test_compliant_line_contributes_nothing():
    result = _flow_b_risk()
    l1 = next(ln for ln in result.lines if ln.line_key == "L1")
    assert l1.excess_pp == Decimal(0)


def test_negative_overage_cannot_cancel_breach():
    result = _assess(
        "GOLD",
        0,
        [
            one_time("OVER", "Over ceiling", "HARDWARE", "1", 1_000_000, 100_000, 2000),
            one_time("UNDER", "Under ceiling", "HARDWARE", "1", 1_000_000, 100_000, 1000),
        ],
    )
    assert result.excess_value_minor == 50_000
    assert result.weighted_excess_pp == Decimal("2.5")
    assert result.worst_line_excess_pp == Decimal("5")
    assert result.required_level != ApprovalLevel.NONE


def test_line_splitting_is_invariant():
    whole = _assess("GOLD", 0, [one_time("BIG", "Ten laptops", "HARDWARE", "10", 1_000_000, 100_000, 2500)])
    pieces = _assess(
        "GOLD", 0,
        [one_time(f"S{i}", f"Laptop {i}", "HARDWARE", "1", 1_000_000, 100_000, 2500) for i in range(10)],
    )
    assert pieces.worst_line_excess_pp == whole.worst_line_excess_pp
    assert pieces.weighted_excess_pp == whole.weighted_excess_pp
    assert pieces.excess_value_minor == whole.excess_value_minor
    assert pieces.required_level == whole.required_level


def test_aggregate_cap_triggers_on_compliant_lines():
    result = _assess(
        "GOLD",
        0,
        [
            one_time("L1", "Laptop", "HARDWARE", "5", 1_000_000, 100_000, 1500),
            one_time("L2", "Dock", "HARDWARE", "5", 100_000, 10_000, 1500),
        ],
    )
    assert result.worst_line_excess_pp == Decimal(0)
    assert result.excess_value_minor == 0
    assert "AGGREGATE_DISCOUNT_OVER_CEILING" in codes_of(result)
    assert result.required_level == ApprovalLevel.MANAGER


def test_zero_contribution_requires_finance():
    result = _assess("GOLD", 0, [one_time("L1", "Break-even item", "HARDWARE", "1", 10_000, 7_000, 3000)])
    assert "LINE_NON_POSITIVE_CONTRIBUTION" in codes_of(result)
    assert result.required_level == ApprovalLevel.MANAGER_FINANCE


def test_negative_contribution_requires_finance():
    result = _assess("GOLD", 0, [one_time("L1", "Loss-making item", "HARDWARE", "1", 10_000, 7_000, 5000)])
    assert "LINE_NON_POSITIVE_CONTRIBUTION" in codes_of(result)
    assert result.required_level == ApprovalLevel.MANAGER_FINANCE


def test_promoted_item_judged_by_same_ceilings():
    result = _assess("BRONZE", 0, [one_time("PROMO", "Promoted dock", "HARDWARE", "1", 100_000, 10_000, 2000)])
    assert result.worst_line_excess_pp == Decimal("15")
    assert result.required_level == ApprovalLevel.MANAGER_FINANCE


def test_clean_quotation_needs_no_approval():
    result = _assess(
        "BRONZE",
        0,
        [
            one_time("L1", "Laptop", "HARDWARE", "2", 1_000_000, 700_000, 0),
            one_time("L2", "Dock", "HARDWARE", "1", 100_000, 60_000, 0),
        ],
    )
    assert result.required_level == ApprovalLevel.NONE
    assert result.reasons == []
    assert result.excess_value_minor == 0


def _breach_against_bulk(breach_bp: int):
    return _assess(
        "GOLD",
        0,
        [
            one_time("BULK", "Ninety-nine laptops", "HARDWARE", "99", 1_000_000, 100_000, 0),
            one_time("EDGE", "One discounted laptop", "HARDWARE", "1", 1_000_000, 100_000, breach_bp),
        ],
    )


def test_worst_line_boundary_inclusive_at_8():
    at = _breach_against_bulk(2300)
    assert at.worst_line_excess_pp == Decimal("8")
    assert at.weighted_excess_pp < POLICY.finance.weighted_excess_pp_at_least
    assert "WORST_LINE_EXCESS" in codes_of(at)
    assert at.required_level == ApprovalLevel.MANAGER_FINANCE

    below = _breach_against_bulk(2299)
    assert below.worst_line_excess_pp == Decimal("7.99")
    assert "WORST_LINE_EXCESS" not in codes_of(below)
    assert below.required_level == ApprovalLevel.MANAGER


def test_weighted_excess_binds_first_on_single_line():
    result = _assess("GOLD", 0, [one_time("ONLY", "Laptop", "HARDWARE", "1", 1_000_000, 100_000, 1800)])
    assert result.worst_line_excess_pp == Decimal("3")
    assert result.weighted_excess_pp == Decimal("3")
    assert "WEIGHTED_EXCESS" in codes_of(result)
    assert "WORST_LINE_EXCESS" not in codes_of(result)
    assert result.required_level == ApprovalLevel.MANAGER_FINANCE


def test_aggregate_cap_strictly_greater():
    result = _assess("GOLD", 1200, [one_time("L1", "Laptop", "HARDWARE", "1", 1_000_000, 100_000, 0)])
    assert result.aggregate_discount_percent == Decimal("12")
    assert "AGGREGATE_DISCOUNT_OVER_CEILING" not in codes_of(result)
    assert result.required_level == ApprovalLevel.NONE


# ------------------------------------------------------------- allocation

LAPTOP = uuid4()
DOCK = uuid4()
MAIN = uuid4()
EAST = uuid4()


def _wh(wid, code, fixed, order):
    return WarehouseInfo(wid, code, code + " warehouse", fixed, 0, order)


def _demand(key, variant, qty):
    return Demand(key, uuid4(), variant, "Item " + key, Decimal(qty), 0)


def _allocate(demands, stock, warehouses, mode, penalty=5_000):
    return allocate(AllocationInput(demands, stock, warehouses, mode, penalty, 8))


def _qty_at(result: AllocationResult, wid) -> Decimal:
    return sum((ln.quantity for ln in result.allocations if ln.warehouse_id == wid), Decimal(0))


def _e12_fixtures():
    remote, a, b = uuid4(), uuid4(), uuid4()
    warehouses = [_wh(remote, "REMOTE", 50_000, 1), _wh(a, "LOCAL-A", 5_000, 2), _wh(b, "LOCAL-B", 5_000, 3)]
    stock = [
        Availability(remote, LAPTOP, Decimal(2)),
        Availability(a, LAPTOP, Decimal(1)),
        Availability(b, LAPTOP, Decimal(1)),
    ]
    return remote, a, b, warehouses, stock


def test_balanced_prefers_two_cheap_shipments():
    remote, a, b, warehouses, stock = _e12_fixtures()
    result = _allocate([_demand("L1", LAPTOP, "2")], stock, warehouses, Mode.BALANCED)
    assert set(result.used_warehouse_ids) == {a, b}
    assert result.estimated_shipping_cost_minor == 10_000
    assert result.score_minor == 15_000
    assert result.shipment_count == 2
    assert result.fully_fulfilled is True


def test_min_shipments_chooses_single_expensive_parcel():
    remote, a, b, warehouses, stock = _e12_fixtures()
    result = _allocate([_demand("L1", LAPTOP, "2")], stock, warehouses, Mode.MIN_SHIPMENTS)
    assert result.used_warehouse_ids == [remote]
    assert result.shipment_count == 1
    assert result.estimated_shipping_cost_minor == 50_000


def test_min_cost_ignores_parcel_count():
    remote, a, b, warehouses, stock = _e12_fixtures()
    result = _allocate([_demand("L1", LAPTOP, "2")], stock, warehouses, Mode.MIN_COST)
    assert result.estimated_shipping_cost_minor == 10_000
    assert result.score_minor == 10_000


def test_raised_penalty_flips_to_one_parcel():
    remote, a, b, warehouses, stock = _e12_fixtures()
    result = allocate(AllocationInput([_demand("L1", LAPTOP, "2")], stock, warehouses, Mode.BALANCED, 100_000, 8))
    assert result.used_warehouse_ids == [remote]


def test_flow_b_split_records_shortage_of_one():
    result = _allocate(
        [_demand("L1", LAPTOP, "4")],
        [Availability(MAIN, LAPTOP, Decimal(2)), Availability(EAST, LAPTOP, Decimal(1))],
        [_wh(MAIN, "MAIN", 10_000, 1), _wh(EAST, "EAST", 15_000, 2)],
        Mode.BALANCED,
    )
    assert _qty_at(result, MAIN) == Decimal(2)
    assert _qty_at(result, EAST) == Decimal(1)
    assert len(result.shortages) == 1
    assert result.shortages[0].quantity == Decimal(1)
    assert result.fully_fulfilled is False


def test_never_backorders_to_save_shipping():
    result = _allocate(
        [_demand("L1", LAPTOP, "3")],
        [Availability(MAIN, LAPTOP, Decimal(2)), Availability(EAST, LAPTOP, Decimal(5))],
        [_wh(MAIN, "MAIN", 1_000, 1), _wh(EAST, "EAST", 90_000, 2)],
        Mode.BALANCED,
    )
    assert result.fully_fulfilled is True
    assert result.shortages == []


def test_zero_stock_yields_full_shortage_no_shipment():
    result = _allocate(
        [_demand("L1", LAPTOP, "50")],
        [Availability(MAIN, LAPTOP, Decimal(0))],
        [_wh(MAIN, "MAIN", 10_000, 1)],
        Mode.BALANCED,
    )
    assert result.allocations == []
    assert result.used_warehouse_ids == []
    assert result.shipment_count == 0
    assert result.estimated_shipping_cost_minor == 0
    assert len(result.shortages) == 1
    assert result.shortages[0].quantity == Decimal(50)


def test_quantity_is_conserved():
    result = _allocate(
        [_demand("L1", LAPTOP, "7"), _demand("L2", DOCK, "3")],
        [
            Availability(MAIN, LAPTOP, Decimal(4)),
            Availability(EAST, LAPTOP, Decimal(1)),
            Availability(MAIN, DOCK, Decimal(10)),
        ],
        [_wh(MAIN, "MAIN", 10_000, 1), _wh(EAST, "EAST", 15_000, 2)],
        Mode.BALANCED,
    )
    alloc = sum((ln.quantity for ln in result.allocations if ln.line_key == "L1"), Decimal(0))
    short = sum((s.quantity for s in result.shortages if s.line_key == "L1"), Decimal(0))
    assert alloc + short == Decimal(7)


def test_never_over_allocates_a_warehouse():
    result = _allocate(
        [_demand("L1", LAPTOP, "100")],
        [Availability(MAIN, LAPTOP, Decimal(4)), Availability(EAST, LAPTOP, Decimal(1))],
        [_wh(MAIN, "MAIN", 10_000, 1), _wh(EAST, "EAST", 15_000, 2)],
        Mode.BALANCED,
    )
    assert _qty_at(result, MAIN) == Decimal(4)
    assert _qty_at(result, EAST) == Decimal(1)


def test_plan_is_deterministic():
    demands = [_demand("L1", LAPTOP, "3")]
    stock = [Availability(MAIN, LAPTOP, Decimal(2)), Availability(EAST, LAPTOP, Decimal(2))]
    warehouses = [_wh(MAIN, "MAIN", 10_000, 1), _wh(EAST, "EAST", 10_000, 2)]
    first = _allocate(demands, stock, warehouses, Mode.BALANCED)
    second = _allocate(demands, stock, warehouses, Mode.BALANCED)
    assert first.used_warehouse_ids == second.used_warehouse_ids
    assert first.score_minor == second.score_minor


def test_eight_warehouses_stay_exhaustive():
    warehouses, stock = [], []
    for i in range(8):
        wid = uuid4()
        warehouses.append(_wh(wid, f"W{i}", 1_000 * (i + 1), i))
        stock.append(Availability(wid, LAPTOP, Decimal(1)))
    result = _allocate([_demand("L1", LAPTOP, "3")], stock, warehouses, Mode.BALANCED)
    assert result.exhaustive is True
    assert result.fully_fulfilled is True
    assert result.estimated_shipping_cost_minor == 6_000


# -------------------------------------------------------------- proration


def test_plan_worked_example_750():
    adj = quantity_change(Decimal(10), Decimal(15), 30_000, date(2026, 9, 16), date(2026, 9, 1), date(2026, 10, 1), 0)
    assert adj.net_minor == 75_000
    assert adj.remaining_days == 15
    assert adj.total_days == 30
    assert adj.is_charge() is True


def test_reduction_produces_credit():
    adj = quantity_change(Decimal(15), Decimal(10), 30_000, date(2026, 9, 16), date(2026, 9, 1), date(2026, 10, 1), 0)
    assert adj.net_minor == -75_000
    assert adj.is_credit() is True


def test_yearly_increment_is_the_difference():
    adj = quantity_change(Decimal(10), Decimal(20), 365_000, date(2026, 1, 15), date(2026, 1, 1), date(2027, 1, 1), 0)
    assert adj.remaining_days == 351
    assert adj.total_days == 365
    assert adj.net_minor == 3_510_000


def test_day_15_vs_15_days_elapsed_differ():
    on_day = quantity_change(Decimal(10), Decimal(20), 365_000, date(2026, 1, 15), date(2026, 1, 1), date(2027, 1, 1), 0)
    after = quantity_change(Decimal(10), Decimal(20), 365_000, date(2026, 1, 16), date(2026, 1, 1), date(2027, 1, 1), 0)
    assert on_day.net_minor == 3_510_000
    assert after.net_minor == 3_500_000


def test_leap_year_divides_by_366():
    adj = quantity_change(Decimal(0), Decimal(1), 366_000, date(2028, 1, 1), date(2028, 1, 1), date(2029, 1, 1), 0)
    assert adj.total_days == 366
    assert adj.net_minor == 366_000


def test_last_day_bills_single_day():
    adj = quantity_change(Decimal(0), Decimal(1), 365_000, date(2026, 12, 31), date(2026, 1, 1), date(2027, 1, 1), 0)
    assert adj.remaining_days == 1
    assert adj.net_minor == 1_000


def test_change_at_period_end_bills_nothing():
    adj = quantity_change(Decimal(0), Decimal(1), 365_000, date(2027, 1, 1), date(2026, 1, 1), date(2027, 1, 1), 0)
    assert adj.remaining_days == 0
    assert adj.net_minor == 0


def test_rounds_once_at_end_51_61():
    adj = quantity_change(Decimal(0), Decimal(1), 9_999, date(2026, 1, 16), date(2026, 1, 1), date(2026, 2, 1), 0)
    assert adj.remaining_days == 16
    assert adj.total_days == 31
    assert adj.net_minor == 5_161


def test_tax_on_rounded_net():
    adj = quantity_change(Decimal(0), Decimal(1), 100_000, date(2026, 1, 1), date(2026, 1, 1), date(2026, 2, 1), 1800)
    assert adj.net_minor == 100_000
    assert adj.tax_minor == 18_000


def test_cancellation_credits_each_segment():
    credit = unused_coverage(
        [
            ChargeSegment(date(2026, 9, 1), date(2026, 10, 1), 300_000, 0),
            ChargeSegment(date(2026, 9, 16), date(2026, 10, 1), 75_000, 0),
        ],
        date(2026, 9, 21),
    )
    assert len(credit.segments) == 2
    assert credit.segments[0].net_minor == 100_000
    assert credit.segments[1].net_minor == 50_000
    assert credit.net_minor == 150_000


def test_past_coverage_not_credited():
    credit = unused_coverage(
        [ChargeSegment(date(2026, 8, 1), date(2026, 9, 1), 300_000, 0)], date(2026, 9, 21)
    )
    assert credit.net_minor == 0


def test_future_coverage_credited_in_full():
    credit = unused_coverage(
        [ChargeSegment(date(2026, 10, 1), date(2026, 11, 1), 300_000, 0)], date(2026, 9, 21)
    )
    assert credit.net_minor == 300_000


def test_end_of_period_cancellation_credits_nothing():
    credit = unused_coverage(
        [ChargeSegment(date(2026, 9, 1), date(2026, 10, 1), 300_000, 0)], date(2026, 10, 1)
    )
    assert credit.net_minor == 0


def test_full_first_interval_billed_in_full():
    adj = first_period_charge(Decimal(10), 30_000, date(2026, 9, 16), date(2026, 10, 16), 16, 1, 0)
    assert adj.net_minor == 300_000
    assert adj.remaining_fraction == Decimal(1)


def test_calendar_anchored_mid_month_start_prorated():
    adj = first_period_charge(Decimal(10), 30_000, date(2026, 9, 16), date(2026, 10, 1), 1, 1, 0)
    assert adj.total_days == 30
    assert adj.remaining_days == 15
    assert adj.net_minor == 150_000


# ---------------------------------------------------------------- calendar


def test_anchor_survives_short_month():
    jan = date(2026, 1, 31)
    feb = m.next_boundary(jan, 31, 1)
    assert feb == date(2026, 2, 28)
    assert m.next_boundary(feb, 31, 1) == date(2026, 3, 31)


def test_leap_february_clamps_to_29():
    assert m.next_boundary(date(2028, 1, 31), 31, 1) == date(2028, 2, 29)


def test_quarterly_and_yearly_advance_by_calendar_months():
    assert m.next_boundary(date(2026, 1, 31), 31, 3) == date(2026, 4, 30)
    assert m.next_boundary(date(2026, 2, 28), 29, 12) == date(2027, 2, 28)


def test_first_period_end_follows_anchor():
    assert m.first_period_end(date(2026, 9, 16), 1, 1) == date(2026, 10, 1)
    assert m.first_period_end(date(2026, 9, 16), 16, 1) == date(2026, 10, 16)
    assert m.first_period_end(date(2026, 9, 1), 1, 1) == date(2026, 10, 1)


# ----------------------------------------------------------------- anomaly


def test_anomaly_insufficient_history_reports_nothing():
    for obs in ([], [Decimal("8")], [Decimal("8"), Decimal("10"), Decimal("9"), Decimal("11")]):
        v = anomaly_evaluate(Decimal("35"), obs)
        assert v.insufficient_history is True
        assert v.anomalous is False
        assert v.mean_percent is None
        assert v.z_score is None


def test_anomaly_flags_35_against_stable_history():
    v = anomaly_evaluate(Decimal("35"), [Decimal(x) for x in (8, 10, 9, 11, 12, 10)])
    assert v.anomalous is True
    assert v.excess_pp is not None and v.excess_pp >= Decimal("5")


def test_anomaly_ignores_in_range_discount():
    v = anomaly_evaluate(Decimal("11"), [Decimal(x) for x in (8, 10, 9, 11, 12, 10)])
    assert v.anomalous is False


def test_anomaly_needs_both_thresholds():
    v = anomaly_evaluate(Decimal("14"), [Decimal("10")] * 6)
    assert v.anomalous is False  # excess 4 < 5 despite z exploding


def test_anomaly_sigma_floor_flags_15_1():
    v = anomaly_evaluate(Decimal("15.1"), [Decimal("10")] * 6)
    assert v.anomalous is True
    assert v.z_score == Decimal("2.5500")


def test_anomaly_never_flags_below_mean():
    v = anomaly_evaluate(Decimal("5"), [Decimal(x) for x in (8, 10, 9, 11, 12, 10)])
    assert v.anomalous is False


# -------------------------------------------------------- commercial hash


def _hash_lines():
    return [
        {
            "line_key": "L1", "line_kind": "ONE_TIME", "variant_id": uuid4(),
            "plan_id": None, "quantity": Decimal("4.000"), "unit_price_minor": 1_000_000,
            "tax_rate_bp": 0, "line_discount_bp": 1200, "effective_discount_bp": 1200,
            "net_minor": 3_520_000, "interval_months": None, "promised_date": None,
        }
    ]


def test_commercial_hash_deterministic_reorder_invariant_cost_blind():
    kwargs = dict(
        currency="INR", order_discount_bp=0, backorder_terms="ALLOW_BACKORDER",
        invoicing_terms="ON_CONFIRMATION", requested_activation_date=None,
    )
    h1 = commercial_hash(lines=_hash_lines(), **kwargs)
    lines = _hash_lines()
    h1 = commercial_hash(lines=lines, **kwargs)
    h2 = commercial_hash(lines=list(reversed(lines)), **kwargs)
    assert h1 == h2 and len(h1) == 64
    assert commercial_hash(lines=_hash_lines(), **{**kwargs, "order_discount_bp": 1000}) != h1


# -------------------------------------------------------------- money/bp


def test_bp_combine_and_percent():
    assert m.bp_combine(1000, 1000) == 1900
    assert m.bp_to_percent(1200) == Decimal("12.00")
    assert m.to_minor(Decimal("39300.00")) == 3_930_000
    assert m.to_major(3_930_000) == Decimal("39300.00")
    assert m.format_money(3_930_000) == "39300.00"


def test_residual_allocator_thirds():
    out = m.round_preserving_total([Decimal("3333.3")] * 3, ["a", "b", "c"])
    assert sum(out) == 10_000
    assert sorted(out) == [3333, 3333, 3334]
