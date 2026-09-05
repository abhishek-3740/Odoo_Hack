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
import java.time.LocalDate;
import java.util.UUID;

/**
 * A real, first-class shortage record.
 *
 * <p>Never inferred from a status label, and never given an invented delivery
 * date. {@code expectedDate} is populated only from an actual expected receipt;
 * where none exists the UI says "delivery date unconfirmed" rather than
 * fabricating an estimate (edge case E09).
 */
@Entity
@Table(name = "backorders")
public class Backorder extends TimestampedEntity {

    public enum BackorderStatus {
        OPEN, RESOLVED, CANCELED
    }

    @Column(name = "order_id", nullable = false, updatable = false)
    private UUID orderId;

    @Column(name = "order_line_id", nullable = false, updatable = false)
    private UUID orderLineId;

    @Column(name = "variant_id", nullable = false, updatable = false)
    private UUID variantId;

    @Column(name = "quantity", nullable = false)
    private BigDecimal quantity;

    @Column(name = "expected_date")
    private LocalDate expectedDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private BackorderStatus status = BackorderStatus.OPEN;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    protected Backorder() {
    }

    public Backorder(UUID orderId, UUID orderLineId, UUID variantId, BigDecimal quantity) {
        this.orderId = orderId;
        this.orderLineId = orderLineId;
        this.variantId = variantId;
        this.quantity = quantity;
    }

    public void resolve(Instant when) {
        this.status = BackorderStatus.RESOLVED;
        this.resolvedAt = when;
    }

    public UUID getOrderId() {
        return orderId;
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

    public LocalDate getExpectedDate() {
        return expectedDate;
    }

    public void setExpectedDate(LocalDate expectedDate) {
        this.expectedDate = expectedDate;
    }

    public BackorderStatus getStatus() {
        return status;
    }

    public void setStatus(BackorderStatus status) {
        this.status = status;
    }

    public Instant getResolvedAt() {
        return resolvedAt;
    }
}
