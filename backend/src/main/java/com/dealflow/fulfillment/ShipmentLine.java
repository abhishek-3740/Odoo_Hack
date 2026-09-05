package com.dealflow.fulfillment;

import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.UUID;

/** A quantity of one order line travelling in one shipment. */
@Entity
@Table(name = "shipment_lines")
public class ShipmentLine extends TimestampedEntity {

    @Column(name = "shipment_id", nullable = false, updatable = false)
    private UUID shipmentId;

    @Column(name = "order_line_id", nullable = false, updatable = false)
    private UUID orderLineId;

    @Column(name = "variant_id", nullable = false, updatable = false)
    private UUID variantId;

    @Column(name = "quantity", nullable = false)
    private BigDecimal quantity;

    protected ShipmentLine() {
    }

    public ShipmentLine(UUID shipmentId, UUID orderLineId, UUID variantId, BigDecimal quantity) {
        this.shipmentId = shipmentId;
        this.orderLineId = orderLineId;
        this.variantId = variantId;
        this.quantity = quantity;
    }

    public UUID getShipmentId() {
        return shipmentId;
    }

    public UUID getOrderLineId() {
        return orderLineId;
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
}
