package com.dealflow.catalog.models;


import com.dealflow.catalog.repo.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.dto.*;
import com.dealflow.catalog.controller.*;
import com.dealflow.catalog.models.CatalogEnums.BillingAnchor;
import com.dealflow.catalog.models.CatalogEnums.CancellationPolicy;
import com.dealflow.catalog.models.CatalogEnums.ProrationPolicy;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.util.UUID;

/**
 * A recurring plan: price per interval, and the rules for changing or ending it.
 *
 * <p>The price is per <em>interval</em>, not per month. A yearly plan at INR
 * 3,650 charges INR 3,650 once a year; dividing by twelve produces an MRR
 * figure for a report, never an invoice amount.
 */
@Entity
@Table(name = "subscription_plans")
public class SubscriptionPlan extends TimestampedEntity {

    @Column(name = "product_id", nullable = false)
    private UUID productId;

    @Column(name = "code", nullable = false, unique = true)
    private String code;

    @Column(name = "name", nullable = false)
    private String name;

    /** 1, 3 or 12 calendar months. Never 30, 90 or 365 days. */
    @Column(name = "interval_months", nullable = false)
    private int intervalMonths;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency = "INR";

    @Column(name = "interval_price_minor", nullable = false)
    private long intervalPriceMinor;

    @Column(name = "interval_cost_minor", nullable = false)
    private long intervalCostMinor;

    @Column(name = "tax_rate_bp", nullable = false)
    private int taxRateBp;

    @Enumerated(EnumType.STRING)
    @Column(name = "billing_anchor", nullable = false)
    private BillingAnchor billingAnchor = BillingAnchor.ACTIVATION_DATE;

    @Enumerated(EnumType.STRING)
    @Column(name = "proration_policy", nullable = false)
    private ProrationPolicy prorationPolicy = ProrationPolicy.IMMEDIATE_PRORATED;

    @Enumerated(EnumType.STRING)
    @Column(name = "cancellation_policy", nullable = false)
    private CancellationPolicy cancellationPolicy = CancellationPolicy.END_OF_PERIOD;

    /**
     * Always {@code NONE} in this build.
     *
     * <p>Cancelling a bundled support plan does not retroactively reprice the
     * hardware it was sold beside. Recovering a bundle discount would need an
     * explicit formula in the accepted terms and its own adjustment workflow;
     * inferring one from a generic discount would silently bill a customer for
     * something they never agreed to (edge case E14).
     */
    @Column(name = "clawback_policy", nullable = false)
    private String clawbackPolicy = "NONE";

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    protected SubscriptionPlan() {
    }

    public SubscriptionPlan(UUID productId, String code, String name, int intervalMonths,
                            long intervalPriceMinor, long intervalCostMinor) {
        this.productId = productId;
        this.code = code;
        this.name = name;
        this.intervalMonths = intervalMonths;
        this.intervalPriceMinor = intervalPriceMinor;
        this.intervalCostMinor = intervalCostMinor;
    }

    public UUID getProductId() {
        return productId;
    }

    public String getCode() {
        return code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public int getIntervalMonths() {
        return intervalMonths;
    }

    public void setIntervalMonths(int intervalMonths) {
        this.intervalMonths = intervalMonths;
    }

    public String getCurrency() {
        return currency;
    }

    public void setCurrency(String currency) {
        this.currency = currency;
    }

    public long getIntervalPriceMinor() {
        return intervalPriceMinor;
    }

    public void setIntervalPriceMinor(long intervalPriceMinor) {
        this.intervalPriceMinor = intervalPriceMinor;
    }

    public long getIntervalCostMinor() {
        return intervalCostMinor;
    }

    public void setIntervalCostMinor(long intervalCostMinor) {
        this.intervalCostMinor = intervalCostMinor;
    }

    public int getTaxRateBp() {
        return taxRateBp;
    }

    public void setTaxRateBp(int taxRateBp) {
        this.taxRateBp = taxRateBp;
    }

    public BillingAnchor getBillingAnchor() {
        return billingAnchor;
    }

    public void setBillingAnchor(BillingAnchor billingAnchor) {
        this.billingAnchor = billingAnchor;
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

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }
}
