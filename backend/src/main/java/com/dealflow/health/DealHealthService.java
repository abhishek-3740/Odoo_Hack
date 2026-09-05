package com.dealflow.health;

import com.dealflow.approvals.ApprovalRequest;
import com.dealflow.approvals.ApprovalRequestRepository;
import com.dealflow.auth.Actor;
import com.dealflow.auth.Profile;
import com.dealflow.auth.ProfileRepository;
import com.dealflow.auth.Role;
import com.dealflow.billing.Invoice;
import com.dealflow.billing.InvoiceRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.fulfillment.Backorder;
import com.dealflow.fulfillment.BackorderRepository;
import com.dealflow.fulfillment.StockLevel;
import com.dealflow.fulfillment.StockLevelRepository;
import com.dealflow.health.AlertEnums.AlertStatus;
import com.dealflow.health.AlertEnums.AlertType;
import com.dealflow.health.AlertEnums.Severity;
import com.dealflow.orders.OrderLine;
import com.dealflow.orders.OrderLineRepository;
import com.dealflow.outbox.OutboxWriter;
import com.dealflow.quotes.Quote;
import com.dealflow.quotes.QuoteEnums.Stage;
import com.dealflow.quotes.QuoteRepository;
import com.dealflow.quotes.QuoteRevisionRepository;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.time.BusinessClock;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Finds deals and orders that need attention, and keeps the alert list honest.
 *
 * <h2>Elapsed time, not local dates</h2>
 *
 * <p>"Stalled for 72 hours" is a {@link Duration} between two {@link Instant}s.
 * It gives the same answer whether the process runs in Mumbai, New York or UTC,
 * and it does not shift when the clocks change. Subtracting local date strings —
 * the obvious-looking implementation — silently disagrees with itself across
 * timezones (edge case E21).
 *
 * <h2>Activity is not progress</h2>
 *
 * <p>The stall sweep reads {@code awaitingExternalSince}, which only a customer
 * response or a real approver decision clears. A rep nudging a quantity every
 * afternoon updates {@code lastActivityAt} and nothing else, so small repeated
 * edits cannot hide a deal that has been waiting a week (edge case E22).
 *
 * <h2>Every alert can be resolved</h2>
 *
 * <p>Alerts are keyed on the condition, not the moment of detection. Re-running a
 * sweep refreshes the existing row; when the condition clears — stock arrives,
 * the customer replies — the same row is resolved rather than left to rot.
 */
@Service
public class DealHealthService {

    private static final Logger log = LoggerFactory.getLogger(DealHealthService.class);

    private static final List<Stage> OPEN_STAGES = List.of(
            Stage.DRAFT, Stage.REVIEW, Stage.SENT, Stage.UNDER_NEGOTIATION);

    private final AlertRepository alerts;
    private final NotificationRepository notifications;
    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final ApprovalRequestRepository approvals;
    private final BackorderRepository backorders;
    private final OrderLineRepository orderLines;
    private final StockLevelRepository stockLevels;
    private final InvoiceRepository invoices;
    private final ProfileRepository profiles;
    private final DiscountAnomalyDetector anomalyDetector;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;
    private final AppProperties properties;

