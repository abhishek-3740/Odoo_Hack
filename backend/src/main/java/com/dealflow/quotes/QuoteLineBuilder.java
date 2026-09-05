package com.dealflow.quotes;

import com.dealflow.catalog.Category;
import com.dealflow.catalog.CategoryRepository;
import com.dealflow.catalog.Customer;
import com.dealflow.catalog.PriceResolver;
import com.dealflow.catalog.Product;
import com.dealflow.catalog.ProductRepository;
import com.dealflow.catalog.SubscriptionPlan;
import com.dealflow.catalog.SubscriptionPlanRepository;
import com.dealflow.quotes.dto.QuoteDtos.QuoteLineRequest;
import com.dealflow.quotes.engine.PricingModel.LineInput;
import com.dealflow.quotes.engine.PricingModel.LineKind;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/**
 * Turns requested lines into priced engine inputs.
 *
 * <p>This is the boundary where a client's request stops being trusted. It
 * accepts an item, a quantity and a requested discount, and resolves everything
 * else — price, cost, tax rate, category, whether the item consumes stock —
 * from the catalogue. A request that includes a price is not rejected; the
 * price is simply never read (test T26).
 *
 * <p>All catalogue rows for a quotation are fetched in a bounded set of queries
 * rather than one per line, so a 30-line quotation is a handful of round trips
 * and not ninety.
 */
@Component
public class QuoteLineBuilder {

    private final PriceResolver priceResolver;
    private final ProductRepository products;
    private final CategoryRepository categories;
    private final SubscriptionPlanRepository plans;

    public QuoteLineBuilder(PriceResolver priceResolver, ProductRepository products,
                            CategoryRepository categories, SubscriptionPlanRepository plans) {
        this.priceResolver = priceResolver;
        this.products = products;
        this.categories = categories;
        this.plans = plans;
    }

    public List<LineInput> build(Customer customer, List<QuoteLineRequest> requests, LocalDate onDate) {
        validateShape(requests);

        Set<UUID> variantIds = requests.stream()
                .map(QuoteLineRequest::variantId).filter(java.util.Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));
        Set<UUID> planIds = requests.stream()
                .map(QuoteLineRequest::planId).filter(java.util.Objects::nonNull)
                .collect(Collectors.toCollection(LinkedHashSet::new));

        Map<UUID, PriceResolver.ResolvedPrice> prices = variantIds.isEmpty()
                ? Map.of()
                : priceResolver.resolveAll(variantIds, customer.getTier(), customer.getCurrency(), onDate);

        Map<UUID, SubscriptionPlan> plansById = planIds.isEmpty()
                ? Map.of()
                : plans.findAllById(planIds).stream()
                        .collect(Collectors.toMap(SubscriptionPlan::getId, plan -> plan));

        Set<UUID> productIds = new HashSet<>();
        prices.values().forEach(price -> productIds.add(price.productId()));
        plansById.values().forEach(plan -> productIds.add(plan.getProductId()));
        Map<UUID, Product> productsById = productIds.isEmpty()
                ? Map.of()
                : products.findAllById(productIds).stream()
                        .collect(Collectors.toMap(Product::getId, product -> product));

        Map<UUID, Category> categoriesById = categories.findAll().stream()
                .collect(Collectors.toMap(Category::getId, category -> category));

