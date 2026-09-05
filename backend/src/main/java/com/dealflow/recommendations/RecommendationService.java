package com.dealflow.recommendations;

import com.dealflow.auth.Actor;
import com.dealflow.catalog.CatalogEnums.CustomerTier;
import com.dealflow.catalog.Category;
import com.dealflow.catalog.CategoryRepository;
import com.dealflow.catalog.Customer;
import com.dealflow.catalog.CustomerRepository;
import com.dealflow.catalog.PriceResolver;
import com.dealflow.catalog.Product;
import com.dealflow.catalog.ProductRepository;
import com.dealflow.catalog.ProductVariant;
import com.dealflow.catalog.ProductVariantRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.fulfillment.StockAvailabilityService;
import com.dealflow.quotes.Quote;
import com.dealflow.quotes.QuoteAccessPolicy;
import com.dealflow.quotes.QuoteLine;
import com.dealflow.quotes.QuoteLineRepository;
import com.dealflow.quotes.QuoteRepository;
import com.dealflow.quotes.QuoteRevision;
import com.dealflow.quotes.QuoteRevisionRepository;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessClock;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Tuple;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Ranks products to suggest alongside what is already in the quotation.
 *
 * <h2>No model, and no hard-coded cards</h2>
 *
 * <p>Suggestions come from real finalised orders. For a product {@code a} in the
 * cart and a candidate {@code b}:
 *
 * <pre>
 *   confidence(a → b) = orders containing both / orders containing a
 *   history(b)        = max confidence over the cart
 *   score(b)          = 0.75·history + 0.15·promoted + 0.10·normalised contribution
 * </pre>
 *
 * <p>A product counts <em>once per order</em> however many lines it appears on,
 * so splitting a line cannot inflate a confidence figure.
 *
 * <h2>Honest about thin data</h2>
 *
 * <p>Below the configured minimum of eligible historical orders, the panel says
 * so and falls back to promoted items in related categories. It does not compute
 * a confidence from two orders and present it as a pattern — "appeared in 1 of 1
 * orders" is not a recommendation, it is a coincidence with a percentage sign.
 *
 * <h2>A promotion is a ranking boost, never a licence</h2>
 *
 * <p>The promotion weight moves a product up this list and does nothing else.
 * Anything added from here is priced, risk-checked and approved exactly like a
 * manually chosen line (edge case E04).
 */
@Service
public class RecommendationService {

    @PersistenceContext
    private EntityManager entityManager;

    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final QuoteLineRepository quoteLines;
    private final RecommendationDismissalRepository dismissals;
    private final ProductRepository products;
    private final ProductVariantRepository variants;
    private final CategoryRepository categories;
    private final CustomerRepository customers;
    private final PriceResolver priceResolver;
    private final StockAvailabilityService availability;
    private final QuoteAccessPolicy accessPolicy;
    private final BusinessClock clock;
    private final AppProperties properties;

    public RecommendationService(QuoteRepository quotes, QuoteRevisionRepository revisions,
                                 QuoteLineRepository quoteLines,
                                 RecommendationDismissalRepository dismissals,
                                 ProductRepository products, ProductVariantRepository variants,
                                 CategoryRepository categories, CustomerRepository customers,
                                 PriceResolver priceResolver, StockAvailabilityService availability,
                                 QuoteAccessPolicy accessPolicy, BusinessClock clock,
                                 AppProperties properties) {
        this.quotes = quotes;
        this.revisions = revisions;
        this.quoteLines = quoteLines;
        this.dismissals = dismissals;
        this.products = products;
        this.variants = variants;
        this.categories = categories;
        this.customers = customers;
        this.priceResolver = priceResolver;
        this.availability = availability;
        this.accessPolicy = accessPolicy;
        this.clock = clock;
        this.properties = properties;
    }

    /** One suggestion, with the evidence behind it. */
    public record Suggestion(
            UUID variantId,
            UUID productId,
            String sku,
            String name,
            String categoryCode,
            BigDecimal unitPrice,
            BigDecimal score,
            boolean promoted,
            /** Human-readable evidence: "appeared with laptops in 8 of 12 orders". */
            String reason,
            String basis,
            BigDecimal contributionDelta,
            /** Percentage-point change to overall margin. A profitable add-on can
             *  still lower the quotation's margin percentage. */
            BigDecimal marginPercentDelta,
            String availabilityNote,
            boolean inStock) {
    }

    public record RecommendationResult(
            List<Suggestion> suggestions,
            /** True when there was too little history to compute confidence. */
            boolean limitedHistory,
            String note,
            long eligibleHistoricalOrders) {
    }

