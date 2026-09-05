package com.dealflow.fulfillment;

import com.dealflow.fulfillment.engine.AllocationModel.Availability;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read-only stock lookups.
 *
 * <p>Everything here is a <em>snapshot</em>. It is what the quote builder shows
 * beside a line and what the allocation preview reasons about, and it is never a
 * promise: between reading these numbers and confirming an order, someone else
 * may have taken the last unit. Reservation re-reads the same rows under a lock
 * and decides again (edge case E10).
 */
@Service
public class StockAvailabilityService {

    private final StockLevelRepository stockLevels;
    private final WarehouseRepository warehouses;

    public StockAvailabilityService(StockLevelRepository stockLevels, WarehouseRepository warehouses) {
        this.stockLevels = stockLevels;
        this.warehouses = warehouses;
    }

    /** Availability of one variant, summed and broken down by warehouse. */
    public record VariantAvailability(UUID variantId, BigDecimal totalAvailable, BigDecimal totalOnHand,
                                      List<WarehouseAvailability> byWarehouse,
                                      LocalDate earliestExpectedReceipt) {
    }

    public record WarehouseAvailability(UUID warehouseId, String warehouseCode, String warehouseName,
                                        BigDecimal available, BigDecimal onHand,
                                        LocalDate expectedReceiptDate) {
    }

    @Transactional(readOnly = true)
    public Map<UUID, VariantAvailability> availabilityFor(Collection<UUID> variantIds) {
        if (variantIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, Warehouse> warehousesById = new LinkedHashMap<>();
        warehouses.findByActiveTrueOrderBySortOrderAscCodeAsc()
                .forEach(warehouse -> warehousesById.put(warehouse.getId(), warehouse));

        Map<UUID, List<StockLevel>> levelsByVariant = new LinkedHashMap<>();
        for (StockLevel level : stockLevels.findByVariantIdIn(Set.copyOf(variantIds))) {
            // Rows at a deactivated warehouse are not available to promise.
            if (warehousesById.containsKey(level.getWarehouseId())) {
                levelsByVariant.computeIfAbsent(level.getVariantId(), key -> new ArrayList<>()).add(level);
            }
        }

        Map<UUID, VariantAvailability> result = new LinkedHashMap<>();
        for (UUID variantId : variantIds) {
            List<StockLevel> levels = levelsByVariant.getOrDefault(variantId, List.of());
            BigDecimal totalAvailable = BigDecimal.ZERO;
            BigDecimal totalOnHand = BigDecimal.ZERO;
            LocalDate earliest = null;
            List<WarehouseAvailability> breakdown = new ArrayList<>(levels.size());

            for (StockLevel level : levels) {
                Warehouse warehouse = warehousesById.get(level.getWarehouseId());
                totalAvailable = totalAvailable.add(level.available());
                totalOnHand = totalOnHand.add(level.getOnHand());
                if (level.getExpectedReceiptDate() != null
                        && (earliest == null || level.getExpectedReceiptDate().isBefore(earliest))) {
                    earliest = level.getExpectedReceiptDate();
                }
                breakdown.add(new WarehouseAvailability(warehouse.getId(), warehouse.getCode(),
                        warehouse.getName(), level.available(), level.getOnHand(),
                        level.getExpectedReceiptDate()));
            }
            result.put(variantId, new VariantAvailability(variantId, totalAvailable, totalOnHand,
                    List.copyOf(breakdown), earliest));
        }
        return result;
    }

    /** Availability in the shape the allocation engine consumes. */
    @Transactional(readOnly = true)
    public List<Availability> allocationSnapshot(Collection<UUID> variantIds) {
        if (variantIds.isEmpty()) {
            return List.of();
        }
        Set<UUID> activeWarehouseIds = warehouses.findByActiveTrueOrderBySortOrderAscCodeAsc()
                .stream().map(Warehouse::getId).collect(java.util.stream.Collectors.toSet());

        List<Availability> snapshot = new ArrayList<>();
        for (StockLevel level : stockLevels.findByVariantIdIn(Set.copyOf(variantIds))) {
            if (activeWarehouseIds.contains(level.getWarehouseId())) {
                snapshot.add(new Availability(level.getWarehouseId(), level.getVariantId(), level.available()));
            }
        }
        return snapshot;
    }

    @Transactional(readOnly = true)
    public List<Warehouse> activeWarehouses() {
        return warehouses.findByActiveTrueOrderBySortOrderAscCodeAsc();
    }
}
