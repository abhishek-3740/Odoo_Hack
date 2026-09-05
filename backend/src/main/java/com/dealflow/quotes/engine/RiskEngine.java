package com.dealflow.quotes.engine;

import com.dealflow.catalog.CatalogEnums.CustomerTier;
import com.dealflow.policy.DiscountPolicyDefinition;
import com.dealflow.quotes.engine.PricingModel.LineResult;
import com.dealflow.quotes.engine.PricingModel.PricingResult;
import com.dealflow.quotes.engine.RiskModel.ApprovalLevel;
import com.dealflow.quotes.engine.RiskModel.LineRisk;
import com.dealflow.quotes.engine.RiskModel.RiskReason;
import com.dealflow.quotes.engine.RiskModel.RiskResult;
import com.dealflow.shared.money.Bp;
import com.dealflow.shared.money.Money;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Decides how far a quotation must travel for approval, and says why.
 *
 * <p>Four measures, computed from the priced lines:
 * <pre>
 *   allowed_i  = min(tier ceiling, category ceiling)
 *   excess_i   = max(0, effective_discount_i − allowed_i)      in points
 *   value_i    = base_i · excess_i / 100                        in money
 *
 *   M = max(excess_i)                     worst single line
 *   W = Σ value_i / Σ base_i · 100        value-weighted excess
 *   E = Σ value_i                         total money conceded
 *   D = total discount / total base · 100 overall discount
 * </pre>
 *
 * <p>Three design decisions worth stating explicitly, because each one closes a
 * way of gaming the route:
 *
 * <ol>
 *   <li><b>{@code max(0, …)} per line, before any aggregation.</b> A line that is
 *       five points <em>under</em> its ceiling contributes zero, never a negative
 *       offset. Otherwise a large compliant line could mathematically cancel a
 *       small abusive one and the quotation would score as risk-free (E02).</li>
 *   <li><b>Value-weighted, not summed percentages.</b> Adding raw percentage
 *       excesses across rows makes the result depend on how many rows the deal
 *       is split into. Splitting one line into ten identical smaller lines
 *       leaves M, W and E unchanged here, so it cannot lower the route (E01).</li>
 *   <li><b>An aggregate ceiling in addition to per-line ones.</b> Discounts that
 *       are each individually permissible can still exceed what the business is
 *       willing to concede on one deal.</li>
 * </ol>
 *
 * <p>Promotion flags have no effect at all in this class. A promoted item ranks
 * higher in the recommendation panel and is judged by exactly the same ceilings
 * as everything else (E04).
 */
