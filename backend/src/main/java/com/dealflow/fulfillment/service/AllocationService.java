package com.dealflow.fulfillment.service;


import com.dealflow.fulfillment.models.*;
import com.dealflow.fulfillment.repo.*;
import com.dealflow.fulfillment.dto.*;
import com.dealflow.fulfillment.controller.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.catalog.repo.ProductVariantRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.fulfillment.service.AllocationEngine;
import com.dealflow.fulfillment.models.AllocationModel;
import com.dealflow.fulfillment.models.AllocationModel.AllocationInput;
import com.dealflow.fulfillment.models.AllocationModel.AllocationResult;
import com.dealflow.fulfillment.models.AllocationModel.Availability;
import com.dealflow.fulfillment.models.AllocationModel.Demand;
import com.dealflow.fulfillment.models.AllocationModel.WarehouseInfo;
import com.dealflow.orders.models.Order;
import com.dealflow.orders.models.OrderLine;
import com.dealflow.outbox.service.OutboxWriter;
import com.dealflow.quotes.models.QuoteEnums.BackorderTerms;
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
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Turns an allocation plan into actual held stock.
 *
 * <h2>The one rule that matters</h2>
 *
 * <p>A preview reads stock without locking anything. Reservation re-reads the
 * same rows under {@code SELECT ... FOR UPDATE}, in a stable
 * {@code (variant, warehouse)} order, and decides again from those numbers.
 * Nothing that was read outside that lock is trusted — not the preview the rep
 * saw, not a WebSocket update, not a value cached a millisecond ago.
 *
 * <p>That is what makes the classic race safe: with ten units left, two reps
 * confirming at the same moment do not both get ten. The first transaction holds
 * the row; the second waits, re-reads zero, and either backorders or fails
 * according to the terms the customer actually accepted (edge cases E10, E09).
 *
 * <p>Reservation runs inside the caller's transaction, never its own. If billing
 * fails after stock is held, the reservation rolls back with it — there is no
 * state where inventory is committed to an order that was never created.
 */
@Service
public class AllocationService {

    private static final Logger log = LoggerFactory.getLogger(AllocationService.class);

    private final AllocationEngine engine;
    private final StockLevelRepository stockLevels;
    private final WarehouseRepository warehouses;
    private final ProductVariantRepository variants;
    private final ReservationRepository reservations;
    private final ShipmentRepository shipments;
    private final ShipmentLineRepository shipmentLines;
    private final BackorderRepository backorders;
    private final StockMovementRepository movements;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;
    private final AppProperties properties;

    public AllocationService(AllocationEngine engine, StockLevelRepository stockLevels,
                             WarehouseRepository warehouses, ProductVariantRepository variants,
                             ReservationRepository reservations, ShipmentRepository shipments,
                             ShipmentLineRepository shipmentLines, BackorderRepository backorders,
                             StockMovementRepository movements, AuditService audit,
                             OutboxWriter outbox, BusinessClock clock, AppProperties properties) {
        this.engine = engine;
        this.stockLevels = stockLevels;
        this.warehouses = warehouses;
        this.variants = variants;
        this.reservations = reservations;
        this.shipments = shipments;
        this.shipmentLines = shipmentLines;
        this.backorders = backorders;
        this.movements = movements;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
        this.properties = properties;
    }

    /**
     * Plans without holding anything.
     *
     * <p>Explicitly a preview: the numbers can change before confirmation, which
     * is exactly why confirmation does not reuse this result.
     */
    @Transactional(readOnly = true)
    public AllocationResult preview(List<OrderLine> orderLines) {
        List<Demand> demands = demandsFor(orderLines);
        if (demands.isEmpty()) {
            return engine.allocate(new AllocationInput(List.of(), List.of(), List.of(),
                    properties.allocation().mode(), properties.allocation().extraShipmentPenaltyMinor(),
                    properties.allocation().exhaustiveWarehouseLimit()));
        }
        Set<UUID> variantIds = demands.stream().map(Demand::variantId).collect(Collectors.toSet());
        List<Availability> availability = stockLevels.findByVariantIdIn(variantIds).stream()
                .map(level -> new Availability(level.getWarehouseId(), level.getVariantId(), level.available()))
                .toList();
        return engine.allocate(buildInput(demands, availability));
    }

