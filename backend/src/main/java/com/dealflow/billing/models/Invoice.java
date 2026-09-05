package com.dealflow.billing.models;


import com.dealflow.billing.repo.*;
import com.dealflow.billing.service.*;
import com.dealflow.billing.dto.*;
import com.dealflow.billing.controller.*;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.LocalDate;
import java.util.UUID;

/**
 * A bill.
 *
 * <p>Issued amounts are immutable. {@code creditedMinor} and {@code paidMinor}
 * are running settlement figures maintained alongside their allocation rows, and
 * a database CHECK keeps their sum from exceeding the total — so neither a
 * credit nor a payment can drive a balance below zero.
 *
 * <p>Status is <em>derived</em> from those figures, never set independently. An
 * invoice is PAID because nothing is outstanding, not because someone marked it
 * so.
 */
@Entity
@Table(name = "invoices")
public class Invoice extends TimestampedEntity {

    public enum InvoiceKind {
        /** One-time lines from an order. */
        ONE_TIME,
        /** A recurring period charge. */
        RECURRING,
        /** A mid-period proration or correction. */
        ADJUSTMENT
    }

    public enum InvoiceStatus {
        DRAFT, ISSUED, PARTIALLY_PAID, PAID, VOID
    }

    @Column(name = "invoice_no", nullable = false, unique = true, updatable = false)
    private long invoiceNo;

    @Column(name = "reference", nullable = false, unique = true, updatable = false)
    private String reference;

    @Column(name = "customer_id", nullable = false, updatable = false)
    private UUID customerId;

    @Column(name = "order_id")
    private UUID orderId;

    @Column(name = "subscription_id")
    private UUID subscriptionId;

    @Enumerated(EnumType.STRING)
    @Column(name = "invoice_kind", nullable = false, updatable = false)
    private InvoiceKind invoiceKind;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private InvoiceStatus status = InvoiceStatus.DRAFT;

    @Column(name = "issue_date")
    private LocalDate issueDate;

    @Column(name = "due_date")
    private LocalDate dueDate;

    @Column(name = "net_minor", nullable = false)
    private long netMinor;

    @Column(name = "tax_minor", nullable = false)
    private long taxMinor;

    @Column(name = "total_minor", nullable = false)
    private long totalMinor;

    @Column(name = "credited_minor", nullable = false)
    private long creditedMinor;

    @Column(name = "paid_minor", nullable = false)
    private long paidMinor;

    @Version
    @Column(name = "row_version", nullable = false)
    private long rowVersion;

    protected Invoice() {
    }

    public Invoice(long invoiceNo, String reference, UUID customerId, InvoiceKind invoiceKind,
                   String currency) {
        this.invoiceNo = invoiceNo;
        this.reference = reference;
        this.customerId = customerId;
        this.invoiceKind = invoiceKind;
        this.currency = currency;
    }

    /** What is still owed: total less credits applied and payments allocated. */
    public long outstandingMinor() {
        return Math.max(0L, totalMinor - creditedMinor - paidMinor);
    }

    public void issue(LocalDate issueDate, LocalDate dueDate) {
        this.status = InvoiceStatus.ISSUED;
        this.issueDate = issueDate;
        this.dueDate = dueDate;
    }

    public void addLineTotals(long net, long tax) {
        this.netMinor += net;
        this.taxMinor += tax;
        this.totalMinor = this.netMinor + this.taxMinor;
    }

    /**
     * Recomputes status from the settlement figures.
     *
     * <p>A fully credited invoice counts as settled: the customer owes nothing,
     * which is a different fact from having paid, and both are visible because
     * the credited and paid figures are stored separately.
     */
    public void recomputeStatus() {
        if (status == InvoiceStatus.DRAFT || status == InvoiceStatus.VOID) {
            return;
        }
        long outstanding = outstandingMinor();
        if (outstanding == 0) {
            this.status = InvoiceStatus.PAID;
        } else if (paidMinor > 0 || creditedMinor > 0) {
            this.status = InvoiceStatus.PARTIALLY_PAID;
        } else {
            this.status = InvoiceStatus.ISSUED;
        }
    }

    public boolean acceptsSettlement() {
        return status == InvoiceStatus.ISSUED || status == InvoiceStatus.PARTIALLY_PAID;
    }

    public long getInvoiceNo() {
        return invoiceNo;
    }

    public String getReference() {
        return reference;
    }

    public UUID getCustomerId() {
        return customerId;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public void setOrderId(UUID orderId) {
        this.orderId = orderId;
    }

    public UUID getSubscriptionId() {
        return subscriptionId;
    }

    public void setSubscriptionId(UUID subscriptionId) {
        this.subscriptionId = subscriptionId;
    }

    public InvoiceKind getInvoiceKind() {
        return invoiceKind;
    }

    public String getCurrency() {
        return currency;
    }

    public InvoiceStatus getStatus() {
        return status;
    }

    public void setStatus(InvoiceStatus status) {
        this.status = status;
    }

    public LocalDate getIssueDate() {
        return issueDate;
    }

    public LocalDate getDueDate() {
        return dueDate;
    }

    public long getNetMinor() {
        return netMinor;
    }

    public long getTaxMinor() {
        return taxMinor;
    }

    public long getTotalMinor() {
        return totalMinor;
    }

    public long getCreditedMinor() {
        return creditedMinor;
    }

    public void addCredited(long amount) {
        this.creditedMinor += amount;
    }

    public long getPaidMinor() {
        return paidMinor;
    }

    public void addPaid(long amount) {
        this.paidMinor += amount;
    }

    public long getRowVersion() {
        return rowVersion;
    }
}
