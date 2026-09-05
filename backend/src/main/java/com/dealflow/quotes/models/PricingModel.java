package com.dealflow.quotes.models;


import com.dealflow.quotes.repo.*;
import com.dealflow.quotes.service.*;
import com.dealflow.quotes.dto.*;
import com.dealflow.quotes.controller.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Inputs and outputs of the pricing engine. Pure data; no persistence, no I/O. */
public final class PricingModel {

    private PricingModel() {
    }

    public enum LineKind {
        ONE_TIME, RECURRING
    }

    /**
     * One requested line.
     *
     * <p>Prices and costs arrive here already resolved by
     * {@code PriceResolver}. The client never supplies them: it sends
     * identifiers, quantities and requested discounts, and the server decides
     * what those cost.
     */
    public record LineInput(
            String lineKey,
            int position,
            LineKind kind,
            UUID productId,
            UUID categoryId,
            String categoryCode,
            UUID variantId,
            UUID planId,
            String description,
            BigDecimal quantity,
            long unitPriceMinor,
            long unitCostMinor,
            int taxRateBp,
            int lineDiscountBp,
            Integer intervalMonths,
            boolean requiresStock,
            String source) {
    }

    public record PricingInput(String currency, int orderDiscountBp, List<LineInput> lines) {
    }

    /** One priced line. Every money field is a whole number of minor units. */
    public record LineResult(
            String lineKey,
            int position,
            LineKind kind,
            UUID productId,
            UUID categoryId,
            String categoryCode,
            UUID variantId,
            UUID planId,
            String description,
            BigDecimal quantity,
            long unitPriceMinor,
            long unitCostMinor,
            int taxRateBp,
            int lineDiscountBp,
            int appliedOrderDiscountBp,
            /** 1 - (1-line)(1-order), in basis points. */
            int effectiveDiscountBp,
            long baseMinor,
            long netMinor,
            long taxMinor,
            long costTotalMinor,
            long marginMinor,
            /** Null when net revenue is zero — undefined, not zero. */
            BigDecimal marginPercent,
            Integer intervalMonths,
            boolean requiresStock,
            String source) {

        public long discountMinor() {
            return baseMinor - netMinor;
        }
    }

    /** A recurring subtotal for one cadence. Cadences are never added together. */
    public record RecurringGroup(int intervalMonths, String cadence, long netMinor, long taxMinor,
                                 long costMinor, long marginMinor, BigDecimal marginPercent) {
    }

    /**
     * A fully evaluated quotation.
     *
     * <p>One-time money, recurring money and the comparison contribution are
     * separate figures on purpose. A single blended "total" would let a small
     * pro-rated first charge hide a heavily discounted annual commitment, which
     * is exactly the number a reviewer needs to see (section 5.2).
     */
    public record PricingResult(
            String currency,
            int orderDiscountBp,
            List<LineResult> lines,

            long oneTimeNetMinor,
            long oneTimeTaxMinor,
            long oneTimeCostMinor,

            /** Full first billing interval per cadence, excluding first-period proration. */
            long recurringFirstCycleNetMinor,
            long recurringFirstCycleTaxMinor,
            long recurringFirstCycleCostMinor,
            Map<Integer, RecurringGroup> recurringByCadence,

            long totalBaseMinor,
            long totalDiscountMinor,

            /** One-time plus first full recurring periods, less cost. */
            long contributionMinor,
            BigDecimal contributionPercent,

            /** What the customer owes on confirmation, under ON_CONFIRMATION terms. */
            long initialAmountDueMinor,

            /** Normalised monthly recurring revenue. A reporting metric, not an invoice. */
            long monthlyRecurringRevenueMinor) {

        public long comparisonNetMinor() {
            return oneTimeNetMinor + recurringFirstCycleNetMinor;
        }
    }
}
