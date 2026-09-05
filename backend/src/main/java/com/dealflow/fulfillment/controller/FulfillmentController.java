package com.dealflow.fulfillment.controller;


import com.dealflow.fulfillment.models.*;
import com.dealflow.fulfillment.repo.*;
import com.dealflow.fulfillment.service.*;
import com.dealflow.fulfillment.dto.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.catalog.models.Product;
import com.dealflow.catalog.repo.ProductRepository;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.catalog.repo.ProductVariantRepository;
import com.dealflow.fulfillment.dto.FulfillmentDtos.AllocationPlanResponse;
import com.dealflow.fulfillment.dto.FulfillmentDtos.BackorderResponse;
import com.dealflow.fulfillment.dto.FulfillmentDtos.DispatchRequest;
import com.dealflow.fulfillment.dto.FulfillmentDtos.OrderFulfillmentResponse;
import com.dealflow.fulfillment.dto.FulfillmentDtos.OverrideAllocationRequest;
import com.dealflow.fulfillment.dto.FulfillmentDtos.PlannedAllocation;
import com.dealflow.fulfillment.dto.FulfillmentDtos.PlannedShortage;
import com.dealflow.fulfillment.dto.FulfillmentDtos.ShipmentLineResponse;
import com.dealflow.fulfillment.dto.FulfillmentDtos.ShipmentResponse;
import com.dealflow.fulfillment.dto.FulfillmentDtos.StockLevelResponse;
import com.dealflow.fulfillment.dto.FulfillmentDtos.StockLevelUpdateRequest;
import com.dealflow.fulfillment.dto.FulfillmentDtos.StockMovementRequest;
import com.dealflow.fulfillment.dto.FulfillmentDtos.StockMovementResponse;
import com.dealflow.fulfillment.models.AllocationModel.AllocationResult;
import com.dealflow.orders.models.Order;
import com.dealflow.orders.controller.OrderController;
import com.dealflow.orders.models.OrderLine;
import com.dealflow.orders.repo.OrderLineRepository;
import com.dealflow.orders.repo.OrderRepository;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Warehouse allocation, shipments, stock and receipts. */
@RestController
@RequestMapping("/api/v1")
public class FulfillmentController {

    private final AllocationService allocationService;
    private final StockOperationsService stockOperations;
    private final OrderController orderController;
    private final OrderRepository orders;
    private final OrderLineRepository orderLines;
    private final ShipmentRepository shipments;
    private final ShipmentLineRepository shipmentLines;
    private final BackorderRepository backorders;
    private final WarehouseRepository warehouses;
    private final StockLevelRepository stockLevels;
    private final StockAvailabilityService availability;
    private final ProductVariantRepository variants;
    private final ProductRepository products;

    public FulfillmentController(AllocationService allocationService, StockOperationsService stockOperations,
                                 OrderController orderController, OrderRepository orders,
                                 OrderLineRepository orderLines, ShipmentRepository shipments,
                                 ShipmentLineRepository shipmentLines, BackorderRepository backorders,
                                 WarehouseRepository warehouses, StockLevelRepository stockLevels,
                                 StockAvailabilityService availability, ProductVariantRepository variants,
                                 ProductRepository products) {
        this.allocationService = allocationService;
        this.stockOperations = stockOperations;
        this.orderController = orderController;
        this.orders = orders;
        this.orderLines = orderLines;
        this.shipments = shipments;
        this.shipmentLines = shipmentLines;
        this.backorders = backorders;
        this.warehouses = warehouses;
        this.stockLevels = stockLevels;
        this.availability = availability;
        this.variants = variants;
        this.products = products;
    }

    // ---------------------------------------------------------- allocation

    /** The current plan for an order: a preview before reservation, the real split after. */
    @GetMapping("/orders/{orderId}/allocation")
    @Transactional(readOnly = true)
    public ApiResponse<AllocationPlanResponse> allocation(@PathVariable UUID orderId, Actor actor) {
        Order order = orderController.loadVisible(orderId, actor);
        List<OrderLine> lines = orderLines.findByOrderIdOrderByPositionAsc(orderId);
        boolean preview = order.getFulfillmentStatus() == Order.FulfillmentStatus.UNALLOCATED;
        return ApiResponse.of(toPlan(order, allocationService.preview(lines), lines, preview));
    }

    @GetMapping("/orders/{orderId}/fulfillment")
    @Transactional(readOnly = true)
    public ApiResponse<OrderFulfillmentResponse> fulfillment(@PathVariable UUID orderId, Actor actor) {
        Order order = orderController.loadVisible(orderId, actor);
        return ApiResponse.of(toFulfillment(order));
    }

    /** Manual override: exact quantities, validated under locks, refused if infeasible. */
    @PostMapping("/orders/{orderId}/allocations")
    @PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
    public ApiResponse<AllocationPlanResponse> override(@PathVariable UUID orderId,
                                                        @Valid @RequestBody OverrideAllocationRequest request,
                                                        Actor actor) {
        AllocationResult result = stockOperations.overrideAllocation(orderId, request, actor);
        Order order = orders.findById(orderId).orElseThrow(() -> ApiException.notFound("Order " + orderId));
        return ApiResponse.of(toPlan(order, result, orderLines.findByOrderIdOrderByPositionAsc(orderId), false));
    }

