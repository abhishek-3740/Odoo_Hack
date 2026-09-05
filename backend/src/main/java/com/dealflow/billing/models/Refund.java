package com.dealflow.billing.models;


import com.dealflow.billing.repo.*;
import com.dealflow.billing.service.*;
import com.dealflow.billing.dto.*;
import com.dealflow.billing.controller.*;
import com.dealflow.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * Money sent back.
 *
 * <p>Always backed by a credit note with an available balance, and capped by
 * what the customer actually paid. Cancelling an unpaid subscription can wipe
 * out a debt, but it cannot refund money that never arrived.
 */
@Entity
@Table(name = "refunds")
public class Refund extends BaseEntity {

    @Column(name = "reference", nullable = false, unique = true, updatable = false)
    private String reference;

    @Column(name = "customer_id", nullable = false, updatable = false)
    private UUID customerId;

    @Column(name = "credit_note_id", nullable = false, updatable = false)
    private UUID creditNoteId;

    @Column(name = "currency", nullable = false, length = 3)
    private String currency;

    @Column(name = "amount_minor", nullable = false, updatable = false)
    private long amountMinor;

    @Column(name = "method", nullable = false)
    private String method;

    @Column(name = "external_reference")
    private String externalReference;

    @Column(name = "note")
    private String note;

    @Column(name = "recorded_by_profile_id")
    private UUID recordedByProfileId;

    @Column(name = "recorded_at", nullable = false)
    private Instant recordedAt;

    protected Refund() {
    }

    public Refund(String reference, UUID customerId, UUID creditNoteId, String currency,
                  long amountMinor, String method, UUID recordedByProfileId, Instant recordedAt) {
        this.reference = reference;
        this.customerId = customerId;
        this.creditNoteId = creditNoteId;
        this.currency = currency;
        this.amountMinor = amountMinor;
        this.method = method;
        this.recordedByProfileId = recordedByProfileId;
        this.recordedAt = recordedAt;
    }

    public String getReference() {
        return reference;
    }

    public UUID getCustomerId() {
        return customerId;
    }

    public UUID getCreditNoteId() {
        return creditNoteId;
    }

    public String getCurrency() {
        return currency;
    }

    public long getAmountMinor() {
        return amountMinor;
    }

    public String getMethod() {
        return method;
    }

    public void setExternalReference(String externalReference) {
        this.externalReference = externalReference;
    }

    public String getExternalReference() {
        return externalReference;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public String getNote() {
        return note;
    }

    public UUID getRecordedByProfileId() {
        return recordedByProfileId;
    }

    public Instant getRecordedAt() {
        return recordedAt;
    }
}
