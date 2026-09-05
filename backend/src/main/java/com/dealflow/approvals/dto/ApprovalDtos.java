package com.dealflow.approvals.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** The approval API surface. */
public final class ApprovalDtos {

    private ApprovalDtos() {
    }

    /** What an approver can do with a step. */
    public enum Decision {
        APPROVE,
        REJECT,
        /** Sends it back to the rep. The current attempt is closed, not paused. */
        RETURN_FOR_REVISION
    }

    public record DecisionRequest(
            @NotNull Decision decision,
            /* Guards against deciding a step whose terms have since been
             * replaced. A mismatch is a 409, never a silent decision on the
             * wrong version. */
            UUID expectedRevisionId,
            Long expectedRowVersion,
            @Size(max = 1000) String reason) {
    }

    /** Administrator hand-off to a qualified backup. */
    public record ReassignRequest(
            @NotNull UUID assigneeProfileId,
            @NotNull @Size(min = 3, max = 500) String reason) {
    }

    public record ApprovalReasonDto(
            String code,
            String lineKey,
            String description,
            BigDecimal observedValue,
            BigDecimal thresholdValue,
            String unit,
            String requiredLevel,
            String message) {
    }

    /** A step in the approver's queue, with enough context to decide. */
    public record ApprovalQueueItem(
            UUID id,
            UUID quoteId,
            String quoteReference,
            String customerName,
            UUID revisionId,
            int revisionNo,
            int step,
            String requiredRole,
            String status,
            UUID assigneeProfileId,
            String assigneeName,
            Instant dueAt,
            boolean overdue,
            /** False while an earlier step is still pending. */
            boolean actionable,
            String blockedReason,
            String currency,
            BigDecimal oneTimeNet,
            BigDecimal recurringFirstCycleNet,
            BigDecimal contributionPercent,
            BigDecimal worstLineExcessPp,
            List<ApprovalReasonDto> reasons,
            Instant createdAt) {
    }

    public record DecisionResponse(
            UUID approvalRequestId,
            String stepStatus,
            String revisionApprovalStatus,
            /** Set when this decision completed the last gate and created an order. */
            UUID orderId,
            String finalizationStatus,
            List<String> remainingGates) {
    }
}
