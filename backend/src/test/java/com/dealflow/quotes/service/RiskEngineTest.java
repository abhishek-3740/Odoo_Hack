package com.dealflow.quotes.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.policy.models.DiscountPolicyDefinition;
import com.dealflow.quotes.models.PricingModel.LineInput;
import com.dealflow.quotes.models.PricingModel.LineKind;
import com.dealflow.quotes.models.PricingModel.PricingInput;
import com.dealflow.quotes.models.PricingModel.PricingResult;
import com.dealflow.quotes.models.RiskModel.ApprovalLevel;
import com.dealflow.quotes.models.RiskModel.RiskReason;
import com.dealflow.quotes.models.RiskModel.RiskResult;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Verifies discount risk routing against the plan's examples and edge cases. */
class RiskEngineTest {

    private final PricingEngine pricing = new PricingEngine();
    private final RiskEngine risk = new RiskEngine();
    private final DiscountPolicyDefinition policy = DiscountPolicyDefinition.seedDefault();

    private static LineInput oneTime(String key, String description, String categoryCode,
                                     String quantity, long priceMinor, long costMinor, int discountBp) {
        return new LineInput(key, 0, LineKind.ONE_TIME, UUID.randomUUID(), UUID.randomUUID(), categoryCode,
                UUID.randomUUID(), null, description, new BigDecimal(quantity), priceMinor, costMinor,
                0, discountBp, null, true, "MANUAL");
    }

    private static LineInput recurring(String key, String description, String quantity,
                                       long priceMinor, long costMinor, int discountBp) {
        return new LineInput(key, 0, LineKind.RECURRING, UUID.randomUUID(), UUID.randomUUID(), "SUBSCRIPTION",
                null, UUID.randomUUID(), description, new BigDecimal(quantity), priceMinor, costMinor,
                0, discountBp, 1, false, "MANUAL");
    }

    private RiskResult evaluate(CustomerTier tier, int orderDiscountBp, List<LineInput> lines) {
        PricingResult priced = pricing.evaluate(new PricingInput("INR", orderDiscountBp, lines));
        return risk.evaluate(priced, tier, policy, 1);
    }

    private static List<String> codes(RiskResult result) {
        return result.reasons().stream().map(RiskReason::code).toList();
    }

    @Nested
    @DisplayName("Flow B routing (plan section 13.3, test T03)")
    class FlowBRouting {

        private RiskResult flowB() {
            return evaluate(CustomerTier.GOLD, 0, List.of(
                    oneTime("L1", "Laptop", "HARDWARE", "4", 1_000_000L, 700_000L, 1200),
                    oneTime("L2", "Setup service", "SERVICE", "1", 500_000L, 350_000L, 1800),
                    recurring("L3", "Support seat", "10", 30_000L, 12_000L, 0)));
        }

        @Test
        @DisplayName("the service line alone forces manager then finance")
        void serviceLineForcesFinance() {
            RiskResult result = flowB();

            assertThat(result.requiredLevel()).isEqualTo(ApprovalLevel.MANAGER_FINANCE);
            assertThat(codes(result)).contains("LINE_DISCOUNT_OVER_CEILING", "WORST_LINE_EXCESS");
        }

        @Test
        @DisplayName("M is 8 points, E is INR 400 and W is 0.8333 points")
        void metricsMatchTheWorkedExample() {
            RiskResult result = flowB();

            // Gold ceiling 15%, service ceiling 10% -> allowed 10%; charged 18%.
            assertThat(result.worstLineExcessPp()).isEqualByComparingTo(new BigDecimal("8"));
            // 5,000 * 8 / 100 = 400
            assertThat(result.excessValueMinor()).isEqualTo(40_000L);
            // 400 / 48,000 * 100 = 0.8333
            assertThat(result.weightedExcessPp()).isEqualByComparingTo(new BigDecimal("0.8333"));
            assertThat(result.totalBaseMinor()).isEqualTo(4_800_000L);
        }

        @Test
        @DisplayName("finance is reached by the worst-line rule even though blended excess is small")
        void smallBlendedExcessStillRoutesToFinance() {
            RiskResult result = flowB();

            assertThat(result.weightedExcessPp()).isLessThan(policy.finance().weightedExcessPpAtLeast());
            assertThat(result.excessValueMinor()).isLessThan(policy.finance().excessValueMinorAtLeast());
            assertThat(result.requiredLevel()).isEqualTo(ApprovalLevel.MANAGER_FINANCE);
        }

        @Test
        @DisplayName("the hardware line is inside its ceiling and contributes no excess")
        void compliantLineContributesNothing() {
            RiskResult result = flowB();

            assertThat(result.lines()).filteredOn(line -> line.lineKey().equals("L1"))
                    .singleElement()
                    .satisfies(line -> assertThat(line.excessPp()).isEqualByComparingTo(BigDecimal.ZERO));
        }
    }

    @Nested
    @DisplayName("Negative overage cannot cancel a breach (edge case E02)")
    class NegativeOverage {

