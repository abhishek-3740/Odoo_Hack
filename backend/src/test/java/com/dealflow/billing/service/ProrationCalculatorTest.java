package com.dealflow.billing.service;

import static org.assertj.core.api.Assertions.assertThat;
import com.dealflow.billing.service.ProrationCalculator.*;
import com.dealflow.shared.time.BusinessCalendar;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Verifies proration against the worked examples in the plan and edge cases E13-E16. */
class ProrationCalculatorTest {

    private final ProrationCalculator calculator = new ProrationCalculator();

    @Nested
    @DisplayName("Mid-period quantity change (plan section 7.5)")
    class QuantityChange {

        @Test
        @DisplayName("10 to 15 seats on 16 September bills INR 750")
        void workedExampleFromThePlan() {
            // Sep 1 - Oct 1 is 30 days; 15 remain from Sep 16. INR 300 a seat.
            Adjustment adjustment = calculator.quantityChange(
                    new BigDecimal("10"), new BigDecimal("15"), 30_000L,
                    LocalDate.of(2026, 9, 16), LocalDate.of(2026, 9, 1), LocalDate.of(2026, 10, 1), 0);

            // 5 seats * 300 * 15/30 = 750.00
            assertThat(adjustment.netMinor()).isEqualTo(75_000L);
            assertThat(adjustment.remainingDays()).isEqualTo(15);
            assertThat(adjustment.totalDays()).isEqualTo(30);
            assertThat(adjustment.isCharge()).isTrue();
        }

        @Test
        @DisplayName("a reduction produces a credit, not a charge")
        void reducingQuantityCredits() {
            Adjustment adjustment = calculator.quantityChange(
                    new BigDecimal("15"), new BigDecimal("10"), 30_000L,
                    LocalDate.of(2026, 9, 16), LocalDate.of(2026, 9, 1), LocalDate.of(2026, 10, 1), 0);

            assertThat(adjustment.netMinor()).isEqualTo(-75_000L);
            assertThat(adjustment.isCredit()).isTrue();
        }
    }

    @Nested
    @DisplayName("Yearly upgrade on day 15 (edge case E13)")
    class YearlyUpgrade {

        private final LocalDate periodStart = LocalDate.of(2026, 1, 1);
        private final LocalDate periodEnd = LocalDate.of(2027, 1, 1);

        @Test
        @DisplayName("10 to 20 units prorates TEN units, not five")
        void incrementIsTheDifferenceNotTheHalf() {
            // Unit annual price INR 3,650. Effective Jan 15: 351 days remain.
            Adjustment adjustment = calculator.quantityChange(
                    new BigDecimal("10"), new BigDecimal("20"), 365_000L,
                    LocalDate.of(2026, 1, 15), periodStart, periodEnd, 0);

            assertThat(adjustment.remainingDays()).isEqualTo(351);
            assertThat(adjustment.totalDays()).isEqualTo(365);
            // 10 * 3,650 * 351/365 = 35,100.00
            assertThat(adjustment.netMinor()).isEqualTo(3_510_000L);
        }

        @Test
        @DisplayName("'day 15' and '15 days elapsed' are different inputs")
        void theTwoReadingsDiffer() {
            Adjustment onDayFifteen = calculator.quantityChange(
                    new BigDecimal("10"), new BigDecimal("20"), 365_000L,
                    LocalDate.of(2026, 1, 15), periodStart, periodEnd, 0);
            Adjustment afterFifteenDays = calculator.quantityChange(
                    new BigDecimal("10"), new BigDecimal("20"), 365_000L,
                    LocalDate.of(2026, 1, 16), periodStart, periodEnd, 0);

            assertThat(onDayFifteen.netMinor()).isEqualTo(3_510_000L);   // INR 35,100
            assertThat(afterFifteenDays.netMinor()).isEqualTo(3_500_000L); // INR 35,000
        }

        @Test
        @DisplayName("a leap year divides by 366")
        void leapYearUsesTheRealPeriodLength() {
            Adjustment adjustment = calculator.quantityChange(
                    BigDecimal.ZERO, BigDecimal.ONE, 366_000L,
                    LocalDate.of(2028, 1, 1), LocalDate.of(2028, 1, 1), LocalDate.of(2029, 1, 1), 0);

            assertThat(adjustment.totalDays()).isEqualTo(366);
            assertThat(adjustment.netMinor()).isEqualTo(366_000L);
        }