@Component
public class RiskEngine {

    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    public RiskResult evaluate(PricingResult pricing, CustomerTier tier,
                               DiscountPolicyDefinition policy, int policyVersionNo) {

        List<LineRisk> lineRisks = new ArrayList<>(pricing.lines().size());
        List<RiskReason> reasons = new ArrayList<>();

        BigDecimal worstExcessPp = BigDecimal.ZERO;
        BigDecimal excessValueExact = BigDecimal.ZERO;
        long totalBase = 0;

        for (LineResult line : pricing.lines()) {
            BigDecimal effectivePercent = Bp.toPercent(line.effectiveDiscountBp());
            BigDecimal allowedPercent = policy.allowedPercentFor(tier, line.categoryCode());
            BigDecimal excessPp = effectivePercent.subtract(allowedPercent).max(BigDecimal.ZERO);

            BigDecimal lineExcessValue = BigDecimal.valueOf(line.baseMinor())
                    .multiply(excessPp, Money.CALC)
                    .divide(HUNDRED, Money.CALC);

            excessValueExact = excessValueExact.add(lineExcessValue);
            totalBase = Money.sum(totalBase, line.baseMinor());
            worstExcessPp = worstExcessPp.max(excessPp);

            lineRisks.add(new LineRisk(
                    line.lineKey(), line.description(), line.categoryCode(),
                    effectivePercent, allowedPercent, excessPp,
                    Money.round(lineExcessValue), line.baseMinor(),
                    line.marginMinor(), line.marginPercent()));

            if (excessPp.signum() > 0) {
                reasons.add(new RiskReason(
                        "LINE_DISCOUNT_OVER_CEILING", line.lineKey(), line.description(),
                        effectivePercent, allowedPercent, "percent", ApprovalLevel.MANAGER,
                        "\"" + line.description() + "\" is discounted " + trim(effectivePercent)
                                + "%, which is " + trim(excessPp) + " points over its "
                                + trim(allowedPercent) + "% ceiling."));
            }

            // A line sold at a positive price that earns nothing, or loses money,
            // is a finance decision regardless of how small the discount looks.
            if (line.netMinor() > 0 && line.marginMinor() <= 0) {
                reasons.add(new RiskReason(
                        "LINE_NON_POSITIVE_CONTRIBUTION", line.lineKey(), line.description(),
                        BigDecimal.valueOf(line.marginMinor()), BigDecimal.ZERO, "minor",
                        policy.finance().nonPositiveLineContribution()
                                ? ApprovalLevel.MANAGER_FINANCE : ApprovalLevel.MANAGER,
                        "\"" + line.description() + "\" contributes "
                                + Money.format(line.marginMinor()) + " at a selling price of "
                                + Money.format(line.netMinor()) + "."));
            }
        }

        long excessValueMinor = Money.round(excessValueExact);
        BigDecimal weightedExcessPp = totalBase == 0
                ? BigDecimal.ZERO
                : excessValueExact.multiply(HUNDRED, Money.CALC)
                        .divide(BigDecimal.valueOf(totalBase), 4, RoundingMode.HALF_UP);
        BigDecimal aggregateDiscountPercent = totalBase == 0
                ? BigDecimal.ZERO
                : BigDecimal.valueOf(pricing.totalDiscountMinor()).multiply(HUNDRED, Money.CALC)
                        .divide(BigDecimal.valueOf(totalBase), 4, RoundingMode.HALF_UP);
        BigDecimal aggregateMarginPercent = pricing.contributionPercent();

        DiscountPolicyDefinition.ManagerTriggers manager = policy.manager();
        DiscountPolicyDefinition.FinanceTriggers finance = policy.finance();

        // ---- manager triggers: strictly greater / strictly less ----
        if (manager.anyPositiveExcess() && excessValueMinor > 0 && reasons.isEmpty()) {
            // Excess exists but produced no per-line reason (rounding to a sub-paisa
            // value); still record it so the route is explainable.
            reasons.add(new RiskReason("AGGREGATE_EXCESS_PRESENT", null, "Quotation",
                    weightedExcessPp, BigDecimal.ZERO, "pp", ApprovalLevel.MANAGER,
                    "This quotation concedes " + Money.format(excessValueMinor)
                            + " beyond the configured ceilings."));
        }
        if (manager.aggregateDiscountPercentAbove() != null
                && aggregateDiscountPercent.compareTo(manager.aggregateDiscountPercentAbove()) > 0) {
            reasons.add(new RiskReason("AGGREGATE_DISCOUNT_OVER_CEILING", null, "Quotation",
                    aggregateDiscountPercent, manager.aggregateDiscountPercentAbove(), "percent",
                    ApprovalLevel.MANAGER,
                    "The overall discount is " + trim(aggregateDiscountPercent)
                            + "%, above the " + trim(manager.aggregateDiscountPercentAbove())
                            + "% limit for a single deal."));
        }
        if (manager.aggregateMarginPercentBelow() != null && aggregateMarginPercent != null
                && aggregateMarginPercent.compareTo(manager.aggregateMarginPercentBelow()) < 0) {
            reasons.add(new RiskReason("AGGREGATE_MARGIN_BELOW_FLOOR", null, "Quotation",
                    aggregateMarginPercent, manager.aggregateMarginPercentBelow(), "percent",
                    ApprovalLevel.MANAGER,
                    "Quotation contribution is " + trim(aggregateMarginPercent)
                            + "%, below the " + trim(manager.aggregateMarginPercentBelow()) + "% floor."));
        }

        // ---- finance triggers: at least / strictly below for margin ----
        if (finance.worstLineExcessPpAtLeast() != null
                && worstExcessPp.compareTo(finance.worstLineExcessPpAtLeast()) >= 0) {
            reasons.add(new RiskReason("WORST_LINE_EXCESS", null, "Quotation",
                    worstExcessPp, finance.worstLineExcessPpAtLeast(), "pp", ApprovalLevel.MANAGER_FINANCE,
                    "One line is " + trim(worstExcessPp) + " points over its ceiling, at or above the "
                            + trim(finance.worstLineExcessPpAtLeast()) + "-point finance threshold."));
        }
        if (finance.weightedExcessPpAtLeast() != null
                && weightedExcessPp.compareTo(finance.weightedExcessPpAtLeast()) >= 0) {
            reasons.add(new RiskReason("WEIGHTED_EXCESS", null, "Quotation",
                    weightedExcessPp, finance.weightedExcessPpAtLeast(), "pp", ApprovalLevel.MANAGER_FINANCE,
                    "Value-weighted excess is " + trim(weightedExcessPp) + " points, at or above the "
                            + trim(finance.weightedExcessPpAtLeast()) + "-point finance threshold."));
        }
        if (finance.excessValueMinorAtLeast() != null
                && excessValueMinor >= finance.excessValueMinorAtLeast()) {
            reasons.add(new RiskReason("EXCESS_CONCESSION_VALUE", null, "Quotation",
                    BigDecimal.valueOf(excessValueMinor),
                    BigDecimal.valueOf(finance.excessValueMinorAtLeast()), "minor",
                    ApprovalLevel.MANAGER_FINANCE,
                    "Total concession beyond ceilings is " + Money.format(excessValueMinor)
                            + ", at or above the " + Money.format(finance.excessValueMinorAtLeast())
                            + " finance threshold."));
        }
        if (finance.aggregateMarginPercentBelow() != null && aggregateMarginPercent != null
                && aggregateMarginPercent.compareTo(finance.aggregateMarginPercentBelow()) < 0) {
            reasons.add(new RiskReason("AGGREGATE_MARGIN_BELOW_FINANCE_FLOOR", null, "Quotation",
                    aggregateMarginPercent, finance.aggregateMarginPercentBelow(), "percent",
                    ApprovalLevel.MANAGER_FINANCE,
                    "Quotation contribution is " + trim(aggregateMarginPercent)
                            + "%, below the " + trim(finance.aggregateMarginPercentBelow())
                            + "% finance floor."));
        }

        // The route is the strictest reason, and finance always follows manager:
        // MANAGER_FINANCE means both steps, in that order, never finance alone.
        ApprovalLevel required = ApprovalLevel.NONE;
        for (RiskReason reason : reasons) {
            required = required.max(reason.requiredLevel());
        }

        return new RiskResult(required, List.copyOf(reasons), List.copyOf(lineRisks),
                worstExcessPp, weightedExcessPp, excessValueMinor,
                aggregateDiscountPercent, aggregateMarginPercent,
                totalBase, pricing.totalDiscountMinor(), policyVersionNo);
    }

    /** Renders 8.0000 as "8" and 0.8333 as "0.83" for readable reason text. */
    private static String trim(BigDecimal value) {
        if (value == null) {
            return "n/a";
        }
        BigDecimal rounded = value.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros();
        return rounded.scale() <= 0 ? rounded.toBigInteger().toString() : rounded.toPlainString();
    }
}
