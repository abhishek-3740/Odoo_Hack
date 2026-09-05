package com.dealflow.quotes.models;


import com.dealflow.quotes.repo.*;
import com.dealflow.quotes.service.*;
import com.dealflow.quotes.dto.*;
import com.dealflow.quotes.controller.*;
import com.dealflow.quotes.models.QuoteEnums.Stage;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * The container for a deal. Every commercial fact lives on a revision.
 *
 * <h2>Two clocks, on purpose</h2>
 *
 * <p>{@code lastActivityAt} moves whenever anyone touches the quotation.
 * {@code lastProgressAt} moves only when something real happens: the customer
 * responds or accepts, or an approver decides. A rep nudging a quantity every
 * afternoon is activity, not progress, and must not silently reset the stall
 * timer (edge case E22).
 *
 * <p>{@code awaitingExternalSince} is the start of the current wait for someone
 * outside the sales team. It deliberately survives revision loops: re-sending a
 * quotation for the fourth time does not restart the clock on how long the
 * customer has been silent.
 */
@Entity
@Table(name = "quotes")
public class Quote extends TimestampedEntity {

    @Column(name = "reference", nullable = false, unique = true, updatable = false)
    private String reference;

    @Column(name = "customer_id", nullable = false, updatable = false)
    private UUID customerId;

    @Column(name = "owner_profile_id", nullable = false)
    private UUID ownerProfileId;

    @Column(name = "team_id")
    private UUID teamId;

    @Column(name = "title")
    private String title;

    @Column(name = "current_revision_id")
    private UUID currentRevisionId;

    @Enumerated(EnumType.STRING)
    @Column(name = "stage", nullable = false)
    private Stage stage = Stage.DRAFT;

    @Column(name = "valid_until")
    private LocalDate validUntil;

    @Column(name = "last_activity_at", nullable = false)
    private Instant lastActivityAt;

    @Column(name = "last_progress_at", nullable = false)
    private Instant lastProgressAt;

    @Column(name = "awaiting_external_since")
    private Instant awaitingExternalSince;

    @Column(name = "revision_count", nullable = false)
    private int revisionCount;

    /**
     * Optimistic version. A stale edit loses and the caller is told to refresh,
     * rather than overwriting someone else's change.
     */
    @Version
    @Column(name = "row_version", nullable = false)
    private long rowVersion;

    protected Quote() {
    }

    public Quote(String reference, UUID customerId, UUID ownerProfileId, UUID teamId, Instant now) {
        this.reference = reference;
        this.customerId = customerId;
        this.ownerProfileId = ownerProfileId;
        this.teamId = teamId;
        this.lastActivityAt = now;
        this.lastProgressAt = now;
    }

    /** Any edit or comment. Feeds the revision-churn indicator, not the stall timer. */
    public void touchActivity(Instant now) {
        this.lastActivityAt = now;
    }

    /**
     * Real movement: a customer reply or acceptance, or a valid approver
     * decision. Clears the external wait, because someone finally answered.
     */
    public void recordProgress(Instant now) {
        this.lastActivityAt = now;
        this.lastProgressAt = now;
        this.awaitingExternalSince = null;
    }

    /**
     * Starts the wait for an external party, if one is not already running.
     *
     * <p>Idempotent by design — re-submitting keeps the original timestamp, so a
     * quotation that has been with the customer for five days still reads as
     * five days even after three resends.
     */
    public void beginAwaitingExternal(Instant now) {
        this.lastActivityAt = now;
        if (this.awaitingExternalSince == null) {
            this.awaitingExternalSince = now;
        }
    }

    public boolean isExpiredOn(LocalDate businessDate) {
        return validUntil != null && businessDate.isAfter(validUntil);
    }

    public String getReference() {
        return reference;
    }

    public UUID getCustomerId() {
        return customerId;
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

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public UUID getCurrentRevisionId() {
        return currentRevisionId;
    }

    public void setCurrentRevisionId(UUID currentRevisionId) {
        this.currentRevisionId = currentRevisionId;
    }

    public Stage getStage() {
        return stage;
    }

    public void setStage(Stage stage) {
        this.stage = stage;
    }

    public LocalDate getValidUntil() {
        return validUntil;
    }

    public void setValidUntil(LocalDate validUntil) {
        this.validUntil = validUntil;
    }

    public Instant getLastActivityAt() {
        return lastActivityAt;
    }

    public Instant getLastProgressAt() {
        return lastProgressAt;
    }

    public Instant getAwaitingExternalSince() {
        return awaitingExternalSince;
    }

    public int getRevisionCount() {
        return revisionCount;
    }

    public int nextRevisionNo() {
        return ++revisionCount;
    }

    public long getRowVersion() {
        return rowVersion;
    }
}