        @Test
        @DisplayName("a change on the last day of the period bills a single day")
        void lastDayBillsOneDay() {
            Adjustment adjustment = calculator.quantityChange(
                    BigDecimal.ZERO, BigDecimal.ONE, 365_000L,
                    LocalDate.of(2026, 12, 31), periodStart, periodEnd, 0);

            assertThat(adjustment.remainingDays()).isEqualTo(1);
            // 3,650 * 1/365 = 10.00
            assertThat(adjustment.netMinor()).isEqualTo(1_000L);
        }

        @Test
        @DisplayName("a change exactly at period end bills nothing")
        void periodEndBillsNothing() {
            Adjustment adjustment = calculator.quantityChange(
                    BigDecimal.ZERO, BigDecimal.ONE, 365_000L, periodEnd, periodStart, periodEnd, 0);

            assertThat(adjustment.remainingDays()).isZero();
            assertThat(adjustment.netMinor()).isZero();
        }
    }

    @Nested
    @DisplayName("Fractional rounding (edge case E15)")
    class FractionalRounding {

        @Test
        @DisplayName("INR 99.99 with 16 of 31 days left is INR 51.61, not INR 100.13")
        void roundsOnceAtTheEnd() {
            // Rounding a daily rate to 3.23 and multiplying by 31 would produce
            // 100.13 — more than the original charge.
            Adjustment adjustment = calculator.quantityChange(
                    BigDecimal.ZERO, BigDecimal.ONE, 9_999L,
                    LocalDate.of(2026, 1, 16), LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1), 0);

            assertThat(adjustment.remainingDays()).isEqualTo(16);
            assertThat(adjustment.totalDays()).isEqualTo(31);
            assertThat(adjustment.netMinor()).isEqualTo(5_161L);
        }

        @Test
        @DisplayName("tax follows the rounded net at the line's configured rate")
        void taxIsComputedOnRoundedNet() {
            Adjustment adjustment = calculator.quantityChange(
                    BigDecimal.ZERO, BigDecimal.ONE, 100_000L,
                    LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 1), LocalDate.of(2026, 2, 1), 1800);

