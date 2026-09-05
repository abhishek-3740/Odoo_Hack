package com.dealflow.billing.engine;

import com.dealflow.shared.money.Bp;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessCalendar;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Calendar-based billing arithmetic.
 *
 * <p>The whole class turns on one discipline: compute the exact fraction, apply
 * it to the full price, and round <em>once</em> at the end. Rounding a daily
 * rate first and multiplying it back out is the classic proration bug — INR
 * 99.99 over 31 days with 16 days remaining is INR 51.61, but a rounded daily
 * rate of 3.23 × 31 gives 100.13, more than the original charge (edge case E15).
 *
 * <p>The second discipline is counting the right days. "Day 15" of a year and
 * "15 days elapsed" are different inputs and produce different amounts; the
 * denominator is the actual length of the actual period, so a leap year divides
 * by 366 and February divides by 28 or 29 (edge case E13).
 */
@Component
public class ProrationCalculator {

    /**
     * A signed adjustment.
     *
     * @param netMinor          positive is an extra charge, negative is a credit
     * @param remainingFraction the exact unrounded ratio the amount was derived from
     */
    public record Adjustment(long netMinor, long taxMinor, BigDecimal remainingFraction,
                             long remainingDays, long totalDays,
                             LocalDate coverageStart, LocalDate coverageEnd) {

        public boolean isCharge() {
            return netMinor > 0;
        }

        public boolean isCredit() {
            return netMinor < 0;
        }

        public long absoluteNetMinor() {
            return Math.abs(netMinor);
        }

        public long absoluteTaxMinor() {
            return Math.abs(taxMinor);
        }
    }

    /** A charge already raised, with the coverage window it paid for. */
    public record ChargeSegment(LocalDate coverageStart, LocalDate coverageEnd,
                                long netMinor, long taxMinor) {
    }

    /** The unused part of one earlier charge. */
    public record SegmentCredit(LocalDate coverageStart, LocalDate coverageEnd,
                                LocalDate creditedFrom, long netMinor, long taxMinor,
                                BigDecimal remainingFraction) {
    }

    public record CreditBreakdown(long netMinor, long taxMinor, List<SegmentCredit> segments) {
    }

    /**
     * Charge for the first period of a new subscription.
     *
     * <p>A period that is a full interval is billed in full. A short first
     * period — a mid-month start on a calendar-anchored plan — is billed for the
     * share of the interval it actually covers, and the invoice line records the
     * real dates so the customer can see why the first amount differs.
     */
    public Adjustment firstPeriodCharge(BigDecimal quantity, long unitIntervalPriceMinor,
                                        LocalDate periodStart, LocalDate periodEnd,
                                        int anchorDay, int intervalMonths, int taxRateBp) {
        LocalDate fullPeriodStart =
                BusinessCalendar.previousBoundary(periodEnd, anchorDay, intervalMonths);
        long totalDays = BusinessCalendar.days(fullPeriodStart, periodEnd);
        long coveredDays = BusinessCalendar.days(periodStart, periodEnd);

        BigDecimal fraction = periodStart.isAfter(fullPeriodStart)
                ? BigDecimal.valueOf(coveredDays).divide(BigDecimal.valueOf(totalDays), Money.CALC)
                : BigDecimal.ONE;

        BigDecimal exactNet = quantity
                .multiply(BigDecimal.valueOf(unitIntervalPriceMinor), Money.CALC)
                .multiply(fraction, Money.CALC);
        long net = Money.round(exactNet);
        return new Adjustment(net, taxOn(net, taxRateBp), fraction,
                coveredDays, totalDays, periodStart, periodEnd);
    }

