package com.dealflow.health;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.config.AppProperties;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/** Verifies anomaly detection against edge case E23 and test T22. */
class DiscountAnomalyDetectorTest {

    private final DiscountAnomalyDetector detector = new DiscountAnomalyDetector(properties());

    private static AppProperties properties() {
        return new AppProperties(
                new AppProperties.Auth(null, null, "x".repeat(32), "authenticated", true, 60,
                        List.of("http://localhost:3000"), true, null, null),
                new AppProperties.Billing("Asia/Kolkata", "INR", 15),
                new AppProperties.Allocation(
                        com.dealflow.fulfillment.engine.AllocationModel.Mode.BALANCED, 5000L, 8),
                new AppProperties.Recommendations(new BigDecimal("0.75"), new BigDecimal("0.15"),
                        new BigDecimal("0.10"), 5, 5, BigDecimal.ZERO),
                new AppProperties.Health(72, 48, 12, 5, new BigDecimal("5"), new BigDecimal("2"),
                        new BigDecimal("2"), 7),
                new AppProperties.Jobs(true, 25, 50, 120, 8),
                new AppProperties.Demo(false, false, null),
                new AppProperties.Limits(100, 100, 1000));
    }

    @Nested
    @DisplayName("A new rep has no personal baseline (edge case E23)")
    class NewRep {

        @Test
        @DisplayName("zero history reports insufficient data, not a zero mean")
        void zeroHistoryIsNotAZeroMean() {
            var verdict = detector.evaluate(new BigDecimal("5"), List.of());

            assertThat(verdict.insufficientHistory()).isTrue();
            assertThat(verdict.anomalous()).isFalse();
            assertThat(verdict.meanPercent()).isNull();
            assertThat(verdict.zScore()).isNull();
            assertThat(verdict.explanation()).contains("Not enough finalised quotations");
        }

        @Test
        @DisplayName("four observations are still not enough")
        void fourObservationsIsBelowTheMinimum() {
            var verdict = detector.evaluate(new BigDecimal("40"),
                    List.of(5.0, 5.0, 5.0, 5.0));

            assertThat(verdict.insufficientHistory()).isTrue();
            assertThat(verdict.anomalous()).isFalse();
        }

        @Test
        @DisplayName("a 5% first quotation is not a personal anomaly")
        void firstQuotationIsNotAnAnomaly() {
            assertThat(detector.evaluate(new BigDecimal("5"), List.of()).anomalous()).isFalse();
        }
    }

    @Nested
    @DisplayName("With an adequate baseline (test T22)")
    class AdequateHistory {

        private final List<Double> history = List.of(8.0, 10.0, 9.0, 11.0, 12.0, 10.0);

        @Test
        @DisplayName("five observations switch detection on")
        void fiveObservationsIsEnough() {
            var verdict = detector.evaluate(new BigDecimal("10"), List.of(8.0, 10.0, 9.0, 11.0, 12.0));

            assertThat(verdict.insufficientHistory()).isFalse();
            assertThat(verdict.observations()).isEqualTo(5);
            assertThat(verdict.meanPercent()).isNotNull();
        }

        @Test
        @DisplayName("a genuine outlier is flagged")
        void realOutlierIsFlagged() {
            var verdict = detector.evaluate(new BigDecimal("35"), history);

            assertThat(verdict.anomalous()).isTrue();
            assertThat(verdict.excessPp()).isGreaterThan(new BigDecimal("5"));
            assertThat(verdict.explanation()).contains("standard deviations");
        }

        @Test
        @DisplayName("a discount inside the usual range is not flagged")
        void normalDiscountIsNotFlagged() {
            var verdict = detector.evaluate(new BigDecimal("11"), history);

            assertThat(verdict.anomalous()).isFalse();
            assertThat(verdict.explanation()).contains("Within this rep's usual range");
        }

        @Test
        @DisplayName("both thresholds must be crossed, not just one")
        void bothConditionsAreRequired() {
            // 4 points above a mean of 10: statistically notable against a tight
            // history, but below the 5-point absolute floor.
            var verdict = detector.evaluate(new BigDecimal("14"), List.of(10.0, 10.0, 10.0, 10.0, 10.0));

            assertThat(verdict.excessPp()).isLessThan(new BigDecimal("5"));
            assertThat(verdict.anomalous()).isFalse();
        }

        @Test
        @DisplayName("a perfectly consistent history does not make small gaps extreme")
        void sigmaFloorPreventsFalsePositives() {
            // Every past quotation exactly 10%. Without the sigma floor the
            // z-score would be unbounded and 15.1% would look astronomical.
            var verdict = detector.evaluate(new BigDecimal("15.1"),
                    List.of(10.0, 10.0, 10.0, 10.0, 10.0));

            assertThat(verdict.standardDeviation()).isEqualByComparingTo(BigDecimal.ZERO);
            // 5.1 points over, against a floored sigma of 2 -> z = 2.55.
            assertThat(verdict.zScore()).isEqualByComparingTo(new BigDecimal("2.5500"));
            assertThat(verdict.anomalous()).isTrue();
        }

        @Test
        @DisplayName("a discount below the mean is never an anomaly")
        void lowerDiscountIsNeverFlagged() {
            assertThat(detector.evaluate(new BigDecimal("2"), history).anomalous()).isFalse();
        }
    }
}