    /** Re-plans the unshipped remainder after a receipt; consolidates into open parcels. */
    @PostMapping("/orders/{orderId}/replans")
    @PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
    @Transactional
    public ApiResponse<OrderFulfillmentResponse> replan(@PathVariable UUID orderId, Actor actor) {
        Order order = orders.findByIdForUpdate(orderId)
                .orElseThrow(() -> ApiException.notFound("Order " + orderId));
        allocationService.replan(order, orderLines.findByOrderIdOrderByPositionAsc(orderId), actor);
        return ApiResponse.of(toFulfillment(order));
    }

    @PostMapping("/shipments/{shipmentId}/dispatches")
    @PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
    public ApiResponse<ShipmentResponse> dispatch(@PathVariable UUID shipmentId,
                                                  @RequestBody(required = false) DispatchRequest request,
                                                  Actor actor) {
        DispatchRequest body = request == null ? new DispatchRequest(null, null) : request;
        Shipment shipment = stockOperations.dispatch(shipmentId, body, actor);
        return ApiResponse.of(toShipment(shipment));
    }

    // ----------------------------------------------------------------- stock

    /** Goods receipt or correction. Requires an {@code Idempotency-Key}. */
    @PostMapping("/stock-movements")
    @PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
    public ApiResponse<StockMovementResponse> move(@RequestHeader(value = "Idempotency-Key", required = false)
                                                   String idempotencyKey,
                                                   @Valid @RequestBody StockMovementRequest request,
                                                   Actor actor) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new ApiException(com.dealflow.shared.error.ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
        }
        var outcome = stockOperations.recordMovement(request, idempotencyKey.trim(), actor);
        StockMovement movement = outcome.movement();
        return ApiResponse.of(new StockMovementResponse(movement.getId(), movement.getVariantId(),
                        movement.getWarehouseId(), movement.getQuantity(), movement.getMovementType().name(),
                        movement.getNote(), movement.getOccurredAt(), outcome.replayed()),
                Map.of("consolidatableOrderIds", outcome.consolidatableOrderIds()));
    }

    @GetMapping("/stock-levels")
    @Transactional(readOnly = true)
    public ApiResponse<List<StockLevelResponse>> stockLevels(@RequestParam(required = false) UUID warehouseId,
                                                             @RequestParam(required = false) UUID variantId,
                                                             Actor actor) {
        if (actor.isCustomer()) {
            throw ApiException.forbidden("Stock is internal.");
        }
        List<StockLevel> rows = warehouseId != null
                ? stockLevels.findByWarehouseId(warehouseId)
                : variantId != null ? stockLevels.findByVariantIdIn(List.of(variantId)) : stockLevels.findAll();
        Map<UUID, Warehouse> warehouseRows = warehouses.findAll().stream()
                .collect(Collectors.toMap(Warehouse::getId, warehouse -> warehouse));
        Map<UUID, ProductVariant> variantRows = variants.findAllById(
                        rows.stream().map(StockLevel::getVariantId).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(ProductVariant::getId, variant -> variant));
        Map<UUID, Product> productRows = products.findAllById(
                        variantRows.values().stream().map(ProductVariant::getProductId).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(Product::getId, product -> product));

        return ApiResponse.of(rows.stream().map(level -> {
            ProductVariant variant = variantRows.get(level.getVariantId());
            Product product = variant == null ? null : productRows.get(variant.getProductId());
            Warehouse warehouse = warehouseRows.get(level.getWarehouseId());
            return new StockLevelResponse(level.getVariantId(), variant == null ? null : variant.getSku(),
                    product == null ? null : product.getName(), level.getWarehouseId(),
                    warehouse == null ? null : warehouse.getCode(), level.getOnHand(), level.getReserved(),
                    level.available(), level.getReorderPoint(), level.getTargetQty(),
                    level.getExpectedReceiptDate(), level.needsReplenishment(), level.replenishmentSuggestion());
        }).toList());
    }

    /** Replenishment thresholds and expected receipts. Functional configuration, not decoration. */
    @PatchMapping("/stock-levels")
    @PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
    @Transactional
    public ApiResponse<StockLevelResponse> updateLevel(@Valid @RequestBody StockLevelUpdateRequest request,
                                                       Actor actor) {
        StockLevel level = stockLevels.findByWarehouseIdAndVariantId(request.warehouseId(), request.variantId())
                .orElseGet(() -> stockLevels.save(new StockLevel(request.warehouseId(), request.variantId())));
        if (request.reorderPoint() != null) {
            level.setReorderPoint(request.reorderPoint());
        }
        if (request.targetQty() != null) {
            level.setTargetQty(request.targetQty());
        }
        level.setExpectedReceiptDate(request.expectedReceiptDate());
        level.setExpectedReceiptQty(request.expectedReceiptQty());
        ProductVariant variant = variants.findById(level.getVariantId()).orElse(null);
        Product product = variant == null ? null : products.findById(variant.getProductId()).orElse(null);
        Warehouse warehouse = warehouses.findById(level.getWarehouseId()).orElse(null);
        return ApiResponse.of(new StockLevelResponse(level.getVariantId(),
                variant == null ? null : variant.getSku(), product == null ? null : product.getName(),
                level.getWarehouseId(), warehouse == null ? null : warehouse.getCode(),
                level.getOnHand(), level.getReserved(), level.available(), level.getReorderPoint(),
                level.getTargetQty(), level.getExpectedReceiptDate(), level.needsReplenishment(),
                level.replenishmentSuggestion()));
    }

    // -------------------------------------------------------------- mapping

    private AllocationPlanResponse toPlan(Order order, AllocationResult result, List<OrderLine> lines,
                                          boolean preview) {
        Map<UUID, OrderLine> byId = lines.stream().collect(Collectors.toMap(OrderLine::getId, line -> line));
        Map<UUID, StockAvailabilityService.VariantAvailability> stock = availability.availabilityFor(
                result.shortages().stream().map(s -> s.variantId()).collect(Collectors.toSet()));

        List<PlannedAllocation> allocations = result.allocations().stream()
                .map(line -> new PlannedAllocation(line.warehouseId(), line.warehouseCode(),
                        line.warehouseName(), line.orderLineId(), line.lineKey(), line.description(),
                        line.quantity()))
                .toList();
        List<PlannedShortage> shortages = result.shortages().stream()
                .map(shortage -> {
                    var variantStock = stock.get(shortage.variantId());
                    return new PlannedShortage(shortage.orderLineId(), shortage.lineKey(),
                            shortage.description(), shortage.quantity(),
                            variantStock == null ? null : variantStock.earliestExpectedReceipt());
                })
                .toList();
        return new AllocationPlanResponse(order.getId(), result.mode().name(), allocations, shortages,
                result.shipmentCount(), Money.toMajor(result.estimatedShippingCostMinor()),
                Money.toMajor(result.scoreMinor()), result.fullyFulfilled(), result.exhaustive(),
                order.getBackorderTerms().name(), preview);
    }

    private OrderFulfillmentResponse toFulfillment(Order order) {
        List<ShipmentResponse> shipmentRows = shipments.findByOrderId(order.getId()).stream()
                .map(this::toShipment).toList();
        Map<UUID, OrderLine> lines = orderLines.findByOrderIdOrderByPositionAsc(order.getId()).stream()
                .collect(Collectors.toMap(OrderLine::getId, line -> line));

        List<Backorder> open = backorders.findByOrderId(order.getId());
        Map<UUID, StockAvailabilityService.VariantAvailability> stock = availability.availabilityFor(
                open.stream().map(Backorder::getVariantId).collect(Collectors.toSet()));

        boolean replanSuggested = false;
        List<BackorderResponse> backorderRows = new java.util.ArrayList<>();
        for (Backorder backorder : open) {
            var variantStock = stock.get(backorder.getVariantId());
            boolean consolidatable = backorder.getStatus() == Backorder.BackorderStatus.OPEN
                    && variantStock != null && variantStock.totalAvailable().signum() > 0;
            replanSuggested |= consolidatable;
            OrderLine line = lines.get(backorder.getOrderLineId());
            backorderRows.add(new BackorderResponse(backorder.getId(), backorder.getOrderLineId(),
                    line == null ? null : line.getDescription(), backorder.getQuantity(),
                    backorder.getExpectedDate(), backorder.getStatus().name(), consolidatable));
        }
        return new OrderFulfillmentResponse(order.getId(), order.getReference(),
                order.getFulfillmentStatus().name(), order.getBackorderTerms().name(),
                shipmentRows, backorderRows, replanSuggested);
    }

    private ShipmentResponse toShipment(Shipment shipment) {
        Warehouse warehouse = warehouses.findById(shipment.getWarehouseId()).orElse(null);
        Map<UUID, OrderLine> lines = orderLines.findByOrderIdOrderByPositionAsc(shipment.getOrderId()).stream()
                .collect(Collectors.toMap(OrderLine::getId, line -> line));
        List<ShipmentLineResponse> lineRows = shipmentLines.findByShipmentId(shipment.getId()).stream()
                .map(line -> {
                    OrderLine orderLine = lines.get(line.getOrderLineId());
                    return new ShipmentLineResponse(line.getId(), line.getOrderLineId(),
                            orderLine == null ? null : orderLine.getLineKey(),
                            orderLine == null ? null : orderLine.getDescription(), line.getQuantity());
                })
                .toList();
        return new ShipmentResponse(shipment.getId(), shipment.getWarehouseId(),
                warehouse == null ? null : warehouse.getCode(), warehouse == null ? null : warehouse.getName(),
                shipment.getStatus().name(), Money.toMajor(shipment.getEstimatedCostMinor()),
                shipment.getDispatchedAt(), shipment.getTrackingReference(), lineRows);
    }
}
