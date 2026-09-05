package com.dealflow.jobs.controller;


import com.dealflow.jobs.models.*;
import com.dealflow.jobs.repo.*;
import com.dealflow.jobs.service.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.health.service.DealHealthService;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.constraints.NotNull;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.Limit;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Manual job control for finance and administrators.
 *
 * <p>Runs the same implementation the scheduler runs, so a manual catch-up
 * after an outage behaves exactly like the automatic one — including all of its
 * idempotency guarantees.
 */
@RestController
@RequestMapping("/api/v1/internal/job-runs")
@PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
public class JobController {

    public record RunRequest(@NotNull String jobName) {
    }

    private final RecurringBillingJob billingJob;
    private final DealHealthService healthService;
    private final ScheduledJobs scheduledJobs;
    private final JobRunRepository jobRuns;
    private final AuditService audit;

    public JobController(RecurringBillingJob billingJob, DealHealthService healthService,
                         org.springframework.beans.factory.ObjectProvider<ScheduledJobs> scheduledJobs,
                         JobRunRepository jobRuns, AuditService audit) {
        this.billingJob = billingJob;
        this.healthService = healthService;
        this.scheduledJobs = scheduledJobs.getIfAvailable();
        this.jobRuns = jobRuns;
        this.audit = audit;
    }

    @PostMapping
    public ApiResponse<Map<String, Object>> run(@RequestBody RunRequest request, Actor actor) {
        Map<String, Object> outcome = switch (request.jobName()) {
            case RecurringBillingJob.JOB_NAME -> {
                var summary = billingJob.run(JobRun.Trigger.MANUAL);
                yield Map.of("job", RecurringBillingJob.JOB_NAME, "processed", summary.processed(),
                        "failed", summary.failed(), "skippedNoLease", summary.skippedNoLease());
            }
            case ScheduledJobs.HEALTH_JOB -> {
                var summary = healthService.sweepAll();
                yield Map.of("job", ScheduledJobs.HEALTH_JOB, "open", summary.opened(),
                        "resolved", summary.resolved());
            }
            case ScheduledJobs.EXPIRY_JOB -> {
                if (scheduledJobs == null) {
                    throw new ApiException(ErrorCode.CONFLICTING_STATE, "Scheduled jobs are disabled.");
                }
                yield Map.of("job", ScheduledJobs.EXPIRY_JOB, "expired", scheduledJobs.expireQuotes());
            }
            default -> throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "Unknown job. Use recurring-billing, deal-health or quote-expiry.");
        };
        audit.record(actor, "JOB_RUN_MANUAL", "Job", null)
                .after(Map.of("jobName", request.jobName()))
                .save();
        return ApiResponse.of(outcome);
    }

    @GetMapping
    public ApiResponse<List<Map<String, Object>>> recent() {
        return ApiResponse.of(jobRuns.findAllByOrderByStartedAtDesc(Limit.of(50)).stream()
                .map(run -> Map.<String, Object>of(
                        "id", run.getId(), "jobName", run.getJobName(), "status", run.getStatus().name(),
                        "trigger", run.getTrigger().name(), "businessDate", String.valueOf(run.getBusinessDate()),
                        "startedAt", run.getStartedAt(), "finishedAt", String.valueOf(run.getFinishedAt()),
                        "processed", run.getProcessedCount(), "failed", run.getFailureCount(),
                        "message", String.valueOf(run.getMessage())))
                .toList());
    }
}