        List<LineInput> lines = new ArrayList<>(requests.size());
        for (int position = 0; position < requests.size(); position++) {
            QuoteLineRequest request = requests.get(position);
            String lineKey = resolveLineKey(request, position);
            int discountBp = request.lineDiscountBp() == null ? 0 : request.lineDiscountBp();

            if (request.variantId() != null) {
                lines.add(oneTimeLine(request, lineKey, position, discountBp,
                        prices, productsById, categoriesById));
            } else {
                lines.add(recurringLine(request, lineKey, position, discountBp, customer,
                        plansById, productsById, categoriesById));
            }
        }
        return lines;
    }

    private LineInput oneTimeLine(QuoteLineRequest request, String lineKey, int position, int discountBp,
                                  Map<UUID, PriceResolver.ResolvedPrice> prices,
                                  Map<UUID, Product> productsById,
                                  Map<UUID, Category> categoriesById) {
        PriceResolver.ResolvedPrice price = prices.get(request.variantId());
        if (price == null) {
            throw ApiException.notFound("Product variant " + request.variantId());
        }
        Product product = productsById.get(price.productId());
        Category category = categoriesById.get(price.categoryId());
        if (product == null || category == null) {
            throw ApiException.notFound("Catalogue data for variant " + request.variantId());
        }
        if (product.isRecurring()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "\"" + product.getName() + "\" is a recurring product. Add it by choosing a plan.");
        }
        requireWholeUnitsWhereConfigured(product, request.quantity());

        return new LineInput(lineKey, position, LineKind.ONE_TIME,
                product.getId(), category.getId(), category.getCode(),
                price.variantId(), null, price.name(),
                request.quantity(), price.unitPriceMinor(), price.unitCostMinor(),
                price.taxRateBp(), discountBp, null, price.requiresStock(),
                request.source() == null ? "MANUAL" : request.source());
    }

    private LineInput recurringLine(QuoteLineRequest request, String lineKey, int position, int discountBp,
                                    Customer customer, Map<UUID, SubscriptionPlan> plansById,
                                    Map<UUID, Product> productsById, Map<UUID, Category> categoriesById) {
        SubscriptionPlan plan = plansById.get(request.planId());
        if (plan == null || !plan.isActive()) {
            throw ApiException.notFound("Subscription plan " + request.planId());
        }
        if (!plan.getCurrency().equals(customer.getCurrency())) {
            throw new ApiException(ErrorCode.CURRENCY_MISMATCH,
                    "\"" + plan.getName() + "\" is priced in " + plan.getCurrency()
                            + ", not " + customer.getCurrency() + ".");
        }
        Product product = productsById.get(plan.getProductId());
        if (product == null) {
            throw ApiException.notFound("Product for plan " + plan.getCode());
        }
        Category category = categoriesById.get(product.getCategoryId());
        if (category == null) {
            throw ApiException.notFound("Category for plan " + plan.getCode());
        }
        requireWholeUnitsWhereConfigured(product, request.quantity());

        // A recurring line prices from its plan, never from the product's
        // one-time price field. Those are different numbers for the same item.
        return new LineInput(lineKey, position, LineKind.RECURRING,
                product.getId(), category.getId(), category.getCode(),
                null, plan.getId(), plan.getName(),
                request.quantity(), plan.getIntervalPriceMinor(), plan.getIntervalCostMinor(),
                plan.getTaxRateBp(), discountBp, plan.getIntervalMonths(), false,
                request.source() == null ? "MANUAL" : request.source());
    }

    private void validateShape(List<QuoteLineRequest> requests) {
        if (requests == null || requests.isEmpty()) {
            throw new ApiException(ErrorCode.EMPTY_QUOTE);
        }
        Set<String> seenKeys = new HashSet<>();
        for (QuoteLineRequest request : requests) {
            boolean hasVariant = request.variantId() != null;
            boolean hasPlan = request.planId() != null;
            if (hasVariant == hasPlan) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED,
                        "Each line needs exactly one of a product variant or a subscription plan.");
            }
            if (request.lineKey() != null && !request.lineKey().isBlank()
                    && !seenKeys.add(request.lineKey())) {
                throw ApiException.of(ErrorCode.VALIDATION_FAILED,
                        "Two lines share the key \"" + request.lineKey() + "\".",
                        "lineKey", request.lineKey());
            }
        }
    }

    /** Hardware and seats come in whole units; a service may be billed in fractions. */
    private void requireWholeUnitsWhereConfigured(Product product, BigDecimal quantity) {
        if (product.getQuantityMode() == com.dealflow.catalog.CatalogEnums.QuantityMode.INTEGER
                && quantity.stripTrailingZeros().scale() > 0) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "\"" + product.getName() + "\" is sold in whole units.");
        }
    }

    /**
     * Keeps a caller-supplied key, or mints one.
     *
     * <p>The key is what a customer comment and a counteroffer point at, so it
     * has to survive re-quoting. Clients echo it when editing an existing line
     * and omit it for a new one.
     */
    private static String resolveLineKey(QuoteLineRequest request, int position) {
        if (request.lineKey() != null && !request.lineKey().isBlank()) {
            return request.lineKey().trim();
        }
        return "ln-" + position + "-" + UUID.randomUUID().toString().substring(0, 8);
    }
}
