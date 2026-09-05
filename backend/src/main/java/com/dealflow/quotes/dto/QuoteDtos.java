package com.dealflow.quotes.dto;


import com.dealflow.quotes.models.*;
import com.dealflow.quotes.repo.*;
import com.dealflow.quotes.service.*;
import com.dealflow.quotes.controller.*;
import com.dealflow.quotes.models.QuoteEnums.BackorderTerms;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * The quotation API surface.
 *
 * <p>Requests carry identifiers, quantities and <em>requested</em> discounts.
 * They never carry prices, costs or totals: those are resolved server-side, and
 * a client that sends them is ignored rather than trusted (test T26).
 *
 * <p>Money crosses the wire as decimal strings in major units ("39300.00").
 * Percentages are decimals; discounts are integer basis points, so 12% is
 * exactly 1200 everywhere.
 */
public final class QuoteDtos {

    private QuoteDtos() {
    }

    // ------------------------------------------------------------- requests

    public record CreateQuoteRequest(
            @NotNull UUID customerId,
            @Size(max = 200) String title,
            LocalDate validUntil) {
    }

    /**
     * One requested line. Exactly one of {@code variantId} (a one-time item) or
     * {@code planId} (a recurring plan) must be set; the service rejects both or
     * neither rather than guessing.
     */
    public record QuoteLineRequest(
            /* Stable across revisions. Generated when absent, so the client may
             * omit it for a brand-new line but must echo it when editing. */
            @Size(max = 64) String lineKey,
            UUID variantId,
            UUID planId,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal quantity,
            @Min(0) @Max(9999) Integer lineDiscountBp,
            LocalDate promisedDate,
            @Size(max = 32) String source) {
    }

    /** Draft terms, for a read-only evaluation or for saving a revision. */
    public record QuoteDraftRequest(
            @NotEmpty @Size(max = 100) @Valid List<QuoteLineRequest> lines,
            @Min(0) @Max(9999) Integer orderDiscountBp,
            BackorderTerms backorderTerms,
            LocalDate requestedActivationDate,
            /* Optimistic guard. Omit on a pure evaluation; required when saving
             * so a stale editor cannot overwrite someone else's change. */
            Long expectedRowVersion) {

        public int orderDiscountBpOrZero() {
            return orderDiscountBp == null ? 0 : orderDiscountBp;
        }
    }

    public record SubmitQuoteRequest(
            @NotNull UUID expectedRevisionId,
            Long expectedRowVersion,
            @Size(max = 500) String note) {
    }

    public record AdoptRevisionRequest(
            @NotNull UUID revisionId,
            Long expectedRowVersion,
            @Size(max = 500) String note) {
    }

    public record CancelQuoteRequest(
            @Size(max = 500) String reason,
            Long expectedRowVersion) {
    }

    // ------------------------------------------------------------ responses

    public record EvaluatedLine(
            String lineKey,
            int position,
            String lineKind,
            UUID productId,
            UUID variantId,
            UUID planId,
            String categoryCode,
            String description,
            BigDecimal quantity,
            BigDecimal unitPrice,
            BigDecimal unitCost,
            int taxRateBp,
            int lineDiscountBp,
            int appliedOrderDiscountBp,
            int effectiveDiscountBp,
            BigDecimal base,
            BigDecimal net,
            BigDecimal tax,
            BigDecimal costTotal,
            BigDecimal margin,
            /** Null, not zero, when there is no revenue to divide by. */
            BigDecimal marginPercent,
            Integer intervalMonths,
            boolean requiresStock,
            LocalDate promisedDate,
            String source) {
    }

    /** A recurring subtotal for one cadence. Cadences are never summed together. */
    public record RecurringTotal(
            int intervalMonths,
            String cadence,
            BigDecimal net,
            BigDecimal tax,
            BigDecimal cost,
            BigDecimal margin,
            BigDecimal marginPercent) {
    }

    /**
     * Deliberately several numbers rather than one.
     *
     * <p>A single "total" for a hybrid deal would be a lie: INR 39,300 once and
     * INR 3,000 a month are not INR 42,300 of anything the customer pays today.
     * {@code comparisonNet} exists only to give risk and margin a consistent
     * denominator, and is labelled as such wherever it is shown.
     */
    public record Totals(
            String currency,
            BigDecimal oneTimeNet,
            BigDecimal oneTimeTax,
            BigDecimal oneTimeTotal,
            List<RecurringTotal> recurring,
            BigDecimal recurringFirstCycleNet,
            /** What is actually payable on confirmation. */
            BigDecimal initialAmountDue,
            /** One-time plus first full recurring cycles: the risk denominator. */
            BigDecimal comparisonNet,
            BigDecimal contribution,
            BigDecimal contributionPercent,
            /** Reporting metric only. Never an invoice amount. */
            BigDecimal monthlyRecurringRevenue,
            BigDecimal totalBase,
            BigDecimal totalDiscount) {
    }

