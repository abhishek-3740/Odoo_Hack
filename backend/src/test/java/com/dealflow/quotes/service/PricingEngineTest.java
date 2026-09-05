package com.dealflow.quotes.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dealflow.quotes.models.PricingModel.LineInput;
import com.dealflow.quotes.models.PricingModel.LineKind;
import com.dealflow.quotes.models.PricingModel.LineResult;
import com.dealflow.quotes.models.PricingModel.PricingInput;
import com.dealflow.quotes.models.PricingModel.PricingResult;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Verifies the pricing arithmetic against the worked examples in the plan. */
class PricingEngineTest {

    private final PricingEngine engine = new PricingEngine();

    private static LineInput oneTime(String key, String description, String categoryCode,
                                     String quantity, long priceMinor, long costMinor, int discountBp) {
        return new LineInput(key, 0, LineKind.ONE_TIME, UUID.randomUUID(), UUID.randomUUID(), categoryCode,
                UUID.randomUUID(), null, description, new BigDecimal(quantity), priceMinor, costMinor,
                0, discountBp, null, true, "MANUAL");
    }

    private static LineInput recurring(String key, String description, String categoryCode, String quantity,
                                       long priceMinor, long costMinor, int discountBp, int intervalMonths) {
        return new LineInput(key, 0, LineKind.RECURRING, UUID.randomUUID(), UUID.randomUUID(), categoryCode,
                null, UUID.randomUUID(), description, new BigDecimal(quantity), priceMinor, costMinor,
                0, discountBp, intervalMonths, false, "MANUAL");
    }

    private static LineResult line(PricingResult result, String key) {
        return result.lines().stream().filter(l -> l.lineKey().equals(key)).findFirst().orElseThrow();
    }

    @Nested
    @DisplayName("Discount composition (test T02, edge case E01)")
    class DiscountComposition {

        @Test
        @DisplayName("10% line discount then 10% order discount is 19%, not 20%")
        void stackedDiscountsCompose() {
            PricingResult result = engine.evaluate(new PricingInput("INR", 1000, List.of(
                    oneTime("L1", "Laptop", "HARDWARE", "1", 1_000_000L, 700_000L, 1000))));

            assertThat(line(result, "L1").effectiveDiscountBp()).isEqualTo(1900);
            // 10,000.00 * 0.9 * 0.9 = 8,100.00
            assertThat(line(result, "L1").netMinor()).isEqualTo(810_000L);
        }

        @Test
        @DisplayName("the order discount reaches every line at the same percentage")
        void orderDiscountAppliesToAllLines() {
            PricingResult result = engine.evaluate(new PricingInput("INR", 1000, List.of(
                    oneTime("L1", "Laptop", "HARDWARE", "1", 1_000_000L, 700_000L, 500),
                    oneTime("L2", "Setup", "SERVICE", "1", 500_000L, 350_000L, 0))));

            assertThat(line(result, "L1").effectiveDiscountBp()).isEqualTo(1450);
            assertThat(line(result, "L2").effectiveDiscountBp()).isEqualTo(1000);
        }
    }

    @Nested
    @DisplayName("Flow B totals (plan section 13.3)")
    class FlowBTotals {

        private PricingResult evaluateFlowB() {
            return engine.evaluate(new PricingInput("INR", 0, List.of(
                    // 4 laptops at 10,000, cost 7,000, 12% off
                    oneTime("L1", "Laptop", "HARDWARE", "4", 1_000_000L, 700_000L, 1200),
                    // setup at 5,000, cost 3,500, 18% off
                    oneTime("L2", "Setup service", "SERVICE", "1", 500_000L, 350_000L, 1800),
                    // 10 support seats at 300/month, cost 120, no discount
                    recurring("L3", "Support seat", "SUBSCRIPTION", "10", 30_000L, 12_000L, 0, 1))));
        }

        @Test
        @DisplayName("one-time net is INR 39,300 and recurring is INR 3,000 a month")
        void separatesOneTimeFromRecurring() {
            PricingResult result = evaluateFlowB();

            // 4 * 10,000 * 0.88 = 35,200 ; 5,000 * 0.82 = 4,100
            assertThat(result.oneTimeNetMinor()).isEqualTo(3_930_000L);
            assertThat(result.recurringFirstCycleNetMinor()).isEqualTo(300_000L);
            assertThat(result.recurringByCadence()).containsOnlyKeys(1);
            assertThat(result.recurringByCadence().get(1).cadence()).isEqualTo("monthly");
        }

