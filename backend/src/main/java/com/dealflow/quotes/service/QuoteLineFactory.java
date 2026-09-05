package com.dealflow.quotes.service;

import com.dealflow.quotes.models.PricingModel.LineResult;
import com.dealflow.quotes.models.QuoteEnums.LineSource;
import com.dealflow.quotes.models.QuoteLine;
import java.util.UUID;

/** Copies one priced engine result onto a persistent quotation line. */
public final class QuoteLineFactory {

    private QuoteLineFactory() {
    }

    public static QuoteLine fromResult(UUID revisionId, LineResult result, LineSource source) {
        QuoteLine line = new QuoteLine(revisionId, result.lineKey(), result.position());
        line.setLineKind(result.kind());
        line.setProductId(result.productId());
        line.setCategoryId(result.categoryId());
        line.setVariantId(result.variantId());
        line.setPlanId(result.planId());
        line.setDescription(result.description());
        line.setQuantity(result.quantity());
        line.setUnitPriceMinor(result.unitPriceMinor());
        line.setUnitCostMinor(result.unitCostMinor());
        line.setTaxRateBp(result.taxRateBp());
        line.setLineDiscountBp(result.lineDiscountBp());
        line.setAppliedOrderDiscountBp(result.appliedOrderDiscountBp());
        line.setEffectiveDiscountBp(result.effectiveDiscountBp());
        line.setBaseMinor(result.baseMinor());
        line.setNetMinor(result.netMinor());
        line.setTaxMinor(result.taxMinor());
        line.setCostTotalMinor(result.costTotalMinor());
        line.setMarginMinor(result.marginMinor());
        line.setIntervalMonths(result.intervalMonths());
        line.setRequiresStock(result.requiresStock());
        line.setSource(source);
        return line;
    }
}