    /**
     * Reserves stock for a freshly created order.
     *
     * <p>Joins the caller's transaction ({@code REQUIRED}) on purpose: order
     * creation, reservation and billing are one atomic unit.
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public AllocationResult reserveForOrder(Order order, List<OrderLine> orderLines, Actor actor) {
        List<Demand> demands = demandsFor(orderLines);
        if (demands.isEmpty()) {
            order.setFulfillmentStatus(Order.FulfillmentStatus.NOT_REQUIRED);
            return null;
        }

        Set<UUID> variantIds = demands.stream().map(Demand::variantId).collect(Collectors.toSet());
        // Authoritative read. Everything after this point reasons about locked rows.
        Map<StockKey, StockLevel> locked = lockStock(variantIds);

        List<Availability> availability = locked.values().stream()
                .map(level -> new Availability(level.getWarehouseId(), level.getVariantId(), level.available()))
                .toList();

        AllocationResult plan = engine.allocate(buildInput(demands, availability));

        if (plan.hasShortage() && order.getBackorderTerms() == BackorderTerms.IN_STOCK_ONLY) {
            // The customer accepted in-stock-only terms, so a partial order is
            // not something we may create. Failing here rolls back the whole
            // finalisation: no order, no reservation, no invoice (edge case E09).
            throw ApiException.of(ErrorCode.INSUFFICIENT_STOCK,
                    "There is not enough stock to fulfil this order completely, and it was accepted "
                            + "on in-stock-only terms.",
                    "shortages", plan.shortages().size());
        }

        applyPlan(order, orderLines, plan, locked, actor, clock.now());
        return plan;
    }

    /**
     * Re-allocates an order's unshipped remainder, typically after a receipt.
     *
     * <p>The order may re-use stock it already holds, so availability here is
     * {@code on_hand − everyone_else's_reservations}. Counting its own held
     * stock against itself would make a replan look impossible (test T12).
     *
     * <p>Dispatched quantities are never touched.
     */
    @Transactional
    public AllocationResult replan(Order order, List<OrderLine> orderLines, Actor actor) {
        List<Backorder> open = backorders.findOpenForOrder(order.getId());
        if (open.isEmpty()) {
            return null;
        }
        Map<UUID, OrderLine> linesById = orderLines.stream()
                .collect(Collectors.toMap(OrderLine::getId, line -> line));

        List<Demand> demands = new ArrayList<>();
        Map<UUID, ProductVariant> variantsById = loadVariants(
                open.stream().map(Backorder::getVariantId).collect(Collectors.toSet()));
        for (Backorder backorder : open) {
            OrderLine line = linesById.get(backorder.getOrderLineId());
            if (line == null) {
                continue;
            }
            ProductVariant variant = variantsById.get(backorder.getVariantId());
            demands.add(new Demand(line.getLineKey(), line.getId(), backorder.getVariantId(),
                    line.getDescription(), backorder.getQuantity(),
                    variant == null ? 0 : variant.getWeightGrams()));
        }
        if (demands.isEmpty()) {
            return null;
        }

        Set<UUID> variantIds = demands.stream().map(Demand::variantId).collect(Collectors.toSet());
        Map<StockKey, StockLevel> locked = lockStock(variantIds);

        List<Availability> availability = locked.values().stream()
                .map(level -> {
                    BigDecimal ownHeld = reservations.sumOwnHeld(order.getId(),
                            level.getVariantId(), level.getWarehouseId());
                    return new Availability(level.getWarehouseId(), level.getVariantId(),
                            level.available().add(ownHeld == null ? BigDecimal.ZERO : ownHeld));
                })
                .toList();

        AllocationResult plan = engine.allocate(buildInput(demands, availability));
        if (plan.allocations().isEmpty()) {
            return plan;
        }

        Instant now = clock.now();
        applyAllocations(order, linesById, plan, locked, now);
        reduceBackorders(open, plan, now);
        recomputeFulfillmentStatus(order, orderLines);

        audit.record(actor, "ORDER_REPLANNED", "Order", order.getId())
                .order(order.getId())
                .after(Map.of("newlyAllocated", plan.allocations().size(),
                        "remainingShortages", plan.shortages().size()))
                .save();

        outbox.publish(OutboxWriter.Events.ALLOCATION_UPDATED, "Order", order.getId(),
                order.getRowVersion(), Map.of("replanned", true),
                OutboxWriter.RecipientScope.deal(order.getCustomerId(), order.getOwnerProfileId(), null));
        return plan;
    }

    // -------------------------------------------------------------- helpers

    private record StockKey(UUID variantId, UUID warehouseId) {
    }

    /**
     * Locks every stock row for these variants, in a stable order.
     *
     * <p>Ordering by {@code (variant, warehouse)} means two orders touching the
     * same SKUs always take the rows in the same sequence, so they queue rather
     * than deadlock.
     */
    private Map<StockKey, StockLevel> lockStock(Set<UUID> variantIds) {
        Map<StockKey, StockLevel> locked = new LinkedHashMap<>();
        for (StockLevel level : stockLevels.lockByVariantIds(variantIds)) {
            locked.put(new StockKey(level.getVariantId(), level.getWarehouseId()), level);
        }
        return locked;
    }

