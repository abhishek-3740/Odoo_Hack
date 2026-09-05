package com.dealflow.fulfillment.engine;

import com.dealflow.fulfillment.engine.AllocationModel.AllocationInput;
import com.dealflow.fulfillment.engine.AllocationModel.AllocationLine;
import com.dealflow.fulfillment.engine.AllocationModel.AllocationResult;
import com.dealflow.fulfillment.engine.AllocationModel.Availability;
import com.dealflow.fulfillment.engine.AllocationModel.Demand;
import com.dealflow.fulfillment.engine.AllocationModel.Mode;
import com.dealflow.fulfillment.engine.AllocationModel.Shortage;
import com.dealflow.fulfillment.engine.AllocationModel.WarehouseInfo;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Chooses which warehouses ship which quantities.
 *
 * <p>Two objectives, in strict order:
 *
 * <ol>
 *   <li><b>Fulfil as much as physically possible.</b> The maximum fillable
 *       quantity per SKU is computed first, across every warehouse. Only
 *       combinations that reach that same target are considered, so the engine
 *       can never pick a cheaper plan by quietly backordering something it could
 *       have shipped.</li>
 *   <li><b>Among those, minimise the score.</b>
 *       <pre>score = shipping cost + penalty × max(0, parcels − 1)</pre></li>
 * </ol>
 *
 * <p>The penalty is what stops "fewest parcels" from being an unspoken rule
 * (edge case E12). One remote parcel at INR 500 scores 500; two local parcels
 * totalling INR 100 score 100 + 50 = 150, and win. {@code MIN_SHIPMENTS} and
 * {@code MIN_COST} are available as explicit alternatives, expressed by moving
 * the same penalty to its extremes rather than by a second algorithm.
 *
 * <p>With eight warehouses there are 255 non-empty combinations, so the search
 * is exhaustive and the result is a genuine optimum for the configured costs.
 * Past that limit it degrades to a cheapest-first greedy pass, and says so.
 *
 * <p>This engine reserves nothing. It reads a snapshot of availability and
 * returns a plan; holding the stock happens later, under row locks, against
 * freshly re-read numbers (edge case E10).
 */
@Component
public class AllocationEngine {

    /** Large enough to dominate any realistic shipping bill, so parcels sort first. */
    private static final long MIN_SHIPMENTS_PENALTY = 1_000_000_000_000L;

    public AllocationResult allocate(AllocationInput input) {
        List<Demand> demands = input.demands().stream()
                .filter(demand -> demand.quantity().signum() > 0)
                .toList();

        List<WarehouseInfo> warehouses = input.warehouses().stream()
                .sorted(Comparator.comparingInt(WarehouseInfo::sortOrder)
                        .thenComparing(WarehouseInfo::warehouseId))
                .toList();

        if (demands.isEmpty() || warehouses.isEmpty()) {
            return new AllocationResult(List.of(), shortagesFor(demands, Map.of()), List.of(),
                    0L, 0, 0L, demands.isEmpty(), true, input.mode());
        }

        Map<UUID, Map<UUID, BigDecimal>> stock = indexAvailability(input.availability());

        // Step 1: the most that can be shipped per SKU, using every warehouse.
        // A variant appearing on several lines draws from one shared pool, so
        // the target is computed per variant rather than per line.
        Map<UUID, BigDecimal> perVariantTarget = new HashMap<>();
        Map<UUID, BigDecimal> perVariantDemand = new HashMap<>();
        for (Demand demand : demands) {
            perVariantDemand.merge(demand.variantId(), demand.quantity(), BigDecimal::add);
        }
        perVariantDemand.forEach((variantId, wanted) -> {
            BigDecimal total = warehouses.stream()
                    .map(warehouse -> availableAt(stock, warehouse.warehouseId(), variantId))
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            perVariantTarget.put(variantId, wanted.min(total));
        });

        boolean exhaustive = warehouses.size() <= input.exhaustiveWarehouseLimit();
        long penalty = switch (input.mode()) {
            case BALANCED -> input.extraShipmentPenaltyMinor();
            case MIN_COST -> 0L;
            case MIN_SHIPMENTS -> MIN_SHIPMENTS_PENALTY;
        };

        Plan best = exhaustive
                ? searchExhaustively(demands, warehouses, stock, perVariantTarget, penalty)
                : greedy(demands, warehouses, stock, penalty);

        if (best == null) {
            // No combination reached the fulfilment target, which can only mean
            // there is no stock at all. That is a valid, empty result — not an
            // error, and not an empty shipment record.
            best = new Plan(List.of(), List.of(), 0L, 0L);
        }

        Map<String, BigDecimal> allocatedByLine = new HashMap<>();
        for (AllocationLine line : best.lines()) {
            allocatedByLine.merge(line.lineKey(), line.quantity(), BigDecimal::add);
        }

        List<Shortage> shortages = shortagesFor(demands, allocatedByLine);
        return new AllocationResult(
                best.lines(), shortages, best.usedWarehouseIds(),
                best.shippingCostMinor(), best.usedWarehouseIds().size(), best.scoreMinor(),
                shortages.isEmpty(), exhaustive, input.mode());
    }

