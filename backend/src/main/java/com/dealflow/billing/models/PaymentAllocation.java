package com.dealflow.billing.models;


import com.dealflow.billing.repo.*;
import com.dealflow.billing.service.*;
import com.dealflow.billing.dto.*;
import com.dealflow.billing.controller.*;
import com.dealflow.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;

/** How much of one payment settles one invoice. */
@Entity
@Table(name = "payment_allocations")
public class PaymentAllocation extends BaseEntity {

    @Column(name = "payment_id", nullable = false, updatable = false)
    private UUID paymentId;

    @Column(name = "invoice_id", nullable = false, updatable = false)
    private UUID invoiceId;

    @Column(name = "amount_minor", nullable = false)
    private long amountMinor;

    protected PaymentAllocation() {
    }

    public PaymentAllocation(UUID paymentId, UUID invoiceId, long amountMinor) {
        this.paymentId = paymentId;
        this.invoiceId = invoiceId;
        this.amountMinor = amountMinor;
    }

    public UUID getPaymentId() {
        return paymentId;
    }

    public UUID getInvoiceId() {
        return invoiceId;
    }

    public long getAmountMinor() {
        return amountMinor;
    }
}
