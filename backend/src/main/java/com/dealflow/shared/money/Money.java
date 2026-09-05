package com.dealflow.shared.money;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;

/**
 * Exact commercial arithmetic.
 *
 * <p>Every persisted amount is a {@code long} of currency minor units: INR
 * 10,000.00 is {@code 1000000}. Intermediate work happens in {@link BigDecimal}
 * at high precision and is rounded to minor units exactly once, at the end,
 * HALF_UP.
 *
 * <p>Two rules this class exists to enforce:
 * <ul>
 *   <li>Never construct a {@code BigDecimal} from a {@code double}. Every entry
 *       point here takes a string, an int, or a long.</li>
 *   <li>Never round an intermediate and then multiply the rounded value back up.
 *       Rounding a daily rate and multiplying by 31 days is how INR 51.61 turns
 *       into INR 100.13 (edge case E15).</li>
 * </ul>
 */
public final class Money {

    /** Minor units per major unit, as a scale: 2 means 1 rupee = 100 paise. */
    public static final int MINOR_SCALE = 2;

    /** Precision for intermediate percentage and proration work. */
    public static final MathContext CALC = new MathContext(34, RoundingMode.HALF_UP);

    private static final BigDecimal MINOR_FACTOR = BigDecimal.TEN.pow(MINOR_SCALE);

    private Money() {
    }

    /** Major-unit decimal (39300.00) for a stored minor amount (3930000). */
    public static BigDecimal toMajor(long minor) {
        return BigDecimal.valueOf(minor, MINOR_SCALE);
    }

    /** Stored minor amount for a major-unit decimal. Rejects sub-minor precision loss silently rounding. */
    public static long toMinor(BigDecimal major) {
        return major.multiply(MINOR_FACTOR, CALC).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    /** Parses a decimal string such as {@code "10000.00"} into minor units. */
    public static long parseMajor(String major) {
        return toMinor(new BigDecimal(major));
    }

    /** Rounds an exact minor-unit quantity to a whole minor unit, HALF_UP. */
    public static long round(BigDecimal exactMinor) {
        return exactMinor.setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    /**
     * Percentage of a minor amount, expressed with 4 decimal places, or
     * {@code null} when the base is zero. A margin percentage at zero revenue is
     * undefined, not zero (edge case E03) — the caller must render it as such
     * rather than substituting 0.
     */
    public static BigDecimal percentOf(long partMinor, long baseMinor) {
        if (baseMinor == 0) {
            return null;
        }
        return BigDecimal.valueOf(partMinor)
                .multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(baseMinor), 4, RoundingMode.HALF_UP);
    }

    /** Sums minor amounts with overflow detection. */
    public static long sum(long... amounts) {
        long total = 0;
        for (long amount : amounts) {
            total = Math.addExact(total, amount);
        }
        return total;
    }

    /** Formats a minor amount for display and export, e.g. {@code "39300.00"}. */
    public static String format(long minor) {
        return toMajor(minor).toPlainString();
    }

    /**
     * Renders a quantity or percentage without the scale it picked up in the
     * database: {@code numeric(18,3)} turns the {@code 4} a client sent into
     * {@code 4.000}. Trailing zeros are stripped only above scale 2, so a money
     * value built at exactly scale 2 is never touched — {@code "21000.00"} stays
     * the contract while {@code 4.000} becomes {@code 4} and {@code 1.500}
     * becomes {@code 1.5}.
     */
    public static String plainQuantity(BigDecimal value) {
        if (value == null) {
            return null;
        }
        BigDecimal normalised = value;
        if (normalised.scale() > MINOR_SCALE) {
            normalised = normalised.stripTrailingZeros();
            if (normalised.scale() < 0) {
                // stripTrailingZeros can produce 1E+1 for 10.000; keep it plain.
                normalised = normalised.setScale(0);
            }
        }
        return normalised.toPlainString();
    }
}