    public DealHealthService(AlertRepository alerts, NotificationRepository notifications,
                             QuoteRepository quotes, QuoteRevisionRepository revisions,
                             ApprovalRequestRepository approvals, BackorderRepository backorders,
                             OrderLineRepository orderLines, StockLevelRepository stockLevels,
                             InvoiceRepository invoices, ProfileRepository profiles,
                             DiscountAnomalyDetector anomalyDetector, AuditService audit,
                             OutboxWriter outbox, BusinessClock clock, ObjectMapper objectMapper,
                             AppProperties properties) {
        this.alerts = alerts;
        this.notifications = notifications;
        this.quotes = quotes;
        this.revisions = revisions;
        this.approvals = approvals;
        this.backorders = backorders;
        this.orderLines = orderLines;
        this.stockLevels = stockLevels;
        this.invoices = invoices;
        this.profiles = profiles;
        this.anomalyDetector = anomalyDetector;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    public record SweepSummary(int opened, int refreshed, int resolved) {
    }

    /** Runs every time-based health rule. Called by the scheduler and manually. */
    @Transactional(rollbackFor = Exception.class)
    public SweepSummary sweepAll() {
        Instant now = clock.now();
        LocalDate businessToday = clock.businessToday();
        Set<String> stillOpen = new HashSet<>();

        int touched = 0;
        touched += sweepStalledQuotes(now, stillOpen);
        touched += sweepOverdueApprovals(now, stillOpen);
        touched += sweepDeliverySlippage(businessToday, now, stillOpen);
        touched += sweepLowStock(now, stillOpen);
        touched += sweepOverdueInvoices(businessToday, now, stillOpen);

        int resolved = resolveClearedAlerts(stillOpen, now);
        return new SweepSummary(touched, touched, resolved);
    }

    // -------------------------------------------------------------- stalled

    private int sweepStalledQuotes(Instant now, Set<String> stillOpen) {
        Duration threshold = Duration.ofHours(properties.health().stalledAfterHours());
        Instant cutoff = now.minus(threshold);

        List<Quote> stalled = quotes.findStalled(OPEN_STAGES, cutoff);
        for (Quote quote : stalled) {
            // Elapsed time between instants: independent of where this runs.
            Duration waiting = Duration.between(quote.getAwaitingExternalSince(), now);
            long hours = waiting.toHours();

            String key = "STALLED_QUOTE:" + quote.getId();
            stillOpen.add(key);

            List<Map<String, Object>> reasons = List.of(Map.of(
                    "code", "NO_EXTERNAL_PROGRESS",
                    "hoursWaiting", hours,
                    "thresholdHours", threshold.toHours(),
                    "since", quote.getAwaitingExternalSince().toString(),
                    "message", "No customer response or approval decision for " + hours + " hours."));

            upsert(AlertType.STALLED_QUOTE, hours > threshold.toHours() * 2
                            ? Severity.CRITICAL : Severity.WARNING, key,
                    quote.getReference() + " has had no progress for " + hours + " hours",
                    reasons, now, alert -> {
                        alert.setQuoteId(quote.getId());
                        alert.setOwnerProfileId(quote.getOwnerProfileId());
                        alert.setTeamId(quote.getTeamId());
                    });
        }
        return stalled.size();
    }

    // ------------------------------------------------------------ approvals

    private int sweepOverdueApprovals(Instant now, Set<String> stillOpen) {
        List<ApprovalRequest> overdue = approvals.findOverdue(now);
        for (ApprovalRequest step : overdue) {
            String key = "APPROVAL_OVERDUE:" + step.getId();
            stillOpen.add(key);
            long hours = Duration.between(step.getDueAt(), now).toHours();

            upsert(AlertType.APPROVAL_OVERDUE, Severity.WARNING, key,
                    "Approval step " + step.getStep() + " is " + hours + " hours overdue",
                    List.of(Map.of("code", "APPROVAL_OVERDUE",
                            "requiredRole", step.getRequiredRole().name(),
                            "hoursOverdue", hours,
                            "message", "This step has been pending past its due time.")),
                    now, alert -> {
                        alert.setQuoteId(step.getQuoteId());
                        alert.setTeamId(step.getTeamId());
                    });
        }

        // A pending step with nobody qualified and available is an operational
        // problem that must be visible. It is never treated as approval.
        int unassigned = 0;
        for (ApprovalRequest step : approvals.findAllPending()) {
            if (step.getAssigneeProfileId() != null) {
                continue;
            }
            List<Profile> available = profiles.findAvailableApprovers(
                    step.getRequiredRole(), step.getTeamId(), now);
            if (!available.isEmpty()) {
                continue;
            }
            String key = "NO_APPROVER:" + step.getId();
            stillOpen.add(key);
            unassigned++;

            upsert(AlertType.NO_APPROVER, Severity.CRITICAL, key,
                    "No available " + step.getRequiredRole().name().toLowerCase()
                            + " to approve step " + step.getStep(),
                    List.of(Map.of("code", "NO_AVAILABLE_APPROVER",
                            "requiredRole", step.getRequiredRole().name(),
                            "message", "This quotation is blocked until an administrator reassigns "
                                    + "the step to a qualified backup.")),
                    now, alert -> {
                        alert.setQuoteId(step.getQuoteId());
                        alert.setTeamId(step.getTeamId());
                    });
        }
        return overdue.size() + unassigned;
    }

    // ------------------------------------------------------------- delivery

    private int sweepDeliverySlippage(LocalDate businessToday, Instant now, Set<String> stillOpen) {
        List<Backorder> open = backorders.findAllOpen();
        int flagged = 0;

        for (Backorder backorder : open) {
            OrderLine line = orderLines.findById(backorder.getOrderLineId()).orElse(null);
            if (line == null) {
                continue;
            }

            boolean pastPromise = line.getPromisedDate() != null
                    && businessToday.isAfter(line.getPromisedDate());
            boolean receiptTooLate = backorder.getExpectedDate() != null
                    && line.getPromisedDate() != null
                    && backorder.getExpectedDate().isAfter(line.getPromisedDate());
            if (!pastPromise && !receiptTooLate) {
                continue;
            }

            String key = "DELIVERY_SLIPPAGE:" + backorder.getId();
            stillOpen.add(key);
            flagged++;

            List<Map<String, Object>> reasons = new ArrayList<>();
            if (pastPromise) {
                reasons.add(Map.of("code", "PAST_PROMISED_DATE",
                        "promisedDate", line.getPromisedDate().toString(),
                        "outstandingQuantity", backorder.getQuantity().toPlainString(),
                        "message", backorder.getQuantity().toPlainString()
                                + " units are still unshipped past the promised date."));
            }
            if (receiptTooLate) {
                reasons.add(Map.of("code", "RESTOCK_AFTER_PROMISE",
                        "expectedDate", backorder.getExpectedDate().toString(),
                        "promisedDate", line.getPromisedDate().toString(),
                        "message", "Stock is not expected until after the promised date."));
            }
            if (backorder.getExpectedDate() == null) {
                // Say what is true: we do not know. No fabricated estimate.
                reasons.add(Map.of("code", "DELIVERY_DATE_UNCONFIRMED",
                        "message", "Delivery date unconfirmed: no expected receipt is recorded "
                                + "for this item."));
            }

            upsert(AlertType.DELIVERY_SLIPPAGE, Severity.CRITICAL, key,
                    "Delivery slipping on " + line.getDescription(), reasons, now, alert -> {
                        alert.setOrderId(backorder.getOrderId());
                        alert.setVariantId(backorder.getVariantId());
                    });
        }
        return flagged;
    }

    // ---------------------------------------------------------------- stock

    private int sweepLowStock(Instant now, Set<String> stillOpen) {
        List<StockLevel> low = stockLevels.findNeedingReplenishment();
        for (StockLevel level : low) {
            String key = "LOW_STOCK:" + level.getVariantId() + ":" + level.getWarehouseId();
            stillOpen.add(key);

            upsert(AlertType.LOW_STOCK, Severity.INFO, key,
                    "Stock at or below its reorder point",
                    List.of(Map.of("code", "BELOW_REORDER_POINT",
                            "available", level.available().toPlainString(),
                            "reorderPoint", level.getReorderPoint().toPlainString(),
                            "suggestedOrderQuantity", level.replenishmentSuggestion().toPlainString(),
                            "message", "Available " + level.available().toPlainString()
                                    + " is at or below the reorder point of "
                                    + level.getReorderPoint().toPlainString() + ".")),
                    now, alert -> alert.setVariantId(level.getVariantId()));
        }
        return low.size();
    }

    // ------------------------------------------------------------- invoices

    private int sweepOverdueInvoices(LocalDate businessToday, Instant now, Set<String> stillOpen) {
        List<Invoice> overdue = invoices.findOverdue(businessToday);
        for (Invoice invoice : overdue) {
            String key = "INVOICE_OVERDUE:" + invoice.getId();
            stillOpen.add(key);
            long daysOverdue = java.time.temporal.ChronoUnit.DAYS.between(
                    invoice.getDueDate(), businessToday);

            upsert(AlertType.INVOICE_OVERDUE, daysOverdue > 30 ? Severity.CRITICAL : Severity.WARNING,
                    key, "Invoice " + invoice.getReference() + " is " + daysOverdue + " days overdue",
                    List.of(Map.of("code", "INVOICE_PAST_DUE",
                            "dueDate", invoice.getDueDate().toString(),
                            "outstandingMinor", invoice.outstandingMinor(),
                            "message", com.dealflow.shared.money.Money.format(
                                    invoice.outstandingMinor()) + " remains outstanding.")),
                    now, alert -> alert.setInvoiceId(invoice.getId()));
        }
        return overdue.size();
    }

    // ------------------------------------------------------------- anomaly

    /**
     * Compares a quotation's discount to the rep's own history.
     *
     * <p>Called at submission rather than on a timer, because it is a property of
     * the terms rather than of elapsed time.
     */
    @Transactional(rollbackFor = Exception.class)
    public DiscountAnomalyDetector.Verdict evaluateDiscountAnomaly(Quote quote, Actor actor) {
        var revision = revisions.findById(quote.getCurrentRevisionId()).orElse(null);
        if (revision == null || revision.getTotalBaseMinor() <= 0) {
            return null;
        }
        BigDecimal currentPercent = BigDecimal.valueOf(revision.getTotalDiscountMinor())
                .multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(revision.getTotalBaseMinor()), 4,
                        java.math.RoundingMode.HALF_UP);

        // The rep's own finalised quotations, excluding this one so a deal never
        // contributes to the statistics judging it.
        List<Double> history = revisions.findHistoricalDiscountPercents(
                quote.getOwnerProfileId(), quote.getId());

        var verdict = anomalyDetector.evaluate(currentPercent, history);
        Instant now = clock.now();
        String key = "DISCOUNT_ANOMALY:" + quote.getId();

        if (verdict.anomalous()) {
            upsert(AlertType.DISCOUNT_ANOMALY, Severity.WARNING, key,
                    "Unusual discount on " + quote.getReference(),
                    List.of(Map.of("code", "DISCOUNT_OUTSIDE_REP_PATTERN",
                            "currentPercent", verdict.currentPercent().toPlainString(),
                            "meanPercent", verdict.meanPercent().toPlainString(),
                            "observations", verdict.observations(),
                            "message", verdict.explanation())),
                    now, alert -> {
                        alert.setQuoteId(quote.getId());
                        alert.setOwnerProfileId(quote.getOwnerProfileId());
                        alert.setTeamId(quote.getTeamId());
                    });
        } else {
            alerts.findByDedupeKey(key)
                    .filter(alert -> alert.getStatus() == AlertStatus.OPEN)
                    .ifPresent(alert -> alert.resolve(now));
        }
        return verdict;
    }

