package com.dealflow.fulfillment.engine;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.fulfillment.engine.AllocationModel.AllocationInput;
import com.dealflow.fulfillment.engine.AllocationModel.AllocationLine;
import com.dealflow.fulfillment.engine.AllocationModel.AllocationResult;
import com.dealflow.fulfillment.engine.AllocationModel.Availability;
import com.dealflow.fulfillment.engine.AllocationModel.Demand;
import com.dealflow.fulfillment.engine.AllocationModel.Mode;
import com.dealflow.fulfillment.engine.AllocationModel.Shortage;
import com.dealflow.fulfillment.engine.AllocationModel.WarehouseInfo;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Verifies warehouse splitting against the plan's fixtures and edge case E12. */
class AllocationEngineTest {

    private static final long PENALTY = 5_000L; // INR 50.00

    private final AllocationEngine engine = new AllocationEngine();

    private final UUID laptop = UUID.randomUUID();
    private final UUID dock = UUID.randomUUID();
    private final UUID main = UUID.randomUUID();
    private final UUID east = UUID.randomUUID();

    private WarehouseInfo warehouse(UUID id, String code, long fixedCostMinor, int order) {
        return new WarehouseInfo(id, code, code + " warehouse", fixedCostMinor, 0L, order);
    }

    private Demand demand(String key, UUID variantId, String quantity) {
        return new Demand(key, UUID.randomUUID(), variantId, "Item " + key, new BigDecimal(quantity), 0);
    }

    private AllocationResult allocate(List<Demand> demands, List<Availability> stock,
                                      List<WarehouseInfo> warehouses, Mode mode) {
        return engine.allocate(new AllocationInput(demands, stock, warehouses, mode, PENALTY, 8));
    }

