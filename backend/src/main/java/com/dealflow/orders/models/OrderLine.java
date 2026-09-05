package com.dealflow.orders.models;


import com.dealflow.orders.repo.*;
import com.dealflow.orders.service.*;
import com.dealflow.orders.controller.*;
import com.dealflow.quotes.models.PricingModel.LineKind;
import com.dealflow.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * An immutable commercial snapshot of one accepted line.
 *
 * <p>Nothing here is edited after the order exists. A change of mind becomes an
 * adjustment charge, a credit note, or a subscription change with its own
 * record — never an UPDATE that quietly restates what was agreed.
 */
@Entity
@Table(name = "order_lines")
public class OrderLine extends BaseEntity {

    @Column(name = "order_id", nullable = false, updatable = false)
    private UUID orderId;

    @Column(name = "quote_line_id", nullable = false, updatable = false)
    private UUID quoteLineId;

    @Column(name = "line_key", nullable = false, updatable = false)
    private String lineKey;

    @Column(name = "position", nullable = false)
    private int position;

    @Enumerated(EnumType.STRING)
    @Column(name = "line_kind", nullable = false)
    private LineKind lineKind;

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Column(name = "category_id", nullable = false)
    private UUID categoryId;

    @Column(name = "variant_id")
    private UUID variantId;

    @Column(name = "plan_id")
    private UUID planId;

    @Column(name = "description", nullable = false)
    private String description;

    @Column(name = "quantity", nullable = false)
    private BigDecimal quantity;

    @Column(name = "unit_price_minor", nullable = false)
    private long unitPriceMinor;

    @Column(name = "unit_cost_minor", nullable = false)
    private long unitCostMinor;

    @Column(name = "tax_rate_bp", nullable = false)
    private int taxRateBp;

    @Column(name = "effective_discount_bp", nullable = false)
    private int effectiveDiscountBp;

    @Column(name = "net_minor", nullable = false)
    private long netMinor;

    @Column(name = "tax_minor", nullable = false)
    private long taxMinor;

    @Column(name = "interval_months")
    private Integer intervalMonths;

    @Column(name = "requires_stock", nullable = false)
    private boolean requiresStock;

    /** The delivery date promised to the customer, used by slippage detection. */
    @Column(name = "promised_date")
    private LocalDate promisedDate;

    protected OrderLine() {
    }

    public OrderLine(UUID orderId, UUID quoteLineId, String lineKey, int position) {
        this.orderId = orderId;
        this.quoteLineId = quoteLineId;
        this.lineKey = lineKey;
        this.position = position;
    }

    /** Discounted unit price, used when a recurring line becomes a subscription. */
    public long discountedUnitPriceMinor() {
        if (quantity == null || quantity.signum() == 0) {
            return 0L;
        }
        return BigDecimal.valueOf(netMinor)
                .divide(quantity, 0, java.math.RoundingMode.HALF_UP)
                .longValueExact();
    }

    public UUID getOrderId() {
        return orderId;
    }

    public UUID getQuoteLineId() {
        return quoteLineId;
    }

    public String getLineKey() {
        return lineKey;
    }

    public int getPosition() {
        return position;
    }

    public LineKind getLineKind() {
        return lineKind;
    }

    public void setLineKind(LineKind lineKind) {
        this.lineKind = lineKind;
    }

    public UUID getProductId() {
        return productId;
    }

    public void setProductId(UUID productId) {
        this.productId = productId;
    }

    public UUID getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(UUID categoryId) {
        this.categoryId = categoryId;
    }

    public UUID getVariantId() {
        return variantId;
    }

    public void setVariantId(UUID variantId) {
        this.variantId = variantId;
    }

    public UUID getPlanId() {
        return planId;
    }

    public void setPlanId(UUID planId) {
        this.planId = planId;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public BigDecimal getQuantity() {
        return quantity;
    }

    public void setQuantity(BigDecimal quantity) {
        this.quantity = quantity;
    }

    public long getUnitPriceMinor() {
        return unitPriceMinor;
    }

    public void setUnitPriceMinor(long unitPriceMinor) {
        this.unitPriceMinor = unitPriceMinor;
    }

    public long getUnitCostMinor() {
        return unitCostMinor;
    }

    public void setUnitCostMinor(long unitCostMinor) {
        this.unitCostMinor = unitCostMinor;
    }

    public int getTaxRateBp() {
        return taxRateBp;
    }

    public void setTaxRateBp(int taxRateBp) {
        this.taxRateBp = taxRateBp;
    }

    public int getEffectiveDiscountBp() {
        return effectiveDiscountBp;
    }

    public void setEffectiveDiscountBp(int effectiveDiscountBp) {
        this.effectiveDiscountBp = effectiveDiscountBp;
    }

    public long getNetMinor() {
        return netMinor;
    }

    public void setNetMinor(long netMinor) {
        this.netMinor = netMinor;
    }

    public long getTaxMinor() {
        return taxMinor;
    }

    public void setTaxMinor(long taxMinor) {
        this.taxMinor = taxMinor;
    }

    public Integer getIntervalMonths() {
        return intervalMonths;
    }

    public void setIntervalMonths(Integer intervalMonths) {
        this.intervalMonths = intervalMonths;
    }

    public boolean isRequiresStock() {
        return requiresStock;
    }

    public void setRequiresStock(boolean requiresStock) {
        this.requiresStock = requiresStock;
    }

    public LocalDate getPromisedDate() {
        return promisedDate;
    }

    public void setPromisedDate(LocalDate promisedDate) {
        this.promisedDate = promisedDate;
    }
}
