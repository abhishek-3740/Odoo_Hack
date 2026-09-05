package com.dealflow.shared.money;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Basis points. 1 bp = 0.01%, so 1500 bp = 15.00% and 10000 bp = 100%.
 *
 * <p>Discounts are stored and transported as integer basis points so that a
 * "12%" discount is exactly 1200 everywhere — in the request, in the risk
 * engine, in the database and in the export — with no float drift in between.
 */
public final class Bp {

    public static final int ONE_HUNDRED_PERCENT = 10_000;

    /** Highest discount this build accepts on a line: 99.99% (edge case E18). */
    public static final int MAX_DISCOUNT = 9_999;

    private static final BigDecimal SCALE = BigDecimal.valueOf(ONE_HUNDRED_PERCENT);

    private Bp() {
    }

    /** Fraction for multiplication, e.g. 1200 bp becomes 0.12. */
    public static BigDecimal fraction(int bp) {
        return BigDecimal.valueOf(bp).divide(SCALE, Money.CALC);
    }

    /** Retained fraction, e.g. 1200 bp becomes 0.88. */
    public static BigDecimal keepFraction(int bp) {
        return BigDecimal.ONE.subtract(fraction(bp));
    }

    /** Percentage points for display and threshold comparison, e.g. 1200 bp becomes 12.00. */
    public static BigDecimal toPercent(int bp) {
        return BigDecimal.valueOf(bp).divide(BigDecimal.valueOf(100), 2, RoundingMode.HALF_UP);
    }

    /** Percentage points to basis points, e.g. 12.5 becomes 1250. */
    public static int fromPercent(BigDecimal percent) {
        return percent.multiply(BigDecimal.valueOf(100)).setScale(0, RoundingMode.HALF_UP).intValueExact();
    }

    /**
     * Combined effect of stacking a line discount and an order discount.
     *
     * <p>Discounts compose multiplicatively, they do not add: 10% off then a
     * further 10% off leaves 0.9 × 0.9 = 0.81 of the price, which is a 19%
     * effective discount, not 20% (edge case E01). Risk routing must see this
     * combined number, otherwise a quote can be split across two "compliant"
     * discounts that together breach a ceiling.
     */
    public static int combine(int lineBp, int orderBp) {
        BigDecimal kept = keepFraction(lineBp).multiply(keepFraction(orderBp), Money.CALC);
        BigDecimal effective = BigDecimal.ONE.subtract(kept).multiply(SCALE, Money.CALC);
        return effective.setScale(0, RoundingMode.HALF_UP).intValueExact();
    }
}
