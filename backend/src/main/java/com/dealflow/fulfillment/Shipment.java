package com.dealflow.fulfillment;

import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A parcel from one warehouse for one order.
 *
 * <p>A partial unique index keeps at most one <em>open</em> shipment per
 * (order, warehouse). That is what makes consolidation work: when stock arrives
 * and the order is replanned, the newly available units join the shipment that
 * is already waiting to go out rather than creating a second parcel to the same
 * address (test T12).
 */
@Entity
@Table(name = "shipments")
public class Shipment extends TimestampedEntity {

    public enum ShipmentStatus {
        DRAFT, RESERVED, DISPATCHED, CANCELED;

        public boolean isOpen() {
            return this == DRAFT || this == RESERVED;
        }
    }

    @Column(name = "order_id", nullable = false, updatable = false)
    private UUID orderId;

    @Column(name = "warehouse_id", nullable = false, updatable = false)
    private UUID warehouseId;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ShipmentStatus status = ShipmentStatus.RESERVED;

    @Column(name = "estimated_cost_minor", nullable = false)
    private long estimatedCostMinor;

    @Column(name = "dispatched_at")
    private Instant dispatchedAt;

    @Column(name = "dispatched_by_profile_id")
    private UUID dispatchedByProfileId;

    @Column(name = "tracking_reference")
    private String trackingReference;

    protected Shipment() {
    }

    public Shipment(UUID orderId, UUID warehouseId, long estimatedCostMinor) {
        this.orderId = orderId;
        this.warehouseId = warehouseId;
        this.estimatedCostMinor = estimatedCostMinor;
    }

    public void markDispatched(UUID profileId, Instant when, String trackingReference) {
        this.status = ShipmentStatus.DISPATCHED;
        this.dispatchedByProfileId = profileId;
        this.dispatchedAt = when;
        this.trackingReference = trackingReference;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public UUID getWarehouseId() {
        return warehouseId;
    }

    public ShipmentStatus getStatus() {
        return status;
    }

    public void setStatus(ShipmentStatus status) {
        this.status = status;
    }

    public long getEstimatedCostMinor() {
        return estimatedCostMinor;
    }

    public void setEstimatedCostMinor(long estimatedCostMinor) {
        this.estimatedCostMinor = estimatedCostMinor;
    }

    public Instant getDispatchedAt() {
        return dispatchedAt;
    }

    public UUID getDispatchedByProfileId() {
        return dispatchedByProfileId;
    }

    public String getTrackingReference() {
        return trackingReference;
    }
}