        @Test
        @DisplayName("comparison contribution is INR 9,600, about 22.70%")
        void computesComparisonContribution() {
            PricingResult result = evaluateFlowB();

            // 39,300 + 3,000 = 42,300 net ; 28,000 + 3,500 + 1,200 = 32,700 cost
            assertThat(result.comparisonNetMinor()).isEqualTo(4_230_000L);
            assertThat(result.contributionMinor()).isEqualTo(960_000L);
            assertThat(result.contributionPercent()).isEqualByComparingTo(new BigDecimal("22.6950"));
        }

        @Test
        @DisplayName("only the one-time part is due on confirmation")
        void initialAmountDueExcludesRecurring() {
            assertThat(evaluateFlowB().initialAmountDueMinor()).isEqualTo(3_930_000L);
        }
    }

    @Nested
    @DisplayName("Rounding")
    class Rounding {

        @Test
        @DisplayName("line values still add up to the subtotal after rounding")
        void residualIsRedistributedSoLinesReconcile() {
            // Three lines that each land on a half-paisa; naive rounding would
            // leave the subtotal one minor unit away from the sum of its lines.
            PricingResult result = engine.evaluate(new PricingInput("INR", 3333, List.of(
                    oneTime("L1", "Item A", "HARDWARE", "1", 10_001L, 1L, 0),
                    oneTime("L2", "Item B", "HARDWARE", "1", 10_001L, 1L, 0),
                    oneTime("L3", "Item C", "HARDWARE", "1", 10_001L, 1L, 0))));

            long sumOfLines = result.lines().stream().mapToLong(LineResult::netMinor).sum();
            assertThat(sumOfLines).isEqualTo(result.oneTimeNetMinor());
        }

        @Test
        @DisplayName("the same input always produces the same split")
        void residualAllocationIsDeterministic() {
            PricingInput input = new PricingInput("INR", 3333, List.of(
                    oneTime("L1", "Item A", "HARDWARE", "1", 10_001L, 1L, 0),
                    oneTime("L2", "Item B", "HARDWARE", "1", 10_001L, 1L, 0),
                    oneTime("L3", "Item C", "HARDWARE", "1", 10_001L, 1L, 0)));

            assertThat(engine.evaluate(input).lines().stream().map(LineResult::netMinor).toList())
                    .isEqualTo(engine.evaluate(input).lines().stream().map(LineResult::netMinor).toList());
        }
    }

    @Nested
    @DisplayName("Zero-value lines (edge case E03)")
    class ZeroValueLines {

        @Test
        @DisplayName("a 100% discount is refused rather than routed for approval")
        void hundredPercentDiscountIsRejected() {
            assertThatThrownBy(() -> engine.evaluate(new PricingInput("INR", 0, List.of(
                    oneTime("L1", "Laptop", "HARDWARE", "1", 1_000_000L, 700_000L, 10_000)))))
                    .isInstanceOf(ApiException.class)
                    .extracting(ex -> ((ApiException) ex).code())
                    .isEqualTo(ErrorCode.DISCOUNT_OUT_OF_RANGE);
        }

        @Test
        @DisplayName("a line discounted to zero net is refused")
        void zeroNetLineIsRejected() {
            assertThatThrownBy(() -> engine.evaluate(new PricingInput("INR", 0, List.of(
                    oneTime("L1", "Rounding dust", "HARDWARE", "1", 1L, 0L, 9999)))))
                    .isInstanceOf(ApiException.class)
                    .extracting(ex -> ((ApiException) ex).code())
                    .isEqualTo(ErrorCode.ZERO_NET_LINE);
        }

        @Test
        @DisplayName("margin percent is undefined, never zero, when there is no revenue")
        void marginPercentIsNullAtZeroRevenue() {
            assertThat(com.dealflow.shared.money.Money.percentOf(0L, 0L)).isNull();
        }
    }

    @Nested
    @DisplayName("Mixed cadences")
    class MixedCadences {

        @Test
        @DisplayName("each cadence keeps its own subtotal and MRR normalises to a month")
        void cadencesAreReportedSeparately() {
            PricingResult result = engine.evaluate(new PricingInput("INR", 0, List.of(
                    recurring("M", "Monthly seat", "SUBSCRIPTION", "1", 30_000L, 0L, 0, 1),
                    recurring("Q", "Quarterly seat", "SUBSCRIPTION", "1", 90_000L, 0L, 0, 3),
                    recurring("Y", "Yearly seat", "SUBSCRIPTION", "1", 360_000L, 0L, 0, 12))));

            assertThat(result.recurringByCadence()).containsOnlyKeys(1, 3, 12);
            // 300 + 900/3 + 3,600/12 = 300 + 300 + 300 = 900 a month
            assertThat(result.monthlyRecurringRevenueMinor()).isEqualTo(90_000L);
            // The first full cycle of each is still the full interval price.
            assertThat(result.recurringFirstCycleNetMinor()).isEqualTo(480_000L);
        }
    }
}
