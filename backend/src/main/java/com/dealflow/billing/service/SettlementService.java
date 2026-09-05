package com.dealflow.billing.service;


import com.dealflow.billing.models.*;
import com.dealflow.billing.repo.*;
import com.dealflow.billing.dto.*;
import com.dealflow.billing.controller.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.billing.dto.BillingDtos.PaymentAllocationRequest;
import com.dealflow.billing.dto.BillingDtos.RecordPaymentRequest;
import com.dealflow.billing.dto.BillingDtos.RecordRefundRequest;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.outbox.service.OutboxWriter;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessClock;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Settles debts: payments in, credits applied, refunds out.
 *
 * <h2>Money can only move in directions that make sense</h2>
 *
 * <ul>
 *   <li>An allocation never exceeds what is outstanding, so an invoice cannot go
 *       negative. Receipt in excess of the debt stays unallocated as customer
 *       credit — visible, and available for the next invoice (test T20).</li>
 *   <li>A refund is capped three ways: by the credit note's unused balance, and
 *       by what the customer has actually paid less what has already been
 *       refunded. Cancelling an unpaid subscription can erase a debt, but it
 *       cannot produce cash the customer never sent (edge case E17).</li>
 *   <li>Invoices are locked in a stable id order before settlement, so
 *       concurrent allocations queue instead of racing, and each one reads a
 *       real outstanding figure rather than a stale one.</li>
 * </ul>
 */
@Service
public class SettlementService {

    private static final Logger log = LoggerFactory.getLogger(SettlementService.class);

    private final InvoiceRepository invoices;
    private final PaymentRepository payments;
    private final PaymentAllocationRepository paymentAllocations;
    private final CreditNoteRepository creditNotes;
    private final CreditAllocationRepository creditAllocations;
    private final RefundRepository refunds;
    private final CustomerRepository customers;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;

    public SettlementService(InvoiceRepository invoices, PaymentRepository payments,
                             PaymentAllocationRepository paymentAllocations,
                             CreditNoteRepository creditNotes,
                             CreditAllocationRepository creditAllocations, RefundRepository refunds,
                             CustomerRepository customers, AuditService audit, OutboxWriter outbox,
                             BusinessClock clock) {
        this.invoices = invoices;
        this.payments = payments;
        this.paymentAllocations = paymentAllocations;
        this.creditNotes = creditNotes;
        this.creditAllocations = creditAllocations;
        this.refunds = refunds;
        this.customers = customers;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
    }

    public record PaymentOutcome(Payment payment, long allocatedMinor, long unallocatedMinor,
                                 List<PaymentAllocation> allocations) {
    }

