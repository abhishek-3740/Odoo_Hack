package com.dealflow.fulfillment.models;


import com.dealflow.fulfillment.repo.*;
import com.dealflow.fulfillment.service.*;
import com.dealflow.fulfillment.dto.*;
import com.dealflow.fulfillment.controller.*;
import com.dealflow.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * An append-only entry in the physical inventory ledger.
 *
 * <p>Reservations are not movements: holding stock for an order changes who may
 * take it, not how much is in the building. Only receipts, dispatches and
 * explicit adjustments appear here.
 *
 * <p>{@code requestKey} is unique where present, so replaying a goods receipt —
 * a double-clicked form, a retried request — cannot add the same stock twice
 * (test T11).
 */
@Entity
@Table(name = "stock_movements")
public class StockMovement extends BaseEntity {

    public enum MovementType {
        RECEIPT, DISPATCH, ADJUSTMENT
    }

    @Column(name = "variant_id", nullable = false, updatable = false)
    private UUID variantId;

    @Column(name = "warehouse_id", nullable = false, updatable = false)
    private UUID warehouseId;

    /** Signed: positive receives stock, negative dispatches it. */
    @Column(name = "quantity", nullable = false, updatable = false)
    private BigDecimal quantity;

    @Enumerated(EnumType.STRING)
    @Column(name = "movement_type", nullable = false, updatable = false)
    private MovementType movementType;

    @Column(name = "reference_type")
    private String referenceType;

    @Column(name = "reference_id")
    private UUID referenceId;

    @Column(name = "request_key", unique = true)
    private String requestKey;

    @Column(name = "note")
    private String note;

    @Column(name = "actor_profile_id")
    private UUID actorProfileId;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    protected StockMovement() {
    }

    public StockMovement(UUID variantId, UUID warehouseId, BigDecimal quantity,
                         MovementType movementType, Instant occurredAt) {
        this.variantId = variantId;
        this.warehouseId = warehouseId;
        this.quantity = quantity;
        this.movementType = movementType;
        this.occurredAt = occurredAt;
    }

    public void setReference(String referenceType, UUID referenceId) {
        this.referenceType = referenceType;
        this.referenceId = referenceId;
    }

    public void setRequestKey(String requestKey) {
        this.requestKey = requestKey;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public void setActorProfileId(UUID actorProfileId) {
        this.actorProfileId = actorProfileId;
    }

    public UUID getVariantId() {
        return variantId;
    }

    public UUID getWarehouseId() {
        return warehouseId;
    }

    public BigDecimal getQuantity() {
        return quantity;
    }

    public MovementType getMovementType() {
        return movementType;
    }

    public String getReferenceType() {
        return referenceType;
    }

    public UUID getReferenceId() {
        return referenceId;
    }

    public String getRequestKey() {
        return requestKey;
    }

    public String getNote() {
        return note;
    }

    public UUID getActorProfileId() {
        return actorProfileId;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }
}
