package com.dealflow.billing;

import com.dealflow.auth.Actor;
import com.dealflow.billing.dto.BillingDtos.CancelSubscriptionRequest;
import com.dealflow.billing.dto.BillingDtos.SubscriptionChangePreview;
import com.dealflow.billing.dto.BillingDtos.SubscriptionChangeRequest;
import com.dealflow.billing.engine.ProrationCalculator;
import com.dealflow.catalog.CatalogEnums.CancellationPolicy;
import com.dealflow.catalog.CatalogEnums.ProrationPolicy;
import com.dealflow.config.AppProperties;
import com.dealflow.outbox.OutboxWriter;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessCalendar;
import com.dealflow.shared.time.BusinessClock;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Changes and ends live subscriptions.
 *
 * <h2>Dates are checked, not trusted</h2>
 *
 * <p>An effective date must fall inside the open period and must not be in the
 * past. Backdating is refused outright (edge case E16): silently starting today
 * would give away service, and silently charging arrears would bill for days the
 * customer never had. A genuinely future change is scheduled, not applied.
 *
 * <h2>Credits are computed from what was charged</h2>
 *
 * <p>Cancellation credit is worked out segment by segment from the stored
 * invoice lines, each with its own coverage window. After a mid-period upgrade
 * there are two charges covering two different windows, and only a per-segment
 * calculation credits each for its own unused days. Recomputing from the current
 * quantity would treat the upgrade's fifteen-day window as if it had run all
 * month.
 */
