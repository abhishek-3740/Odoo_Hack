package com.dealflow.approvals.models;


import com.dealflow.approvals.repo.*;
import com.dealflow.approvals.service.*;
import com.dealflow.approvals.dto.*;
import com.dealflow.approvals.controller.*;
import com.dealflow.auth.models.Role;
import com.dealflow.quotes.models.QuoteEnums.ApprovalRequestStatus;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * One step of the approval chain for one revision.
 *
 * <p>Step 1 is the manager, step 2 is finance, and the database enforces both
 * the pairing and one row per {@code (revision, step)}. Finance never decides
 * while step 1 is still pending — the sequence is a business rule, not a UI
 * ordering (edge case E05).
 *
 * <p>Requests belong to a <em>revision</em>, not to the quotation. Editing the
 * terms supersedes the pending steps rather than carrying them forward, so an
 * approval can never be inherited by terms the approver never saw.
 *
 * <p>Reassignment changes {@code assigneeProfileId} and keeps
 * {@code originalAssigneeProfileId}. It moves who is asked; it never removes the
 * requirement that someone qualified actually says yes (edge case E07).
 */
@Entity
@Table(name = "approval_requests")
public class ApprovalRequest extends TimestampedEntity {

    @Column(name = "quote_id", nullable = false, updatable = false)
    private UUID quoteId;

    @Column(name = "revision_id", nullable = false, updatable = false)
    private UUID revisionId;

    /** 1 = manager, 2 = finance. */
    @Column(name = "step", nullable = false, updatable = false)
    private int step;

    @Enumerated(EnumType.STRING)
    @Column(name = "required_role", nullable = false, updatable = false)
    private Role requiredRole;

    @Column(name = "team_id")
    private UUID teamId;

    @Column(name = "assignee_profile_id")
    private UUID assigneeProfileId;

    @Column(name = "original_assignee_profile_id")
    private UUID originalAssigneeProfileId;

    @Column(name = "due_at")
    private Instant dueAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private ApprovalRequestStatus status = ApprovalRequestStatus.PENDING;

    /** The risk reasons as they stood at submission, so the approver sees the case. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "reasons", nullable = false)
    private String reasons = "[]";

    @Column(name = "decided_by_profile_id")
    private UUID decidedByProfileId;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "decision_reason")
    private String decisionReason;

    @Column(name = "reassignment_reason")
    private String reassignmentReason;

    @Version
    @Column(name = "row_version", nullable = false)
    private long rowVersion;

    protected ApprovalRequest() {
    }

    public ApprovalRequest(UUID quoteId, UUID revisionId, int step, Role requiredRole,
                           UUID teamId, Instant dueAt) {
        this.quoteId = quoteId;
        this.revisionId = revisionId;
        this.step = step;
        this.requiredRole = requiredRole;
        this.teamId = teamId;
        this.dueAt = dueAt;
    }

    public boolean isPending() {
        return status == ApprovalRequestStatus.PENDING;
    }

    public void decide(ApprovalRequestStatus decision, UUID actorProfileId, Instant when, String reason) {
        this.status = decision;
        this.decidedByProfileId = actorProfileId;
        this.decidedAt = when;
        this.decisionReason = reason;
    }

    /** Retires a step because the terms it referred to no longer exist. */
    public void supersede() {
        this.status = ApprovalRequestStatus.SUPERSEDED;
    }

    public void assignTo(UUID profileId) {
        if (this.originalAssigneeProfileId == null) {
            this.originalAssigneeProfileId = this.assigneeProfileId;
        }
        this.assigneeProfileId = profileId;
    }

    public void reassignTo(UUID profileId, String reason) {
        if (this.originalAssigneeProfileId == null) {
            this.originalAssigneeProfileId = this.assigneeProfileId;
        }
        this.assigneeProfileId = profileId;
        this.reassignmentReason = reason;
    }

    public UUID getQuoteId() {
        return quoteId;
    }

    public UUID getRevisionId() {
        return revisionId;
    }

    public int getStep() {
        return step;
    }

    public Role getRequiredRole() {
        return requiredRole;
    }

    public UUID getTeamId() {
        return teamId;
    }

    public UUID getAssigneeProfileId() {
        return assigneeProfileId;
    }

    public UUID getOriginalAssigneeProfileId() {
        return originalAssigneeProfileId;
    }

    public Instant getDueAt() {
        return dueAt;
    }

    public void setDueAt(Instant dueAt) {
        this.dueAt = dueAt;
    }

    public ApprovalRequestStatus getStatus() {
        return status;
    }

    public String getReasons() {
        return reasons;
    }

    public void setReasons(String reasons) {
        this.reasons = reasons;
    }

    public UUID getDecidedByProfileId() {
        return decidedByProfileId;
    }

    public Instant getDecidedAt() {
        return decidedAt;
    }

    public String getDecisionReason() {
        return decisionReason;
    }

    public String getReassignmentReason() {
        return reassignmentReason;
    }

    public long getRowVersion() {
        return rowVersion;
    }
}