    /**
     * Records money received and settles what it can.
     *
     * <p>Explicit allocations are honoured if the caller supplied them; otherwise
     * open invoices are settled oldest-due first. Either way, no single
     * allocation exceeds that invoice's outstanding amount.
     */
    @Transactional(rollbackFor = Exception.class)
    public PaymentOutcome recordPayment(RecordPaymentRequest request, Actor actor) {
        var customer = customers.findById(request.customerId())
                .orElseThrow(() -> ApiException.notFound("Customer " + request.customerId()));

        long amountMinor = Money.toMinor(request.amount());
        if (amountMinor <= 0) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "A payment must be greater than zero.");
        }

        Payment payment = payments.save(new Payment(
                "PAY-" + payments.nextReferenceNumber(), customer.getId(), customer.getCurrency(),
                amountMinor, request.method(), actor.profileId(), clock.now()));
        payment.setExternalReference(request.externalReference());
        payment.setNote(request.note());

        Map<UUID, Long> plan = request.allocations() == null || request.allocations().isEmpty()
                ? autoAllocate(customer.getId(), amountMinor)
                : explicitAllocation(request.allocations(), amountMinor);

        List<PaymentAllocation> created = new ArrayList<>();
        long allocated = 0;

        if (!plan.isEmpty()) {
            // Stable id order: concurrent settlements queue rather than deadlock.
            List<Invoice> locked = invoices.lockAll(plan.keySet());
            Map<UUID, Invoice> byId = locked.stream()
                    .collect(Collectors.toMap(Invoice::getId, invoice -> invoice));

            for (Map.Entry<UUID, Long> entry : plan.entrySet()) {
                Invoice invoice = byId.get(entry.getKey());
                if (invoice == null) {
                    throw ApiException.notFound("Invoice " + entry.getKey());
                }
                if (!invoice.getCustomerId().equals(customer.getId())) {
                    throw ApiException.notFound("Invoice " + entry.getKey());
                }
                if (!invoice.getCurrency().equals(customer.getCurrency())) {
                    throw new ApiException(ErrorCode.CURRENCY_MISMATCH,
                            "Invoice " + invoice.getReference() + " is in another currency.");
                }
                if (!invoice.acceptsSettlement()) {
                    throw ApiException.of(ErrorCode.INVOICE_NOT_PAYABLE,
                            "Invoice " + invoice.getReference() + " is "
                                    + invoice.getStatus().name().toLowerCase() + ".",
                            "invoiceId", invoice.getId().toString());
                }

                // Re-read outstanding under the lock. A figure computed before
                // the lock may already be wrong.
                long outstanding = invoice.outstandingMinor();
                long requested = entry.getValue();
                if (requested > outstanding) {
                    throw ApiException.of(ErrorCode.OVER_ALLOCATION,
                            "Allocating " + Money.format(requested) + " to invoice "
                                    + invoice.getReference() + " exceeds the "
                                    + Money.format(outstanding) + " outstanding.",
                            "invoiceId", invoice.getId().toString(),
                            "outstandingMinor", outstanding);
                }
                if (requested <= 0) {
                    continue;
                }

                invoice.addPaid(requested);
                invoice.recomputeStatus();
                created.add(paymentAllocations.save(
                        new PaymentAllocation(payment.getId(), invoice.getId(), requested)));
                allocated += requested;

                outbox.publish(OutboxWriter.Events.INVOICE_UPDATED, "Invoice", invoice.getId(),
                        invoice.getRowVersion(),
                        Map.of("status", invoice.getStatus().name(),
                                "outstandingMinor", invoice.outstandingMinor()),
                        OutboxWriter.RecipientScope.deal(invoice.getCustomerId(), null, null));
            }
        }

        if (allocated > amountMinor) {
            throw new ApiException(ErrorCode.OVER_ALLOCATION,
                    "Allocations exceed the payment amount.");
        }
        long unallocated = amountMinor - allocated;

        audit.record(actor, "PAYMENT_RECORDED", "Payment", payment.getId())
                .after(Map.of("reference", payment.getReference(), "amountMinor", amountMinor,
                        "allocatedMinor", allocated, "unallocatedMinor", unallocated))
                .reason(request.note())
                .save();

        if (unallocated > 0) {
            log.info("Payment {} leaves {} unallocated as customer credit",
                    payment.getReference(), Money.format(unallocated));
        }
        return new PaymentOutcome(payment, allocated, unallocated, created);
    }

    /**
     * Applies a credit to the customer's open invoices.
     *
     * <p>Credits reduce debt before they become spendable balance, which is the
     * right order: a customer with an outstanding invoice should see it settled
     * rather than accumulate credit alongside a debt.
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public long applyCreditToOpenInvoices(CreditNote creditNote, Actor actor) {
        long available = creditNote.availableMinor();
        if (available <= 0) {
            return 0L;
        }
        List<Invoice> open = invoices.findOpenForCustomer(creditNote.getCustomerId());
        if (open.isEmpty()) {
            return 0L;
        }
        List<Invoice> locked = invoices.lockAll(open.stream().map(Invoice::getId).toList());

        long applied = 0;
        for (Invoice invoice : locked) {
            if (available <= 0) {
                break;
            }
            if (!invoice.acceptsSettlement() || !invoice.getCurrency().equals(creditNote.getCurrency())) {
                continue;
            }
            long outstanding = invoice.outstandingMinor();
            if (outstanding <= 0) {
                continue;
            }
            long amount = Math.min(available, outstanding);

            invoice.addCredited(amount);
            invoice.recomputeStatus();
            creditAllocations.save(new CreditAllocation(creditNote.getId(), invoice.getId(), amount));
            creditNote.applyToInvoice(amount);

            available -= amount;
            applied += amount;

            outbox.publish(OutboxWriter.Events.INVOICE_UPDATED, "Invoice", invoice.getId(),
                    invoice.getRowVersion(),
                    Map.of("status", invoice.getStatus().name(),
                            "creditedMinor", invoice.getCreditedMinor()),
                    OutboxWriter.RecipientScope.deal(invoice.getCustomerId(), null, null));
        }

        if (applied > 0) {
            audit.record(actor, "CREDIT_APPLIED", "CreditNote", creditNote.getId())
                    .after(Map.of("appliedMinor", applied,
                            "remainingMinor", creditNote.availableMinor()))
                    .save();
        }
        return applied;
    }

    /**
     * Pays money back against a credit note.
     *
     * <p>Refuses to refund more than the customer actually sent. That cap is not
     * a nicety: without it, cancelling an unpaid subscription would mint cash out
     * of an accounting entry.
     */
    @Transactional(rollbackFor = Exception.class)
    public Refund recordRefund(RecordRefundRequest request, Actor actor) {
        CreditNote creditNote = creditNotes.findByIdForUpdate(request.creditNoteId())
                .orElseThrow(() -> ApiException.notFound("Credit note " + request.creditNoteId()));

        long amountMinor = Money.toMinor(request.amount());
        if (amountMinor <= 0) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "A refund must be greater than zero.");
        }

        long availableOnNote = creditNote.availableMinor();
        if (amountMinor > availableOnNote) {
            throw ApiException.of(ErrorCode.REFUND_EXCEEDS_ELIGIBLE,
                    "Only " + Money.format(availableOnNote) + " of this credit note is unused.",
                    "availableMinor", availableOnNote);
        }

        long received = payments.sumReceivedFrom(creditNote.getCustomerId());
        long alreadyRefunded = refunds.sumRefundedTo(creditNote.getCustomerId());
        long refundable = received - alreadyRefunded;
        if (amountMinor > refundable) {
            throw ApiException.of(ErrorCode.REFUND_EXCEEDS_ELIGIBLE,
                    "This customer has paid " + Money.format(received) + " and been refunded "
                            + Money.format(alreadyRefunded) + ". At most "
                            + Money.format(Math.max(0, refundable)) + " can be refunded.",
                    "refundableMinor", Math.max(0, refundable));
        }

        Refund refund = refunds.save(new Refund(
                "REF-" + refunds.nextReferenceNumber(), creditNote.getCustomerId(), creditNote.getId(),
                creditNote.getCurrency(), amountMinor, request.method(), actor.profileId(), clock.now()));
        refund.setExternalReference(request.externalReference());
        refund.setNote(request.note());
        creditNote.recordRefund(amountMinor);

        audit.record(actor, "REFUND_RECORDED", "Refund", refund.getId())
                .after(Map.of("reference", refund.getReference(), "amountMinor", amountMinor,
                        "creditNoteId", creditNote.getId().toString()))
                .reason(request.note())
                .save();

        return refund;
    }

    // -------------------------------------------------------------- helpers

    /** Oldest due first, capped at each invoice's outstanding amount. */
    private Map<UUID, Long> autoAllocate(UUID customerId, long amountMinor) {
        Map<UUID, Long> plan = new LinkedHashMap<>();
        long remaining = amountMinor;
        for (Invoice invoice : invoices.findOpenForCustomer(customerId)) {
            if (remaining <= 0) {
                break;
            }
            long outstanding = invoice.outstandingMinor();
            if (outstanding <= 0) {
                continue;
            }
            long amount = Math.min(remaining, outstanding);
            plan.put(invoice.getId(), amount);
            remaining -= amount;
        }
        return plan;
    }

    private Map<UUID, Long> explicitAllocation(List<PaymentAllocationRequest> requested,
                                               long amountMinor) {
        Map<UUID, Long> plan = new LinkedHashMap<>();
        long total = 0;
        for (PaymentAllocationRequest allocation : requested) {
            long amount = Money.toMinor(allocation.amount());
            if (amount <= 0) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED,
                        "Every allocation must be greater than zero.");
            }
            if (plan.put(allocation.invoiceId(), amount) != null) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED,
                        "The same invoice appears twice in the allocation.");
            }
            total += amount;
        }
        if (total > amountMinor) {
            throw ApiException.of(ErrorCode.OVER_ALLOCATION,
                    "Allocations total " + Money.format(total) + " but the payment is "
                            + Money.format(amountMinor) + ".",
                    "allocatedMinor", total, "paymentMinor", amountMinor);
        }
        return plan;
    }
}