    // ---------------------------------------------------------------- search

    private record Plan(List<AllocationLine> lines, List<UUID> usedWarehouseIds,
                        long shippingCostMinor, long scoreMinor) {
    }

    private Plan searchExhaustively(List<Demand> demands, List<WarehouseInfo> warehouses,
                                    Map<UUID, Map<UUID, BigDecimal>> stock,
                                    Map<UUID, BigDecimal> perVariantTarget, long penalty) {
        int count = warehouses.size();
        Plan best = null;

        for (int mask = 1; mask < (1 << count); mask++) {
            List<WarehouseInfo> subset = new ArrayList<>();
            for (int bit = 0; bit < count; bit++) {
                if ((mask & (1 << bit)) != 0) {
                    subset.add(warehouses.get(bit));
                }
            }
            if (!meetsTarget(subset, stock, perVariantTarget)) {
                continue;
            }
            Plan candidate = buildPlan(demands, subset, stock, penalty);
            if (isBetter(candidate, best)) {
                best = candidate;
            }
        }
        return best;
    }

    /** Can this combination still ship everything the full set could ship? */
    private boolean meetsTarget(List<WarehouseInfo> subset, Map<UUID, Map<UUID, BigDecimal>> stock,
                                Map<UUID, BigDecimal> perVariantTarget) {
        for (Map.Entry<UUID, BigDecimal> entry : perVariantTarget.entrySet()) {
            BigDecimal reachable = subset.stream()
                    .map(warehouse -> availableAt(stock, warehouse.warehouseId(), entry.getKey()))
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            if (reachable.compareTo(entry.getValue()) < 0) {
                return false;
            }
        }
        return true;
    }

    private Plan greedy(List<Demand> demands, List<WarehouseInfo> warehouses,
                        Map<UUID, Map<UUID, BigDecimal>> stock, long penalty) {
        return buildPlan(demands, warehouses, stock, penalty);
    }

