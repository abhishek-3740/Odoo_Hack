package com.dealflow.portal.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The customer-facing API surface.
 *
 * <p>These are <b>separate types</b>, not the internal DTOs with fields hidden
 * at runtime. That is the point: a portal response has no field for unit cost,
 * margin, policy threshold or another customer, so no serialiser setting, no
 * refactor and no future "just add one more field" can leak one. The difference
 * between "we don't send it" and "we can't send it" is the difference between a
 * convention and a boundary (test T08).
 */
public final class PortalDtos {

    private PortalDtos() {
    }

    // ------------------------------------------------------------- requests

    /** A proposed change to one line, or to the order-level discount. */
    public record CounterLineRequest(
            @NotNull @Size(max = 64) String lineKey,
            @DecimalMin(value = "0", inclusive = false) BigDecimal quantity,
            /* Bounded at 99.99%. A line that nets to zero is refused outright,
             * whatever the customer typed (edge case E18). */
            @Min(0) @Max(9999) Integer requestedDiscountBp) {
    }

    public record PortalRequest(
            /* COMMENT | CHANGE | COUNTER */
            @NotNull String requestType,
            @Size(max = 64) String lineKey,
            @Size(max = 2000) String message,
            @Valid List<CounterLineRequest> lines,
            @Min(0) @Max(9999) Integer requestedOrderDiscountBp,
            /* The version the customer was looking at. A mismatch is refused
             * rather than applied to whatever is current now. */
            @NotNull UUID expectedRevisionId) {
    }

    /**
     * An acceptance of one exact version.
     *
     * <p>Both the revision id and the commercial hash are required. A click made
     * on a phone that has been asleep for an hour must not become consent to a
     * price the customer never saw (edge case E19).
     */
    public record AcceptanceRequest(
            @NotNull UUID revisionId,
            @NotNull @Size(min = 8, max = 128) String commercialHash,
            @Size(max = 500) String note) {
    }

    // ------------------------------------------------------------ responses

    /** A quotation line as the customer sees it. No cost, no margin. */
    public record PortalLine(
            String lineKey,
            String description,
            BigDecimal quantity,
            BigDecimal unitPrice,
            int discountPercentBp,
            BigDecimal lineTotal,
            BigDecimal tax,
            String billingCadence,
            LocalDate promisedDate,
            /* Availability as a plain statement, with no warehouse detail and no
             * implied promise the system cannot keep. */
            String availabilityNote) {
    }

    public record PortalRecurringTotal(String cadence, BigDecimal amount, BigDecimal tax) {
    }

    public record PortalTotals(
            String currency,
            BigDecimal oneTimeSubtotal,
            BigDecimal oneTimeTax,
            BigDecimal oneTimeTotal,
            List<PortalRecurringTotal> recurring,
            /** What is payable on confirmation. Recurring charges are separate. */
            BigDecimal dueOnConfirmation) {
    }

    public record PortalActivity(
            UUID id,
            String requestType,
            String lineKey,
            String message,
            String status,
            String responseMessage,
            boolean fromCustomer,
            Instant createdAt,
            Instant respondedAt) {
    }

    public record PortalQuoteSummary(
            UUID id,
            String reference,
            String title,
            String status,
            String currency,
            BigDecimal oneTimeTotal,
            LocalDate validUntil,
            Instant updatedAt) {
    }

    public record PortalQuoteDetail(
            UUID id,
            String reference,
            String title,
            UUID revisionId,
            int versionNumber,
            String status,
            /** Plain language: "Awaiting internal approval", never a threshold. */
            String statusMessage,
            boolean awaitingInternalApproval,
            boolean acceptable,
            boolean acceptedByYou,
            Instant acceptedAt,
            boolean orderPlaced,
            String orderReference,
            LocalDate validUntil,
            boolean expired,
            String backorderTerms,
            String invoicingNote,
            List<PortalLine> lines,
            PortalTotals totals,
            List<PortalActivity> activity,
            /** Echoed back on acceptance so the server can verify the exact terms. */
            String commercialHash) {
    }

    public record PortalInvoiceSummary(
            UUID id,
            String reference,
            String status,
            String currency,
            BigDecimal total,
            BigDecimal outstanding,
            LocalDate issueDate,
            LocalDate dueDate) {
    }

    public record AcceptanceResponse(
            UUID quoteId,
            UUID revisionId,
            boolean accepted,
            /** True when acceptance is recorded but approval is still outstanding. */
            boolean conditional,
            String message,
            String orderReference,
            List<String> remainingSteps) {
    }
}
