package com.dealflow.fulfillment.models;


import com.dealflow.fulfillment.repo.*;
import com.dealflow.fulfillment.service.*;
import com.dealflow.fulfillment.dto.*;
import com.dealflow.fulfillment.controller.*;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * Stock held for one order line, at one warehouse, not yet dispatched.
 *
 * <p>The sum of {@code HELD} reservations for a (variant, warehouse) is exactly
 * the {@code reserved} figure on its stock row. Dispatch turns a reservation
 * {@code CONSUMED} and decrements on-hand and reserved by the same amount, in
 * one movement, so the two never drift apart.
 *
 * <p>Keeping these as rows rather than a single counter is what makes replanning
 * possible: when the order is re-allocated after a receipt, its own held stock
 * is identifiable and can be re-used rather than double-counted against itself
 * (test T12).
 */
@Entity
@Table(name = "reservations")
public class Reservation extends TimestampedEntity {

    public enum ReservationStatus {
        HELD, CONSUMED, RELEASED
    }

    @Column(name = "order_id", nullable = false, updatable = false)
    private UUID orderId;

    @Column(name = "order_line_id", nullable = false, updatable = false)
    private UUID orderLineId;

    @Column(name = "shipment_line_id")
    private UUID shipmentLineId;

    @Column(name = "warehouse_id", nullable = false, updatable = false)
    private UUID warehouseId;

    @Column(name = "variant_id", nullable = false, updatable = false)
    private UUID variantId;

    @Column(name = "quantity", nullable = false)
    private BigDecimal quantity;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ReservationStatus status = ReservationStatus.HELD;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "released_at")
    private Instant releasedAt;

    protected Reservation() {
    }

    public Reservation(UUID orderId, UUID orderLineId, UUID warehouseId, UUID variantId,
                       BigDecimal quantity) {
        this.orderId = orderId;
        this.orderLineId = orderLineId;
        this.warehouseId = warehouseId;
        this.variantId = variantId;
        this.quantity = quantity;
    }

    public void consume(Instant when) {
        this.status = ReservationStatus.CONSUMED;
        this.consumedAt = when;
    }

    public void release(Instant when) {
        this.status = ReservationStatus.RELEASED;
        this.releasedAt = when;
    }

    public boolean isHeld() {
        return status == ReservationStatus.HELD;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public UUID getOrderLineId() {
        return orderLineId;
    }

    public UUID getShipmentLineId() {
        return shipmentLineId;
    }

    public void setShipmentLineId(UUID shipmentLineId) {
        this.shipmentLineId = shipmentLineId;
    }

    public UUID getWarehouseId() {
        return warehouseId;
    }

    public UUID getVariantId() {
        return variantId;
    }

    public BigDecimal getQuantity() {
        return quantity;
    }

    public void setQuantity(BigDecimal quantity) {
        this.quantity = quantity;
    }

    public ReservationStatus getStatus() {
        return status;
    }

    public Instant getConsumedAt() {
        return consumedAt;
    }

    public Instant getReleasedAt() {
        return releasedAt;
    }
}