    /**
     * Allocates within a fixed set of warehouses, cheapest first.
     *
     * <p>Because every subset is enumerated, a cheapest-first pass inside each
     * one is enough: the combination that ends up used is itself a subset that
     * gets scored on its own terms.
     */
    private Plan buildPlan(List<Demand> demands, List<WarehouseInfo> subset,
                           Map<UUID, Map<UUID, BigDecimal>> stock, long penalty) {
        List<WarehouseInfo> ordered = subset.stream()
                .sorted(Comparator.comparingLong(WarehouseInfo::shippingFixedCostMinor)
                        .thenComparingInt(WarehouseInfo::sortOrder)
                        .thenComparing(WarehouseInfo::warehouseId))
                .toList();

        Map<UUID, Map<UUID, BigDecimal>> remaining = copyOf(stock);
        List<AllocationLine> lines = new ArrayList<>();
        Map<UUID, BigDecimal> weightByWarehouse = new LinkedHashMap<>();

        for (Demand demand : demands) {
            BigDecimal outstanding = demand.quantity();
            for (WarehouseInfo warehouse : ordered) {
                if (outstanding.signum() <= 0) {
                    break;
                }
                BigDecimal free = remaining
                        .getOrDefault(warehouse.warehouseId(), Map.of())
                        .getOrDefault(demand.variantId(), BigDecimal.ZERO);
                if (free.signum() <= 0) {
                    continue;
                }
                BigDecimal take = free.min(outstanding);
                remaining.get(warehouse.warehouseId()).put(demand.variantId(), free.subtract(take));
                outstanding = outstanding.subtract(take);

                lines.add(new AllocationLine(warehouse.warehouseId(), warehouse.code(), warehouse.name(),
                        demand.lineKey(), demand.orderLineId(), demand.variantId(),
                        demand.description(), take));

                weightByWarehouse.merge(warehouse.warehouseId(),
                        take.multiply(BigDecimal.valueOf(demand.unitWeightGrams())), BigDecimal::add);
            }
        }

        List<UUID> used = lines.stream().map(AllocationLine::warehouseId).distinct().sorted().toList();
        long shippingCost = 0;
        for (UUID warehouseId : used) {
            WarehouseInfo warehouse = ordered.stream()
                    .filter(w -> w.warehouseId().equals(warehouseId)).findFirst().orElseThrow();
            BigDecimal kilograms = weightByWarehouse.getOrDefault(warehouseId, BigDecimal.ZERO)
                    .divide(BigDecimal.valueOf(1000), 3, RoundingMode.CEILING);
            long variableCost = kilograms.multiply(BigDecimal.valueOf(warehouse.shippingCostPerKgMinor()))
                    .setScale(0, RoundingMode.HALF_UP).longValueExact();
            shippingCost += warehouse.shippingFixedCostMinor() + variableCost;
        }
        long score = shippingCost + penalty * Math.max(0, used.size() - 1);
        return new Plan(List.copyOf(lines), used, shippingCost, score);
    }

    /** Lower score wins; then fewer parcels; then the stable warehouse ordering. */
    private boolean isBetter(Plan candidate, Plan incumbent) {
        if (incumbent == null) {
            return true;
        }
        if (candidate.scoreMinor() != incumbent.scoreMinor()) {
            return candidate.scoreMinor() < incumbent.scoreMinor();
        }
        if (candidate.usedWarehouseIds().size() != incumbent.usedWarehouseIds().size()) {
            return candidate.usedWarehouseIds().size() < incumbent.usedWarehouseIds().size();
        }
        return compareIdLists(candidate.usedWarehouseIds(), incumbent.usedWarehouseIds()) < 0;
    }

    private static int compareIdLists(List<UUID> left, List<UUID> right) {
        for (int i = 0; i < Math.min(left.size(), right.size()); i++) {
            int comparison = left.get(i).compareTo(right.get(i));
            if (comparison != 0) {
                return comparison;
            }
        }
        return Integer.compare(left.size(), right.size());
    }

    // ----------------------------------------------------------------- utils

    private static List<Shortage> shortagesFor(List<Demand> demands, Map<String, BigDecimal> allocated) {
        List<Shortage> shortages = new ArrayList<>();
        for (Demand demand : demands) {
            BigDecimal filled = allocated.getOrDefault(demand.lineKey(), BigDecimal.ZERO);
            BigDecimal missing = demand.quantity().subtract(filled);
            if (missing.signum() > 0) {
                shortages.add(new Shortage(demand.lineKey(), demand.orderLineId(), demand.variantId(),
                        demand.description(), missing));
            }
        }
        return List.copyOf(shortages);
    }

    private static Map<UUID, Map<UUID, BigDecimal>> indexAvailability(List<Availability> availability) {
        Map<UUID, Map<UUID, BigDecimal>> index = new HashMap<>();
        for (Availability row : availability) {
            if (row.available().signum() > 0) {
                index.computeIfAbsent(row.warehouseId(), key -> new HashMap<>())
                        .merge(row.variantId(), row.available(), BigDecimal::add);
            }
        }
        return index;
    }

    private static Map<UUID, Map<UUID, BigDecimal>> copyOf(Map<UUID, Map<UUID, BigDecimal>> source) {
        Map<UUID, Map<UUID, BigDecimal>> copy = new HashMap<>();
        source.forEach((warehouseId, byVariant) -> copy.put(warehouseId, new HashMap<>(byVariant)));
        return copy;
    }

    private static BigDecimal availableAt(Map<UUID, Map<UUID, BigDecimal>> stock,
                                          UUID warehouseId, UUID variantId) {
        return stock.getOrDefault(warehouseId, Map.of()).getOrDefault(variantId, BigDecimal.ZERO);
    }
}
