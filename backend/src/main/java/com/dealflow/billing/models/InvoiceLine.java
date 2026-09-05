package com.dealflow.billing.models;


import com.dealflow.billing.repo.*;
import com.dealflow.billing.service.*;
import com.dealflow.billing.dto.*;
import com.dealflow.billing.controller.*;
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
 * One charge on an invoice.
 *
 * <h2>The charge key</h2>
 *
 * <p>{@code chargeKey} is UNIQUE across the entire database, and it is the whole
 * idempotency story for recurring billing. Its shape:
 *
 * <pre>sub:&lt;subscriptionId&gt;|&lt;coverageStart&gt;|&lt;coverageEnd&gt;|&lt;type&gt;|&lt;base|changeId&gt;</pre>
 *
 * <p>Because the key encodes exactly which service period is being charged for,
 * the billing job can run twice, run concurrently with itself, or catch up after
 * a week of downtime, and each interval is still charged exactly once. The second
 * attempt hits the unique index and rolls back (test T19).
 *
 * <p>{@code coverageStart}/{@code coverageEnd} are also what make a later credit
 * provably correct: cancellation credits the unused part of each stored segment,
 * so the same days cannot be credited twice.
 */
@Entity
@Table(name = "invoice_lines")
public class InvoiceLine extends BaseEntity {

    public enum LineType {
        ONE_TIME, RECURRING, PRORATION
    }

    @Column(name = "invoice_id", nullable = false, updatable = false)
    private UUID invoiceId;

    @Column(name = "order_line_id")
    private UUID orderLineId;

    @Column(name = "subscription_id")
    private UUID subscriptionId;

    @Column(name = "position", nullable = false)
    private int position;

    @Column(name = "description", nullable = false)
    private String description;

    @Column(name = "quantity", nullable = false)
    private BigDecimal quantity;

    @Column(name = "unit_price_minor", nullable = false)
    private long unitPriceMinor;

    @Column(name = "net_minor", nullable = false)
    private long netMinor;

    @Column(name = "tax_rate_bp", nullable = false)
    private int taxRateBp;

    @Column(name = "tax_minor", nullable = false)
    private long taxMinor;

    @Column(name = "coverage_start")
    private LocalDate coverageStart;

    @Column(name = "coverage_end")
    private LocalDate coverageEnd;

    @Enumerated(EnumType.STRING)
    @Column(name = "line_type", nullable = false)
    private LineType lineType = LineType.ONE_TIME;

    @Column(name = "charge_key", unique = true)
    private String chargeKey;

    protected InvoiceLine() {
    }

    public InvoiceLine(UUID invoiceId, String description, BigDecimal quantity,
                       long unitPriceMinor, long netMinor, int taxRateBp, long taxMinor) {
        this.invoiceId = invoiceId;
        this.description = description;
        this.quantity = quantity;
        this.unitPriceMinor = unitPriceMinor;
        this.netMinor = netMinor;
        this.taxRateBp = taxRateBp;
        this.taxMinor = taxMinor;
    }

    /** Builds the unique key for a recurring period charge. */
    public static String periodChargeKey(UUID subscriptionId, LocalDate start, LocalDate end) {
        return "sub:" + subscriptionId + "|" + start + "|" + end + "|RECURRING|base";
    }

    /** Builds the unique key for a mid-period adjustment tied to one change. */
    public static String adjustmentChargeKey(UUID subscriptionId, LocalDate start, LocalDate end,
                                             UUID changeId) {
        return "sub:" + subscriptionId + "|" + start + "|" + end + "|PRORATION|" + changeId;
    }

    /** Builds the unique key for an order's one-time invoice line. */
    public static String oneTimeChargeKey(UUID orderLineId) {
        return "order-line:" + orderLineId + "|ONE_TIME|base";
    }

    public UUID getInvoiceId() {
        return invoiceId;
    }

    public UUID getOrderLineId() {
        return orderLineId;
    }

    public void setOrderLineId(UUID orderLineId) {
        this.orderLineId = orderLineId;
    }

    public UUID getSubscriptionId() {
        return subscriptionId;
    }

    public void setSubscriptionId(UUID subscriptionId) {
        this.subscriptionId = subscriptionId;
    }

    public int getPosition() {
        return position;
    }

    public void setPosition(int position) {
        this.position = position;
    }

    public String getDescription() {
        return description;
    }

    public BigDecimal getQuantity() {
        return quantity;
    }

    public long getUnitPriceMinor() {
        return unitPriceMinor;
    }

    public long getNetMinor() {
        return netMinor;
    }

    public int getTaxRateBp() {
        return taxRateBp;
    }

    public long getTaxMinor() {
        return taxMinor;
    }

    public LocalDate getCoverageStart() {
        return coverageStart;
    }

    public LocalDate getCoverageEnd() {
        return coverageEnd;
    }

    public void setCoverage(LocalDate start, LocalDate end) {
        this.coverageStart = start;
        this.coverageEnd = end;
    }

    public LineType getLineType() {
        return lineType;
    }

    public void setLineType(LineType lineType) {
        this.lineType = lineType;
    }

    public String getChargeKey() {
        return chargeKey;
    }

    public void setChargeKey(String chargeKey) {
        this.chargeKey = chargeKey;
    }
}
