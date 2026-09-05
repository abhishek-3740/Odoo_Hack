package com.dealflow.fulfillment.engine;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/** Inputs and outputs of the warehouse allocation engine. Pure data. */
public final class AllocationModel {

    private AllocationModel() {
    }

    /** What the customer accepted about shortages. Not a runtime preference. */
    public enum BackorderTerms {
        /** Reserve what exists, record the rest as a real backorder. */
        ALLOW_BACKORDER,
        /** Anything short of complete fulfilment fails the confirmation outright. */
        IN_STOCK_ONLY
    }

    public enum Mode {
        /** Shipping cost plus a penalty for each shipment beyond the first. */
        BALANCED,
        /** Fewest parcels, cost as the tie-breaker. */
        MIN_SHIPMENTS,
        /** Cheapest shipping, however many parcels that takes. */
        MIN_COST
    }

    /** One stocked order line that needs allocating. */
    public record Demand(String lineKey, UUID orderLineId, UUID variantId, String description,
                         BigDecimal quantity, int unitWeightGrams) {
    }

    /** Free stock at one warehouse: {@code on_hand − reserved}, plus anything this order already holds. */
    public record Availability(UUID warehouseId, UUID variantId, BigDecimal available) {
    }

    public record WarehouseInfo(UUID warehouseId, String code, String name,
                                long shippingFixedCostMinor, long shippingCostPerKgMinor, int sortOrder) {
    }

    public record AllocationInput(List<Demand> demands, List<Availability> availability,
                                  List<WarehouseInfo> warehouses, Mode mode,
                                  long extraShipmentPenaltyMinor, int exhaustiveWarehouseLimit) {
    }

    /** A quantity of one line to be picked from one warehouse. */
    public record AllocationLine(UUID warehouseId, String warehouseCode, String warehouseName,
                                 String lineKey, UUID orderLineId, UUID variantId,
                                 String description, BigDecimal quantity) {
    }

    /** An unfulfillable remainder. Carries no invented delivery date. */
    public record Shortage(String lineKey, UUID orderLineId, UUID variantId, String description,
                           BigDecimal quantity) {
    }

    /**
     * A costed plan.
     *
     * <p>{@code exhaustive} says whether every warehouse combination was
     * examined. Beyond the configured limit the engine falls back to a greedy
     * pass, and the result is labelled a heuristic rather than presented as an
     * optimum it did not prove.
     */
    public record AllocationResult(
            List<AllocationLine> allocations,
            List<Shortage> shortages,
            List<UUID> usedWarehouseIds,
            long estimatedShippingCostMinor,
            int shipmentCount,
            long scoreMinor,
            boolean fullyFulfilled,
            boolean exhaustive,
            Mode mode) {

        public boolean hasShortage() {
            return !shortages.isEmpty();
        }
    }
}