@Service
public class SubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(SubscriptionService.class);

    private final SubscriptionRepository subscriptions;
    private final SubscriptionChangeRepository changes;
    private final InvoiceRepository invoices;
    private final InvoiceLineRepository invoiceLines;
    private final CreditNoteRepository creditNotes;
    private final ProrationCalculator proration;
    private final BillingService billingService;
    private final SettlementService settlementService;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;
    private final AppProperties properties;

    public SubscriptionService(SubscriptionRepository subscriptions, SubscriptionChangeRepository changes,
                               InvoiceRepository invoices, InvoiceLineRepository invoiceLines,
                               CreditNoteRepository creditNotes, ProrationCalculator proration,
                               BillingService billingService, SettlementService settlementService,
                               AuditService audit, OutboxWriter outbox, BusinessClock clock,
                               ObjectMapper objectMapper, AppProperties properties) {
        this.subscriptions = subscriptions;
        this.changes = changes;
        this.invoices = invoices;
        this.invoiceLines = invoiceLines;
        this.creditNotes = creditNotes;
        this.proration = proration;
        this.billingService = billingService;
        this.settlementService = settlementService;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    // -------------------------------------------------------------- preview

    /** Shows the arithmetic before anything is committed. Persists nothing. */
    @Transactional(readOnly = true)
    public SubscriptionChangePreview previewQuantityChange(UUID subscriptionId,
                                                           SubscriptionChangeRequest request) {
        Subscription subscription = subscriptions.findById(subscriptionId)
                .orElseThrow(() -> ApiException.notFound("Subscription " + subscriptionId));
        LocalDate effectiveDate = resolveEffectiveDate(subscription, request.effectiveDate());

        ProrationCalculator.Adjustment adjustment = proration.quantityChange(
                subscription.getQuantity(), request.newQuantity(),
                subscription.getUnitIntervalPriceMinor(), effectiveDate,
                subscription.getPeriodStart(), subscription.getPeriodEnd(),
                subscription.getTaxRateBp());

        return toPreview(subscription, "QUANTITY", effectiveDate, request.newQuantity(),
                adjustment, null, null, false);
    }

    // ------------------------------------------------------- quantity change

    /**
     * Applies a quantity change.
     *
     * <p>The proration multiplier is the <em>difference</em> in quantity: going
     * from ten units to twenty prorates ten additional units, not five and not
     * twenty (edge case E13).
     *
     * <p>{@code requestKey} makes the operation replay-safe: the unique index on
     * {@code (subscription_id, request_key)} means a resubmitted request returns
     * the original result instead of raising a second adjustment.
     */
    @Transactional(rollbackFor = Exception.class)
    public SubscriptionChangePreview applyQuantityChange(UUID subscriptionId, String requestKey,
                                                         SubscriptionChangeRequest request,
                                                         Actor actor) {
        Subscription subscription = subscriptions.findByIdForUpdate(subscriptionId)
                .orElseThrow(() -> ApiException.notFound("Subscription " + subscriptionId));
        requireLive(subscription);

        var existing = changes.findBySubscriptionIdAndRequestKey(subscriptionId, requestKey);
        if (existing.isPresent()) {
            // Already applied. Returning the original outcome keeps a retry
            // harmless rather than charging twice (edge case E18).
            SubscriptionChange applied = existing.get();
            return replayOf(subscription, applied);
        }

        LocalDate effectiveDate = resolveEffectiveDate(subscription, request.effectiveDate());
        BigDecimal priorQuantity = subscription.getQuantity();
        BigDecimal newQuantity = request.newQuantity();
        if (priorQuantity.compareTo(newQuantity) == 0) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "The quantity is already " + newQuantity.toPlainString() + ".");
        }

        Instant now = clock.now();
        ProrationCalculator.Adjustment adjustment = proration.quantityChange(
                priorQuantity, newQuantity, subscription.getUnitIntervalPriceMinor(),
                effectiveDate, subscription.getPeriodStart(), subscription.getPeriodEnd(),
                subscription.getTaxRateBp());

        SubscriptionChange change = changes.save(new SubscriptionChange(
                subscription.getId(), SubscriptionChange.ChangeType.QUANTITY, effectiveDate,
                snapshot(subscription), snapshotWithQuantity(subscription, newQuantity),
                requestKey, actor.profileId(), now));

        UUID adjustmentInvoiceId = null;
        UUID creditNoteId = null;

        if (subscription.getProrationPolicy() == ProrationPolicy.IMMEDIATE_PRORATED
                && adjustment.netMinor() != 0) {
            if (adjustment.isCharge()) {
                adjustmentInvoiceId = raiseAdjustmentInvoice(subscription, change, adjustment,
                        effectiveDate, newQuantity.subtract(priorQuantity), actor);
                change.setAdjustmentInvoiceId(adjustmentInvoiceId);
            } else {
                CreditNote note = raiseCreditNote(subscription, change,
                        adjustment.absoluteNetMinor(), adjustment.absoluteTaxMinor(),
                        effectiveDate, subscription.getPeriodEnd(),
                        "Reduced quantity for the remainder of the period", actor);
                creditNoteId = note.getId();
                change.setCreditNoteId(creditNoteId);
                settlementService.applyCreditToOpenInvoices(note, actor);
            }
        }

        // NEXT_PERIOD keeps the current period untouched; the change takes
        // effect when the next period is billed.
        if (subscription.getProrationPolicy() == ProrationPolicy.IMMEDIATE_PRORATED) {
            subscription.setQuantity(newQuantity);
        }

        audit.record(actor, "SUBSCRIPTION_QUANTITY_CHANGED", "Subscription", subscription.getId())
                .before(Map.of("quantity", priorQuantity.toPlainString()))
                .after(Map.of("quantity", newQuantity.toPlainString(),
                        "effectiveDate", effectiveDate.toString(),
                        "adjustmentNetMinor", adjustment.netMinor(),
                        "policy", subscription.getProrationPolicy().name()))
                .reason(request.note())
                .save();

        outbox.publish(OutboxWriter.Events.SUBSCRIPTION_UPDATED, "Subscription", subscription.getId(),
                subscription.getRowVersion(),
                Map.of("changeType", "QUANTITY", "effectiveDate", effectiveDate.toString()),
                OutboxWriter.RecipientScope.deal(subscription.getCustomerId(), null, null));

        return toPreview(subscription, "QUANTITY", effectiveDate, newQuantity, adjustment,
                adjustmentInvoiceId, creditNoteId, true);
    }

    // --------------------------------------------------------- cancellation

    /**
     * Ends a subscription.
     *
     * <p>{@code END_OF_PERIOD} stops the renewal and credits nothing: the
     * customer keeps the service they paid for until the period runs out.
     * {@code IMMEDIATE_PRORATED} stops it now and credits the unused coverage.
     *
     * <p>Cancelling a bundled support plan never reprices the hardware it was
     * sold beside. Recovering a bundle discount would need an explicit formula
     * in the accepted terms; inferring one would bill the customer for something
     * they never agreed to (edge case E14).
     */
    @Transactional(rollbackFor = Exception.class)
    public SubscriptionChangePreview cancel(UUID subscriptionId, String requestKey,
                                            CancelSubscriptionRequest request, Actor actor) {
        Subscription subscription = subscriptions.findByIdForUpdate(subscriptionId)
                .orElseThrow(() -> ApiException.notFound("Subscription " + subscriptionId));

        var existing = changes.findBySubscriptionIdAndRequestKey(subscriptionId, requestKey);
        if (existing.isPresent()) {
            return replayOf(subscription, existing.get());
        }
        if (subscription.getStatus() == Subscription.SubscriptionStatus.CANCELED) {
            throw new ApiException(ErrorCode.SUBSCRIPTION_NOT_ACTIVE,
                    "This subscription is already cancelled.");
        }
        requireLive(subscription);

        CancellationPolicy policy = request.policy() == null
                ? subscription.getCancellationPolicy()
                : parsePolicy(request.policy());
        LocalDate effectiveDate = policy == CancellationPolicy.END_OF_PERIOD
                ? subscription.getPeriodEnd()
                : resolveEffectiveDate(subscription, request.effectiveDate());

        Instant now = clock.now();
        SubscriptionChange change = changes.save(new SubscriptionChange(
                subscription.getId(), SubscriptionChange.ChangeType.CANCEL, effectiveDate,
                snapshot(subscription),
                objectMapper.writeValueAsString(Map.of("status", "CANCELED", "policy", policy.name())),
                requestKey, actor.profileId(), now));

        UUID creditNoteId = null;
        long creditNet = 0;
        long creditTax = 0;

        if (policy == CancellationPolicy.IMMEDIATE_PRORATED) {
            // Work from the charges actually raised, each with its own coverage
            // window. This is what prevents crediting the same days twice.
            List<ProrationCalculator.ChargeSegment> segments = invoiceLines
                    .findBySubscriptionIdOrderByCoverageStartAsc(subscription.getId()).stream()
                    .filter(line -> line.getCoverageStart() != null && line.getCoverageEnd() != null)
                    .map(line -> new ProrationCalculator.ChargeSegment(
                            line.getCoverageStart(), line.getCoverageEnd(),
                            line.getNetMinor(), line.getTaxMinor()))
                    .toList();

            var breakdown = proration.unusedCoverage(segments, effectiveDate);
            creditNet = breakdown.netMinor();
            creditTax = breakdown.taxMinor();

            // Anything already credited for this subscription is deducted, so a
            // second cancellation attempt cannot credit the same period again.
            long alreadyCredited = creditNotes.findBySubscriptionId(subscription.getId()).stream()
                    .mapToLong(CreditNote::getTotalMinor).sum();
            long creditTotal = Math.max(0, (creditNet + creditTax) - alreadyCredited);

            if (creditTotal > 0) {
                long netPortion = Math.min(creditNet, creditTotal);
                long taxPortion = creditTotal - netPortion;
                CreditNote note = raiseCreditNote(subscription, change, netPortion, taxPortion,
                        effectiveDate, subscription.getPeriodEnd(),
                        "Unused service after cancellation", actor);
                creditNoteId = note.getId();
                change.setCreditNoteId(creditNoteId);
                // Debt first; whatever is left becomes customer credit, and only
                // a Finance-recorded refund turns that into money.
                settlementService.applyCreditToOpenInvoices(note, actor);
            }

            subscription.setStatus(Subscription.SubscriptionStatus.CANCELED);
            subscription.setCanceledAt(now);
            subscription.setNextBillAt(null);
        } else {
            subscription.setStatus(Subscription.SubscriptionStatus.CANCEL_AT_PERIOD_END);
        }
        subscription.setCancelEffectiveDate(effectiveDate);

        audit.record(actor, "SUBSCRIPTION_CANCELED", "Subscription", subscription.getId())
                .after(Map.of("policy", policy.name(), "effectiveDate", effectiveDate.toString(),
                        "creditNetMinor", creditNet, "creditTaxMinor", creditTax))
                .reason(request.reason())
                .save();

        outbox.publish(OutboxWriter.Events.SUBSCRIPTION_UPDATED, "Subscription", subscription.getId(),
                subscription.getRowVersion(),
                Map.of("status", subscription.getStatus().name()),
                OutboxWriter.RecipientScope.deal(subscription.getCustomerId(), null, null));

        ProrationCalculator.Adjustment asAdjustment = new ProrationCalculator.Adjustment(
                -(creditNet), -(creditTax), BigDecimal.ZERO,
                BusinessCalendar.days(effectiveDate, subscription.getPeriodEnd()),
                BusinessCalendar.days(subscription.getPeriodStart(), subscription.getPeriodEnd()),
                effectiveDate, subscription.getPeriodEnd());

        return toPreview(subscription, "CANCEL", effectiveDate, subscription.getQuantity(),
                asAdjustment, null, creditNoteId, true);
    }

    // -------------------------------------------------------------- helpers

    private UUID raiseAdjustmentInvoice(Subscription subscription, SubscriptionChange change,
                                        ProrationCalculator.Adjustment adjustment,
                                        LocalDate effectiveDate, BigDecimal deltaQuantity,
                                        Actor actor) {
        Invoice invoice = billingService.newInvoice(subscription.getCustomerId(),
                Invoice.InvoiceKind.ADJUSTMENT, subscription.getCurrency());
        invoice.setSubscriptionId(subscription.getId());
        invoice.setOrderId(subscription.getOrderId());
        invoices.save(invoice);

        InvoiceLine line = new InvoiceLine(invoice.getId(),
                "Quantity change (" + deltaQuantity.toPlainString() + " units, "
                        + effectiveDate + " to " + subscription.getPeriodEnd() + ")",
                deltaQuantity, subscription.getUnitIntervalPriceMinor(),
                adjustment.netMinor(), subscription.getTaxRateBp(), adjustment.taxMinor());
        line.setSubscriptionId(subscription.getId());
        line.setCoverage(effectiveDate, subscription.getPeriodEnd());
        line.setLineType(InvoiceLine.LineType.PRORATION);
        // Keyed on the change, so replaying the request cannot raise it twice.
        line.setChargeKey(InvoiceLine.adjustmentChargeKey(subscription.getId(), effectiveDate,
                subscription.getPeriodEnd(), change.getId()));
        invoiceLines.save(line);
        invoice.addLineTotals(adjustment.netMinor(), adjustment.taxMinor());

        LocalDate businessToday = clock.businessToday();
        invoice.issue(businessToday, businessToday.plusDays(properties.billing().invoiceDueDays()));

        outbox.publish(OutboxWriter.Events.INVOICE_UPDATED, "Invoice", invoice.getId(),
                invoice.getRowVersion(), Map.of("kind", "ADJUSTMENT"),
                OutboxWriter.RecipientScope.deal(subscription.getCustomerId(), null, null));

        return invoice.getId();
    }

    private CreditNote raiseCreditNote(Subscription subscription, SubscriptionChange change,
                                       long netMinor, long taxMinor, LocalDate coverageStart,
                                       LocalDate coverageEnd, String reason, Actor actor) {
        CreditNote note = new CreditNote("CN-" + creditNotes.nextReferenceNumber(),
                subscription.getCustomerId(), subscription.getCurrency(), reason,
                netMinor, taxMinor, actor.profileId());
        note.setSubscriptionId(subscription.getId());
        note.setSubscriptionChangeId(change.getId());
        note.setCoverage(coverageStart, coverageEnd);
        creditNotes.save(note);

        audit.record(actor, "CREDIT_NOTE_ISSUED", "CreditNote", note.getId())
                .after(Map.of("reference", note.getReference(), "totalMinor", note.getTotalMinor(),
                        "subscriptionId", subscription.getId().toString()))
                .reason(reason)
                .save();
        return note;
    }

    /**
     * Validates and defaults the effective date.
     *
     * <p>Refuses anything before today and anything outside the open period. A
     * future-dated change belongs to a scheduled change, not to a silently
     * clamped immediate one.
     */
    private LocalDate resolveEffectiveDate(Subscription subscription, LocalDate requested) {
        LocalDate businessToday = clock.businessToday();
        LocalDate effectiveDate = requested == null ? businessToday : requested;

        if (effectiveDate.isBefore(businessToday)) {
            throw ApiException.of(ErrorCode.BACKDATED_CHANGE_REJECTED,
                    "A change cannot take effect before today. Use a scheduled change for a future "
                            + "date, or contact finance for a historical correction.",
                    "requested", effectiveDate.toString(), "businessDate", businessToday.toString());
        }
        if (effectiveDate.isBefore(subscription.getPeriodStart())
                || !effectiveDate.isBefore(subscription.getPeriodEnd())) {
            throw ApiException.of(ErrorCode.EFFECTIVE_DATE_OUT_OF_PERIOD,
                    "The effective date must fall inside the current period ("
                            + subscription.getPeriodStart() + " to " + subscription.getPeriodEnd() + ").",
                    "periodStart", subscription.getPeriodStart().toString(),
                    "periodEnd", subscription.getPeriodEnd().toString());
        }
        return effectiveDate;
    }

    private void requireLive(Subscription subscription) {
        if (!subscription.getStatus().isLive()) {
            throw ApiException.of(ErrorCode.SUBSCRIPTION_NOT_ACTIVE,
                    "This subscription is " + subscription.getStatus().name().toLowerCase() + ".",
                    "status", subscription.getStatus().name());
        }
    }

    private static CancellationPolicy parsePolicy(String value) {
        try {
            return CancellationPolicy.valueOf(value.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "policy must be END_OF_PERIOD or IMMEDIATE_PRORATED.");
        }
    }

    private String snapshot(Subscription subscription) {
        return objectMapper.writeValueAsString(Map.of(
                "quantity", subscription.getQuantity().toPlainString(),
                "unitIntervalPriceMinor", subscription.getUnitIntervalPriceMinor(),
                "intervalMonths", subscription.getIntervalMonths(),
                "periodStart", subscription.getPeriodStart().toString(),
                "periodEnd", subscription.getPeriodEnd().toString(),
                "status", subscription.getStatus().name()));
    }

    private String snapshotWithQuantity(Subscription subscription, BigDecimal quantity) {
        return objectMapper.writeValueAsString(Map.of(
                "quantity", quantity.toPlainString(),
                "unitIntervalPriceMinor", subscription.getUnitIntervalPriceMinor(),
                "intervalMonths", subscription.getIntervalMonths(),
                "periodStart", subscription.getPeriodStart().toString(),
                "periodEnd", subscription.getPeriodEnd().toString(),
                "status", subscription.getStatus().name()));
    }

    private SubscriptionChangePreview toPreview(Subscription subscription, String changeType,
                                                LocalDate effectiveDate, BigDecimal newQuantity,
                                                ProrationCalculator.Adjustment adjustment,
                                                UUID adjustmentInvoiceId, UUID creditNoteId,
                                                boolean applied) {
        String explanation = adjustment.netMinor() == 0
                ? "No adjustment is due for the remainder of this period."
                : (adjustment.isCharge() ? "Additional charge of " : "Credit of ")
                        + Money.format(adjustment.absoluteNetMinor()) + " for "
                        + adjustment.remainingDays() + " of " + adjustment.totalDays()
                        + " days remaining in the period.";

        return new SubscriptionChangePreview(subscription.getId(), changeType, effectiveDate,
                subscription.getPeriodStart(), subscription.getPeriodEnd(),
                adjustment.remainingDays(), adjustment.totalDays(), adjustment.remainingFraction(),
                subscription.getQuantity(), newQuantity,
                Money.toMajor(adjustment.netMinor()), Money.toMajor(adjustment.taxMinor()),
                explanation, adjustmentInvoiceId, creditNoteId, applied);
    }

    /** Returns the outcome of a change that was already applied under this key. */
    private SubscriptionChangePreview replayOf(Subscription subscription, SubscriptionChange change) {
        log.debug("Replaying subscription change {} for key {}", change.getId(), change.getRequestKey());
        return new SubscriptionChangePreview(subscription.getId(), change.getChangeType().name(),
                change.getEffectiveDate(), subscription.getPeriodStart(), subscription.getPeriodEnd(),
                BusinessCalendar.days(change.getEffectiveDate(), subscription.getPeriodEnd()),
                BusinessCalendar.days(subscription.getPeriodStart(), subscription.getPeriodEnd()),
                BigDecimal.ZERO, subscription.getQuantity(), subscription.getQuantity(),
                BigDecimal.ZERO, BigDecimal.ZERO,
                "This change was already applied; no further adjustment was raised.",
                change.getAdjustmentInvoiceId(), change.getCreditNoteId(), true);
    }
}
