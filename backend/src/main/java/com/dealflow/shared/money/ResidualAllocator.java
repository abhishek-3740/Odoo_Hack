package com.dealflow.shared.money;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.List;
import java.util.stream.IntStream;

/**
 * Rounds a set of exact amounts to minor units so that the rounded parts still
 * add up to the rounded whole.
 *
 * <p>Rounding each line independently loses money. Three lines of 33.333 round
 * to 33.33 each and sum to 99.99, while the order they came from rounds to
 * 100.00. The one-paise gap is small and completely unacceptable: an invoice
 * whose lines do not reconcile to its total is not an invoice.
 *
 * <p>The residual is handed to the lines that lost the most in rounding, and
 * ties break on a stable key so that the same input always produces the same
 * split — across processes, across replays, and in the export as on the screen.
 */
public final class ResidualAllocator {

    private ResidualAllocator() {
    }

    /**
     * @param exactMinorAmounts unrounded minor-unit amounts, one per line
     * @param stableKeys        deterministic tie-breakers, same length and order
     * @return rounded minor amounts summing exactly to the rounded total
     */
    public static long[] roundPreservingTotal(List<BigDecimal> exactMinorAmounts, List<String> stableKeys) {
        int n = exactMinorAmounts.size();
        if (n != stableKeys.size()) {
            throw new IllegalArgumentException("amounts and keys must be the same length");
        }
        long[] rounded = new long[n];
        if (n == 0) {
            return rounded;
        }

        BigDecimal exactTotal = BigDecimal.ZERO;
        long roundedTotal = 0;
        for (int i = 0; i < n; i++) {
            BigDecimal exact = exactMinorAmounts.get(i);
            exactTotal = exactTotal.add(exact);
            rounded[i] = exact.setScale(0, RoundingMode.HALF_UP).longValueExact();
            roundedTotal = Math.addExact(roundedTotal, rounded[i]);
        }

        long target = exactTotal.setScale(0, RoundingMode.HALF_UP).longValueExact();
        long residual = target - roundedTotal;
        if (residual == 0) {
            return rounded;
        }

        // Signed rounding loss per line: positive means the line was rounded
        // down and has the strongest claim on a spare minor unit.
        BigDecimal[] loss = new BigDecimal[n];
        for (int i = 0; i < n; i++) {
            loss[i] = exactMinorAmounts.get(i).subtract(BigDecimal.valueOf(rounded[i]));
        }

        int step = residual > 0 ? 1 : -1;
        Comparator<Integer> order = residual > 0
                ? Comparator.<Integer, BigDecimal>comparing(i -> loss[i]).reversed()
                        .thenComparing(stableKeys::get)
                : Comparator.<Integer, BigDecimal>comparing(i -> loss[i])
                        .thenComparing(stableKeys::get);

        List<Integer> ranked = IntStream.range(0, n).boxed().sorted(order).toList();
        long remaining = Math.abs(residual);
        for (int pass = 0; remaining > 0; pass++) {
            // A residual larger than the line count would be a bug upstream, but
            // wrapping keeps this terminating rather than silently dropping money.
            int index = ranked.get(pass % n);
            rounded[index] += step;
            remaining--;
        }
        return rounded;
    }
}
