package com.dealflow.fulfillment.models;


import com.dealflow.fulfillment.repo.*;
import com.dealflow.fulfillment.service.*;
import com.dealflow.fulfillment.dto.*;
import com.dealflow.fulfillment.controller.*;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Physical stock of one variant at one warehouse.
 *
 * <p>{@code onHand} is what is in the building. {@code reserved} is the part of
 * it already promised to confirmed orders. Free stock is the difference, and
 * database CHECK constraints refuse to let either go negative or let reserved
 * exceed on-hand.
 *
 * <p>Those constraints are a backstop, not the mechanism. Correctness comes from
 * re-reading these rows under a row lock inside the reservation transaction; the
 * constraints exist so that a bug in that path fails loudly rather than
 * overselling quietly.
 */
@Entity
@Table(name = "stock_levels")
public class StockLevel extends TimestampedEntity {

    @Column(name = "warehouse_id", nullable = false, updatable = false)
    private UUID warehouseId;

    @Column(name = "variant_id", nullable = false, updatable = false)
    private UUID variantId;

    @Column(name = "on_hand", nullable = false)
    private BigDecimal onHand = BigDecimal.ZERO;

    @Column(name = "reserved", nullable = false)
    private BigDecimal reserved = BigDecimal.ZERO;

    @Column(name = "reorder_point", nullable = false)
    private BigDecimal reorderPoint = BigDecimal.ZERO;

    @Column(name = "target_qty", nullable = false)
    private BigDecimal targetQty = BigDecimal.ZERO;

    /** A real expected receipt, or null. Never a fabricated date (edge case E09). */
    @Column(name = "expected_receipt_date")
    private LocalDate expectedReceiptDate;

    @Column(name = "expected_receipt_qty")
    private BigDecimal expectedReceiptQty;

    @Column(name = "row_version", nullable = false)
    private long rowVersion;

    protected StockLevel() {
    }

    public StockLevel(UUID warehouseId, UUID variantId) {
        this.warehouseId = warehouseId;
        this.variantId = variantId;
    }

    /** Stock nobody has claimed yet. */
    public BigDecimal available() {
        return onHand.subtract(reserved);
    }

    /** True when free stock has fallen to or below the configured reorder threshold. */
    public boolean needsReplenishment() {
        return reorderPoint.signum() > 0 && available().compareTo(reorderPoint) <= 0;
    }

    /** Suggested purchase quantity to reach the configured target. */
    public BigDecimal replenishmentSuggestion() {
        BigDecimal shortfall = targetQty.subtract(available());
        return shortfall.signum() > 0 ? shortfall : BigDecimal.ZERO;
    }

    public UUID getWarehouseId() {
        return warehouseId;
    }

    public UUID getVariantId() {
        return variantId;
    }

    public BigDecimal getOnHand() {
        return onHand;
    }

    public void setOnHand(BigDecimal onHand) {
        this.onHand = onHand;
    }

    public BigDecimal getReserved() {
        return reserved;
    }

    public void setReserved(BigDecimal reserved) {
        this.reserved = reserved;
    }

    public BigDecimal getReorderPoint() {
        return reorderPoint;
    }

    public void setReorderPoint(BigDecimal reorderPoint) {
        this.reorderPoint = reorderPoint;
    }

    public BigDecimal getTargetQty() {
        return targetQty;
    }

    public void setTargetQty(BigDecimal targetQty) {
        this.targetQty = targetQty;
    }

    public LocalDate getExpectedReceiptDate() {
        return expectedReceiptDate;
    }

    public void setExpectedReceiptDate(LocalDate expectedReceiptDate) {
        this.expectedReceiptDate = expectedReceiptDate;
    }

    public BigDecimal getExpectedReceiptQty() {
        return expectedReceiptQty;
    }

    public void setExpectedReceiptQty(BigDecimal expectedReceiptQty) {
        this.expectedReceiptQty = expectedReceiptQty;
    }

    public long getRowVersion() {
        return rowVersion;
    }

    public void setRowVersion(long rowVersion) {
        this.rowVersion = rowVersion;
    }
}
