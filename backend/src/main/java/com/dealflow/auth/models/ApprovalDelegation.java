package com.dealflow.auth.models;


import com.dealflow.auth.repo.*;
import com.dealflow.auth.service.*;
import com.dealflow.auth.controller.*;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A dated stand-in for an unavailable approver.
 *
 * <p>Only ever role-qualified: a delegation can move <em>who</em> is asked, and
 * never removes the requirement that a manager and then finance actually
 * approve. An expired delegation confers nothing (edge case E07).
 */
@Entity
@Table(name = "approval_delegations")
public class ApprovalDelegation extends TimestampedEntity {

    @Enumerated(EnumType.STRING)
    @Column(name = "approver_role", nullable = false)
    private Role approverRole;

    @Column(name = "team_id")
    private UUID teamId;

    @Column(name = "delegate_profile_id", nullable = false)
    private UUID delegateProfileId;

    @Column(name = "valid_from", nullable = false)
    private Instant validFrom;

    @Column(name = "valid_until", nullable = false)
    private Instant validUntil;

    @Column(name = "reason", nullable = false)
    private String reason;

    @Column(name = "created_by_profile_id", nullable = false)
    private UUID createdByProfileId;

    protected ApprovalDelegation() {
    }

    public ApprovalDelegation(Role approverRole, UUID teamId, UUID delegateProfileId,
                              Instant validFrom, Instant validUntil, String reason, UUID createdByProfileId) {
        this.approverRole = approverRole;
        this.teamId = teamId;
        this.delegateProfileId = delegateProfileId;
        this.validFrom = validFrom;
        this.validUntil = validUntil;
        this.reason = reason;
        this.createdByProfileId = createdByProfileId;
    }

    public boolean isValidAt(Instant moment) {
        return !moment.isBefore(validFrom) && moment.isBefore(validUntil);
    }

    public Role getApproverRole() {
        return approverRole;
    }

    public UUID getTeamId() {
        return teamId;
    }

    public UUID getDelegateProfileId() {
        return delegateProfileId;
    }

    public Instant getValidFrom() {
        return validFrom;
    }

    public Instant getValidUntil() {
        return validUntil;
    }

    public String getReason() {
        return reason;
    }

    public UUID getCreatedByProfileId() {
        return createdByProfileId;
    }
}
