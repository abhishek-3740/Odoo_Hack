package com.dealflow.health.service;


import com.dealflow.health.models.*;
import com.dealflow.health.repo.*;
import com.dealflow.health.controller.*;
import com.dealflow.config.AppProperties;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Flags a discount that is far outside a rep's own historical pattern.
 *
 * <p>A discount is anomalous when it is <em>both</em>:
 * <ul>
 *   <li>at least a configured number of percentage points above the rep's mean
 *       (default 5 pp), and</li>
 *   <li>more than a configured number of standard deviations above it
 *       (default 2σ), with a floor on σ so a rep who has always discounted
 *       exactly 10% does not get flagged for 10.1%.</li>
 * </ul>
 *
 * <p>Both conditions are required deliberately. The z-score alone fires on
 * trivial deviations from a very consistent history; the absolute gap alone
 * fires on a rep whose discounts legitimately vary a lot.
 *
 * <h2>Silence is the honest answer for a new rep</h2>
 *
 * <p>Below the configured minimum number of observations the detector reports
 * "insufficient history" and computes nothing. It never substitutes zero for the
 * mean, which would make a new rep's entirely normal first 5% quotation look
 * like a five-sigma event (edge case E23).
 *
 * <p>What this produces is a risk <em>indicator</em>, for a human to look at. It
 * is not a prediction and not an accusation.
 */
@Component
public class DiscountAnomalyDetector {

    private static final MathContext CALC = new MathContext(20, RoundingMode.HALF_UP);

    private final AppProperties properties;

    public DiscountAnomalyDetector(AppProperties properties) {
        this.properties = properties;
    }

    /**
     * @param anomalous          whether both thresholds were crossed
     * @param insufficientHistory true when there was not enough data to judge
     * @param observations       how many historical quotations were considered
     */
    public record Verdict(boolean anomalous, boolean insufficientHistory, int observations,
                          BigDecimal currentPercent, BigDecimal meanPercent,
                          BigDecimal standardDeviation, BigDecimal excessPp,
                          BigDecimal zScore, String explanation) {
    }

    public Verdict evaluate(BigDecimal currentDiscountPercent, List<Double> historicalPercents) {
        var config = properties.health();
        int minimum = config.anomalyMinimumObservations();
        int observations = historicalPercents == null ? 0 : historicalPercents.size();

        if (observations < minimum) {
            return new Verdict(false, true, observations, currentDiscountPercent, null, null, null, null,
                    "Not enough finalised quotations yet (" + observations + " of " + minimum
                            + " needed) to compare this discount against this rep's own history. "
                            + "Customer and category policy rules still apply.");
        }

        BigDecimal mean = mean(historicalPercents);
        BigDecimal deviation = standardDeviation(historicalPercents, mean);

        // Floor on sigma: a perfectly consistent history must not make every
        // tiny deviation look extreme.
        BigDecimal effectiveDeviation = deviation.max(config.anomalyStdDevFloorPp());

        BigDecimal excess = currentDiscountPercent.subtract(mean);
        BigDecimal zScore = effectiveDeviation.signum() == 0
                ? BigDecimal.ZERO
                : excess.divide(effectiveDeviation, 4, RoundingMode.HALF_UP);

        boolean farEnoughAbsolutely = excess.compareTo(config.anomalyMinimumExcessPp()) >= 0;
        boolean farEnoughStatistically = zScore.compareTo(config.anomalySigmaMultiplier()) > 0;
        boolean anomalous = farEnoughAbsolutely && farEnoughStatistically;

        String explanation = anomalous
                ? "This discount is " + scale(excess) + " points above this rep's average of "
                        + scale(mean) + "% across " + observations + " finalised quotations ("
                        + scale(zScore) + " standard deviations). Worth a look, not a conclusion."
                : "Within this rep's usual range: average " + scale(mean) + "%, this quotation "
                        + scale(currentDiscountPercent) + "%.";

        return new Verdict(anomalous, false, observations, currentDiscountPercent, mean,
                deviation, excess, zScore, explanation);
    }

    private static BigDecimal mean(List<Double> values) {
        BigDecimal total = BigDecimal.ZERO;
        for (Double value : values) {
            total = total.add(BigDecimal.valueOf(value));
        }
        return total.divide(BigDecimal.valueOf(values.size()), CALC);
    }

    /** Population standard deviation over the rep's own finalised quotations. */
    private static BigDecimal standardDeviation(List<Double> values, BigDecimal mean) {
        BigDecimal sumSquares = BigDecimal.ZERO;
        for (Double value : values) {
            BigDecimal difference = BigDecimal.valueOf(value).subtract(mean);
            sumSquares = sumSquares.add(difference.multiply(difference, CALC));
        }
        BigDecimal variance = sumSquares.divide(BigDecimal.valueOf(values.size()), CALC);
        return variance.signum() <= 0
                ? BigDecimal.ZERO
                : BigDecimal.valueOf(Math.sqrt(variance.doubleValue())).setScale(4, RoundingMode.HALF_UP);
    }

    private static String scale(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
    }
}
