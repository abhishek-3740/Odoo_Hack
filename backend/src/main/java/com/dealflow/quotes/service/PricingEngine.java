package com.dealflow.quotes.service;


import com.dealflow.quotes.models.*;
import com.dealflow.quotes.repo.*;
import com.dealflow.quotes.dto.*;
import com.dealflow.quotes.controller.*;
import com.dealflow.quotes.models.PricingModel.LineInput;
import com.dealflow.quotes.models.PricingModel.LineKind;
import com.dealflow.quotes.models.PricingModel.LineResult;
import com.dealflow.quotes.models.PricingModel.PricingInput;
import com.dealflow.quotes.models.PricingModel.PricingResult;
import com.dealflow.quotes.models.PricingModel.RecurringGroup;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.money.Bp;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.money.ResidualAllocator;
import com.dealflow.shared.time.BusinessCalendar;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.stereotype.Component;

/**
 * The single authority on what a quotation is worth.
 *
 * <p>The arithmetic, for quantity {@code q}, unit price {@code p}, line discount
 * {@code l} and order discount {@code o}:
 *
 * <pre>
 *   base       = q · p
 *   net        = q · p · (1 − l) · (1 − o)
 *   effective  = 1 − (1 − l)(1 − o)
 *   tax        = round(net) · rate
 *   margin     = net − q · unit_cost
 * </pre>
 *
 * <p>Discounts <em>compose</em>, they do not add: 10% then a further 10% leaves
 * 81% of the price, an effective 19% discount. Adding them to 20% would let a
 * quotation slip under a ceiling it actually breaches.
 *
 * <p>Each line is computed exactly and rounded once, and the rounding residual
 * is redistributed within its group so that the printed subtotals reconcile with
 * their lines to the paisa.
 *
 * <p>The engine is a pure function. It touches no database and holds no state,
 * which is what lets the same code price a live quotation, re-price a customer's
 * counteroffer and evaluate a hypothetical Deal Lab candidate.
 */
@Component
public class PricingEngine {

    public PricingResult evaluate(PricingInput input) {
        validate(input);

        int orderDiscountBp = input.orderDiscountBp();
        List<LineInput> lines = input.lines();

        // Group by what has to reconcile independently: the one-time subtotal,
        // and each recurring cadence. Rounding residual stays inside its group.
        Map<String, List<Integer>> groups = new LinkedHashMap<>();
        for (int i = 0; i < lines.size(); i++) {
            groups.computeIfAbsent(groupKey(lines.get(i)), key -> new ArrayList<>()).add(i);
        }

        long[] baseMinor = new long[lines.size()];
        long[] netMinor = new long[lines.size()];
        long[] costMinor = new long[lines.size()];

        for (List<Integer> indices : groups.values()) {
            List<BigDecimal> exactBase = new ArrayList<>(indices.size());
            List<BigDecimal> exactNet = new ArrayList<>(indices.size());
            List<BigDecimal> exactCost = new ArrayList<>(indices.size());
            List<String> keys = new ArrayList<>(indices.size());

            for (int index : indices) {
                LineInput line = lines.get(index);
                BigDecimal quantity = line.quantity();
                BigDecimal base = quantity.multiply(BigDecimal.valueOf(line.unitPriceMinor()), Money.CALC);
                BigDecimal net = base
                        .multiply(Bp.keepFraction(line.lineDiscountBp()), Money.CALC)
                        .multiply(Bp.keepFraction(orderDiscountBp), Money.CALC);
                BigDecimal cost = quantity.multiply(BigDecimal.valueOf(line.unitCostMinor()), Money.CALC);

                exactBase.add(base);
                exactNet.add(net);
                exactCost.add(cost);
                keys.add(line.lineKey());
            }

            long[] roundedBase = ResidualAllocator.roundPreservingTotal(exactBase, keys);
            long[] roundedNet = ResidualAllocator.roundPreservingTotal(exactNet, keys);
            long[] roundedCost = ResidualAllocator.roundPreservingTotal(exactCost, keys);

            for (int slot = 0; slot < indices.size(); slot++) {
                int index = indices.get(slot);
                baseMinor[index] = roundedBase[slot];
                netMinor[index] = roundedNet[slot];
                costMinor[index] = roundedCost[slot];
            }
        }

        List<LineResult> results = new ArrayList<>(lines.size());
        for (int i = 0; i < lines.size(); i++) {
            LineInput line = lines.get(i);
            long net = netMinor[i];

            // Edge case E03: a line that nets to zero has an undefined margin
            // percentage and cannot be risk-routed. Refuse it before it reaches
            // approval rather than inventing a denominator.
            if (net <= 0) {
                throw ApiException.of(ErrorCode.ZERO_NET_LINE,
                        "\"" + line.description() + "\" is discounted to zero value. "
                                + "Reduce the discount or remove the line.",
                        "lineKey", line.lineKey());
            }

            int effectiveDiscountBp = Bp.combine(line.lineDiscountBp(), orderDiscountBp);
            long tax = Money.round(BigDecimal.valueOf(net)
                    .multiply(Bp.fraction(line.taxRateBp()), Money.CALC));
            long margin = net - costMinor[i];

            results.add(new LineResult(
                    line.lineKey(), line.position(), line.kind(), line.productId(), line.categoryId(),
                    line.categoryCode(), line.variantId(), line.planId(), line.description(), line.quantity(),
                    line.unitPriceMinor(), line.unitCostMinor(), line.taxRateBp(),
                    line.lineDiscountBp(), orderDiscountBp, effectiveDiscountBp,
                    baseMinor[i], net, tax, costMinor[i], margin,
                    Money.percentOf(margin, net),
                    line.intervalMonths(), line.requiresStock(), line.source()));
        }

        return summarise(input.currency(), orderDiscountBp, results);
    }

