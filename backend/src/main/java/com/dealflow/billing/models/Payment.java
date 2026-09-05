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
 * Money that actually arrived.
 *
 * <p>A record of a receipt, not a gateway capture. Nothing in this build charges
 * a card; finance records what was received, and the invoice status follows from
 * the allocations. Calling this a "payment" is the honest description of what
 * the row means — a claim that money moved, made by a person who is accountable
 * for it.
 *
 * <p>A receipt larger than the debt stays partly unallocated rather than pushing
 * an invoice negative; the surplus is the customer's credit.
 */
@Entity
@Table(name = "payments")
public class Payment extends BaseEntity {

    @Column(name = "reference", nullable = false, unique = true, updatable = false)
    private String reference;

    @Column(name = "customer_id", nullable = false, updatable = false)
    private UUID customerId;

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

    protected Payment() {
    }

    public Payment(String reference, UUID customerId, String currency, long amountMinor,
                   String method, UUID recordedByProfileId, Instant recordedAt) {
        this.reference = reference;
        this.customerId = customerId;
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

    public String getCurrency() {
        return currency;
    }

    public long getAmountMinor() {
        return amountMinor;
    }

    public String getMethod() {
        return method;
    }

    public String getExternalReference() {
        return externalReference;
    }

    public void setExternalReference(String externalReference) {
        this.externalReference = externalReference;
    }

    public String getNote() {
        return note;
    }

    public void setNote(String note) {
        this.note = note;
    }

    public UUID getRecordedByProfileId() {
        return recordedByProfileId;
    }

    public Instant getRecordedAt() {
        return recordedAt;
    }
}