        private RiskResult twoLines() {
            return evaluate(CustomerTier.GOLD, 0, List.of(
                    // 20% on hardware, ceiling 15% -> 5 points over
                    oneTime("OVER", "Over ceiling", "HARDWARE", "1", 1_000_000L, 100_000L, 2000),
                    // 10% on hardware, ceiling 15% -> 5 points under
                    oneTime("UNDER", "Under ceiling", "HARDWARE", "1", 1_000_000L, 100_000L, 1000)));
        }

        @Test
        @DisplayName("a compliant line contributes zero, never a negative offset")
        void riskIsNotCancelledOut() {
            RiskResult result = twoLines();

            assertThat(result.excessValueMinor()).isEqualTo(50_000L);
            assertThat(result.weightedExcessPp()).isEqualByComparingTo(new BigDecimal("2.5"));
            assertThat(result.worstLineExcessPp()).isEqualByComparingTo(new BigDecimal("5"));
            assertThat(result.requiredLevel()).isNotEqualTo(ApprovalLevel.NONE);
        }
    }

    @Nested
    @DisplayName("Line splitting cannot lower the route (test T04)")
    class LineSplitting {

        @Test
        @DisplayName("splitting one breaching line into ten leaves M, W and E unchanged")
        void splittingIsInvariant() {
            RiskResult whole = evaluate(CustomerTier.GOLD, 0, List.of(
                    oneTime("BIG", "Ten laptops", "HARDWARE", "10", 1_000_000L, 100_000L, 2500)));

            List<LineInput> split = new ArrayList<>(IntStream.range(0, 10)
                    .mapToObj(i -> oneTime("S" + i, "Laptop " + i, "HARDWARE", "1",
                            1_000_000L, 100_000L, 2500))
                    .toList());
            RiskResult pieces = evaluate(CustomerTier.GOLD, 0, split);

            assertThat(pieces.worstLineExcessPp()).isEqualByComparingTo(whole.worstLineExcessPp());
            assertThat(pieces.weightedExcessPp()).isEqualByComparingTo(whole.weightedExcessPp());
            assertThat(pieces.excessValueMinor()).isEqualTo(whole.excessValueMinor());
            assertThat(pieces.requiredLevel()).isEqualTo(whole.requiredLevel());
        }
    }

    @Nested
    @DisplayName("Aggregate ceiling (test T05)")
    class AggregateCeiling {

        @Test
        @DisplayName("individually permissible discounts can still breach the deal-level cap")
        void aggregateCapTriggersOnCompliantLines() {
            // Every line sits exactly on its 15% hardware ceiling, so no line
            // produces excess — but the overall concession is 15% > 12%.
            RiskResult result = evaluate(CustomerTier.GOLD, 0, List.of(
                    oneTime("L1", "Laptop", "HARDWARE", "5", 1_000_000L, 100_000L, 1500),
                    oneTime("L2", "Dock", "HARDWARE", "5", 100_000L, 10_000L, 1500)));

            assertThat(result.worstLineExcessPp()).isEqualByComparingTo(BigDecimal.ZERO);
            assertThat(result.excessValueMinor()).isZero();
            assertThat(codes(result)).contains("AGGREGATE_DISCOUNT_OVER_CEILING");
            assertThat(result.requiredLevel()).isEqualTo(ApprovalLevel.MANAGER);
        }
    }

    @Nested
    @DisplayName("Contribution rules (edge case E03)")
    class ContributionRules {

        @Test
        @DisplayName("zero contribution at a positive price requires finance")
        void zeroContributionRequiresFinance() {
            // Price 100, cost 70, 30% off -> net 70, contribution 0.
            RiskResult result = evaluate(CustomerTier.GOLD, 0, List.of(
                    oneTime("L1", "Break-even item", "HARDWARE", "1", 10_000L, 7_000L, 3000)));

            assertThat(codes(result)).contains("LINE_NON_POSITIVE_CONTRIBUTION");
            assertThat(result.requiredLevel()).isEqualTo(ApprovalLevel.MANAGER_FINANCE);
        }

        @Test
        @DisplayName("selling below cost requires finance")
        void negativeContributionRequiresFinance() {
            // Price 100, cost 70, 50% off -> net 50, contribution -20.
            RiskResult result = evaluate(CustomerTier.GOLD, 0, List.of(
                    oneTime("L1", "Loss-making item", "HARDWARE", "1", 10_000L, 7_000L, 5000)));

            assertThat(codes(result)).contains("LINE_NON_POSITIVE_CONTRIBUTION");
            assertThat(result.requiredLevel()).isEqualTo(ApprovalLevel.MANAGER_FINANCE);
        }
    }

    @Nested
    @DisplayName("Promotion is not an exemption (edge case E04)")
    class PromotionIsNotAnExemption {