    @Transactional(readOnly = true)
    public RecommendationResult recommend(UUID quoteId, Actor actor) {
        Quote quote = quotes.findById(quoteId)
                .orElseThrow(() -> ApiException.notFound("Quotation " + quoteId));
        accessPolicy.requireRead(actor, quote);

        QuoteRevision revision = revisions.findById(quote.getCurrentRevisionId())
                .orElseThrow(() -> ApiException.notFound("Current version of quotation " + quoteId));
        Customer customer = customers.findById(quote.getCustomerId())
                .orElseThrow(() -> ApiException.notFound("Customer " + quote.getCustomerId()));

        List<QuoteLine> cart = quoteLines.findByRevisionIdOrderByPositionAsc(revision.getId());
        if (cart.isEmpty()) {
            return new RecommendationResult(List.of(), true,
                    "Add a product to see suggestions based on what customers usually buy together.", 0);
        }

        Set<UUID> cartProductIds = cart.stream().map(QuoteLine::getProductId).collect(Collectors.toSet());
        Set<UUID> dismissedVariantIds = dismissals.findByRevisionId(revision.getId()).stream()
                .map(RecommendationDismissal::getVariantId).collect(Collectors.toSet());

        long eligibleOrders = countEligibleOrders(cartProductIds);
        int minimum = properties.recommendations().minimumHistoryOrders();

        List<Suggestion> suggestions = eligibleOrders >= minimum
                ? fromHistory(cartProductIds, customer, revision, cart, dismissedVariantIds)
                : List.of();

        boolean limitedHistory = eligibleOrders < minimum;
        if (suggestions.isEmpty()) {
            suggestions = fallbackByPromotionAndCategory(cartProductIds, customer, revision, cart,
                    dismissedVariantIds);
        }

        String note = limitedHistory
                ? "Limited purchase history for these products (" + eligibleOrders + " of "
                        + minimum + " orders needed). Showing promoted items in related categories "
                        + "instead of a statistical suggestion."
                : null;

        return new RecommendationResult(suggestions, limitedHistory, note, eligibleOrders);
    }

    /** Persists a dismissal so the panel stops proposing this item for this version. */
    @Transactional
    public void dismiss(UUID quoteId, UUID variantId, Actor actor) {
        Quote quote = quotes.findById(quoteId)
                .orElseThrow(() -> ApiException.notFound("Quotation " + quoteId));
        accessPolicy.requireRead(actor, quote);

        UUID revisionId = quote.getCurrentRevisionId();
        if (dismissals.findByRevisionIdAndVariantId(revisionId, variantId).isEmpty()) {
            dismissals.save(new RecommendationDismissal(quoteId, revisionId, variantId,
                    actor.profileId()));
        }
    }

    // -------------------------------------------------------- co-purchase

    private List<Suggestion> fromHistory(Set<UUID> cartProductIds, Customer customer,
                                         QuoteRevision revision, List<QuoteLine> cart,
                                         Set<UUID> dismissedVariantIds) {
        @SuppressWarnings("unchecked")
        List<Tuple> rows = entityManager.createNativeQuery("""
                with eligible as (
                    select distinct ol.order_id, ol.product_id
                      from dealflow.order_lines ol
                      join dealflow.orders o on o.id = ol.order_id
                     where o.order_status = 'CONFIRMED'
                ),
                anchors as (
                    select order_id, product_id from eligible where product_id in (:cartProductIds)
                ),
                anchor_totals as (
                    select product_id, count(distinct order_id) as anchor_total
                      from anchors group by product_id
                )
                select e.product_id      as candidate_product_id,
                       a.product_id      as anchor_product_id,
                       count(distinct e.order_id) as together_count,
                       t.anchor_total    as anchor_total
                  from eligible e
                  join anchors a on a.order_id = e.order_id
                  join anchor_totals t on t.product_id = a.product_id
                 where e.product_id not in (:cartProductIds)
                 group by e.product_id, a.product_id, t.anchor_total
                """, Tuple.class)
                .setParameter("cartProductIds", cartProductIds)
                .getResultList();

        // confidence(a -> b) = together / anchor total; keep the best anchor.
        Map<UUID, BigDecimal> bestConfidence = new HashMap<>();
        Map<UUID, String> evidence = new HashMap<>();
        Map<UUID, Product> anchorCache = new HashMap<>();

        for (Tuple row : rows) {
            UUID candidateId = (UUID) row.get("candidate_product_id");
            UUID anchorId = (UUID) row.get("anchor_product_id");
            long together = ((Number) row.get("together_count")).longValue();
            long anchorTotal = ((Number) row.get("anchor_total")).longValue();
            if (anchorTotal == 0) {
                continue;
            }
            BigDecimal confidence = BigDecimal.valueOf(together)
                    .divide(BigDecimal.valueOf(anchorTotal), 4, RoundingMode.HALF_UP);

            BigDecimal current = bestConfidence.get(candidateId);
            if (current == null || confidence.compareTo(current) > 0) {
                bestConfidence.put(candidateId, confidence);
                Product anchor = anchorCache.computeIfAbsent(anchorId,
                        id -> products.findById(id).orElse(null));
                String anchorName = anchor == null ? "these products" : anchor.getName();
                evidence.put(candidateId, "Appeared with " + anchorName + " in " + together
                        + " of " + anchorTotal + " eligible historical orders.");
            }
        }
        if (bestConfidence.isEmpty()) {
            return List.of();
        }

        return rank(bestConfidence, evidence, "CO_PURCHASE", customer, revision, cart,
                dismissedVariantIds);
    }