    private static BigDecimal quantityAt(AllocationResult result, UUID warehouseId) {
        return result.allocations().stream()
                .filter(line -> line.warehouseId().equals(warehouseId))
                .map(AllocationLine::quantity)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    @Nested
    @DisplayName("Cost versus parcel count (edge case E12)")
    class CostVersusParcels {

        // One remote warehouse holding everything at INR 500 shipping, versus
        // two local warehouses at INR 50 each that together hold the same stock.
        private final UUID remote = UUID.randomUUID();
        private final UUID localA = UUID.randomUUID();
        private final UUID localB = UUID.randomUUID();

        private final List<WarehouseInfo> warehouses = List.of(
                warehouse(remote, "REMOTE", 50_000L, 1),
                warehouse(localA, "LOCAL-A", 5_000L, 2),
                warehouse(localB, "LOCAL-B", 5_000L, 3));

        private final List<Availability> stock = List.of(
                new Availability(remote, laptop, new BigDecimal("2")),
                new Availability(localA, laptop, new BigDecimal("1")),
                new Availability(localB, laptop, new BigDecimal("1")));

        @Test
        @DisplayName("two cheap local parcels beat one expensive remote parcel")
        void balancedPrefersTwoCheapShipments() {
            AllocationResult result = allocate(
                    List.of(demand("L1", laptop, "2")), stock, warehouses, Mode.BALANCED);

            // 5,000 + 5,000 shipping + 5,000 penalty = 15,000, against 50,000.
            assertThat(result.usedWarehouseIds()).containsExactlyInAnyOrder(localA, localB);
            assertThat(result.estimatedShippingCostMinor()).isEqualTo(10_000L);
            assertThat(result.scoreMinor()).isEqualTo(15_000L);
            assertThat(result.shipmentCount()).isEqualTo(2);
            assertThat(result.fullyFulfilled()).isTrue();
        }

        @Test
        @DisplayName("MIN_SHIPMENTS explicitly chooses the single expensive parcel")
        void minShipmentsPrefersOneParcel() {
            AllocationResult result = allocate(
                    List.of(demand("L1", laptop, "2")), stock, warehouses, Mode.MIN_SHIPMENTS);

            assertThat(result.usedWarehouseIds()).containsExactly(remote);
            assertThat(result.shipmentCount()).isEqualTo(1);
            assertThat(result.estimatedShippingCostMinor()).isEqualTo(50_000L);
        }

        @Test
        @DisplayName("MIN_COST ignores parcel count entirely")
        void minCostIgnoresParcelCount() {
            AllocationResult result = allocate(
                    List.of(demand("L1", laptop, "2")), stock, warehouses, Mode.MIN_COST);

            assertThat(result.estimatedShippingCostMinor()).isEqualTo(10_000L);
            assertThat(result.scoreMinor()).isEqualTo(10_000L);
        }

        @Test
        @DisplayName("raising the penalty flips the decision back to one parcel")
        void configuredPenaltyChangesTheOutcome() {
            AllocationResult result = engine.allocate(new AllocationInput(
                    List.of(demand("L1", laptop, "2")), stock, warehouses, Mode.BALANCED,
                    100_000L, 8));

            assertThat(result.usedWarehouseIds()).containsExactly(remote);
        }
    }

    @Nested
    @DisplayName("Flow B split and backorder (plan section 13.3)")
    class FlowBSplit {

        @Test
        @DisplayName("four laptops across Main 2 and East 1 leaves a backorder of 1")
        void splitsAcrossTwoWarehousesAndRecordsShortage() {
            AllocationResult result = allocate(
                    List.of(demand("L1", laptop, "4")),
                    List.of(new Availability(main, laptop, new BigDecimal("2")),
                            new Availability(east, laptop, new BigDecimal("1"))),
                    List.of(warehouse(main, "MAIN", 10_000L, 1), warehouse(east, "EAST", 15_000L, 2)),
                    Mode.BALANCED);

            assertThat(quantityAt(result, main)).isEqualByComparingTo("2");
            assertThat(quantityAt(result, east)).isEqualByComparingTo("1");
            assertThat(result.shortages()).singleElement()
                    .extracting(Shortage::quantity, org.assertj.core.api.InstanceOfAssertFactories.BIG_DECIMAL)
                    .isEqualByComparingTo("1");
            assertThat(result.fullyFulfilled()).isFalse();
        }

        @Test
        @DisplayName("fulfilment is maximised even when one warehouse alone would be cheaper")
        void neverBackordersToSaveShipping() {
            // Main alone is cheap and could ship 2 of the 3; using East as well
            // costs more but ships everything, so it must win.
            AllocationResult result = allocate(
                    List.of(demand("L1", laptop, "3")),
                    List.of(new Availability(main, laptop, new BigDecimal("2")),
                            new Availability(east, laptop, new BigDecimal("5"))),
                    List.of(warehouse(main, "MAIN", 1_000L, 1), warehouse(east, "EAST", 90_000L, 2)),
                    Mode.BALANCED);

            assertThat(result.fullyFulfilled()).isTrue();
            assertThat(result.shortages()).isEmpty();
        }
    }

    @Nested
    @DisplayName("Zero stock (edge case E09)")
    class ZeroStock {

        @Test
        @DisplayName("no stock anywhere yields a full shortage and no empty shipment")
        void everythingBackordered() {
            AllocationResult result = allocate(
                    List.of(demand("L1", laptop, "50")),
                    List.of(new Availability(main, laptop, BigDecimal.ZERO)),
                    List.of(warehouse(main, "MAIN", 10_000L, 1)),
                    Mode.BALANCED);

            assertThat(result.allocations()).isEmpty();
            assertThat(result.usedWarehouseIds()).isEmpty();
            assertThat(result.shipmentCount()).isZero();
            assertThat(result.estimatedShippingCostMinor()).isZero();
            assertThat(result.shortages()).singleElement()
                    .extracting(Shortage::quantity, org.assertj.core.api.InstanceOfAssertFactories.BIG_DECIMAL)
                    .isEqualByComparingTo("50");
        }
    }

    @Nested
    @DisplayName("Conservation and determinism")
    class Invariants {

        @Test
        @DisplayName("allocated plus backordered always equals what was ordered")
        void quantityIsConserved() {
            AllocationResult result = allocate(
                    List.of(demand("L1", laptop, "7"), demand("L2", dock, "3")),
                    List.of(new Availability(main, laptop, new BigDecimal("4")),
                            new Availability(east, laptop, new BigDecimal("1")),
                            new Availability(main, dock, new BigDecimal("10"))),
                    List.of(warehouse(main, "MAIN", 10_000L, 1), warehouse(east, "EAST", 15_000L, 2)),
                    Mode.BALANCED);

            BigDecimal laptopsAllocated = result.allocations().stream()
                    .filter(line -> line.lineKey().equals("L1"))
                    .map(AllocationLine::quantity).reduce(BigDecimal.ZERO, BigDecimal::add);
            BigDecimal laptopsShort = result.shortages().stream()
                    .filter(line -> line.lineKey().equals("L1"))
                    .map(Shortage::quantity).reduce(BigDecimal.ZERO, BigDecimal::add);

            assertThat(laptopsAllocated.add(laptopsShort)).isEqualByComparingTo("7");
        }

        @Test
        @DisplayName("nothing is ever taken beyond what a warehouse actually holds")
        void neverOverAllocatesAWarehouse() {
            AllocationResult result = allocate(
                    List.of(demand("L1", laptop, "100")),
                    List.of(new Availability(main, laptop, new BigDecimal("4")),
                            new Availability(east, laptop, new BigDecimal("1"))),
                    List.of(warehouse(main, "MAIN", 10_000L, 1), warehouse(east, "EAST", 15_000L, 2)),
                    Mode.BALANCED);

            assertThat(quantityAt(result, main)).isEqualByComparingTo("4");
            assertThat(quantityAt(result, east)).isEqualByComparingTo("1");
        }

        @Test
        @DisplayName("the same inputs always produce the same plan")
        void planIsDeterministic() {
            List<Demand> demands = List.of(demand("L1", laptop, "3"));
            List<Availability> stock = List.of(
                    new Availability(main, laptop, new BigDecimal("2")),
                    new Availability(east, laptop, new BigDecimal("2")));
            // Two identically priced warehouses: the tie must break the same way
            // every time, or a replan would shuffle parcels for no reason.
            List<WarehouseInfo> warehouses = List.of(
                    warehouse(main, "MAIN", 10_000L, 1), warehouse(east, "EAST", 10_000L, 2));

            AllocationResult first = allocate(demands, stock, warehouses, Mode.BALANCED);
            AllocationResult second = allocate(demands, stock, warehouses, Mode.BALANCED);

            assertThat(first.usedWarehouseIds()).isEqualTo(second.usedWarehouseIds());
            assertThat(first.scoreMinor()).isEqualTo(second.scoreMinor());
        }

        @Test
        @DisplayName("eight warehouses are still searched exhaustively")
        void eightWarehousesStayExhaustive() {
            List<WarehouseInfo> warehouses = new ArrayList<>();
            List<Availability> stock = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                UUID id = UUID.randomUUID();
                warehouses.add(warehouse(id, "W" + i, 1_000L * (i + 1), i));
                stock.add(new Availability(id, laptop, BigDecimal.ONE));
            }

            AllocationResult result = allocate(
                    List.of(demand("L1", laptop, "3")), stock, warehouses, Mode.BALANCED);

            assertThat(result.exhaustive()).isTrue();
            assertThat(result.fullyFulfilled()).isTrue();
            // The three cheapest warehouses, not just the first three found.
            assertThat(result.estimatedShippingCostMinor()).isEqualTo(6_000L);
        }
    }
}
