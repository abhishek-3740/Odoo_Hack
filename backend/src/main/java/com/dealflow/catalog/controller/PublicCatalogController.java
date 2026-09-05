package com.dealflow.catalog.controller;

import com.dealflow.catalog.dto.StorefrontDtos.StoreCategory;
import com.dealflow.catalog.dto.StorefrontDtos.StorePlan;
import com.dealflow.catalog.dto.StorefrontDtos.StoreProduct;
import com.dealflow.catalog.dto.StorefrontDtos.StoreVariant;
import com.dealflow.catalog.dto.StorefrontDtos.StorefrontCatalog;
import com.dealflow.catalog.models.Category;
import com.dealflow.catalog.models.Product;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.catalog.models.SubscriptionPlan;
import com.dealflow.catalog.repo.CategoryRepository;
import com.dealflow.catalog.repo.ProductRepository;
import com.dealflow.catalog.repo.ProductVariantRepository;
import com.dealflow.catalog.repo.SubscriptionPlanRepository;
import com.dealflow.fulfillment.service.StockAvailabilityService;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.web.ApiResponse;
import java.math.BigDecimal;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Anonymous, read-only catalogue for the storefront homepage.
 *
 * <p>Permitted without a token in {@code SecurityConfig}. Prices shown are list
 * prices; tier pricing, discounts and stock counts are only ever resolved inside
 * an authenticated quotation.
 */
@RestController
@RequestMapping("/api/v1/public")
public class PublicCatalogController {

    private final CategoryRepository categories;
    private final ProductRepository products;
    private final ProductVariantRepository variants;
    private final SubscriptionPlanRepository plans;
    private final StockAvailabilityService availability;

    public PublicCatalogController(CategoryRepository categories, ProductRepository products,
                                   ProductVariantRepository variants, SubscriptionPlanRepository plans,
                                   StockAvailabilityService availability) {
        this.categories = categories;
        this.products = products;
        this.variants = variants;
        this.plans = plans;
        this.availability = availability;
    }

    @GetMapping("/catalog")
    @Transactional(readOnly = true)
    public ApiResponse<StorefrontCatalog> catalog() {
        Map<UUID, Category> categoryById = categories.findAll().stream()
                .filter(Category::isActive)
                .collect(Collectors.toMap(Category::getId, Function.identity()));

        List<Product> activeProducts = products.findAll().stream()
                .filter(Product::isActive)
                .filter(product -> categoryById.containsKey(product.getCategoryId()))
                .sorted(Comparator.comparing(Product::isPromoted).reversed()
                        .thenComparing(Product::getName))
                .toList();
        Map<UUID, Product> productById = activeProducts.stream()
                .collect(Collectors.toMap(Product::getId, Function.identity()));

        // A recurring product is bought as a plan, never as a one-time variant,
        // so its variants are not offered on the storefront.
        List<ProductVariant> activeVariants = variants.findAll().stream()
                .filter(ProductVariant::isActive)
                .filter(variant -> productById.containsKey(variant.getProductId()))
                .filter(variant -> !productById.get(variant.getProductId()).isRecurring())
                .sorted(Comparator.comparing(ProductVariant::getSku))
                .toList();
        Map<UUID, StockAvailabilityService.VariantAvailability> stock = availability.availabilityFor(
                activeVariants.stream()
                        .filter(variant -> productById.get(variant.getProductId()).requiresStock())
                        .map(ProductVariant::getId).toList());

        List<StoreCategory> categoryViews = categoryById.values().stream()
                .sorted(Comparator.comparing(Category::getName))
                .map(category -> new StoreCategory(category.getId(), category.getCode(), category.getName(),
                        category.getKind().name()))
                .toList();

        List<StoreProduct> productViews = activeProducts.stream().map(product -> {
            Category category = categoryById.get(product.getCategoryId());
            return new StoreProduct(product.getId(), category.getId(), category.getCode(),
                    category.getKind().name(), product.getCode(), product.getName(),
                    product.getDescription(), product.getUnit(), Money.toMajor(product.getBasePriceMinor()),
                    product.getCurrency(), product.getTaxRateBp(), product.getFulfillmentKind().name(),
                    product.getChargeKind().name(), product.getQuantityMode().name(), product.isPromoted());
        }).toList();

        List<StoreVariant> variantViews = activeVariants.stream().map(variant -> {
            Product product = productById.get(variant.getProductId());
            boolean inStock;
            if (product.requiresStock()) {
                var level = stock.get(variant.getId());
                inStock = level != null && level.totalAvailable().compareTo(BigDecimal.ZERO) > 0;
            } else {
                inStock = true;
            }
            return new StoreVariant(variant.getId(), variant.getProductId(), variant.getSku(), variant.getName(),
                    variant.getAttributes(), Money.toMajor(variant.resolveDefaultPriceMinor(product)),
                    inStock, variant.getSubstitutionGroup());
        }).toList();

        List<StorePlan> planViews = plans.findByActiveTrueOrderByNameAsc().stream()
                .filter(plan -> productById.containsKey(plan.getProductId()))
                .sorted(Comparator.comparing(SubscriptionPlan::getProductId)
                        .thenComparing(SubscriptionPlan::getIntervalMonths))
                .map(plan -> new StorePlan(plan.getId(), plan.getProductId(), plan.getCode(), plan.getName(),
                        plan.getIntervalMonths(), plan.getCurrency(), Money.toMajor(plan.getIntervalPriceMinor()),
                        plan.getTaxRateBp(), plan.getBillingAnchor().name(), plan.getProrationPolicy().name(),
                        plan.getCancellationPolicy().name()))
                .toList();

        return ApiResponse.of(new StorefrontCatalog(categoryViews, productViews, variantViews, planViews));
    }
}