    /**
     * What to show when the history is too thin to be meaningful.
     *
     * <p>Promoted items in the categories already in the cart, clearly labelled
     * as such. No invented confidence figure.
     */
    private List<Suggestion> fallbackByPromotionAndCategory(Set<UUID> cartProductIds,
                                                            Customer customer, QuoteRevision revision,
                                                            List<QuoteLine> cart,
                                                            Set<UUID> dismissedVariantIds) {
        Set<UUID> cartCategoryIds = cart.stream().map(QuoteLine::getCategoryId)
                .collect(Collectors.toCollection(HashSet::new));

        List<Product> candidates = products.findAll().stream()
                .filter(Product::isActive)
                .filter(product -> !cartProductIds.contains(product.getId()))
                .filter(product -> !product.isRecurring())
                .filter(product -> product.isPromoted() || cartCategoryIds.contains(product.getCategoryId()))
                .limit(50)
                .toList();

        Map<UUID, BigDecimal> scores = new HashMap<>();
        Map<UUID, String> evidence = new HashMap<>();
        for (Product product : candidates) {
            scores.put(product.getId(), BigDecimal.ZERO);
            evidence.put(product.getId(), product.isPromoted()
                    ? "Currently promoted."
                    : "In a category already on this quotation.");
        }
        return rank(scores, evidence, "LIMITED_HISTORY", customer, revision, cart, dismissedVariantIds);
    }