    // ---------------------------------------------------------------- nudge

    /**
     * Creates a durable, assigned task from an alert.
     *
     * <p>Rate-limited per alert, so following up does not become a stream of
     * identical messages, and audited so "who chased this" has an answer.
     */
    @Transactional(rollbackFor = Exception.class)
    public Notification nudge(UUID alertId, String message, Actor actor) {
        Alert alert = alerts.findById(alertId)
                .orElseThrow(() -> ApiException.notFound("Alert " + alertId));

        Instant now = clock.now();
        Duration cooldown = Duration.ofHours(properties.health().nudgeCooldownHours());
        if (!alert.canNudgeAt(now, cooldown)) {
            throw ApiException.of(com.dealflow.shared.error.ErrorCode.RATE_LIMITED,
                    "This alert was already followed up recently. Try again later.",
                    "lastNudgedAt", String.valueOf(alert.getLastNudgedAt()));
        }

        UUID recipient = alert.getOwnerProfileId();
        String type = "NUDGE";
        if (recipient == null || actor.profileId().equals(recipient)) {
            // Escalate: no owner, or the owner is the one asking. Send it to a
            // manager rather than to the person raising it.
            recipient = profiles.findActiveByRole(Role.MANAGER).stream()
                    .filter(profile -> !profile.getId().equals(actor.profileId()))
                    .map(Profile::getId).findFirst().orElse(recipient);
            type = "ESCALATION";
        }
        if (recipient == null) {
            throw ApiException.of(com.dealflow.shared.error.ErrorCode.NO_AVAILABLE_APPROVER,
                    "There is nobody to notify about this alert.");
        }

        String dedupeKey = type + ":" + alert.getId() + ":" + now.toEpochMilli();
        Notification notification = new Notification(recipient, type, alert.getTitle());
        notification.setBody(message == null ? alert.getTitle() : message);
        notification.setAlertId(alert.getId());
        notification.setQuoteId(alert.getQuoteId());
        notification.setOrderId(alert.getOrderId());
        notification.setDedupeKey(dedupeKey);
        notifications.save(notification);

        alert.recordNudge(now);

        audit.record(actor, "ALERT_" + type, "Alert", alert.getId())
                .quote(alert.getQuoteId())
                .after(Map.of("recipientProfileId", recipient.toString(), "type", type))
                .reason(message)
                .save();

        outbox.publish(OutboxWriter.Events.ALERT_UPDATED, "Alert", alert.getId(), 0L,
                Map.of("type", type, "alertType", alert.getAlertType().name()),
                OutboxWriter.RecipientScope.owner(recipient));

        return notification;
    }

