package com.dealflow.billing;

import com.dealflow.catalog.CatalogEnums.BillingAnchor;
import com.dealflow.catalog.CatalogEnums.CancellationPolicy;
import com.dealflow.catalog.CatalogEnums.ProrationPolicy;
import com.dealflow.shared.domain.TimestampedEntity;
import com.dealflow.shared.time.BusinessCalendar;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A live recurring commitment, created from one accepted recurring order line.
 *
 * <p>{@code unitIntervalPriceMinor} is the <em>accepted discounted</em> price,
 * frozen at confirmation. Every later charge, proration and credit is computed
 * at this rate — not at today's list price, and not at some recomputed blend
 * (edge case E14).
 *
 * <p>{@code anchorDay} is the day of month the schedule belongs to. Boundaries
 * are always derived from it, so a 31st anchor clamps to 28 or 29 in February
 * and returns to the 31st in March rather than drifting down permanently.
 */
@Entity
@Table(name = "subscriptions")
public class Subscription extends TimestampedEntity {

    public enum SubscriptionStatus {
        PENDING_ACTIVATION, ACTIVE, CANCEL_AT_PERIOD_END, CANCELED;

        public boolean isLive() {
            return this == ACTIVE || this == CANCEL_AT_PERIOD_END;
        }
    }

    @Column(name = "reference", nullable = false, unique = true, updatable = false)
    private String reference;

    @Column(name = "order_id", nullable = false, updatable = false)
    private UUID orderId;

    @Column(name = "order_line_id", nullable = false, unique = true, updatable = false)
    private UUID orderLineId;

    @Column(name = "customer_id", nullable = false, updatable = false)
    private UUID customerId;

