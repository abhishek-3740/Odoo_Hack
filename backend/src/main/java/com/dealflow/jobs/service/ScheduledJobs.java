package com.dealflow.jobs.service;


import com.dealflow.jobs.models.*;
import com.dealflow.jobs.repo.*;
import com.dealflow.jobs.controller.*;
import com.dealflow.health.service.DealHealthService;
import com.dealflow.quotes.models.Quote;
import com.dealflow.quotes.models.QuoteEnums.Stage;
import com.dealflow.quotes.repo.QuoteRepository;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.time.BusinessClock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The minute sweep: billing, deal health, and quotation expiry.
 *
 * <p>Runs in the persistent backend, independent of any browser being open.
 * Each sweep is leased so two instances of the same sweep cannot overlap, and
 * each is idempotent so an overlap would be harmless anyway.
 *
 * <p>Disabled entirely with {@code dealflow.jobs.enabled=false}, which the
 * integration tests use so a sweep cannot race a test's own assertions.
 */
@Component
@ConditionalOnProperty(prefix = "dealflow.jobs", name = "enabled", havingValue = "true", matchIfMissing = true)
public class ScheduledJobs {

    public static final String HEALTH_JOB = "deal-health";
    public static final String EXPIRY_JOB = "quote-expiry";
    private static final Logger log = LoggerFactory.getLogger(ScheduledJobs.class);

    private final RecurringBillingJob billingJob;
    private final DealHealthService healthService;
    private final QuoteRepository quotes;
    private final JobLeaseService leases;
    private final JobRunRepository jobRuns;
    private final AuditService audit;
    private final BusinessClock clock;

    public ScheduledJobs(RecurringBillingJob billingJob, DealHealthService healthService,
                         QuoteRepository quotes, JobLeaseService leases, JobRunRepository jobRuns,
                         AuditService audit, BusinessClock clock) {
        this.billingJob = billingJob;
        this.healthService = healthService;
        this.quotes = quotes;
        this.leases = leases;
        this.jobRuns = jobRuns;
        this.audit = audit;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "PT60S", initialDelayString = "PT20S")
    public void billingSweep() {
        try {
            billingJob.run(JobRun.Trigger.SCHEDULED);
        } catch (Exception ex) {
            log.error("Billing sweep failed", ex);
        }
    }

    @Scheduled(fixedDelayString = "PT60S", initialDelayString = "PT40S")
    public void healthSweep() {
        if (!leases.tryAcquire(HEALTH_JOB, Duration.ofSeconds(110))) {
            return;
        }
        JobRun run = jobRuns.save(new JobRun(HEALTH_JOB, clock.businessToday(),
                JobRun.Trigger.SCHEDULED, clock.now()));
        try {
            var summary = healthService.sweepAll();
            run.finish(JobRun.Status.SUCCESS, summary.opened(), 0,
                    summary.opened() + " conditions open, " + summary.resolved() + " resolved", clock.now());
        } catch (Exception ex) {
            run.finish(JobRun.Status.FAILED, 0, 1, ex.getMessage(), clock.now());
            log.error("Health sweep failed", ex);
        } finally {
            jobRuns.save(run);
            leases.release(HEALTH_JOB);
        }
    }

    @Scheduled(fixedDelayString = "PT60S", initialDelayString = "PT50S")
    public void expirySweep() {
        if (!leases.tryAcquire(EXPIRY_JOB, Duration.ofSeconds(110))) {
            return;
        }
        try {
            int expired = expireQuotes();
            if (expired > 0) {
                log.info("Marked {} quotations as expired", expired);
            }
        } catch (Exception ex) {
            log.error("Expiry sweep failed", ex);
        } finally {
            leases.release(EXPIRY_JOB);
        }
    }

    /**
     * Moves open quotations past their validity date to EXPIRED.
     *
     * <p>An expired quotation cannot be accepted or finalised — that gate is
     * checked independently on every command — so this is a visibility change,
     * not the enforcement mechanism.
     */
    @Transactional
    public int expireQuotes() {
        List<Quote> expired = quotes.findExpired(
                List.of(Stage.DRAFT, Stage.REVIEW, Stage.SENT, Stage.UNDER_NEGOTIATION),
                clock.businessToday());
        for (Quote quote : expired) {
            quote.setStage(Stage.EXPIRED);
            audit.recordSystem("QUOTE_EXPIRED", "Quote", quote.getId())
                    .quote(quote.getId())
                    .after(Map.of("validUntil", String.valueOf(quote.getValidUntil())))
                    .save();
        }
        return expired.size();
    }
}