        @Test
        @DisplayName("a promoted item is judged by exactly the same ceilings")
        void promotedItemStillBreaches() {
            // The engine never sees a promotion flag; ranking and governance are
            // separate concerns and this test pins that separation down.
            RiskResult result = evaluate(CustomerTier.BRONZE, 0, List.of(
                    oneTime("PROMO", "Promoted dock", "HARDWARE", "1", 100_000L, 10_000L, 2000)));

            // Bronze ceiling 5% is tighter than the 15% hardware ceiling.
            assertThat(result.worstLineExcessPp()).isEqualByComparingTo(new BigDecimal("15"));
            assertThat(result.requiredLevel()).isEqualTo(ApprovalLevel.MANAGER_FINANCE);
        }
    }

    @Nested
    @DisplayName("Clean quotations (plan section 13.2, Flow A)")
    class CleanQuotations {

        @Test
        @DisplayName("an undiscounted quotation needs no approval at all")
        void flowANeedsNoApproval() {
            RiskResult result = evaluate(CustomerTier.BRONZE, 0, List.of(
                    oneTime("L1", "Laptop", "HARDWARE", "2", 1_000_000L, 700_000L, 0),
                    oneTime("L2", "Dock", "HARDWARE", "1", 100_000L, 60_000L, 0)));

            assertThat(result.requiredLevel()).isEqualTo(ApprovalLevel.NONE);
            assertThat(result.reasons()).isEmpty();
            assertThat(result.excessValueMinor()).isZero();
        }
    }

    @Nested
    @DisplayName("Boundary conventions")
    class Boundaries {

        /**
         * A small breaching line next to a large compliant one. This keeps the
         * value-weighted excess far below its own 3-point threshold, so the
         * worst-line rule is the only thing that can move the route and its
         * boundary can be pinned down on its own.
         */
        private RiskResult withSmallBreachAgainstLargeCompliantLine(int breachDiscountBp) {
            return evaluate(CustomerTier.GOLD, 0, List.of(
                    oneTime("BULK", "Ninety-nine laptops", "HARDWARE", "99", 1_000_000L, 100_000L, 0),
                    oneTime("EDGE", "One discounted laptop", "HARDWARE", "1",
                            1_000_000L, 100_000L, breachDiscountBp)));
        }

        @Test
        @DisplayName("the worst-line rule fires at exactly 8 points over, and not at 7.99")
        void worstLineBoundaryIsInclusive() {
            // 23% against the Gold/hardware 15% ceiling is exactly 8 points over.
            RiskResult atThreshold = withSmallBreachAgainstLargeCompliantLine(2300);
            assertThat(atThreshold.worstLineExcessPp()).isEqualByComparingTo(new BigDecimal("8"));
            assertThat(atThreshold.weightedExcessPp()).isLessThan(policy.finance().weightedExcessPpAtLeast());
            assertThat(codes(atThreshold)).contains("WORST_LINE_EXCESS");
            assertThat(atThreshold.requiredLevel()).isEqualTo(ApprovalLevel.MANAGER_FINANCE);

            RiskResult belowThreshold = withSmallBreachAgainstLargeCompliantLine(2299);
            assertThat(belowThreshold.worstLineExcessPp()).isEqualByComparingTo(new BigDecimal("7.99"));
            assertThat(codes(belowThreshold)).doesNotContain("WORST_LINE_EXCESS");
            assertThat(belowThreshold.requiredLevel()).isEqualTo(ApprovalLevel.MANAGER);
        }

        @Test
        @DisplayName("on a single-line quotation the weighted rule binds before the worst-line rule")
        void weightedExcessBindsFirstWhenOneLineIsTheWholeDeal() {
            // With one line, W equals M, so a 3-point breach already reaches
            // finance long before the 8-point worst-line threshold matters.
            RiskResult result = evaluate(CustomerTier.GOLD, 0, List.of(
                    oneTime("ONLY", "Laptop", "HARDWARE", "1", 1_000_000L, 100_000L, 1800)));

            assertThat(result.worstLineExcessPp()).isEqualByComparingTo(new BigDecimal("3"));
            assertThat(result.weightedExcessPp()).isEqualByComparingTo(new BigDecimal("3"));
            assertThat(codes(result)).contains("WEIGHTED_EXCESS").doesNotContain("WORST_LINE_EXCESS");
            assertThat(result.requiredLevel()).isEqualTo(ApprovalLevel.MANAGER_FINANCE);
        }

        @Test
        @DisplayName("the aggregate discount cap is strictly greater, so exactly 12% stays at manager")
        void aggregateCapIsStrictlyGreater() {
            // Every line on its 15% ceiling would give D = 15%; use 12% flat so
            // D lands exactly on the configured 12% cap.
            RiskResult exactlyAtCap = evaluate(CustomerTier.GOLD, 1200, List.of(
                    oneTime("L1", "Laptop", "HARDWARE", "1", 1_000_000L, 100_000L, 0)));

            assertThat(exactlyAtCap.aggregateDiscountPercent()).isEqualByComparingTo(new BigDecimal("12"));
            assertThat(codes(exactlyAtCap)).doesNotContain("AGGREGATE_DISCOUNT_OVER_CEILING");
            assertThat(exactlyAtCap.requiredLevel()).isEqualTo(ApprovalLevel.NONE);
        }
    }
}
