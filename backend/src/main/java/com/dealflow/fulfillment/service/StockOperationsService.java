package com.dealflow.fulfillment.service;


import com.dealflow.fulfillment.models.*;
import com.dealflow.fulfillment.repo.*;
import com.dealflow.fulfillment.dto.*;
import com.dealflow.fulfillment.controller.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.fulfillment.dto.FulfillmentDtos.AllocationLineRequest;
import com.dealflow.fulfillment.dto.FulfillmentDtos.DispatchRequest;
import com.dealflow.fulfillment.dto.FulfillmentDtos.OverrideAllocationRequest;
import com.dealflow.fulfillment.dto.FulfillmentDtos.StockMovementRequest;
import com.dealflow.orders.models.Order;
import com.dealflow.orders.models.OrderLine;
import com.dealflow.orders.repo.OrderLineRepository;
import com.dealflow.orders.repo.OrderRepository;
import com.dealflow.outbox.service.OutboxWriter;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.time.BusinessClock;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Physical stock operations: dispatch, goods receipt, and manual overrides.
 *
 * <p>Each of these is a place where a small slip becomes a real inventory error,
 * so each one takes the stock rows under a lock and writes its ledger entry in
 * the same transaction as the counter it changes.
 */
@Service
public class StockOperationsService {

    private static final Logger log = LoggerFactory.getLogger(StockOperationsService.class);

    private final StockLevelRepository stockLevels;
    private final StockMovementRepository movements;
    private final WarehouseRepository warehouses;
    private final ReservationRepository reservations;
    private final ShipmentRepository shipments;
    private final ShipmentLineRepository shipmentLines;
    private final BackorderRepository backorders;
    private final OrderRepository orders;
    private final OrderLineRepository orderLines;
    private final AllocationService allocationService;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;

    public StockOperationsService(StockLevelRepository stockLevels, StockMovementRepository movements,
                                  WarehouseRepository warehouses, ReservationRepository reservations,
                                  ShipmentRepository shipments, ShipmentLineRepository shipmentLines,
                                  BackorderRepository backorders, OrderRepository orders,
                                  OrderLineRepository orderLines, AllocationService allocationService,
                                  AuditService audit, OutboxWriter outbox, BusinessClock clock) {
        this.stockLevels = stockLevels;
        this.movements = movements;
        this.warehouses = warehouses;
        this.reservations = reservations;
        this.shipments = shipments;
        this.shipmentLines = shipmentLines;
        this.backorders = backorders;
        this.orders = orders;
        this.orderLines = orderLines;
        this.allocationService = allocationService;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
    }

    // ------------------------------------------------------------- dispatch

