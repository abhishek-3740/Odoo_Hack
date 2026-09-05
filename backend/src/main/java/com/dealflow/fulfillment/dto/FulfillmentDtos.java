package com.dealflow.fulfillment.dto;


import com.dealflow.fulfillment.models.*;
import com.dealflow.fulfillment.repo.*;
import com.dealflow.fulfillment.service.*;
import com.dealflow.fulfillment.controller.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** The fulfilment API surface. */
public final class FulfillmentDtos {

    private FulfillmentDtos() {
    }

    // ------------------------------------------------------------- requests

    /** One line of a manually overridden warehouse split. */
    public record AllocationLineRequest(
            @NotNull UUID orderLineId,
            @NotNull UUID warehouseId,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal quantity) {
    }

    /**
     * A manual split.
     *
     * <p>Validated exactly, under the same locks as an automatic allocation. An
     * infeasible request is refused with a feasible counter-proposal; asking for
     * five units from a warehouse holding three never quietly becomes "three now,
     * two later" (edge case E11).
     */
    public record OverrideAllocationRequest(
            @NotEmpty List<@Valid AllocationLineRequest> allocations,
            @Size(max = 500) String reason) {
    }

    public record DispatchRequest(
            @Size(max = 120) String trackingReference,
            @Size(max = 500) String note) {
    }

    /** A goods receipt or a stock correction. */
    public record StockMovementRequest(
            @NotNull UUID variantId,
            @NotNull UUID warehouseId,
            @NotNull BigDecimal quantity,
            @NotNull String movementType,
            LocalDate expectedNextReceiptDate,
            BigDecimal expectedNextReceiptQty,
            @Size(max = 500) String note) {
    }

    public record StockLevelUpdateRequest(
            @NotNull UUID variantId,
            @NotNull UUID warehouseId,
            @DecimalMin("0") BigDecimal reorderPoint,
            @DecimalMin("0") BigDecimal targetQty,
            LocalDate expectedReceiptDate,
            BigDecimal expectedReceiptQty) {
    }

    // ------------------------------------------------------------ responses

    public record PlannedAllocation(
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            UUID orderLineId,
            String lineKey,
            String description,
            BigDecimal quantity) {
    }

    public record PlannedShortage(
            UUID orderLineId,
            String lineKey,
            String description,
            BigDecimal quantity,
            /** Only from a real expected receipt. Null means "date unconfirmed". */
            LocalDate expectedDate) {
    }

    /**
     * A costed plan.
     *
     * <p>Before confirmation this is a preview and holds nothing. After
     * confirmation it describes what is actually reserved.
     */
    public record AllocationPlanResponse(
            UUID orderId,
            String mode,
            List<PlannedAllocation> allocations,
            List<PlannedShortage> shortages,
            int shipmentCount,
            BigDecimal estimatedShippingCost,
            BigDecimal score,
            boolean fullyFulfilled,
            /** False when the warehouse count exceeded the exhaustive search limit. */
            boolean exhaustive,
            String backorderTerms,
            boolean preview) {
    }

    public record ShipmentLineResponse(
            UUID id,
            UUID orderLineId,
            String lineKey,
            String description,
            BigDecimal quantity) {
    }

    public record ShipmentResponse(
            UUID id,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            String status,
            BigDecimal estimatedCost,
            Instant dispatchedAt,
            String trackingReference,
            List<ShipmentLineResponse> lines) {
    }

    public record BackorderResponse(
            UUID id,
            UUID orderLineId,
            String description,
            BigDecimal quantity,
            LocalDate expectedDate,
            String status,
            /** Set when a receipt has made stock available to close this shortage. */
            boolean consolidationAvailable) {
    }

    public record OrderFulfillmentResponse(
            UUID orderId,
            String orderReference,
            String fulfillmentStatus,
            String backorderTerms,
            List<ShipmentResponse> shipments,
            List<BackorderResponse> backorders,
            boolean replanSuggested) {
    }

    public record StockLevelResponse(
            UUID variantId,
            String sku,
            String productName,
            UUID warehouseId,
            String warehouseCode,
            BigDecimal onHand,
            BigDecimal reserved,
            BigDecimal available,
            BigDecimal reorderPoint,
            BigDecimal targetQty,
            LocalDate expectedReceiptDate,
            boolean needsReplenishment,
            BigDecimal replenishmentSuggestion) {
    }

    public record StockMovementResponse(
            UUID id,
            UUID variantId,
            UUID warehouseId,
            BigDecimal quantity,
            String movementType,
            String note,
            Instant occurredAt,
            boolean replayed) {
    }
}
