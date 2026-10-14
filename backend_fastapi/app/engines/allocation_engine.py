"""Allocation engine — port of fulfillment/service/AllocationEngine.java +
AllocationModel. Pure function: snapshot in, plan out. Reserves nothing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from uuid import UUID

from app.engines import shared_math as m


class BackorderTerms(str, Enum):
    ALLOW_BACKORDER = "ALLOW_BACKORDER"
    IN_STOCK_ONLY = "IN_STOCK_ONLY"


class Mode(str, Enum):
    BALANCED = "BALANCED"
    MIN_SHIPMENTS = "MIN_SHIPMENTS"
    MIN_COST = "MIN_COST"


MIN_SHIPMENTS_PENALTY = 1_000_000_000_000


@dataclass(frozen=True)
class Demand:
    line_key: str
    order_line_id: UUID | None
    variant_id: UUID
    description: str
    quantity: Decimal
    unit_weight_grams: int = 0


@dataclass(frozen=True)
class Availability:
    warehouse_id: UUID
    variant_id: UUID
    available: Decimal


@dataclass(frozen=True)
class WarehouseInfo:
    warehouse_id: UUID
    code: str
    name: str
    shipping_fixed_cost_minor: int
    shipping_cost_per_kg_minor: int
    sort_order: int


@dataclass(frozen=True)
class AllocationInput:
    demands: list[Demand]
    availability: list[Availability]
    warehouses: list[WarehouseInfo]
    mode: Mode
    extra_shipment_penalty_minor: int
    exhaustive_warehouse_limit: int


@dataclass(frozen=True)
class AllocationLine:
    warehouse_id: UUID
    warehouse_code: str
    warehouse_name: str
    line_key: str
    order_line_id: UUID | None
    variant_id: UUID
    description: str
    quantity: Decimal


@dataclass(frozen=True)
class Shortage:
    line_key: str
    order_line_id: UUID | None
    variant_id: UUID
    description: str
    quantity: Decimal


@dataclass(frozen=True)
class AllocationResult:
    allocations: list[AllocationLine] = field(default_factory=list)
    shortages: list[Shortage] = field(default_factory=list)
    used_warehouse_ids: list[UUID] = field(default_factory=list)
    estimated_shipping_cost_minor: int = 0
    shipment_count: int = 0
    score_minor: int = 0
    fully_fulfilled: bool = False
    exhaustive: bool = True
    mode: Mode = Mode.BALANCED

    def has_shortage(self) -> bool:
        return bool(self.shortages)


@dataclass
class _Plan:
    lines: list[AllocationLine]
    used_warehouse_ids: list[UUID]
    shipping_cost_minor: int
    score_minor: int


def allocate(allocation_input: AllocationInput) -> AllocationResult:
    demands = [d for d in allocation_input.demands if d.quantity > 0]
    warehouses = sorted(
        allocation_input.warehouses, key=lambda w: (w.sort_order, w.warehouse_id)
    )
    if not demands or not warehouses:
        return AllocationResult(
            [],
            _shortages_for(demands, {}),
            [],
            0,
            0,
            0,
            not demands,
            True,
            allocation_input.mode,
        )

    stock = _index_availability(allocation_input.availability)

    per_variant_demand: dict[UUID, Decimal] = {}
    for demand in demands:
        per_variant_demand[demand.variant_id] = (
            per_variant_demand.get(demand.variant_id, Decimal(0)) + demand.quantity
        )
    per_variant_target = {
        variant: min(
            wanted,
            sum(
                (_available_at(stock, w.warehouse_id, variant) for w in warehouses),
                Decimal(0),
            ),
        )
        for variant, wanted in per_variant_demand.items()
    }

    exhaustive = len(warehouses) <= allocation_input.exhaustive_warehouse_limit
    penalty = {
        Mode.BALANCED: allocation_input.extra_shipment_penalty_minor,
        Mode.MIN_COST: 0,
        Mode.MIN_SHIPMENTS: MIN_SHIPMENTS_PENALTY,
    }[allocation_input.mode]

    best = (
        _search_exhaustively(demands, warehouses, stock, per_variant_target, penalty)
        if exhaustive
        else _build_plan(demands, warehouses, stock, penalty)
    )
    if best is None:
        best = _Plan([], [], 0, 0)

    allocated_by_line: dict[str, Decimal] = {}
    for line in best.lines:
        allocated_by_line[line.line_key] = (
            allocated_by_line.get(line.line_key, Decimal(0)) + line.quantity
        )
    shortages = _shortages_for(demands, allocated_by_line)
    return AllocationResult(
        best.lines,
        shortages,
        best.used_warehouse_ids,
        best.shipping_cost_minor,
        len(best.used_warehouse_ids),
        best.score_minor,
        not shortages,
        exhaustive,
        allocation_input.mode,
    )


def _search_exhaustively(
    demands: list[Demand],
    warehouses: list[WarehouseInfo],
    stock: dict[UUID, dict[UUID, Decimal]],
    per_variant_target: dict[UUID, Decimal],
    penalty: int,
) -> _Plan | None:
    count = len(warehouses)
    best: _Plan | None = None
    for mask in range(1, 1 << count):
        subset = [warehouses[bit] for bit in range(count) if mask & (1 << bit)]
        if not _meets_target(subset, stock, per_variant_target):
            continue
        candidate = _build_plan(demands, subset, stock, penalty)
        if _is_better(candidate, best):
            best = candidate
    return best


def _meets_target(
    subset: list[WarehouseInfo],
    stock: dict[UUID, dict[UUID, Decimal]],
    per_variant_target: dict[UUID, Decimal],
) -> bool:
    for variant, target in per_variant_target.items():
        reachable = sum(
            (_available_at(stock, w.warehouse_id, variant) for w in subset), Decimal(0)
        )
        if reachable < target:
            return False
    return True


def _build_plan(
    demands: list[Demand],
    subset: list[WarehouseInfo],
    stock: dict[UUID, dict[UUID, Decimal]],
    penalty: int,
) -> _Plan:
    ordered = sorted(
        subset,
        key=lambda w: (
            w.shipping_fixed_cost_minor,
            w.sort_order,
            w.warehouse_id,
        ),
    )
    remaining = {wid: dict(by_var) for wid, by_var in stock.items()}
    lines: list[AllocationLine] = []
    weight_by_wh: dict[UUID, Decimal] = {}

    for demand in demands:
        outstanding = demand.quantity
        for warehouse in ordered:
            if outstanding <= 0:
                break
            free = remaining.get(warehouse.warehouse_id, {}).get(
                demand.variant_id, Decimal(0)
            )
            if free <= 0:
                continue
            take = min(free, outstanding)
            remaining[warehouse.warehouse_id][demand.variant_id] = free - take
            outstanding -= take
            lines.append(
                AllocationLine(
                    warehouse.warehouse_id,
                    warehouse.code,
                    warehouse.name,
                    demand.line_key,
                    demand.order_line_id,
                    demand.variant_id,
                    demand.description,
                    take,
                )
            )
            weight_by_wh[warehouse.warehouse_id] = weight_by_wh.get(
                warehouse.warehouse_id, Decimal(0)
            ) + take * demand.unit_weight_grams

    used = sorted({line.warehouse_id for line in lines})
    by_id = {w.warehouse_id: w for w in ordered}
    shipping = 0
    for warehouse_id in used:
        warehouse = by_id[warehouse_id]
        kg = m.kg_ceiling(weight_by_wh.get(warehouse_id, Decimal(0)))
        variable = m.money_round(
            m.CALC.multiply(kg, Decimal(warehouse.shipping_cost_per_kg_minor))
        )
        shipping += warehouse.shipping_fixed_cost_minor + variable
    return _Plan(
        list(lines), used, shipping, shipping + penalty * max(0, len(used) - 1)
    )


def _is_better(candidate: _Plan, incumbent: _Plan | None) -> bool:
    if incumbent is None:
        return True
    if candidate.score_minor != incumbent.score_minor:
        return candidate.score_minor < incumbent.score_minor
    if len(candidate.used_warehouse_ids) != len(incumbent.used_warehouse_ids):
        return len(candidate.used_warehouse_ids) < len(incumbent.used_warehouse_ids)
    return candidate.used_warehouse_ids < incumbent.used_warehouse_ids


def _shortages_for(
    demands: list[Demand], allocated: dict[str, Decimal]
) -> list[Shortage]:
    shortages = []
    for demand in demands:
        missing = demand.quantity - allocated.get(demand.line_key, Decimal(0))
        if missing > 0:
            shortages.append(
                Shortage(
                    demand.line_key,
                    demand.order_line_id,
                    demand.variant_id,
                    demand.description,
                    missing,
                )
            )
    return shortages


def _index_availability(
    availability: list[Availability],
) -> dict[UUID, dict[UUID, Decimal]]:
    index: dict[UUID, dict[UUID, Decimal]] = {}
    for row in availability:
        if row.available > 0:
            index.setdefault(row.warehouse_id, {}).setdefault(
                row.variant_id, Decimal(0)
            )
            index[row.warehouse_id][row.variant_id] += row.available
    return index


def _available_at(
    stock: dict[UUID, dict[UUID, Decimal]], warehouse_id: UUID, variant_id: UUID
) -> Decimal:
    return stock.get(warehouse_id, {}).get(variant_id, Decimal(0))
