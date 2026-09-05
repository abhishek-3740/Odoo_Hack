package com.dealflow.shared.time;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;

/**
 * Billing calendar arithmetic.
 *
 * <p>Periods are half-open: {@code [start, end)}. The start day is billed, the
 * end day belongs to the next period. That is what makes consecutive periods
 * tile the calendar without charging a day twice.
 *
 * <p>"Monthly" means one calendar month, not 30 days. A subscription starting
 * 31 January renews 28 February and then 31 March — the anchor day is preserved
 * and only clamped where the month is too short, never permanently lost. Every
 * boundary is therefore derived from the anchor, never from the previous
 * clamped result.
 */
public final class BusinessCalendar {

    private BusinessCalendar() {
    }

    /**
     * Next period boundary after {@code current}.
     *
     * @param current        a period boundary
     * @param anchorDay      day of month the schedule is anchored to (1-31)
     * @param intervalMonths 1, 3 or 12
     */
    public static LocalDate nextBoundary(LocalDate current, int anchorDay, int intervalMonths) {
        YearMonth month = YearMonth.from(current).plusMonths(intervalMonths);
        return month.atDay(Math.min(anchorDay, month.lengthOfMonth()));
    }

    /** Previous period boundary before {@code current}, using the same anchor. */
    public static LocalDate previousBoundary(LocalDate current, int anchorDay, int intervalMonths) {
        YearMonth month = YearMonth.from(current).minusMonths(intervalMonths);
        return month.atDay(Math.min(anchorDay, month.lengthOfMonth()));
    }

    /**
     * End of the first period for a subscription activating on {@code activation}.
     *
     * <p>With an {@code ACTIVATION_DATE} anchor the first period is a full
     * interval starting that day. With a {@code CALENDAR_MONTH_START} anchor a
     * mid-month activation gets a short first period running to the next
     * calendar boundary, which is then billed pro rata.
     */
    public static LocalDate firstPeriodEnd(LocalDate activation, int anchorDay, int intervalMonths) {
        if (activation.getDayOfMonth() == Math.min(anchorDay, activation.lengthOfMonth())) {
            return nextBoundary(activation, anchorDay, intervalMonths);
        }
        // Walk forward to the first anchored boundary strictly after activation.
        YearMonth month = YearMonth.from(activation);
        LocalDate candidate = month.atDay(Math.min(anchorDay, month.lengthOfMonth()));
        while (!candidate.isAfter(activation)) {
            month = month.plusMonths(1);
            candidate = month.atDay(Math.min(anchorDay, month.lengthOfMonth()));
        }
        return candidate;
    }

    /** Whole days in the half-open interval {@code [start, end)}. */
    public static long days(LocalDate start, LocalDate end) {
        return ChronoUnit.DAYS.between(start, end);
    }

    /**
     * Fraction of {@code [periodStart, periodEnd)} that remains from
     * {@code effective} onward, as an exact unrounded ratio.
     *
     * <p>Returned unrounded on purpose: the caller multiplies it by the price and
     * rounds once, at the end. Rounding the fraction first is exactly the error
     * that turns INR 51.61 into INR 100.13 (edge case E15).
     */
    public static BigDecimal remainingFraction(LocalDate effective, LocalDate periodStart, LocalDate periodEnd) {
        long total = days(periodStart, periodEnd);
        if (total <= 0) {
            throw new IllegalArgumentException("period end must follow period start");
        }
        long remaining = days(effective, periodEnd);
        if (remaining <= 0) {
            return BigDecimal.ZERO;
        }
        if (remaining >= total) {
            return BigDecimal.ONE;
        }
        return BigDecimal.valueOf(remaining).divide(BigDecimal.valueOf(total), java.math.MathContext.DECIMAL128);
    }

    /** Fraction of a period already consumed at {@code effective}. */
    public static BigDecimal elapsedFraction(LocalDate effective, LocalDate periodStart, LocalDate periodEnd) {
        return BigDecimal.ONE.subtract(remainingFraction(effective, periodStart, periodEnd));
    }

    /** Human-readable interval label used in invoice line descriptions. */
    public static String cadenceLabel(int intervalMonths) {
        return switch (intervalMonths) {
            case 1 -> "monthly";
            case 3 -> "quarterly";
            case 12 -> "yearly";
            default -> intervalMonths + "-monthly";
        };
    }

    /** Number of periods of {@code intervalMonths} in a year, for MRR normalisation. */
    public static BigDecimal monthlyNormalisationFactor(int intervalMonths) {
        return BigDecimal.ONE.divide(BigDecimal.valueOf(intervalMonths), 10, RoundingMode.HALF_UP);
    }
}
