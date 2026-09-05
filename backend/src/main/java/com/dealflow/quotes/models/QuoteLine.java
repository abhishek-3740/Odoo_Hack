package com.dealflow.quotes.models;


import com.dealflow.quotes.repo.*;
import com.dealflow.quotes.service.*;
import com.dealflow.quotes.dto.*;
import com.dealflow.quotes.controller.*;
import com.dealflow.quotes.models.QuoteEnums.LineSource;
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
 * One priced line on one revision.
 *
 * <p>{@code lineKey} is stable across revisions. That is what lets a customer
 * comment on "the setup service" and have the comment still point at the right
 * thing after the rep re-quotes it twice: the revision changes, the line key
 * does not.
 *
 * <p>Prices, costs and tax rates are frozen copies, not references. Repricing
 * the catalogue next week must not silently restate what was quoted today.
 */
@Entity
@Table(name = "quote_lines")
public class QuoteLine extends BaseEntity {

    @Column(name = "revision_id", nullable = false, updatable = false)
    private UUID revisionId;

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

    @Column(name = "line_discount_bp", nullable = false)
    private int lineDiscountBp;

    @Column(name = "applied_order_discount_bp", nullable = false)
    private int appliedOrderDiscountBp;

    /** The combined effect: 1 − (1−line)(1−order). What risk routing judges. */
    @Column(name = "effective_discount_bp", nullable = false)
    private int effectiveDiscountBp;

    @Column(name = "base_minor", nullable = false)
    private long baseMinor;

    @Column(name = "net_minor", nullable = false)
    private long netMinor;

    @Column(name = "tax_minor", nullable = false)
    private long taxMinor;

    @Column(name = "cost_total_minor", nullable = false)
    private long costTotalMinor;

    @Column(name = "margin_minor", nullable = false)
    private long marginMinor;

    @Column(name = "interval_months")
    private Integer intervalMonths;

    @Column(name = "requires_stock", nullable = false)
    private boolean requiresStock;

    @Column(name = "promised_date")
    private LocalDate promisedDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "source", nullable = false)
    private LineSource source = LineSource.MANUAL;

    protected QuoteLine() {
    }

    public QuoteLine(UUID revisionId, String lineKey, int position) {
        this.revisionId = revisionId;
        this.lineKey = lineKey;
        this.position = position;
    }

    public UUID getRevisionId() {
        return revisionId;
    }

    public String getLineKey() {
        return lineKey;
    }

    public int getPosition() {
        return position;
    }

    public void setPosition(int position) {
        this.position = position;
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

    public int getLineDiscountBp() {
        return lineDiscountBp;
    }

    public void setLineDiscountBp(int lineDiscountBp) {
        this.lineDiscountBp = lineDiscountBp;
    }

    public int getAppliedOrderDiscountBp() {
        return appliedOrderDiscountBp;
    }

    public void setAppliedOrderDiscountBp(int appliedOrderDiscountBp) {
        this.appliedOrderDiscountBp = appliedOrderDiscountBp;
    }

    public int getEffectiveDiscountBp() {
        return effectiveDiscountBp;
    }

    public void setEffectiveDiscountBp(int effectiveDiscountBp) {
        this.effectiveDiscountBp = effectiveDiscountBp;
    }

    public long getBaseMinor() {
        return baseMinor;
    }

    public void setBaseMinor(long baseMinor) {
        this.baseMinor = baseMinor;
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

    public long getCostTotalMinor() {
        return costTotalMinor;
    }

    public void setCostTotalMinor(long costTotalMinor) {
        this.costTotalMinor = costTotalMinor;
    }

    public long getMarginMinor() {
        return marginMinor;
    }

    public void setMarginMinor(long marginMinor) {
        this.marginMinor = marginMinor;
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

    public LineSource getSource() {
        return source;
    }

    public void setSource(LineSource source) {
        this.source = source;
    }
}