    private PricingResult summarise(String currency, int orderDiscountBp, List<LineResult> lines) {
        long oneTimeNet = 0;
        long oneTimeTax = 0;
        long oneTimeCost = 0;
        long recurringNet = 0;
        long recurringTax = 0;
        long recurringCost = 0;
        long totalBase = 0;
        long totalDiscount = 0;
        BigDecimal mrrExact = BigDecimal.ZERO;

        Map<Integer, long[]> cadenceTotals = new TreeMap<>();

        for (LineResult line : lines) {
            totalBase = Money.sum(totalBase, line.baseMinor());
            totalDiscount = Money.sum(totalDiscount, line.discountMinor());

            if (line.kind() == LineKind.ONE_TIME) {
                oneTimeNet = Money.sum(oneTimeNet, line.netMinor());
                oneTimeTax = Money.sum(oneTimeTax, line.taxMinor());
                oneTimeCost = Money.sum(oneTimeCost, line.costTotalMinor());
            } else {
                recurringNet = Money.sum(recurringNet, line.netMinor());
                recurringTax = Money.sum(recurringTax, line.taxMinor());
                recurringCost = Money.sum(recurringCost, line.costTotalMinor());

                int months = line.intervalMonths() == null ? 1 : line.intervalMonths();
                long[] bucket = cadenceTotals.computeIfAbsent(months, key -> new long[3]);
                bucket[0] = Money.sum(bucket[0], line.netMinor());
                bucket[1] = Money.sum(bucket[1], line.taxMinor());
                bucket[2] = Money.sum(bucket[2], line.costTotalMinor());

                // MRR normalises a cadence to a month. It is a reporting figure
                // and never the amount on any invoice.
                mrrExact = mrrExact.add(BigDecimal.valueOf(line.netMinor())
                        .multiply(BusinessCalendar.monthlyNormalisationFactor(months), Money.CALC));
            }
        }

        Map<Integer, RecurringGroup> recurringByCadence = new LinkedHashMap<>();
        cadenceTotals.forEach((months, totals) -> {
            long margin = totals[0] - totals[2];
            recurringByCadence.put(months, new RecurringGroup(
                    months, BusinessCalendar.cadenceLabel(months),
                    totals[0], totals[1], totals[2], margin, Money.percentOf(margin, totals[0])));
        });

        long comparisonNet = Money.sum(oneTimeNet, recurringNet);
        long comparisonCost = Money.sum(oneTimeCost, recurringCost);
        long contribution = comparisonNet - comparisonCost;

        return new PricingResult(
                currency, orderDiscountBp, lines,
                oneTimeNet, oneTimeTax, oneTimeCost,
                recurringNet, recurringTax, recurringCost, recurringByCadence,
                totalBase, totalDiscount,
                contribution, Money.percentOf(contribution, comparisonNet),
                Money.sum(oneTimeNet, oneTimeTax),
                mrrExact.setScale(0, RoundingMode.HALF_UP).longValueExact());
    }

    private static String groupKey(LineInput line) {
        return line.kind() == LineKind.ONE_TIME
                ? "ONE_TIME"
                : "RECURRING:" + (line.intervalMonths() == null ? 1 : line.intervalMonths());
    }

    private void validate(PricingInput input) {
        if (input.lines().isEmpty()) {
            throw new ApiException(ErrorCode.EMPTY_QUOTE);
        }
        if (input.orderDiscountBp() < 0 || input.orderDiscountBp() > Bp.MAX_DISCOUNT) {
            throw ApiException.of(ErrorCode.DISCOUNT_OUT_OF_RANGE,
                    "The order discount must be between 0% and 99.99%.",
                    "orderDiscountBp", input.orderDiscountBp());
        }
        for (LineInput line : input.lines()) {
            if (line.lineDiscountBp() < 0 || line.lineDiscountBp() > Bp.MAX_DISCOUNT) {
                throw ApiException.of(ErrorCode.DISCOUNT_OUT_OF_RANGE,
                        "The discount on \"" + line.description() + "\" must be between 0% and 99.99%.",
                        "lineKey", line.lineKey(), "lineDiscountBp", line.lineDiscountBp());
            }
            if (line.quantity() == null || line.quantity().signum() <= 0) {
                throw ApiException.of(ErrorCode.VALIDATION_FAILED,
                        "\"" + line.description() + "\" needs a quantity greater than zero.",
                        "lineKey", line.lineKey());
            }
            if (line.unitPriceMinor() < 0 || line.unitCostMinor() < 0) {
                throw ApiException.of(ErrorCode.VALIDATION_FAILED,
                        "Prices and costs cannot be negative.", "lineKey", line.lineKey());
            }
            if (line.kind() == LineKind.RECURRING && line.intervalMonths() == null) {
                throw ApiException.of(ErrorCode.VALIDATION_FAILED,
                        "A recurring line needs a billing interval.", "lineKey", line.lineKey());
            }
        }
    }
}
