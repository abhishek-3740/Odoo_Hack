package com.dealflow.health.models;


import com.dealflow.health.repo.*;
import com.dealflow.health.service.*;
import com.dealflow.health.controller.*;
import com.dealflow.health.models.AlertEnums.AlertStatus;
import com.dealflow.health.models.AlertEnums.AlertType;
import com.dealflow.health.models.AlertEnums.Severity;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An open condition somebody should look at.
 *
 * <p>{@code dedupeKey} is unique and identifies the real-world condition, not the
 * moment it was noticed. Re-running the sweep refreshes {@code lastSeenAt}
 * instead of stacking a fresh alert every minute, and when the condition clears
 * the same row is resolved rather than left to accumulate.
 *
 * <p>Every alert carries the reasons that produced it. These are risk indicators
 * computed from stated thresholds — not predictions, and not accusations about
 * the person who owns the deal.
 */
@Entity
@Table(name = "alerts")
public class Alert extends TimestampedEntity {

    @Enumerated(EnumType.STRING)
    @Column(name = "alert_type", nullable = false, updatable = false)
    private AlertType alertType;

    @Enumerated(EnumType.STRING)
    @Column(name = "severity", nullable = false)
    private Severity severity = Severity.WARNING;

    @Column(name = "dedupe_key", nullable = false, unique = true, updatable = false)
    private String dedupeKey;

    @Column(name = "title", nullable = false)
    private String title;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "reasons", nullable = false)
    private String reasons = "[]";

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private AlertStatus status = AlertStatus.OPEN;

    @Column(name = "quote_id")
    private UUID quoteId;

    @Column(name = "order_id")
    private UUID orderId;

    @Column(name = "subscription_id")
    private UUID subscriptionId;

    @Column(name = "invoice_id")
    private UUID invoiceId;

    @Column(name = "variant_id")
    private UUID variantId;

    @Column(name = "owner_profile_id")
    private UUID ownerProfileId;

    @Column(name = "team_id")
    private UUID teamId;

    @Column(name = "first_seen_at", nullable = false)
    private Instant firstSeenAt;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    @Column(name = "last_nudged_at")
    private Instant lastNudgedAt;

    @Column(name = "nudge_count", nullable = false)
    private int nudgeCount;

    protected Alert() {
    }

    public Alert(AlertType alertType, Severity severity, String dedupeKey, String title, Instant now) {
        this.alertType = alertType;
        this.severity = severity;
        this.dedupeKey = dedupeKey;
        this.title = title;
        this.firstSeenAt = now;
        this.lastSeenAt = now;
    }

    /** The condition is still true. Keeps the original first-seen time. */
    public void refresh(Instant now, String title, String reasons, Severity severity) {
        this.lastSeenAt = now;
        this.title = title;
        this.reasons = reasons;
        this.severity = severity;
        if (this.status == AlertStatus.RESOLVED) {
            // Reopened: the condition came back.
            this.status = AlertStatus.OPEN;
            this.resolvedAt = null;
            this.firstSeenAt = now;
        }
    }

    public void resolve(Instant now) {
        this.status = AlertStatus.RESOLVED;
        this.resolvedAt = now;
    }

    public void recordNudge(Instant now) {
        this.lastNudgedAt = now;
        this.nudgeCount++;
    }

    /** Rate limit so a manager is not notified about the same deal every hour. */
    public boolean canNudgeAt(Instant now, java.time.Duration cooldown) {
        return lastNudgedAt == null || lastNudgedAt.plus(cooldown).isBefore(now);
    }

    public AlertType getAlertType() {
        return alertType;
    }

    public Severity getSeverity() {
        return severity;
    }

    public void setSeverity(Severity severity) {
        this.severity = severity;
    }

    public String getDedupeKey() {
        return dedupeKey;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getReasons() {
        return reasons;
    }

    public void setReasons(String reasons) {
        this.reasons = reasons;
    }

    public AlertStatus getStatus() {
        return status;
    }

    public UUID getQuoteId() {
        return quoteId;
    }

    public void setQuoteId(UUID quoteId) {
        this.quoteId = quoteId;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public void setOrderId(UUID orderId) {
        this.orderId = orderId;
    }

    public UUID getSubscriptionId() {
        return subscriptionId;
    }

    public void setSubscriptionId(UUID subscriptionId) {
        this.subscriptionId = subscriptionId;
    }

    public UUID getInvoiceId() {
        return invoiceId;
    }

    public void setInvoiceId(UUID invoiceId) {
        this.invoiceId = invoiceId;
    }

    public UUID getVariantId() {
        return variantId;
    }

    public void setVariantId(UUID variantId) {
        this.variantId = variantId;
    }

    public UUID getOwnerProfileId() {
        return ownerProfileId;
    }

    public void setOwnerProfileId(UUID ownerProfileId) {
        this.ownerProfileId = ownerProfileId;
    }

    public UUID getTeamId() {
        return teamId;
    }

    public void setTeamId(UUID teamId) {
        this.teamId = teamId;
    }

    public Instant getFirstSeenAt() {
        return firstSeenAt;
    }

    public Instant getLastSeenAt() {
        return lastSeenAt;
    }

    public Instant getResolvedAt() {
        return resolvedAt;
    }

    public Instant getLastNudgedAt() {
        return lastNudgedAt;
    }

    public int getNudgeCount() {
        return nudgeCount;
    }
}