    public record RiskReasonDto(
            String code,
            String lineKey,
            String description,
            BigDecimal observedValue,
            BigDecimal thresholdValue,
            String unit,
            String requiredLevel,
            String message) {
    }

    public record LineRiskDto(
            String lineKey,
            String description,
            String categoryCode,
            BigDecimal effectiveDiscountPercent,
            BigDecimal allowedPercent,
            BigDecimal excessPp,
            BigDecimal excessValue,
            BigDecimal margin,
            BigDecimal marginPercent) {
    }

    public record RiskSummary(
            String requiredLevel,
            List<RiskReasonDto> reasons,
            List<LineRiskDto> lines,
            /** M: the worst single line, in percentage points over its ceiling. */
            BigDecimal worstLineExcessPp,
            /** W: value-weighted excess. Percentage points, not a probability. */
            BigDecimal weightedExcessPp,
            /** E: total money conceded beyond ceilings. */
            BigDecimal excessConcessionValue,
            /** D: overall effective discount across the quotation. */
            BigDecimal aggregateDiscountPercent,
            BigDecimal aggregateMarginPercent,
            Integer policyVersionNo) {
    }

    public record WarehouseStockDto(
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            BigDecimal available,
            LocalDate expectedReceiptDate) {
    }

    /**
     * Availability beside a line. A preview only: it reserves nothing, and the
     * numbers are re-read under a lock when the order is actually confirmed.
     */
    public record StockPreviewDto(
            String lineKey,
            UUID variantId,
            String description,
            BigDecimal requested,
            BigDecimal available,
            BigDecimal shortfall,
            LocalDate earliestExpectedReceipt,
            List<WarehouseStockDto> byWarehouse) {
    }

    /**
     * The independent conditions for creating an order.
     *
     * <p>Approval and customer acceptance are separate facts in either order.
     * {@code blockingReasons} lists what is still missing, in words a user can
     * act on.
     */
    public record GateSummary(
            String approvalStatus,
            boolean approvalCleared,
            boolean sellerAdopted,
            boolean customerAccepted,
            boolean expired,
            boolean orderExists,
            UUID orderId,
            boolean readyToExecute,
            List<String> blockingReasons) {
    }

    public record ApprovalStepDto(
            UUID id,
            int step,
            String requiredRole,
            String status,
            UUID assigneeProfileId,
            String assigneeName,
            Instant dueAt,
            UUID decidedByProfileId,
            String decidedByName,
            Instant decidedAt,
            String decisionReason) {
    }

    /** The full evaluated picture of one revision. */
    public record QuoteEvaluationResponse(
            UUID quoteId,
            String reference,
            String title,
            UUID customerId,
            String customerName,
            String customerTier,
            UUID ownerProfileId,
            String stage,
            LocalDate validUntil,
            UUID revisionId,
            int revisionNo,
            String revisionStatus,
            String revisionSource,
            String currency,
            int orderDiscountBp,
            String backorderTerms,
            String invoicingTerms,
            LocalDate requestedActivationDate,
            List<EvaluatedLine> lines,
            Totals totals,
            RiskSummary risk,
            List<StockPreviewDto> stockPreview,
            GateSummary gates,
            List<ApprovalStepDto> approvals,
            String commercialHash,
            long rowVersion,
            /** True for a read-only evaluation that changed nothing. */
            boolean preview) {
    }

    public record QuoteSummary(
            UUID id,
            String reference,
            String title,
            UUID customerId,
            String customerName,
            UUID ownerProfileId,
            String ownerName,
            String stage,
            String approvalStatus,
            String currency,
            BigDecimal oneTimeNet,
            BigDecimal recurringFirstCycleNet,
            BigDecimal contributionPercent,
            int revisionNo,
            LocalDate validUntil,
            Instant lastActivityAt,
            Instant lastProgressAt,
            Instant awaitingExternalSince,
            long rowVersion) {
    }

    public record ShareResponse(UUID quoteId, String stage, String portalPath, String commercialHash) {
    }
}
