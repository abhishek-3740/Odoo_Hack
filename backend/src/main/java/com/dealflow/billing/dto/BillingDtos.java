package com.dealflow.billing.dto;


import com.dealflow.billing.models.*;
import com.dealflow.billing.repo.*;
import com.dealflow.billing.service.*;
import com.dealflow.billing.controller.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** The billing API surface. */
public final class BillingDtos {

    private BillingDtos() {
    }

    // ------------------------------------------------------------- requests

    /** Explicit allocation of a receipt to one invoice. */
    public record PaymentAllocationRequest(
            @NotNull UUID invoiceId,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal amount) {
    }

    /**
     * A recorded receipt.
     *
     * <p>With no allocations the amount is applied to the customer's open
     * invoices oldest-due first, and anything left over stays unallocated as
     * customer credit rather than pushing an invoice negative.
     */
    public record RecordPaymentRequest(
            @NotNull UUID customerId,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal amount,
            @NotNull @Size(max = 40) String method,
            @Size(max = 120) String externalReference,
            @Size(max = 500) String note,
            @Valid List<PaymentAllocationRequest> allocations) {
    }

    public record RecordRefundRequest(
            @NotNull UUID creditNoteId,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal amount,
            @NotNull @Size(max = 40) String method,
            @Size(max = 120) String externalReference,
            @Size(max = 500) String note) {
    }

    /** A quantity change on a live subscription. */
    public record SubscriptionChangeRequest(
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal newQuantity,
            /* Must fall inside the open period and never before today. Backdating
             * is refused outright in this build (edge case E16). */
            LocalDate effectiveDate,
            @Size(max = 500) String note) {
    }

    public record PlanChangeRequest(
            @NotNull UUID newPlanId,
            LocalDate effectiveDate,
            @Size(max = 500) String note) {
    }

    public record CancelSubscriptionRequest(
            /* END_OF_PERIOD | IMMEDIATE_PRORATED. Defaults to the plan's policy. */
            String policy,
            LocalDate effectiveDate,
            @Size(max = 500) String reason) {
    }

    // ------------------------------------------------------------ responses

    public record InvoiceLineResponse(
            UUID id,
            String description,
            BigDecimal quantity,
            BigDecimal unitPrice,
            BigDecimal net,
            BigDecimal tax,
            LocalDate coverageStart,
            LocalDate coverageEnd,
            String lineType) {
    }

    public record InvoiceResponse(
            UUID id,
            String reference,
            UUID customerId,
            String customerName,
            UUID orderId,
            UUID subscriptionId,
            String invoiceKind,
            String status,
            String currency,
            LocalDate issueDate,
            LocalDate dueDate,
            BigDecimal net,
            BigDecimal tax,
            BigDecimal total,
            BigDecimal credited,
            BigDecimal paid,
            /** Derived: total less credits and payments. Never stored on its own. */
            BigDecimal outstanding,
            List<InvoiceLineResponse> lines) {
    }

    public record PaymentResponse(
            UUID id,
            String reference,
            UUID customerId,
            BigDecimal amount,
            BigDecimal allocated,
            /** Receipt in excess of the debt; remains as customer credit. */
            BigDecimal unallocated,
            String method,
            String externalReference,
            Instant recordedAt,
            List<AllocationResponse> allocations) {
    }

    public record AllocationResponse(UUID invoiceId, String invoiceReference, BigDecimal amount,
                                     BigDecimal invoiceOutstanding, String invoiceStatus) {
    }

    public record CreditNoteResponse(
            UUID id,
            String reference,
            UUID customerId,
            UUID subscriptionId,
            String currency,
            String reason,
            BigDecimal net,
            BigDecimal tax,
            BigDecimal total,
            BigDecimal applied,
            BigDecimal refunded,
            BigDecimal available,
            LocalDate coverageStart,
            LocalDate coverageEnd,
            String status,
            Instant createdAt) {
    }

    public record RefundResponse(
            UUID id,
            String reference,
            UUID creditNoteId,
            BigDecimal amount,
            String method,
            Instant recordedAt) {
    }

    /** Preview or result of a subscription change, with the arithmetic shown. */
    public record SubscriptionChangePreview(
            UUID subscriptionId,
            String changeType,
            LocalDate effectiveDate,
            LocalDate periodStart,
            LocalDate periodEnd,
            long remainingDays,
            long totalDays,
            BigDecimal remainingFraction,
            BigDecimal priorQuantity,
            BigDecimal newQuantity,
            /** Positive is an extra charge; negative is a credit. */
            BigDecimal adjustmentNet,
            BigDecimal adjustmentTax,
            String explanation,
            /** Set once applied. */
            UUID adjustmentInvoiceId,
            UUID creditNoteId,
            boolean applied) {
    }

    public record SubscriptionResponse(
            UUID id,
            String reference,
            UUID orderId,
            UUID customerId,
            String customerName,
            UUID planId,
            String planName,
            String currency,
            BigDecimal quantity,
            BigDecimal unitIntervalPrice,
            int intervalMonths,
            String cadence,
            LocalDate activationDate,
            LocalDate periodStart,
            LocalDate periodEnd,
            LocalDate nextBillAt,
            String status,
            LocalDate cancelEffectiveDate,
            String prorationPolicy,
            String cancellationPolicy,
            /** Normalised monthly value. A reporting figure, not an invoice amount. */
            BigDecimal monthlyRecurringRevenue,
            long rowVersion) {
    }
}