    /**
     * Sends a shipment.
     *
     * <p>Dispatch decrements {@code on_hand} and {@code reserved} by the same
     * amount and writes one movement. Doing only the first would leave stock
     * reserved for goods that have left the building; doing only the second
     * would make the departed units look available again.
     */
    @Transactional(rollbackFor = Exception.class)
    public Shipment dispatch(UUID shipmentId, DispatchRequest request, Actor actor) {
        requireOperations(actor);

        Shipment shipment = shipments.findById(shipmentId)
                .orElseThrow(() -> ApiException.notFound("Shipment " + shipmentId));
        if (shipment.getStatus() == Shipment.ShipmentStatus.DISPATCHED) {
            // Replaying a dispatch returns the same shipment rather than
            // subtracting the stock a second time.
            return shipment;
        }
        if (!shipment.getStatus().isOpen()) {
            throw ApiException.of(ErrorCode.CONFLICTING_STATE,
                    "This shipment is " + shipment.getStatus().name().toLowerCase() + ".",
                    "status", shipment.getStatus().name());
        }

        Order order = orders.findByIdForUpdate(shipment.getOrderId())
                .orElseThrow(() -> ApiException.notFound("Order " + shipment.getOrderId()));

        List<ShipmentLine> lines = shipmentLines.findByShipmentId(shipment.getId());
        if (lines.isEmpty()) {
            throw new ApiException(ErrorCode.NOTHING_TO_DISPATCH,
                    "This shipment holds no reserved stock.");
        }

        Instant now = clock.now();
        Map<UUID, StockLevel> locked = lockStockFor(
                lines.stream().map(ShipmentLine::getVariantId).collect(Collectors.toSet()),
                shipment.getWarehouseId());

        for (ShipmentLine line : lines) {
            List<Reservation> held = reservations.findHeldForShipmentLine(line.getId());
            BigDecimal quantity = held.stream()
                    .map(Reservation::getQuantity).reduce(BigDecimal.ZERO, BigDecimal::add);
            if (quantity.signum() <= 0) {
                continue;
            }

            StockLevel level = locked.get(line.getVariantId());
            if (level == null) {
                throw new ApiException(ErrorCode.CONFLICTING_STATE,
                        "The stock record for this shipment no longer exists.");
            }
            if (level.getOnHand().compareTo(quantity) < 0
                    || level.getReserved().compareTo(quantity) < 0) {
                throw new ApiException(ErrorCode.CONFLICTING_STATE,
                        "Stock records disagree with this shipment. Recount before dispatching.");
            }

            level.setOnHand(level.getOnHand().subtract(quantity));
            level.setReserved(level.getReserved().subtract(quantity));

            StockMovement movement = new StockMovement(line.getVariantId(),
                    shipment.getWarehouseId(), quantity.negate(),
                    StockMovement.MovementType.DISPATCH, now);
            movement.setReference("Shipment", shipment.getId());
            movement.setActorProfileId(actor.profileId());
            movement.setNote(request.note());
            movements.save(movement);

            held.forEach(reservation -> reservation.consume(now));
        }

        shipment.markDispatched(actor.profileId(), now, request.trackingReference());
        allocationService.recomputeFulfillmentStatus(order,
                orderLines.findByOrderIdOrderByPositionAsc(order.getId()));

        audit.record(actor, "SHIPMENT_DISPATCHED", "Shipment", shipment.getId())
                .order(order.getId())
                .after(Map.of("warehouseId", shipment.getWarehouseId().toString(),
                        "lines", lines.size()))
                .save();

        outbox.publish(OutboxWriter.Events.ALLOCATION_UPDATED, "Order", order.getId(),
                order.getRowVersion(),
                Map.of("shipmentId", shipment.getId().toString(), "status", "DISPATCHED"),
                OutboxWriter.RecipientScope.deal(order.getCustomerId(), order.getOwnerProfileId(), null));

        return shipment;
    }

    // -------------------------------------------------------------- receipt

    public record ReceiptOutcome(StockMovement movement, boolean replayed,
                                 List<UUID> consolidatableOrderIds) {
    }