    private AllocationInput buildInput(List<Demand> demands, List<Availability> availability) {
        List<WarehouseInfo> warehouseInfos = warehouses.findByActiveTrueOrderBySortOrderAscCodeAsc().stream()
                .map(warehouse -> new WarehouseInfo(warehouse.getId(), warehouse.getCode(),
                        warehouse.getName(), warehouse.getShippingFixedCostMinor(),
                        warehouse.getShippingCostPerKgMinor(), warehouse.getSortOrder()))
                .toList();
        return new AllocationInput(demands, availability, warehouseInfos,
                properties.allocation().mode(),
                properties.allocation().extraShipmentPenaltyMinor(),
                properties.allocation().exhaustiveWarehouseLimit());
    }

    private List<Demand> demandsFor(List<OrderLine> orderLines) {
        List<OrderLine> stocked = orderLines.stream()
                .filter(line -> line.isRequiresStock() && line.getVariantId() != null)
                .toList();
        if (stocked.isEmpty()) {
            return List.of();
        }
        Map<UUID, ProductVariant> variantsById = loadVariants(
                stocked.stream().map(OrderLine::getVariantId).collect(Collectors.toSet()));

        return stocked.stream()
                .map(line -> {
                    ProductVariant variant = variantsById.get(line.getVariantId());
                    return new Demand(line.getLineKey(), line.getId(), line.getVariantId(),
                            line.getDescription(), line.getQuantity(),
                            variant == null ? 0 : variant.getWeightGrams());
                })
                .toList();
    }

    private Map<UUID, ProductVariant> loadVariants(Set<UUID> variantIds) {
        if (variantIds.isEmpty()) {
            return Map.of();
        }
        return variants.findAllById(variantIds).stream()
                .collect(Collectors.toMap(ProductVariant::getId, variant -> variant));
    }

    /** Writes reservations, shipments and shortages for a freshly planned order. */
    private void applyPlan(Order order, List<OrderLine> orderLines, AllocationResult plan,
                           Map<StockKey, StockLevel> locked, Actor actor, Instant now) {
        Map<UUID, OrderLine> linesById = orderLines.stream()
                .collect(Collectors.toMap(OrderLine::getId, line -> line));

        applyAllocations(order, linesById, plan, locked, now);
        createBackorders(order, linesById, plan, locked);
        recomputeFulfillmentStatus(order, orderLines);

        audit.record(actor, "ORDER_ALLOCATED", "Order", order.getId())
                .order(order.getId())
                .after(Map.of("shipments", plan.shipmentCount(),
                        "shortages", plan.shortages().size(),
                        "estimatedShippingCostMinor", plan.estimatedShippingCostMinor()))
                .save();
    }

    /**
     * Holds the planned quantities.
     *
     * <p>Increments {@code reserved} on the locked row and records a reservation
     * for the same amount, so the counter and the rows that explain it move
     * together. The database CHECK on {@code reserved <= on_hand} is the final
     * word if anything here is wrong.
     */
    private void applyAllocations(Order order, Map<UUID, OrderLine> linesById, AllocationResult plan,
                                  Map<StockKey, StockLevel> locked, Instant now) {
        Map<UUID, Shipment> shipmentByWarehouse = new HashMap<>();
        shipments.findOpenForOrder(order.getId())
                .forEach(shipment -> shipmentByWarehouse.put(shipment.getWarehouseId(), shipment));

        Map<UUID, Long> shippingCostByWarehouse = warehouses.findByActiveTrueOrderBySortOrderAscCodeAsc()
                .stream().collect(Collectors.toMap(Warehouse::getId, Warehouse::getShippingFixedCostMinor));

        for (AllocationModel.AllocationLine allocation : plan.allocations()) {
            OrderLine orderLine = linesById.get(allocation.orderLineId());
            if (orderLine == null) {
                continue;
            }
            StockKey key = new StockKey(allocation.variantId(), allocation.warehouseId());
            StockLevel level = locked.get(key);
            if (level == null) {
                throw new ApiException(ErrorCode.INSUFFICIENT_STOCK,
                        "Stock for \"" + allocation.description() + "\" is no longer available at "
                                + allocation.warehouseName() + ".");
            }
            if (level.available().compareTo(allocation.quantity()) < 0) {
                // The plan was built from these same locked rows, so this should
                // be unreachable; refusing loudly beats overselling quietly.
                throw new ApiException(ErrorCode.INSUFFICIENT_STOCK,
                        "Stock for \"" + allocation.description() + "\" changed while the order was "
                                + "being confirmed. Try again.");
            }

            level.setReserved(level.getReserved().add(allocation.quantity()));

            Shipment shipment = shipmentByWarehouse.computeIfAbsent(allocation.warehouseId(), warehouseId ->
                    shipments.save(new Shipment(order.getId(), warehouseId,
                            shippingCostByWarehouse.getOrDefault(warehouseId, 0L))));

            ShipmentLine shipmentLine = shipmentLines
                    .findByShipmentIdAndOrderLineId(shipment.getId(), orderLine.getId())
                    .orElse(null);
            if (shipmentLine == null) {
                shipmentLine = shipmentLines.save(new ShipmentLine(shipment.getId(), orderLine.getId(),
                        allocation.variantId(), allocation.quantity()));
            } else {
                // Consolidating into a parcel that is already waiting to go out.
                shipmentLine.setQuantity(shipmentLine.getQuantity().add(allocation.quantity()));
            }

            Reservation reservation = new Reservation(order.getId(), orderLine.getId(),
                    allocation.warehouseId(), allocation.variantId(), allocation.quantity());
            reservation.setShipmentLineId(shipmentLine.getId());
            reservations.save(reservation);
        }
    }