    @Column(name = "plan_id", nullable = false)
    private UUID planId;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "quantity", nullable = false)
    private BigDecimal quantity;

    @Column(name = "unit_interval_price_minor", nullable = false)
    private long unitIntervalPriceMinor;

    @Column(name = "unit_interval_cost_minor", nullable = false)
    private long unitIntervalCostMinor;

    @Column(name = "tax_rate_bp", nullable = false)
    private int taxRateBp;

    @Column(name = "interval_months", nullable = false)
    private int intervalMonths;

    @Column(name = "anchor_day")
    private Integer anchorDay;

    @Enumerated(EnumType.STRING)
    @Column(name = "billing_anchor", nullable = false)
    private BillingAnchor billingAnchor = BillingAnchor.ACTIVATION_DATE;

    @Column(name = "activation_date", nullable = false)
    private LocalDate activationDate;

    @Column(name = "period_start", nullable = false)
    private LocalDate periodStart;

    @Column(name = "period_end", nullable = false)
    private LocalDate periodEnd;

    /** The business date the next charge becomes due. Null once cancelled. */
    @Column(name = "next_bill_at")
    private LocalDate nextBillAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private SubscriptionStatus status = SubscriptionStatus.PENDING_ACTIVATION;

    @Column(name = "cancel_effective_date")
    private LocalDate cancelEffectiveDate;

    @Column(name = "canceled_at")
    private Instant canceledAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "proration_policy", nullable = false)
    private ProrationPolicy prorationPolicy = ProrationPolicy.IMMEDIATE_PRORATED;

    @Enumerated(EnumType.STRING)
    @Column(name = "cancellation_policy", nullable = false)
    private CancellationPolicy cancellationPolicy = CancellationPolicy.END_OF_PERIOD;

    /** Always NONE in this build; see {@code SubscriptionPlan.clawbackPolicy}. */
    @Column(name = "clawback_policy", nullable = false)
    private String clawbackPolicy = "NONE";

    @Version
    @Column(name = "row_version", nullable = false)
    private long rowVersion;

    protected Subscription() {
    }

    public Subscription(String reference, UUID orderId, UUID orderLineId, UUID customerId,
                        UUID planId, String currency, BigDecimal quantity,
                        long unitIntervalPriceMinor, int intervalMonths, LocalDate activationDate) {
        this.reference = reference;
        this.orderId = orderId;
        this.orderLineId = orderLineId;
        this.customerId = customerId;
        this.planId = planId;
        this.currency = currency;
        this.quantity = quantity;
        this.unitIntervalPriceMinor = unitIntervalPriceMinor;
        this.intervalMonths = intervalMonths;
        this.activationDate = activationDate;
    }

    /** Full interval value at the current quantity, before tax. */
    public long intervalNetMinor() {
        return quantity.multiply(BigDecimal.valueOf(unitIntervalPriceMinor))
                .setScale(0, java.math.RoundingMode.HALF_UP).longValueExact();
    }

    /** Advances to the next period, deriving the boundary from the anchor. */
    public void advancePeriod() {
        int anchor = anchorDay == null ? periodEnd.getDayOfMonth() : anchorDay;
        this.periodStart = periodEnd;
        this.periodEnd = BusinessCalendar.nextBoundary(periodEnd, anchor, intervalMonths);
        this.nextBillAt = this.periodStart;
    }

    public String getReference() {
        return reference;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public UUID getOrderLineId() {
        return orderLineId;
    }

    public UUID getCustomerId() {
        return customerId;
    }

    public UUID getPlanId() {
        return planId;
    }

    public void setPlanId(UUID planId) {
        this.planId = planId;
    }

    public String getCurrency() {
        return currency;
    }

    public BigDecimal getQuantity() {
        return quantity;
    }

    public void setQuantity(BigDecimal quantity) {
        this.quantity = quantity;
    }

    public long getUnitIntervalPriceMinor() {
        return unitIntervalPriceMinor;
    }

    public void setUnitIntervalPriceMinor(long unitIntervalPriceMinor) {
        this.unitIntervalPriceMinor = unitIntervalPriceMinor;
    }

    public long getUnitIntervalCostMinor() {
        return unitIntervalCostMinor;
    }

    public void setUnitIntervalCostMinor(long unitIntervalCostMinor) {
        this.unitIntervalCostMinor = unitIntervalCostMinor;
    }

    public int getTaxRateBp() {
        return taxRateBp;
    }

    public void setTaxRateBp(int taxRateBp) {
        this.taxRateBp = taxRateBp;
    }

    public int getIntervalMonths() {
        return intervalMonths;
    }

    public void setIntervalMonths(int intervalMonths) {
        this.intervalMonths = intervalMonths;
    }

    public Integer getAnchorDay() {
        return anchorDay;
    }

    public void setAnchorDay(Integer anchorDay) {
        this.anchorDay = anchorDay;
    }

    public BillingAnchor getBillingAnchor() {
        return billingAnchor;
    }

    public void setBillingAnchor(BillingAnchor billingAnchor) {
        this.billingAnchor = billingAnchor;
    }

    public LocalDate getActivationDate() {
        return activationDate;
    }

    public void setActivationDate(LocalDate activationDate) {
        this.activationDate = activationDate;
    }

    public LocalDate getPeriodStart() {
        return periodStart;
    }

    public void setPeriodStart(LocalDate periodStart) {
        this.periodStart = periodStart;
    }

    public LocalDate getPeriodEnd() {
        return periodEnd;
    }

    public void setPeriodEnd(LocalDate periodEnd) {
        this.periodEnd = periodEnd;
    }

    public LocalDate getNextBillAt() {
        return nextBillAt;
    }

    public void setNextBillAt(LocalDate nextBillAt) {
        this.nextBillAt = nextBillAt;
    }

    public SubscriptionStatus getStatus() {
        return status;
    }

    public void setStatus(SubscriptionStatus status) {
        this.status = status;
    }

    public LocalDate getCancelEffectiveDate() {
        return cancelEffectiveDate;
    }

    public void setCancelEffectiveDate(LocalDate cancelEffectiveDate) {
        this.cancelEffectiveDate = cancelEffectiveDate;
    }

    public Instant getCanceledAt() {
        return canceledAt;
    }

    public void setCanceledAt(Instant canceledAt) {
        this.canceledAt = canceledAt;
    }

    public ProrationPolicy getProrationPolicy() {
        return prorationPolicy;
    }

    public void setProrationPolicy(ProrationPolicy prorationPolicy) {
        this.prorationPolicy = prorationPolicy;
    }

    public CancellationPolicy getCancellationPolicy() {
        return cancellationPolicy;
    }

    public void setCancellationPolicy(CancellationPolicy cancellationPolicy) {
        this.cancellationPolicy = cancellationPolicy;
    }

    public String getClawbackPolicy() {
        return clawbackPolicy;
    }

    public void setClawbackPolicy(String clawbackPolicy) {
        this.clawbackPolicy = clawbackPolicy;
    }

    public long getRowVersion() {
        return rowVersion;
    }
}
