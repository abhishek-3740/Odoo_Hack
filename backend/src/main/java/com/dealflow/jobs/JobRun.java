package com.dealflow.jobs;

import com.dealflow.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;

/**
 * One execution of a scheduled job, kept so "did billing run last night" has a
 * database answer rather than a log-grep answer.
 */
@Entity
@Table(name = "job_runs")
public class JobRun extends BaseEntity {

    public enum Status {
        RUNNING, SUCCESS, FAILED
    }

    public enum Trigger {
        SCHEDULED, MANUAL
    }

    @Column(name = "job_name", nullable = false, updatable = false)
    private String jobName;

    @Column(name = "business_date")
    private LocalDate businessDate;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private Status status = Status.RUNNING;

    @Enumerated(EnumType.STRING)
    @Column(name = "trigger_kind", nullable = false)
    private Trigger trigger = Trigger.SCHEDULED;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "processed_count", nullable = false)
    private int processedCount;

    @Column(name = "failure_count", nullable = false)
    private int failureCount;

    @Column(name = "message")
    private String message;

    protected JobRun() {
    }

    public JobRun(String jobName, LocalDate businessDate, Trigger trigger, Instant startedAt) {
        this.jobName = jobName;
        this.businessDate = businessDate;
        this.trigger = trigger;
        this.startedAt = startedAt;
    }

    public void finish(Status status, int processed, int failures, String message, Instant when) {
        this.status = status;
        this.processedCount = processed;
        this.failureCount = failures;
        this.message = message;
        this.finishedAt = when;
    }

    public String getJobName() {
        return jobName;
    }

    public LocalDate getBusinessDate() {
        return businessDate;
    }

    public Status getStatus() {
        return status;
    }

    public Trigger getTrigger() {
        return trigger;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }

    public int getProcessedCount() {
        return processedCount;
    }

    public int getFailureCount() {
        return failureCount;
    }

    public String getMessage() {
        return message;
    }
}