    /** Records shortages, dating them only from a real expected receipt. */
    private void createBackorders(Order order, Map<UUID, OrderLine> linesById, AllocationResult plan,
                                  Map<StockKey, StockLevel> locked) {
        for (AllocationModel.Shortage shortage : plan.shortages()) {
            OrderLine orderLine = linesById.get(shortage.orderLineId());
            if (orderLine == null) {
                continue;
            }
            Backorder backorder = new Backorder(order.getId(), orderLine.getId(),
                    shortage.variantId(), shortage.quantity());
            backorder.setExpectedDate(earliestExpectedReceipt(locked, shortage.variantId()));
            backorders.save(backorder);
        }
    }

    /** Reduces or closes shortages that a replan has now covered. */
    private void reduceBackorders(List<Backorder> open, AllocationResult plan, Instant now) {
        Map<UUID, BigDecimal> allocatedByLine = new HashMap<>();
        plan.allocations().forEach(allocation ->
                allocatedByLine.merge(allocation.orderLineId(), allocation.quantity(), BigDecimal::add));

        for (Backorder backorder : open) {
            BigDecimal covered = allocatedByLine.get(backorder.getOrderLineId());
            if (covered == null || covered.signum() <= 0) {
                continue;
            }
            BigDecimal remaining = backorder.getQuantity().subtract(covered);
            if (remaining.signum() <= 0) {
                backorder.resolve(now);
            } else {
                backorder.setQuantity(remaining);
            }
        }
    }

    /**
     * Derives the order's fulfilment state from what is actually reserved and
     * dispatched, rather than setting a label by hand.
     */
    void recomputeFulfillmentStatus(Order order, List<OrderLine> orderLines) {
        List<OrderLine> stocked = orderLines.stream()
                .filter(line -> line.isRequiresStock() && line.getVariantId() != null)
                .toList();
        if (stocked.isEmpty()) {
            order.setFulfillmentStatus(Order.FulfillmentStatus.NOT_REQUIRED);
            return;
        }

        BigDecimal ordered = stocked.stream()
                .map(OrderLine::getQuantity).reduce(BigDecimal.ZERO, BigDecimal::add);

        BigDecimal held = BigDecimal.ZERO;
        BigDecimal dispatched = BigDecimal.ZERO;
        for (Reservation reservation : reservations.findByOrderId(order.getId())) {
            switch (reservation.getStatus()) {
                case HELD -> held = held.add(reservation.getQuantity());
                case CONSUMED -> dispatched = dispatched.add(reservation.getQuantity());
                case RELEASED -> { }
            }
        }

        if (dispatched.compareTo(ordered) >= 0) {
            order.setFulfillmentStatus(Order.FulfillmentStatus.DISPATCHED);
        } else if (dispatched.signum() > 0) {
            order.setFulfillmentStatus(Order.FulfillmentStatus.PARTIALLY_DISPATCHED);
        } else if (held.compareTo(ordered) >= 0) {
            order.setFulfillmentStatus(Order.FulfillmentStatus.RESERVED);
        } else if (held.signum() > 0) {
            order.setFulfillmentStatus(Order.FulfillmentStatus.PARTIALLY_RESERVED);
        } else {
            order.setFulfillmentStatus(Order.FulfillmentStatus.UNALLOCATED);
        }
    }

    private java.time.LocalDate earliestExpectedReceipt(Map<StockKey, StockLevel> locked, UUID variantId) {
        return locked.values().stream()
                .filter(level -> level.getVariantId().equals(variantId))
                .map(StockLevel::getExpectedReceiptDate)
                .filter(java.util.Objects::nonNull)
                .min(java.time.LocalDate::compareTo)
                .orElse(null);
    }
}