            assertThat(adjustment.netMinor()).isEqualTo(100_000L);
            assertThat(adjustment.taxMinor()).isEqualTo(18_000L);
        }
    }

    @Nested
    @DisplayName("Cancellation credit (plan section 7.5)")
    class CancellationCredit {

        @Test
        @DisplayName("cancelling on 21 September after the upgrade credits INR 1,500")
        void creditsEachChargeForItsOwnUnusedDays() {
            // The base charge covered Sep 1 - Oct 1 for 10 seats (INR 3,000).
            // The upgrade charge covered Sep 16 - Oct 1 for 5 more (INR 750).
            List<ChargeSegment> segments = List.of(
                    new ChargeSegment(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 10, 1), 300_000L, 0L),
                    new ChargeSegment(LocalDate.of(2026, 9, 16), LocalDate.of(2026, 10, 1), 75_000L, 0L));

            CreditBreakdown credit = calculator.unusedCoverage(segments, LocalDate.of(2026, 9, 21));

            // 3,000 * 10/30 = 1,000 and 750 * 10/15 = 500.
            assertThat(credit.segments()).hasSize(2);
            assertThat(credit.segments().get(0).netMinor()).isEqualTo(100_000L);
            assertThat(credit.segments().get(1).netMinor()).isEqualTo(50_000L);
            assertThat(credit.netMinor()).isEqualTo(150_000L);
        }

        @Test
        @DisplayName("a fully consumed period is not credited")
        void pastCoverageIsNotCredited() {
            List<ChargeSegment> segments = List.of(
                    new ChargeSegment(LocalDate.of(2026, 8, 1), LocalDate.of(2026, 9, 1), 300_000L, 0L));

            assertThat(calculator.unusedCoverage(segments, LocalDate.of(2026, 9, 21)).netMinor()).isZero();
        }

        @Test
        @DisplayName("a period that has not started yet is credited in full")
        void futureCoverageIsCreditedInFull() {
            List<ChargeSegment> segments = List.of(
                    new ChargeSegment(LocalDate.of(2026, 10, 1), LocalDate.of(2026, 11, 1), 300_000L, 0L));

            assertThat(calculator.unusedCoverage(segments, LocalDate.of(2026, 9, 21)).netMinor())
                    .isEqualTo(300_000L);
        }

        @Test
        @DisplayName("cancelling at period end credits nothing")
        void endOfPeriodCancellationCreditsNothing() {
            List<ChargeSegment> segments = List.of(
                    new ChargeSegment(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 10, 1), 300_000L, 0L));

            assertThat(calculator.unusedCoverage(segments, LocalDate.of(2026, 10, 1)).netMinor()).isZero();
        }
    }

    @Nested
    @DisplayName("First-period charge")
    class FirstPeriod {

        @Test
        @DisplayName("a full first interval is billed in full")
        void activationAnchoredPeriodIsNotProrated() {
            Adjustment adjustment = calculator.firstPeriodCharge(
                    new BigDecimal("10"), 30_000L,
                    LocalDate.of(2026, 9, 16), LocalDate.of(2026, 10, 16), 16, 1, 0);

            assertThat(adjustment.netMinor()).isEqualTo(300_000L);
            assertThat(adjustment.remainingFraction()).isEqualByComparingTo(BigDecimal.ONE);
        }

        @Test
        @DisplayName("a mid-month start on a calendar-anchored plan bills only the remainder")
        void calendarAnchoredMidMonthStartIsProrated() {
            // Sep 16 - Oct 1 out of the Sep 1 - Oct 1 interval: 15 of 30 days.
            Adjustment adjustment = calculator.firstPeriodCharge(
                    new BigDecimal("10"), 30_000L,
                    LocalDate.of(2026, 9, 16), LocalDate.of(2026, 10, 1), 1, 1, 0);

            assertThat(adjustment.totalDays()).isEqualTo(30);
            assertThat(adjustment.remainingDays()).isEqualTo(15);
            assertThat(adjustment.netMinor()).isEqualTo(150_000L);
        }
    }

    @Nested
    @DisplayName("Anchor preservation (test T14)")
    class AnchorPreservation {

        @Test
        @DisplayName("a 31st anchor clamps to February and then returns to the 31st")
        void shortMonthDoesNotStealTheAnchor() {
            LocalDate january = LocalDate.of(2026, 1, 31);

            LocalDate february = BusinessCalendar.nextBoundary(january, 31, 1);
            assertThat(february).isEqualTo(LocalDate.of(2026, 2, 28));

            LocalDate march = BusinessCalendar.nextBoundary(february, 31, 1);
            assertThat(march).isEqualTo(LocalDate.of(2026, 3, 31));
        }

        @Test
        @DisplayName("a leap February clamps to the 29th")
        void leapFebruary() {
            assertThat(BusinessCalendar.nextBoundary(LocalDate.of(2028, 1, 31), 31, 1))
                    .isEqualTo(LocalDate.of(2028, 2, 29));
        }

        @Test
        @DisplayName("quarterly and yearly cadences advance by calendar months")
        void quarterlyAndYearly() {
            assertThat(BusinessCalendar.nextBoundary(LocalDate.of(2026, 1, 31), 31, 3))
                    .isEqualTo(LocalDate.of(2026, 4, 30));
            assertThat(BusinessCalendar.nextBoundary(LocalDate.of(2026, 2, 28), 29, 12))
                    .isEqualTo(LocalDate.of(2027, 2, 28));
        }

        @Test
        @DisplayName("the first period end lands on the next anchored boundary after activation")
        void firstPeriodEndFollowsTheAnchor() {
            assertThat(BusinessCalendar.firstPeriodEnd(LocalDate.of(2026, 9, 16), 1, 1))
                    .isEqualTo(LocalDate.of(2026, 10, 1));
            assertThat(BusinessCalendar.firstPeriodEnd(LocalDate.of(2026, 9, 16), 16, 1))
                    .isEqualTo(LocalDate.of(2026, 10, 16));
            assertThat(BusinessCalendar.firstPeriodEnd(LocalDate.of(2026, 9, 1), 1, 1))
                    .isEqualTo(LocalDate.of(2026, 10, 1));
        }
    }
}