    // -------------------------------------------------------------- helpers

    /** Creates or refreshes the alert for a condition, keyed on the condition. */
    private void upsert(AlertType type, Severity severity, String dedupeKey, String title,
                        List<Map<String, Object>> reasons, Instant now,
                        java.util.function.Consumer<Alert> decorate) {
        String reasonsJson = objectMapper.writeValueAsString(reasons);
        Alert alert = alerts.findByDedupeKey(dedupeKey).orElse(null);

        if (alert == null) {
            alert = new Alert(type, severity, dedupeKey, title, now);
            alert.setReasons(reasonsJson);
            decorate.accept(alert);
            alerts.save(alert);

            outbox.publish(OutboxWriter.Events.ALERT_UPDATED, "Alert", alert.getId(), 0L,
                    Map.of("alertType", type.name(), "severity", severity.name()),
                    alert.getOwnerProfileId() == null
                            ? OutboxWriter.RecipientScope.roles(Role.MANAGER.name(), Role.FINANCE.name())
                            : OutboxWriter.RecipientScope.owner(alert.getOwnerProfileId()));
        } else {
            alert.refresh(now, title, reasonsJson, severity);
            decorate.accept(alert);
        }
    }

    /**
     * Closes alerts whose condition no longer holds.
     *
     * <p>Only time-based types are auto-resolved. An anomaly alert is resolved by
     * re-evaluating the quotation, not by a sweep that never looked at it.
     */
    private int resolveClearedAlerts(Set<String> stillOpen, Instant now) {
        Set<AlertType> sweptTypes = Set.of(AlertType.STALLED_QUOTE, AlertType.APPROVAL_OVERDUE,
                AlertType.DELIVERY_SLIPPAGE, AlertType.LOW_STOCK, AlertType.INVOICE_OVERDUE,
                AlertType.NO_APPROVER);

        List<Alert> open = alerts.findByStatus(AlertStatus.OPEN);
        int resolved = 0;
        for (Alert alert : open) {
            if (!sweptTypes.contains(alert.getAlertType())) {
                continue;
            }
            if (stillOpen.contains(alert.getDedupeKey())) {
                continue;
            }
            alert.resolve(now);
            resolved++;

            outbox.publish(OutboxWriter.Events.ALERT_UPDATED, "Alert", alert.getId(), 0L,
                    Map.of("status", "RESOLVED", "alertType", alert.getAlertType().name()),
                    alert.getOwnerProfileId() == null
                            ? OutboxWriter.RecipientScope.roles(Role.MANAGER.name())
                            : OutboxWriter.RecipientScope.owner(alert.getOwnerProfileId()));
        }
        if (resolved > 0) {
            log.debug("Resolved {} alerts whose conditions cleared", resolved);
        }
        return resolved;
    }
}
