package com.dealflow.quotes.models;


import com.dealflow.quotes.repo.*;
import com.dealflow.quotes.service.*;
import com.dealflow.quotes.dto.*;
import com.dealflow.quotes.controller.*;
import java.math.BigDecimal;
import java.util.List;

/** Inputs and outputs of the discount risk engine. */
public final class RiskModel {

    private RiskModel() {
    }

    /** How far a quotation has to travel before it can be executed. */
    public enum ApprovalLevel {
        NONE, MANAGER, MANAGER_FINANCE;

        /** The stricter of two levels. Required approval is the max across all reasons. */
        public ApprovalLevel max(ApprovalLevel other) {
            return ordinal() >= other.ordinal() ? this : other;
        }
    }

    /**
     * Why a level was required, in structured form.
     *
     * <p>Every reason names the rule, the line it came from, the number observed
     * and the threshold it crossed. That is what turns "needs finance approval"
     * into "the service discount is 8 points over its 10% category ceiling",
     * which an approver can actually act on.
     */
    public record RiskReason(
            String code,
            String lineKey,
            String description,
            BigDecimal observedValue,
            BigDecimal thresholdValue,
            String unit,
            ApprovalLevel requiredLevel,
            String message) {
    }

    /** Per-line breakdown, shown next to the line in the builder. */
    public record LineRisk(
            String lineKey,
            String description,
            String categoryCode,
            BigDecimal effectiveDiscountPercent,
            BigDecimal allowedPercent,
            /** max(0, effective − allowed). Never negative: a compliant line
             *  contributes zero, and can never offset another line's breach. */
            BigDecimal excessPp,
            long excessValueMinor,
            long baseMinor,
            long marginMinor,
            BigDecimal marginPercent) {
    }

    /**
     * The complete risk picture.
     *
     * <p>{@code weightedExcessPp} is a value-weighted concession measure in
     * percentage points. It is not a probability and must never be labelled as
     * one on screen.
     */
    public record RiskResult(
            ApprovalLevel requiredLevel,
            List<RiskReason> reasons,
            List<LineRisk> lines,
            /** M — the worst single line's excess, in percentage points. */
            BigDecimal worstLineExcessPp,
            /** W — excess value as a share of total base value, in points. */
            BigDecimal weightedExcessPp,
            /** E — total money conceded beyond ceilings, in minor units. */
            long excessValueMinor,
            /** D — overall effective discount across the quotation. */
            BigDecimal aggregateDiscountPercent,
            BigDecimal aggregateMarginPercent,
            long totalBaseMinor,
            long totalDiscountMinor,
            int policyVersionNo) {

        public boolean requiresApproval() {
            return requiredLevel != ApprovalLevel.NONE;
        }
    }
}
