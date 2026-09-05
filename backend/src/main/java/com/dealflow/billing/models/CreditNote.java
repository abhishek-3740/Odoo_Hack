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
import java.time.LocalDate;
import java.util.UUID;

/**
 * A credit for service the customer has paid for and will not receive.
 *
 * <p>A credit note never deletes or edits an invoice — history stays intact and
 * the adjustment is visible as its own record.
 *
 * <p>The balance splits three ways and the split matters: {@code appliedMinor}
 * has reduced outstanding debt, {@code refundedMinor} has been paid back in
 * cash, and the remainder sits as customer credit. Only the last two can fund a
 * refund, and a refund is additionally capped by what the customer actually
 * paid: cancelling an unpaid subscription removes a debt, it does not generate
 * cash (edge case E17).
 */
@Entity
@Table(name = "credit_notes")
public class CreditNote extends TimestampedEntity {

    public enum CreditNoteStatus {
        ISSUED, PARTIALLY_APPLIED, APPLIED, VOID
    }

    @Column(name = "reference", nullable = false, unique = true, updatable = false)
    private String reference;

    @Column(name = "customer_id", nullable = false, updatable = false)
    private UUID customerId;

    @Column(name = "invoice_id")
    private UUID invoiceId;

    @Column(name = "subscription_id")
    private UUID subscriptionId;

    @Column(name = "subscription_change_id")
    private UUID subscriptionChangeId;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "reason", nullable = false)
    private String reason;

    @Column(name = "net_minor", nullable = false)
    private long netMinor;

    @Column(name = "tax_minor", nullable = false)
    private long taxMinor;

    @Column(name = "total_minor", nullable = false)
    private long totalMinor;

    @Column(name = "applied_minor", nullable = false)
    private long appliedMinor;

    @Column(name = "refunded_minor", nullable = false)
    private long refundedMinor;

    /** The service window being credited, so the same days cannot be credited twice. */
    @Column(name = "coverage_start")
    private LocalDate coverageStart;

    @Column(name = "coverage_end")
    private LocalDate coverageEnd;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private CreditNoteStatus status = CreditNoteStatus.ISSUED;

    @Column(name = "issued_by_profile_id")
    private UUID issuedByProfileId;

    protected CreditNote() {
    }

    public CreditNote(String reference, UUID customerId, String currency, String reason,
                      long netMinor, long taxMinor, UUID issuedByProfileId) {
        this.reference = reference;
        this.customerId = customerId;
        this.currency = currency;
        this.reason = reason;
        this.netMinor = netMinor;
        this.taxMinor = taxMinor;
        this.totalMinor = netMinor + taxMinor;
        this.issuedByProfileId = issuedByProfileId;
    }

    /** Not yet used against a debt and not yet refunded. */
    public long availableMinor() {
        return Math.max(0L, totalMinor - appliedMinor - refundedMinor);
    }

    public void applyToInvoice(long amount) {
        this.appliedMinor += amount;
        recomputeStatus();
    }

    public void recordRefund(long amount) {
        this.refundedMinor += amount;
        recomputeStatus();
    }

    private void recomputeStatus() {
        if (status == CreditNoteStatus.VOID) {
            return;
        }
        long used = appliedMinor + refundedMinor;
        if (used >= totalMinor) {
            this.status = CreditNoteStatus.APPLIED;
        } else if (used > 0) {
            this.status = CreditNoteStatus.PARTIALLY_APPLIED;
        } else {
            this.status = CreditNoteStatus.ISSUED;
        }
    }

    public String getReference() {
        return reference;
    }

    public UUID getCustomerId() {
        return customerId;
    }

    public UUID getInvoiceId() {
        return invoiceId;
    }

    public void setInvoiceId(UUID invoiceId) {
        this.invoiceId = invoiceId;
    }

    public UUID getSubscriptionId() {
        return subscriptionId;
    }

    public void setSubscriptionId(UUID subscriptionId) {
        this.subscriptionId = subscriptionId;
    }

    public UUID getSubscriptionChangeId() {
        return subscriptionChangeId;
    }

    public void setSubscriptionChangeId(UUID subscriptionChangeId) {
        this.subscriptionChangeId = subscriptionChangeId;
    }

    public String getCurrency() {
        return currency;
    }

    public String getReason() {
        return reason;
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

    public long getAppliedMinor() {
        return appliedMinor;
    }

    public long getRefundedMinor() {
        return refundedMinor;
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

    public CreditNoteStatus getStatus() {
        return status;
    }

    public UUID getIssuedByProfileId() {
        return issuedByProfileId;
    }
}
