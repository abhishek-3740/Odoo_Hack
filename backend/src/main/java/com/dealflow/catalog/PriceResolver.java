package com.dealflow.catalog;

import com.dealflow.catalog.CatalogEnums.CustomerTier;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * Resolves the authoritative unit price and cost for a set of variants.
 *
 * <p>Precedence, in order:
 * <ol>
 *   <li>the highest-priority in-date {@code price_rules} row for
 *       variant + tier + currency;</li>
 *   <li>the variant default (product base price plus the variant's extra);</li>
 *   <li>failing that, an error — never a guess.</li>
 * </ol>
 *
 * <p>Two things this refuses to do, both deliberately:
 * <ul>
 *   <li><b>Break a tie.</b> Two in-date rules at the same priority mean the
 *       configuration is ambiguous. Picking one by row order would make a
 *       quotation's price depend on which row the planner happened to read
 *       first, and the same quote could reprice on a later evaluation.</li>
 *   <li><b>Accept a client-supplied price.</b> The request carries identifiers,
 *       quantities and requested discounts. Prices and costs come from here.</li>
 * </ul>
 */
@Service
public class PriceResolver {

    private final ProductRepository products;
    private final ProductVariantRepository variants;
    private final PriceRuleRepository priceRules;

    public PriceResolver(ProductRepository products, ProductVariantRepository variants,
                         PriceRuleRepository priceRules) {
        this.products = products;
        this.variants = variants;
        this.priceRules = priceRules;
    }

    /** Everything the pricing engine needs about one catalogue item. */
    public record ResolvedPrice(UUID variantId, UUID productId, UUID categoryId, String sku, String name,
                                long unitPriceMinor, long unitCostMinor, int taxRateBp, String currency,
                                boolean requiresStock, boolean promoted, String source) {
    }

    /**
     * Resolves a batch of variants in a bounded number of queries.
     *
     * @param variantIds the variants to price
     * @param tier       the customer's tier
     * @param currency   the quotation currency
     * @param onDate     the date the price must be in effect for
     */
    public Map<UUID, ResolvedPrice> resolveAll(Set<UUID> variantIds, CustomerTier tier,
                                               String currency, LocalDate onDate) {
        if (variantIds.isEmpty()) {
            return Map.of();
        }

        List<ProductVariant> variantRows = variants.findByIdIn(variantIds);
        if (variantRows.size() != variantIds.size()) {
            Set<UUID> found = variantRows.stream().map(ProductVariant::getId).collect(Collectors.toSet());
            UUID missing = variantIds.stream().filter(id -> !found.contains(id)).findFirst().orElseThrow();
            throw ApiException.notFound("Product variant " + missing);
        }

        Map<UUID, Product> productsById = products
                .findAllById(variantRows.stream().map(ProductVariant::getProductId).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(Product::getId, p -> p));

        Map<UUID, List<PriceRule>> rulesByVariant = priceRules
                .findCandidates(variantIds, tier, currency).stream()
                .filter(rule -> rule.isActiveOn(onDate))
                .collect(Collectors.groupingBy(PriceRule::getVariantId));

        Map<UUID, ResolvedPrice> resolved = new HashMap<>();
        for (ProductVariant variant : variantRows) {
            Product product = productsById.get(variant.getProductId());
            if (product == null) {
                throw ApiException.notFound("Product for variant " + variant.getSku());
            }
            if (!product.isActive() || !variant.isActive()) {
                throw new ApiException(ErrorCode.PRICE_NOT_RESOLVABLE,
                        "\"" + variant.getName() + "\" is no longer available.");
            }
            if (!product.getCurrency().equals(currency)) {
                throw new ApiException(ErrorCode.CURRENCY_MISMATCH,
                        "\"" + variant.getName() + "\" is priced in " + product.getCurrency()
                                + ", not " + currency + ".");
            }

            long unitPrice;
            String source;
            List<PriceRule> candidates = rulesByVariant.getOrDefault(variant.getId(), List.of());
            if (candidates.isEmpty()) {
                unitPrice = variant.resolveDefaultPriceMinor(product);
                source = "VARIANT_DEFAULT";
            } else {
                int topPriority = candidates.stream().mapToInt(PriceRule::getPriority).max().orElseThrow();
                List<PriceRule> winners = candidates.stream()
                        .filter(rule -> rule.getPriority() == topPriority)
                        .sorted(Comparator.comparing(PriceRule::getActiveFrom).reversed())
                        .toList();
                if (winners.size() > 1) {
                    throw ApiException.of(ErrorCode.AMBIGUOUS_PRICE_RULE,
                            "Two price rules of equal priority match \"" + variant.getName()
                                    + "\" for this tier. Fix the configuration before quoting it.",
                            "variantId", variant.getId(), "priority", topPriority);
                }
                unitPrice = winners.getFirst().getUnitPriceMinor();
                source = "PRICE_RULE";
            }

            resolved.put(variant.getId(), new ResolvedPrice(
                    variant.getId(),
                    product.getId(),
                    product.getCategoryId(),
                    variant.getSku(),
                    variant.getName(),
                    unitPrice,
                    variant.resolveCostMinor(product),
                    product.getTaxRateBp(),
                    currency,
                    product.requiresStock(),
                    product.isPromoted(),
                    source));
        }
        return resolved;
    }

    /** Single-variant convenience for the recommendation panel's repricing. */
    public ResolvedPrice resolve(UUID variantId, CustomerTier tier, String currency, LocalDate onDate) {
        ResolvedPrice price = resolveAll(Set.of(variantId), tier, currency, onDate).get(variantId);
        if (price == null) {
            throw new ApiException(ErrorCode.PRICE_NOT_RESOLVABLE,
                    "No price is configured for this item at the customer's tier.");
        }
        return price;
    }
}
