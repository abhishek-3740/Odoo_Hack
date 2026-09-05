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
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A recorded change to a live subscription, with the before and after state.
 *
 * <p>{@code (subscriptionId, requestKey)} is unique, so a resubmitted change
 * request produces no second adjustment however many times it arrives (edge
 * case E18).
 *
 * <p>The snapshots are kept because "increase to 15 seats" is not enough to
 * reconstruct a bill six months later: the quantity it changed <em>from</em>, at
 * the price in force <em>then</em>, is what the adjustment was calculated on.
 */
@Entity
@Table(name = "subscription_changes")
public class SubscriptionChange extends BaseEntity {

    public enum ChangeType {
        QUANTITY, PLAN, CANCEL
    }

    @Column(name = "subscription_id", nullable = false, updatable = false)
    private UUID subscriptionId;

    @Enumerated(EnumType.STRING)
    @Column(name = "change_type", nullable = false, updatable = false)
    private ChangeType changeType;

    @Column(name = "effective_date", nullable = false)
    private LocalDate effectiveDate;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "prior_snapshot", nullable = false)
    private String priorSnapshot;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "new_snapshot", nullable = false)
    private String newSnapshot;

    @Column(name = "adjustment_invoice_id")
    private UUID adjustmentInvoiceId;

    @Column(name = "credit_note_id")
    private UUID creditNoteId;

    @Column(name = "request_key", nullable = false, updatable = false)
    private String requestKey;

    @Column(name = "actor_profile_id")
    private UUID actorProfileId;

    @Column(name = "applied_at", nullable = false)
    private Instant appliedAt;

    protected SubscriptionChange() {
    }

    public SubscriptionChange(UUID subscriptionId, ChangeType changeType, LocalDate effectiveDate,
                              String priorSnapshot, String newSnapshot, String requestKey,
                              UUID actorProfileId, Instant appliedAt) {
        this.subscriptionId = subscriptionId;
        this.changeType = changeType;
        this.effectiveDate = effectiveDate;
        this.priorSnapshot = priorSnapshot;
        this.newSnapshot = newSnapshot;
        this.requestKey = requestKey;
        this.actorProfileId = actorProfileId;
        this.appliedAt = appliedAt;
    }

    public UUID getSubscriptionId() {
        return subscriptionId;
    }

    public ChangeType getChangeType() {
        return changeType;
    }

    public LocalDate getEffectiveDate() {
        return effectiveDate;
    }

    public String getPriorSnapshot() {
        return priorSnapshot;
    }

    public String getNewSnapshot() {
        return newSnapshot;
    }

    public UUID getAdjustmentInvoiceId() {
        return adjustmentInvoiceId;
    }

    public void setAdjustmentInvoiceId(UUID adjustmentInvoiceId) {
        this.adjustmentInvoiceId = adjustmentInvoiceId;
    }

    public UUID getCreditNoteId() {
        return creditNoteId;
    }

    public void setCreditNoteId(UUID creditNoteId) {
        this.creditNoteId = creditNoteId;
    }

    public String getRequestKey() {
        return requestKey;
    }

    public UUID getActorProfileId() {
        return actorProfileId;
    }

    public Instant getAppliedAt() {
        return appliedAt;
    }
}