    /**
     * Mid-period quantity change.
     *
     * <pre>
     *   remaining = days(effective, period_end) / days(period_start, period_end)
     *   amount    = (new_qty − old_qty) × unit_interval_price × remaining
     * </pre>
     *
     * <p>The multiplier is the <em>change</em> in quantity. Going from 10 units
     * to 20 prorates ten additional units, not five and not twenty (edge case
     * E13). A reduction produces a negative amount, which becomes a credit for
     * service the customer has paid for and will no longer receive.
     */
    public Adjustment quantityChange(BigDecimal oldQuantity, BigDecimal newQuantity,
                                     long unitIntervalPriceMinor, LocalDate effectiveDate,
                                     LocalDate periodStart, LocalDate periodEnd, int taxRateBp) {
        BigDecimal fraction = BusinessCalendar.remainingFraction(effectiveDate, periodStart, periodEnd);
        BigDecimal delta = newQuantity.subtract(oldQuantity);

        BigDecimal exactNet = delta
                .multiply(BigDecimal.valueOf(unitIntervalPriceMinor), Money.CALC)
                .multiply(fraction, Money.CALC);
        long net = Money.round(exactNet);

        return new Adjustment(net, taxOn(net, taxRateBp), fraction,
                BusinessCalendar.days(effectiveDate, periodEnd),
                BusinessCalendar.days(periodStart, periodEnd),
                effectiveDate, periodEnd);
    }

    /**
     * Charge for a new plan covering the remainder of the current period.
     *
     * <p>Used with {@link #unusedCoverage} for a same-cadence price change:
     * credit what is left of the old plan, charge the same remainder at the new
     * price. An interval change (monthly to yearly) does not use this — it closes
     * the old period and opens a full new one at the change date, because a year
     * is not twelve identical month fractions.
     */
    public Adjustment remainderAtNewPrice(BigDecimal quantity, long unitIntervalPriceMinor,
                                          LocalDate effectiveDate, LocalDate periodStart,
                                          LocalDate periodEnd, int taxRateBp) {
        return quantityChange(BigDecimal.ZERO, quantity, unitIntervalPriceMinor,
                effectiveDate, periodStart, periodEnd, taxRateBp);
    }

    /**
     * The unused part of everything already charged, from {@code effectiveDate}.
     *
     * <p>Worked segment by segment rather than by recomputing the current
     * quantity against the current period. That distinction matters: after a
     * mid-period upgrade there are two charges covering two different windows,
     * and only a per-segment calculation credits each for its own unused days.
     * Recomputing from the current state would credit the upgrade's fifteen-day
     * window as if it had run the whole month.
     *
     * <p>Because each segment can be credited at most once, this is also what
     * stops a second cancellation or a repeated request from crediting the same
     * days twice.
     */
    public CreditBreakdown unusedCoverage(List<ChargeSegment> segments, LocalDate effectiveDate) {
        List<SegmentCredit> credits = new ArrayList<>();
        long netTotal = 0;
        long taxTotal = 0;

        for (ChargeSegment segment : segments) {
            if (segment.coverageStart() == null || segment.coverageEnd() == null) {
                continue;
            }
            if (!segment.coverageEnd().isAfter(effectiveDate)) {
                continue; // Fully consumed already.
            }
            // A charge that has not started yet is refunded in full.
            LocalDate creditFrom = effectiveDate.isBefore(segment.coverageStart())
                    ? segment.coverageStart()
                    : effectiveDate;

            BigDecimal fraction = BusinessCalendar.remainingFraction(
                    creditFrom, segment.coverageStart(), segment.coverageEnd());
            if (fraction.signum() <= 0) {
                continue;
            }

            long net = Money.round(BigDecimal.valueOf(segment.netMinor())
                    .multiply(fraction, Money.CALC));
            long tax = Money.round(BigDecimal.valueOf(segment.taxMinor())
                    .multiply(fraction, Money.CALC));
            if (net <= 0 && tax <= 0) {
                continue;
            }

            credits.add(new SegmentCredit(segment.coverageStart(), segment.coverageEnd(),
                    creditFrom, net, tax, fraction));
            netTotal = Money.sum(netTotal, net);
            taxTotal = Money.sum(taxTotal, tax);
        }
        return new CreditBreakdown(netTotal, taxTotal, List.copyOf(credits));
    }

    /** Tax on an already-rounded net amount, matching the line's configured rate. */
    private static long taxOn(long netMinor, int taxRateBp) {
        if (taxRateBp == 0) {
            return 0L;
        }
        return Money.round(BigDecimal.valueOf(netMinor).multiply(Bp.fraction(taxRateBp), Money.CALC));
    }
}