    /**
     * Records a goods receipt or an inventory correction.
     *
     * <p>{@code requestKey} is unique in the database, so replaying a receipt —
     * a double-clicked form, a retried request — cannot add the same stock twice
     * (test T11). A replay returns the original movement.
     *
     * <p>After a receipt, open shortages for that variant become candidates for
     * consolidation. The suggestion is surfaced; nothing is re-reserved silently,
     * because moving stock onto an order is an operational decision.
     */
    @Transactional(rollbackFor = Exception.class)
    public ReceiptOutcome recordMovement(StockMovementRequest request, String requestKey, Actor actor) {
        requireOperations(actor);

        if (requestKey != null && !requestKey.isBlank()) {
            Optional<StockMovement> existing = movements.findByRequestKey(requestKey);
            if (existing.isPresent()) {
                log.debug("Stock movement {} replayed; stock unchanged", requestKey);
                return new ReceiptOutcome(existing.get(), true, List.of());
            }
        }

        StockMovement.MovementType type = parseMovementType(request.movementType());
        BigDecimal quantity = request.quantity();
        if (type == StockMovement.MovementType.RECEIPT && quantity.signum() <= 0) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "A receipt must be a positive quantity.");
        }
        if (type == StockMovement.MovementType.ADJUSTMENT && quantity.signum() == 0) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "An adjustment cannot be zero.");
        }
        if (type == StockMovement.MovementType.DISPATCH) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "Dispatches are recorded by shipping a shipment, not directly.");
        }

        warehouses.findById(request.warehouseId())
                .orElseThrow(() -> ApiException.notFound("Warehouse " + request.warehouseId()));

        StockLevel level = stockLevels.lockOne(request.variantId(), request.warehouseId())
                .orElseGet(() -> stockLevels.save(
                        new StockLevel(request.warehouseId(), request.variantId())));

        BigDecimal newOnHand = level.getOnHand().add(quantity);
        if (newOnHand.signum() < 0) {
            throw ApiException.of(ErrorCode.VALIDATION_FAILED,
                    "That adjustment would take stock below zero.",
                    "onHand", level.getOnHand().toPlainString());
        }
        if (newOnHand.compareTo(level.getReserved()) < 0) {
            throw ApiException.of(ErrorCode.CONFLICTING_STATE,
                    "That adjustment would leave less stock than is already reserved for orders.",
                    "reserved", level.getReserved().toPlainString());
        }
        level.setOnHand(newOnHand);

        if (request.expectedNextReceiptDate() != null) {
            level.setExpectedReceiptDate(request.expectedNextReceiptDate());
            level.setExpectedReceiptQty(request.expectedNextReceiptQty());
        } else if (type == StockMovement.MovementType.RECEIPT) {
            // The awaited delivery has arrived; do not keep advertising it.
            level.setExpectedReceiptDate(null);
            level.setExpectedReceiptQty(null);
        }

        Instant now = clock.now();
        StockMovement movement = new StockMovement(request.variantId(), request.warehouseId(),
                quantity, type, now);
        movement.setRequestKey(requestKey);
        movement.setNote(request.note());
        movement.setActorProfileId(actor.profileId());
        movements.save(movement);

        audit.record(actor, "STOCK_" + type.name(), "StockLevel", level.getId())
                .after(Map.of("variantId", request.variantId().toString(),
                        "warehouseId", request.warehouseId().toString(),
                        "quantity", quantity.toPlainString(),
                        "onHand", level.getOnHand().toPlainString()))
                .reason(request.note())
                .save();

        List<UUID> consolidatable = openBackorderOrders(request.variantId());
        outbox.publish(OutboxWriter.Events.STOCK_UPDATED, "StockLevel", level.getId(),
                level.getRowVersion(),
                Map.of("variantId", request.variantId().toString(),
                        "warehouseId", request.warehouseId().toString(),
                        "onHand", level.getOnHand().toPlainString()),
                OutboxWriter.RecipientScope.roles("FINANCE", "ADMIN", "MANAGER"));

        for (UUID orderId : consolidatable) {
            outbox.publish(OutboxWriter.Events.BACKORDER_UPDATED, "Order", orderId, 0L,
                    Map.of("consolidationAvailable", true,
                            "variantId", request.variantId().toString()),
                    OutboxWriter.RecipientScope.roles("FINANCE", "ADMIN"));
        }

        return new ReceiptOutcome(movement, false, consolidatable);
    }

    // -------------------------------------------------------------- override

    /**
     * Replaces the warehouse split with an explicitly requested one.
     *
     * <p>Validated exactly, under locks. If a warehouse holding three units is
     * asked for five, the request is <em>refused</em> with a feasible proposal —
     * it is never quietly reinterpreted as "three now and two later", because
     * that is a different commercial outcome from the one the operator asked for
     * (edge case E11). Existing reservations are untouched when the request is
     * rejected.
     */
    @Transactional(rollbackFor = Exception.class)
    public com.dealflow.fulfillment.models.AllocationModel.AllocationResult overrideAllocation(
            UUID orderId, OverrideAllocationRequest request, Actor actor) {
        requireOperations(actor);

        Order order = orders.findByIdForUpdate(orderId)
                .orElseThrow(() -> ApiException.notFound("Order " + orderId));
        List<OrderLine> lines = orderLines.findByOrderIdOrderByPositionAsc(orderId);
        Map<UUID, OrderLine> linesById = lines.stream()
                .collect(Collectors.toMap(OrderLine::getId, line -> line));

        Set<UUID> variantIds = request.allocations().stream()
                .map(allocation -> {
                    OrderLine line = linesById.get(allocation.orderLineId());
                    if (line == null) {
                        throw ApiException.notFound("Order line " + allocation.orderLineId());
                    }
                    if (!line.isRequiresStock() || line.getVariantId() == null) {
                        throw new ApiException(ErrorCode.ALLOCATION_INFEASIBLE,
                                "\"" + line.getDescription() + "\" is not a stocked item.");
                    }
                    return line.getVariantId();
                })
                .collect(Collectors.toSet());

        Map<String, StockLevel> locked = new LinkedHashMap<>();
        stockLevels.lockByVariantIds(variantIds).forEach(level ->
                locked.put(level.getVariantId() + "|" + level.getWarehouseId(), level));

        // What this order already holds is available to it again.
        Map<UUID, List<Reservation>> heldByLine = reservations.findHeldForOrder(orderId).stream()
                .collect(Collectors.groupingBy(Reservation::getOrderLineId));

        Map<UUID, BigDecimal> requestedByLine = new HashMap<>();
        for (AllocationLineRequest allocation : request.allocations()) {
            requestedByLine.merge(allocation.orderLineId(), allocation.quantity(), BigDecimal::add);
        }

        // Validate feasibility per (variant, warehouse) before changing anything.
        Map<String, BigDecimal> demandByCell = new LinkedHashMap<>();
        for (AllocationLineRequest allocation : request.allocations()) {
            OrderLine line = linesById.get(allocation.orderLineId());
            demandByCell.merge(line.getVariantId() + "|" + allocation.warehouseId(),
                    allocation.quantity(), BigDecimal::add);
        }
        List<String> problems = new ArrayList<>();
        for (Map.Entry<String, BigDecimal> cell : demandByCell.entrySet()) {
            StockLevel level = locked.get(cell.getKey());
            BigDecimal ownHeld = BigDecimal.ZERO;
            if (level != null) {
                BigDecimal own = reservations.sumOwnHeld(orderId, level.getVariantId(),
                        level.getWarehouseId());
                ownHeld = own == null ? BigDecimal.ZERO : own;
            }
            BigDecimal availableToOrder = level == null
                    ? BigDecimal.ZERO : level.available().add(ownHeld);
            if (availableToOrder.compareTo(cell.getValue()) < 0) {
                problems.add("Requested " + cell.getValue().toPlainString() + " but only "
                        + availableToOrder.toPlainString() + " is available at that warehouse.");
            }
        }
        if (!problems.isEmpty()) {
            // Refuse, and hand back a plan that would work.
            var feasible = allocationService.preview(lines);
            throw ApiException.of(ErrorCode.ALLOCATION_INFEASIBLE,
                    "That split cannot be fulfilled: " + String.join(" ", problems),
                    "problems", problems,
                    "proposedAllocations", feasible.allocations().size(),
                    "proposedShortages", feasible.shortages().size());
        }

        // Requested quantities must not exceed what is still unshipped.
        for (Map.Entry<UUID, BigDecimal> entry : requestedByLine.entrySet()) {
            OrderLine line = linesById.get(entry.getKey());
            BigDecimal dispatched = dispatchedQuantity(line.getId());
            BigDecimal unshipped = line.getQuantity().subtract(dispatched);
            if (entry.getValue().compareTo(unshipped) > 0) {
                throw ApiException.of(ErrorCode.ALLOCATION_MISMATCH,
                        "\"" + line.getDescription() + "\" has only " + unshipped.toPlainString()
                                + " left to allocate.",
                        "orderLineId", line.getId().toString(),
                        "unshipped", unshipped.toPlainString());
            }
        }

        Instant now = clock.now();
        // Release only what has not shipped. Dispatched stock is gone and is
        // never re-planned.
        heldByLine.values().stream().flatMap(List::stream).forEach(reservation -> {
            StockLevel level = locked.get(reservation.getVariantId() + "|" + reservation.getWarehouseId());
            if (level != null) {
                level.setReserved(level.getReserved().subtract(reservation.getQuantity()));
            }
            reservation.release(now);
        });
        shipments.findOpenForOrder(orderId).forEach(shipment -> {
            shipmentLines.findByShipmentId(shipment.getId()).forEach(shipmentLines::delete);
            shipment.setStatus(Shipment.ShipmentStatus.CANCELED);
        });

        Map<UUID, Long> shippingCosts = warehouses.findByActiveTrueOrderBySortOrderAscCodeAsc().stream()
                .collect(Collectors.toMap(Warehouse::getId, Warehouse::getShippingFixedCostMinor));
        Map<UUID, Shipment> newShipments = new LinkedHashMap<>();

        for (AllocationLineRequest allocation : request.allocations()) {
            OrderLine line = linesById.get(allocation.orderLineId());
            StockLevel level = locked.get(line.getVariantId() + "|" + allocation.warehouseId());
            if (level == null) {
                throw new ApiException(ErrorCode.ALLOCATION_INFEASIBLE,
                        "There is no stock record for that item at that warehouse.");
            }
            level.setReserved(level.getReserved().add(allocation.quantity()));

            Shipment shipment = newShipments.computeIfAbsent(allocation.warehouseId(), warehouseId ->
                    shipments.save(new Shipment(orderId, warehouseId,
                            shippingCosts.getOrDefault(warehouseId, 0L))));
            ShipmentLine shipmentLine = shipmentLines.save(new ShipmentLine(shipment.getId(),
                    line.getId(), line.getVariantId(), allocation.quantity()));

            Reservation reservation = new Reservation(orderId, line.getId(),
                    allocation.warehouseId(), line.getVariantId(), allocation.quantity());
            reservation.setShipmentLineId(shipmentLine.getId());
            reservations.save(reservation);
        }

        // Whatever the operator did not allocate becomes an explicit shortage.
        rebuildBackorders(order, lines, requestedByLine, now);
        allocationService.recomputeFulfillmentStatus(order, lines);

        audit.record(actor, "ALLOCATION_OVERRIDDEN", "Order", orderId)
                .order(orderId)
                .after(Map.of("allocations", request.allocations().size()))
                .reason(request.reason())
                .save();

        outbox.publish(OutboxWriter.Events.ALLOCATION_UPDATED, "Order", orderId,
                order.getRowVersion(), Map.of("overridden", true),
                OutboxWriter.RecipientScope.deal(order.getCustomerId(), order.getOwnerProfileId(), null));

        return allocationService.preview(lines);
    }

    // -------------------------------------------------------------- helpers

    private void rebuildBackorders(Order order, List<OrderLine> lines,
                                   Map<UUID, BigDecimal> allocatedByLine, Instant now) {
        for (OrderLine line : lines) {
            if (!line.isRequiresStock() || line.getVariantId() == null) {
                continue;
            }
            BigDecimal dispatched = dispatchedQuantity(line.getId());
            BigDecimal allocated = allocatedByLine.getOrDefault(line.getId(), BigDecimal.ZERO);
            BigDecimal shortfall = line.getQuantity().subtract(dispatched).subtract(allocated);

            Optional<Backorder> open = backorders.findOpenForLine(line.getId());
            if (shortfall.signum() > 0) {
                if (open.isPresent()) {
                    open.get().setQuantity(shortfall);
                } else {
                    backorders.save(new Backorder(order.getId(), line.getId(),
                            line.getVariantId(), shortfall));
                }
            } else {
                open.ifPresent(backorder -> backorder.resolve(now));
            }
        }
    }

    /** Quantity of this line already dispatched, which no replan may touch. */
    private BigDecimal dispatchedQuantity(UUID orderLineId) {
        BigDecimal dispatched = reservations.sumDispatched(orderLineId);
        return dispatched == null ? BigDecimal.ZERO : dispatched;
    }

    private Map<UUID, StockLevel> lockStockFor(Set<UUID> variantIds, UUID warehouseId) {
        Map<UUID, StockLevel> locked = new LinkedHashMap<>();
        for (StockLevel level : stockLevels.lockByVariantIds(variantIds)) {
            if (level.getWarehouseId().equals(warehouseId)) {
                locked.put(level.getVariantId(), level);
            }
        }
        return locked;
    }

    private List<UUID> openBackorderOrders(UUID variantId) {
        return backorders.findOpenForVariant(variantId).stream()
                .map(Backorder::getOrderId)
                .distinct()
                .toList();
    }

    private static StockMovement.MovementType parseMovementType(String value) {
        try {
            return StockMovement.MovementType.valueOf(value.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "movementType must be RECEIPT or ADJUSTMENT.");
        }
    }

    private static void requireOperations(Actor actor) {
        if (!(actor.role() == com.dealflow.auth.models.Role.FINANCE
                || actor.role() == com.dealflow.auth.models.Role.ADMIN)) {
            throw ApiException.forbidden(
                    "Stock operations are restricted to operations and administrator accounts.");
        }
    }
}
