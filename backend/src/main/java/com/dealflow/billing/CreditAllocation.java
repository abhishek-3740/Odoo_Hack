package com.dealflow.billing;

import com.dealflow.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;

/** How much of one credit note is applied to one invoice. */
@Entity
@Table(name = "credit_allocations")
public class CreditAllocation extends BaseEntity {

    @Column(name = "credit_note_id", nullable = false, updatable = false)
    private UUID creditNoteId;

    @Column(name = "invoice_id", nullable = false, updatable = false)
    private UUID invoiceId;

    @Column(name = "amount_minor", nullable = false)
    private long amountMinor;

    protected CreditAllocation() {
    }

    public CreditAllocation(UUID creditNoteId, UUID invoiceId, long amountMinor) {
        this.creditNoteId = creditNoteId;
        this.invoiceId = invoiceId;
        this.amountMinor = amountMinor;
    }

    public UUID getCreditNoteId() {
        return creditNoteId;
    }

    public UUID getInvoiceId() {
        return invoiceId;
    }

    public long getAmountMinor() {
        return amountMinor;
    }
}
