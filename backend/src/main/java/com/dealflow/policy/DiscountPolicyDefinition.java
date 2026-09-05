package com.dealflow.policy;

import com.dealflow.catalog.CatalogEnums.CustomerTier;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * The editable half of discount governance, stored as JSON on an immutable
 * policy version.
 *
 * <p>Every number here is a commercial policy choice, not a rule handed down by
 * the brief. They are stored versioned so that changing a ceiling today cannot
 * retroactively change whether a quotation submitted last week needed finance
 * approval: each submitted revision keeps the version it was judged against.
 *
 * <p>Boundary conventions are fixed and tested, because "over 12%" and "12% or
 * more" route differently at exactly 12%:
 * <ul>
 *   <li>manager triggers use <em>strictly</em> greater / strictly less;</li>
 *   <li>finance triggers use <em>at least</em> / strictly less for margin.</li>
 * </ul>
 */
public record DiscountPolicyDefinition(
        @NotNull Map<CustomerTier, BigDecimal> tierCeilingPercent,
        /** Keyed by category CODE, so renaming a category does not move its ceiling. */
        @NotNull Map<String, BigDecimal> categoryCeilingPercent,
        @NotNull ManagerTriggers manager,
        @NotNull FinanceTriggers finance) {

    /**
     * Step 1. Any excess at all is enough: a rep may not concede beyond the
     * configured ceiling without someone saying yes.
     */
    public record ManagerTriggers(
            boolean anyPositiveExcess,
            /** Aggregate concession budget: strictly above this routes to manager. */
            BigDecimal aggregateDiscountPercentAbove,
            /** Strictly below this overall margin routes to manager. */
            BigDecimal aggregateMarginPercentBelow) {
    }

    /**
     * Step 2. Reached when the concession is deep on one line, broad across the
     * quotation, large in absolute money, or destroys the margin.
     */
    public record FinanceTriggers(
            /** Worst single line, in percentage points over its ceiling (M). */
            BigDecimal worstLineExcessPpAtLeast,
            /** Value-weighted excess across the quotation (W). */
            BigDecimal weightedExcessPpAtLeast,
            /** Total money conceded beyond ceilings (E), in minor units. */
            Long excessValueMinorAtLeast,
            BigDecimal aggregateMarginPercentBelow,
            /** A line that sells at a positive price yet earns nothing or loses money. */
            boolean nonPositiveLineContribution) {
    }

    /**
     * The ceiling that applies to one line: the tighter of the customer's tier
     * ceiling and the line's category ceiling. A category with no configured
     * ceiling falls back to the tier ceiling alone.
     */
    public BigDecimal allowedPercentFor(CustomerTier tier, String categoryCode) {
        BigDecimal tierCeiling = tierCeilingPercent.get(tier);
        BigDecimal categoryCeiling = categoryCeilingPercent.get(categoryCode);
        if (tierCeiling == null && categoryCeiling == null) {
            return BigDecimal.ZERO;
        }
        if (tierCeiling == null) {
            return categoryCeiling;
        }
        if (categoryCeiling == null) {
            return tierCeiling;
        }
        return tierCeiling.min(categoryCeiling);
    }

    /** The illustrative seed policy from the plan. Editable at runtime. */
    public static DiscountPolicyDefinition seedDefault() {
        Map<CustomerTier, BigDecimal> tiers = new LinkedHashMap<>();
        tiers.put(CustomerTier.BRONZE, new BigDecimal("5"));
        tiers.put(CustomerTier.SILVER, new BigDecimal("10"));
        tiers.put(CustomerTier.GOLD, new BigDecimal("15"));

        Map<String, BigDecimal> categories = new LinkedHashMap<>();
        categories.put("HARDWARE", new BigDecimal("15"));
        categories.put("SERVICE", new BigDecimal("10"));
        categories.put("SUBSCRIPTION", new BigDecimal("10"));

        return new DiscountPolicyDefinition(
                tiers,
                categories,
                new ManagerTriggers(true, new BigDecimal("12"), new BigDecimal("20")),
                new FinanceTriggers(new BigDecimal("8"), new BigDecimal("3"), 500_000L,
                        new BigDecimal("15"), true));
    }
}