    /**
     * Turns product-level scores into priced, filtered, ranked suggestions.
     *
     * <p>Each candidate is repriced for <em>this</em> customer's tier — a
     * suggestion showing a price the customer would not actually be charged is
     * worse than no suggestion.
     */
    private List<Suggestion> rank(Map<UUID, BigDecimal> historyScores, Map<UUID, String> evidence,
                                  String basis, Customer customer, QuoteRevision revision,
                                  List<QuoteLine> cart, Set<UUID> dismissedVariantIds) {
        if (historyScores.isEmpty()) {
            return List.of();
        }
        LocalDate today = clock.businessToday();
        var weights = properties.recommendations();

        Map<UUID, Product> productsById = products.findAllById(historyScores.keySet()).stream()
                .filter(Product::isActive)
                .filter(product -> !product.isRecurring())
                .collect(Collectors.toMap(Product::getId, product -> product));
        if (productsById.isEmpty()) {
            return List.of();
        }

        Map<UUID, Category> categoriesById = categories.findAll().stream()
                .collect(Collectors.toMap(Category::getId, category -> category));

        // One representative active variant per candidate product.
        Map<UUID, ProductVariant> variantByProduct = new HashMap<>();
        for (UUID productId : productsById.keySet()) {
            variants.findByProductIdAndActiveTrueOrderByNameAsc(productId).stream()
                    .filter(variant -> !dismissedVariantIds.contains(variant.getId()))
                    .findFirst()
                    .ifPresent(variant -> variantByProduct.put(productId, variant));
        }
        if (variantByProduct.isEmpty()) {
            return List.of();
        }

        Map<UUID, PriceResolver.ResolvedPrice> prices;
        try {
            prices = priceResolver.resolveAll(
                    variantByProduct.values().stream().map(ProductVariant::getId)
                            .collect(Collectors.toSet()),
                    customer.getTier(), customer.getCurrency(), today);
        } catch (ApiException ex) {
            // A misconfigured price must not break the builder; it just means we
            // cannot honestly suggest that item.
            return List.of();
        }

        var stock = availability.availabilityFor(prices.values().stream()
                .filter(PriceResolver.ResolvedPrice::requiresStock)
                .map(PriceResolver.ResolvedPrice::variantId)
                .collect(Collectors.toSet()));

        long quoteNet = revision.getOneTimeNetMinor() + revision.getRecurringFirstCycleNetMinor();
        long quoteContribution = revision.getContributionMinor();
        BigDecimal currentMarginPercent = Money.percentOf(quoteContribution, quoteNet);

        // Normalise contribution across candidates so the margin term is bounded.
        long maxContribution = prices.values().stream()
                .mapToLong(price -> Math.max(0, price.unitPriceMinor() - price.unitCostMinor()))
                .max().orElse(0);

        List<Suggestion> suggestions = new ArrayList<>();
        for (Map.Entry<UUID, ProductVariant> entry : variantByProduct.entrySet()) {
            Product product = productsById.get(entry.getKey());
            ProductVariant variant = entry.getValue();
            PriceResolver.ResolvedPrice price = prices.get(variant.getId());
            if (product == null || price == null) {
                continue;
            }

            long unitContribution = price.unitPriceMinor() - price.unitCostMinor();
            BigDecimal candidateMarginPercent = Money.percentOf(unitContribution, price.unitPriceMinor());
            if (candidateMarginPercent != null
                    && candidateMarginPercent.compareTo(weights.minimumCandidateMarginPercent()) < 0) {
                continue;
            }

            BigDecimal history = historyScores.getOrDefault(product.getId(), BigDecimal.ZERO);
            BigDecimal promotedTerm = product.isPromoted() ? BigDecimal.ONE : BigDecimal.ZERO;
            BigDecimal contributionTerm = maxContribution <= 0 ? BigDecimal.ZERO
                    : BigDecimal.valueOf(Math.max(0, unitContribution))
                            .divide(BigDecimal.valueOf(maxContribution), 4, RoundingMode.HALF_UP);

            BigDecimal score = history.multiply(weights.historyWeight())
                    .add(promotedTerm.multiply(weights.promotionWeight()))
                    .add(contributionTerm.multiply(weights.marginWeight()))
                    .setScale(4, RoundingMode.HALF_UP);

            // Adding one unit: show both the money and the percentage effect,
            // because a profitable add-on can still lower the overall margin.
            long newNet = quoteNet + price.unitPriceMinor();
            long newContribution = quoteContribution + unitContribution;
            BigDecimal newMarginPercent = Money.percentOf(newContribution, newNet);
            BigDecimal marginDelta = (newMarginPercent == null || currentMarginPercent == null)
                    ? null : newMarginPercent.subtract(currentMarginPercent);

            var variantStock = stock.get(variant.getId());
            boolean inStock = !price.requiresStock()
                    || (variantStock != null && variantStock.totalAvailable().signum() > 0);
            String availabilityNote;
            if (!price.requiresStock()) {
                availabilityNote = null;
            } else if (inStock) {
                availabilityNote = "In stock";
            } else if (variantStock != null && variantStock.earliestExpectedReceipt() != null) {
                availabilityNote = "Out of stock, expected " + variantStock.earliestExpectedReceipt();
            } else {
                // Never imply availability we cannot back up.
                availabilityNote = "Out of stock, would be backordered";
            }

            Category category = categoriesById.get(product.getCategoryId());
            suggestions.add(new Suggestion(variant.getId(), product.getId(), variant.getSku(),
                    variant.getName(), category == null ? null : category.getCode(),
                    Money.toMajor(price.unitPriceMinor()), score, product.isPromoted(),
                    evidence.getOrDefault(product.getId(), "Related to items on this quotation."),
                    basis, Money.toMajor(unitContribution), marginDelta,
                    availabilityNote, inStock));
        }

        return suggestions.stream()
                .sorted(Comparator.comparing(Suggestion::score).reversed()
                        .thenComparing(Suggestion::name))
                .limit(weights.maxResults())
                .toList();
    }

    /** Confirmed orders containing any product currently in the cart. */
    private long countEligibleOrders(Set<UUID> cartProductIds) {
        Number count = (Number) entityManager.createNativeQuery("""
                select count(distinct ol.order_id)
                  from dealflow.order_lines ol
                  join dealflow.orders o on o.id = ol.order_id
                 where o.order_status = 'CONFIRMED'
                   and ol.product_id in (:cartProductIds)
                """)
                .setParameter("cartProductIds", cartProductIds)
                .getSingleResult();
        return count == null ? 0 : count.longValue();
    }
}
