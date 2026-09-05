package com.dealflow.jobs;

import com.dealflow.auth.Actor;
import com.dealflow.billing.BillingService;
import com.dealflow.billing.Subscription;
import com.dealflow.billing.SubscriptionChange;
import com.dealflow.billing.SubscriptionChangeRepository;
import com.dealflow.billing.SubscriptionRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.shared.time.BusinessClock;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Raises recurring charges that have fallen due.
 *
 * <h2>Each subscription is its own transaction</h2>
 *
 * <p>The sweep finds due subscriptions, then charges each one in a separate
 * {@code REQUIRES_NEW} transaction under a row lock. One bad subscription fails
 * alone; the other twenty-four in the batch still bill. A batch is bounded, and
 * whatever is left stays due for the next run.
 *
 * <h2>Catch-up bills each missed interval once</h2>
 *
 * <p>A subscription that is three periods behind after an outage is charged
 * period by period — {@code next_bill_at} advances one interval per pass — and
 * the unique charge key on each period guarantees none is charged twice, even if
 * two sweeps overlap (test T19).
 *
 * <p>Jobs run as the SYSTEM actor. A scheduled charge is never signed with a
 * person's name.
 */
@Service
public class RecurringBillingJob {

    public static final String JOB_NAME = "recurring-billing";
    private static final Logger log = LoggerFactory.getLogger(RecurringBillingJob.class);

    private final SubscriptionRepository subscriptions;
    private final SubscriptionChangeRepository changes;
    private final BillingService billingService;
    private final JobRunRepository jobRuns;
    private final JobLeaseService leases;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;
    private final AppProperties properties;

    public RecurringBillingJob(SubscriptionRepository subscriptions, SubscriptionChangeRepository changes,
                               BillingService billingService, JobRunRepository jobRuns,
                               JobLeaseService leases, BusinessClock clock, ObjectMapper objectMapper,
                               AppProperties properties) {
        this.subscriptions = subscriptions;
        this.changes = changes;
        this.billingService = billingService;
        this.jobRuns = jobRuns;
        this.leases = leases;
        this.clock = clock;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    public record RunSummary(UUID jobRunId, int processed, int failed, boolean skippedNoLease) {
    }

    /** Runs one bounded batch. Safe to call from the scheduler or by hand. */
    public RunSummary run(JobRun.Trigger trigger) {
        if (!leases.tryAcquire(JOB_NAME, Duration.ofSeconds(properties.jobs().leaseSeconds()))) {
            log.debug("Recurring billing already running elsewhere; skipping");
            return new RunSummary(null, 0, 0, true);
        }
        LocalDate businessToday = clock.businessToday();
        JobRun run = jobRuns.save(new JobRun(JOB_NAME, businessToday, trigger, clock.now()));

        int processed = 0;
        int failed = 0;
        try {
            List<UUID> due = subscriptions.findDue(businessToday,
                            Limit.of(properties.jobs().billingBatchSize())).stream()
                    .map(Subscription::getId)
                    .toList();
            for (UUID subscriptionId : due) {
                try {
                    chargeOne(subscriptionId, businessToday);
                    processed++;
                } catch (Exception ex) {
                    failed++;
                    log.error("Recurring charge failed for subscription {}", subscriptionId, ex);
                }
            }
            run.finish(failed == 0 ? JobRun.Status.SUCCESS : JobRun.Status.FAILED, processed, failed,
                    due.isEmpty() ? "Nothing due" : processed + " charged, " + failed + " failed",
                    clock.now());
        } catch (Exception ex) {
            run.finish(JobRun.Status.FAILED, processed, failed + 1, ex.getMessage(), clock.now());
            log.error("Recurring billing sweep failed", ex);
        } finally {
            jobRuns.save(run);
            leases.release(JOB_NAME);
        }
        return new RunSummary(run.getId(), processed, failed, false);
    }

    /**
     * Charges one subscription in its own transaction.
     *
     * <p>Re-reads the row under a lock: the "due" list was computed a moment ago
     * without one, and the subscription may have been cancelled since.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, rollbackFor = Exception.class)
    public void chargeOne(UUID subscriptionId, LocalDate businessToday) {
        Subscription subscription = subscriptions.findByIdForUpdate(subscriptionId).orElse(null);
        if (subscription == null || subscription.getNextBillAt() == null
                || subscription.getNextBillAt().isAfter(businessToday)
                || !subscription.getStatus().isLive()) {
            return;
        }
        applyScheduledChanges(subscription);
        billingService.chargeNextPeriod(subscription, Actor.system());
    }

    /**
     * Applies quantity changes deferred to the next period.
     *
     * <p>A {@code NEXT_PERIOD} plan records the change and leaves the current
     * period untouched. When the following period is about to be billed, the
     * recorded new quantity takes effect here — before the charge is computed.
     */
    private void applyScheduledChanges(Subscription subscription) {
        LocalDate boundary = subscription.getPeriodEnd();
        for (SubscriptionChange change : changes.findBySubscriptionIdOrderByEffectiveDateAsc(
                subscription.getId())) {
            if (change.getChangeType() != SubscriptionChange.ChangeType.QUANTITY) {
                continue;
            }
            if (change.getEffectiveDate().isAfter(boundary)) {
                continue;
            }
            BigDecimal newQuantity = quantityFrom(change.getNewSnapshot());
            if (newQuantity != null && newQuantity.compareTo(subscription.getQuantity()) != 0
                    && change.getAdjustmentInvoiceId() == null && change.getCreditNoteId() == null
                    && !change.getEffectiveDate().isBefore(subscription.getPeriodStart())) {
                // A recorded change with no adjustment is a deferred one. Apply it
                // now so the next period bills at the new quantity.
                subscription.setQuantity(newQuantity);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private BigDecimal quantityFrom(String snapshotJson) {
        try {
            Map<String, Object> snapshot = objectMapper.readValue(snapshotJson, Map.class);
            Object quantity = snapshot.get("quantity");
            return quantity == null ? null : new BigDecimal(quantity.toString());
        } catch (RuntimeException ex) {
            log.warn("Unreadable subscription change snapshot: {}", ex.getMessage());
            return null;
        }
    }
}
