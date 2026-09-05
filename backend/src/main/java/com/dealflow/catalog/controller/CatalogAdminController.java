package com.dealflow.catalog.controller;


import com.dealflow.catalog.models.*;
import com.dealflow.catalog.repo.*;
import com.dealflow.catalog.service.*;
import com.dealflow.catalog.dto.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.catalog.models.CatalogEnums.BillingAnchor;
import com.dealflow.catalog.models.CatalogEnums.CancellationPolicy;
import com.dealflow.catalog.models.CatalogEnums.CategoryKind;
import com.dealflow.catalog.models.CatalogEnums.ChargeKind;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.catalog.models.CatalogEnums.FulfillmentKind;
import com.dealflow.catalog.models.CatalogEnums.ProrationPolicy;
import com.dealflow.catalog.models.CatalogEnums.QuantityMode;
import com.dealflow.catalog.dto.CatalogDtos.CategoryRequest;
import com.dealflow.catalog.dto.CatalogDtos.CategoryResponse;
import com.dealflow.catalog.dto.CatalogDtos.CustomerRequest;
import com.dealflow.catalog.dto.CatalogDtos.CustomerResponse;
import com.dealflow.catalog.dto.CatalogDtos.PlanRequest;
import com.dealflow.catalog.dto.CatalogDtos.PlanResponse;
import com.dealflow.catalog.dto.CatalogDtos.PriceRuleRequest;
import com.dealflow.catalog.dto.CatalogDtos.PriceRuleResponse;
import com.dealflow.catalog.dto.CatalogDtos.ProductRequest;
import com.dealflow.catalog.dto.CatalogDtos.ProductResponse;
import com.dealflow.catalog.dto.CatalogDtos.VariantRequest;
import com.dealflow.catalog.dto.CatalogDtos.VariantResponse;
import com.dealflow.catalog.dto.CatalogDtos.WarehouseRequest;
import com.dealflow.catalog.dto.CatalogDtos.WarehouseResponse;
import com.dealflow.fulfillment.models.Warehouse;
import com.dealflow.fulfillment.repo.WarehouseRepository;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.web.ApiResponse;
import com.dealflow.shared.web.PageResponse;
import com.dealflow.shared.web.Paging;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Catalogue and configuration.
 *
 * <p>Reads are open to every internal role — a rep needs the catalogue to build
 * a quotation. Writes are administrator-only. Records are archived by clearing
 * {@code active} rather than deleted, because a product that appears on last
 * year's invoice cannot stop existing.
 */
@RestController
@RequestMapping("/api/v1")
public class CatalogAdminController {

    private static final Set<String> SORTS = Set.of("name", "createdAt", "updatedAt", "code");

    private final CustomerRepository customers;
    private final CategoryRepository categories;
    private final ProductRepository products;
    private final ProductVariantRepository variants;
    private final PriceRuleRepository priceRules;
    private final SubscriptionPlanRepository plans;
    private final WarehouseRepository warehouses;
    private final AuditService audit;

    public CatalogAdminController(CustomerRepository customers, CategoryRepository categories,
                                  ProductRepository products, ProductVariantRepository variants,
                                  PriceRuleRepository priceRules, SubscriptionPlanRepository plans,
                                  WarehouseRepository warehouses, AuditService audit) {
        this.customers = customers;
        this.categories = categories;
        this.products = products;
        this.variants = variants;
        this.priceRules = priceRules;
        this.plans = plans;
        this.warehouses = warehouses;
        this.audit = audit;
    }

    // ------------------------------------------------------------ customers

    @GetMapping("/customers")
    public ApiResponse<PageResponse<CustomerResponse>> customers(@RequestParam(required = false) String search,
                                                                 @RequestParam(required = false) Integer page,
                                                                 @RequestParam(required = false) Integer pageSize,
                                                                 @RequestParam(required = false) String sort,
                                                                 Actor actor) {
        requireInternal(actor);
        return ApiResponse.of(PageResponse.of(customers.search(blankToNull(search),
                Paging.of(page, pageSize, sort, SORTS, "name")), CatalogAdminController::toResponse));
    }

    @GetMapping("/customers/{customerId}")
    public ApiResponse<CustomerResponse> customer(@PathVariable UUID customerId, Actor actor) {
        requireInternal(actor);
        return ApiResponse.of(toResponse(customers.findById(customerId)
                .orElseThrow(() -> ApiException.notFound("Customer " + customerId))));
    }

    @PostMapping("/customers")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER','REP')")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<CustomerResponse> createCustomer(@Valid @RequestBody CustomerRequest request, Actor actor) {
        Customer customer = new Customer(request.name(), parse(CustomerTier.class, request.tier()),
                request.currency() == null ? "INR" : request.currency());
        apply(customer, request);
        customers.save(customer);
        audit.record(actor, "CUSTOMER_CREATED", "Customer", customer.getId())
                .after(Map.of("name", customer.getName(), "tier", customer.getTier().name())).save();
        return ApiResponse.of(toResponse(customer));
    }

    @PatchMapping("/customers/{customerId}")
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    @Transactional
    public ApiResponse<CustomerResponse> updateCustomer(@PathVariable UUID customerId,
                                                        @Valid @RequestBody CustomerRequest request, Actor actor) {
        Customer customer = customers.findById(customerId)
                .orElseThrow(() -> ApiException.notFound("Customer " + customerId));
        String before = customer.getTier().name();
        customer.setName(request.name());
        customer.setTier(parse(CustomerTier.class, request.tier()));
        apply(customer, request);
        audit.record(actor, "CUSTOMER_UPDATED", "Customer", customer.getId())
                .before(Map.of("tier", before)).after(Map.of("tier", customer.getTier().name())).save();
        return ApiResponse.of(toResponse(customer));
    }

    private static void apply(Customer customer, CustomerRequest request) {
        customer.setContactEmail(request.contactEmail());
        customer.setContactPhone(request.contactPhone());
        customer.setBillingAddress(request.billingAddress());
        customer.setOwnerRepProfileId(request.ownerRepProfileId());
        if (request.active() != null) {
            customer.setActive(request.active());
        }
    }

    private static CustomerResponse toResponse(Customer customer) {
        return new CustomerResponse(customer.getId(), customer.getName(), customer.getTier().name(),
                customer.getCurrency(), customer.getContactEmail(), customer.getContactPhone(),
                customer.getBillingAddress(), customer.getOwnerRepProfileId(), customer.isActive());
    }

    // ----------------------------------------------------------- categories

    @GetMapping("/categories")
    public ApiResponse<List<CategoryResponse>> categories(Actor actor) {
        requireInternal(actor);
        return ApiResponse.of(categories.findAll().stream().map(CatalogAdminController::toResponse).toList());
    }

    @PostMapping("/categories")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<CategoryResponse> createCategory(@Valid @RequestBody CategoryRequest request, Actor actor) {
        Category category = new Category(request.code().toUpperCase(java.util.Locale.ROOT), request.name(),
                parse(CategoryKind.class, request.kind()));
        if (request.active() != null) {
            category.setActive(request.active());
        }
        categories.save(category);
        audit.record(actor, "CATEGORY_CREATED", "Category", category.getId())
                .after(Map.of("code", category.getCode())).save();
        return ApiResponse.of(toResponse(category));
    }

    private static CategoryResponse toResponse(Category category) {
        return new CategoryResponse(category.getId(), category.getCode(), category.getName(),
                category.getKind().name(), category.isActive());
    }

    // ------------------------------------------------------------- products

    @GetMapping("/products")
    public ApiResponse<PageResponse<ProductResponse>> products(@RequestParam(required = false) UUID categoryId,
                                                               @RequestParam(required = false) String search,
                                                               @RequestParam(required = false) Integer page,
                                                               @RequestParam(required = false) Integer pageSize,
                                                               @RequestParam(required = false) String sort,
                                                               Actor actor) {
        requireInternal(actor);
        return ApiResponse.of(PageResponse.of(products.search(categoryId, blankToNull(search),
                Paging.of(page, pageSize, sort, SORTS, "name")), this::toResponse));
    }

    @GetMapping("/products/{productId}")
    public ApiResponse<ProductResponse> product(@PathVariable UUID productId, Actor actor) {
        requireInternal(actor);
        return ApiResponse.of(toResponse(products.findById(productId)
                .orElseThrow(() -> ApiException.notFound("Product " + productId))));
    }

    @PostMapping("/products")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<ProductResponse> createProduct(@Valid @RequestBody ProductRequest request, Actor actor) {
        categories.findById(request.categoryId())
                .orElseThrow(() -> ApiException.notFound("Category " + request.categoryId()));
        Product product = new Product(request.categoryId(), request.code(), request.name(),
                Money.toMinor(request.basePrice()), Money.toMinor(request.baseCost()),
                parse(FulfillmentKind.class, request.fulfillmentKind()),
                parse(ChargeKind.class, request.chargeKind()));
        apply(product, request);
        products.save(product);
        audit.record(actor, "PRODUCT_CREATED", "Product", product.getId())
                .after(Map.of("code", product.getCode())).save();
        return ApiResponse.of(toResponse(product));
    }

    @PatchMapping("/products/{productId}")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ApiResponse<ProductResponse> updateProduct(@PathVariable UUID productId,
                                                      @Valid @RequestBody ProductRequest request, Actor actor) {
        Product product = products.findById(productId)
                .orElseThrow(() -> ApiException.notFound("Product " + productId));
        long priceBefore = product.getBasePriceMinor();
        product.setCategoryId(request.categoryId());
        product.setCode(request.code());
        product.setName(request.name());
        product.setBasePriceMinor(Money.toMinor(request.basePrice()));
        product.setBaseCostMinor(Money.toMinor(request.baseCost()));
        product.setFulfillmentKind(parse(FulfillmentKind.class, request.fulfillmentKind()));
        product.setChargeKind(parse(ChargeKind.class, request.chargeKind()));
        apply(product, request);
        audit.record(actor, "PRODUCT_UPDATED", "Product", product.getId())
                .before(Map.of("basePriceMinor", priceBefore))
                .after(Map.of("basePriceMinor", product.getBasePriceMinor())).save();
        return ApiResponse.of(toResponse(product));
    }

    private static void apply(Product product, ProductRequest request) {
        product.setDescription(request.description());
        if (request.unit() != null) {
            product.setUnit(request.unit());
        }
        if (request.currency() != null) {
            product.setCurrency(request.currency());
        }
        if (request.taxRateBp() != null) {
            product.setTaxRateBp(request.taxRateBp());
        }
        if (request.quantityMode() != null) {
            product.setQuantityMode(parse(QuantityMode.class, request.quantityMode()));
        }
        if (request.promoted() != null) {
            product.setPromoted(request.promoted());
        }
        if (request.active() != null) {
            product.setActive(request.active());
        }
    }

    private ProductResponse toResponse(Product product) {
        String categoryCode = categories.findById(product.getCategoryId()).map(Category::getCode).orElse(null);
        return new ProductResponse(product.getId(), product.getCategoryId(), categoryCode, product.getCode(),
                product.getName(), product.getDescription(), product.getUnit(),
                Money.toMajor(product.getBasePriceMinor()), Money.toMajor(product.getBaseCostMinor()),
                product.getCurrency(), product.getTaxRateBp(), product.getFulfillmentKind().name(),
                product.getChargeKind().name(), product.getQuantityMode().name(), product.isPromoted(),
                product.isActive());
    }

    // ------------------------------------------------------------- variants

    @GetMapping("/variants")
    public ApiResponse<List<VariantResponse>> variants(@RequestParam UUID productId, Actor actor) {
        requireInternal(actor);
        return ApiResponse.of(variants.findByProductIdAndActiveTrueOrderByNameAsc(productId).stream()
                .map(CatalogAdminController::toResponse).toList());
    }

    @PostMapping("/variants")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<VariantResponse> createVariant(@Valid @RequestBody VariantRequest request, Actor actor) {
        products.findById(request.productId())
                .orElseThrow(() -> ApiException.notFound("Product " + request.productId()));
        ProductVariant variant = new ProductVariant(request.productId(), request.sku(), request.name());
        apply(variant, request);
        variants.save(variant);
        audit.record(actor, "VARIANT_CREATED", "ProductVariant", variant.getId())
                .after(Map.of("sku", variant.getSku())).save();
        return ApiResponse.of(toResponse(variant));
    }

    @PatchMapping("/variants/{variantId}")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ApiResponse<VariantResponse> updateVariant(@PathVariable UUID variantId,
                                                      @Valid @RequestBody VariantRequest request, Actor actor) {
        ProductVariant variant = variants.findById(variantId)
                .orElseThrow(() -> ApiException.notFound("Variant " + variantId));
        variant.setSku(request.sku());
        variant.setName(request.name());
        apply(variant, request);
        audit.record(actor, "VARIANT_UPDATED", "ProductVariant", variant.getId())
                .after(Map.of("sku", variant.getSku())).save();
        return ApiResponse.of(toResponse(variant));
    }

    private static void apply(ProductVariant variant, VariantRequest request) {
        if (request.attributesJson() != null) {
            variant.setAttributes(request.attributesJson());
        }
        if (request.priceExtra() != null) {
            variant.setPriceExtraMinor(Money.toMinor(request.priceExtra()));
        }
        variant.setCostMinor(request.cost() == null ? null : Money.toMinor(request.cost()));
        if (request.weightGrams() != null) {
            variant.setWeightGrams(request.weightGrams());
        }
        variant.setSubstitutionGroup(request.substitutionGroup());
        if (request.active() != null) {
            variant.setActive(request.active());
        }
    }

    private static VariantResponse toResponse(ProductVariant variant) {
        return new VariantResponse(variant.getId(), variant.getProductId(), variant.getSku(), variant.getName(),
                variant.getAttributes(), Money.toMajor(variant.getPriceExtraMinor()),
                variant.getCostMinor() == null ? null : Money.toMajor(variant.getCostMinor()),
                variant.getWeightGrams(), variant.getSubstitutionGroup(), variant.isActive());
    }

    // ---------------------------------------------------------- price rules

    @GetMapping("/price-rules")
    public ApiResponse<List<PriceRuleResponse>> priceRules(@RequestParam UUID variantId, Actor actor) {
        requireInternal(actor);
        return ApiResponse.of(priceRules.findByVariantId(variantId).stream()
                .map(CatalogAdminController::toResponse).toList());
    }

    @PostMapping("/price-rules")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<PriceRuleResponse> createPriceRule(@Valid @RequestBody PriceRuleRequest request, Actor actor) {
        variants.findById(request.variantId())
                .orElseThrow(() -> ApiException.notFound("Variant " + request.variantId()));
        PriceRule rule = new PriceRule(request.variantId(), parse(CustomerTier.class, request.tier()),
                request.currency() == null ? "INR" : request.currency(), Money.toMinor(request.unitPrice()),
                request.priority() == null ? 0 : request.priority(), request.activeFrom());
        rule.setActiveUntil(request.activeUntil());
        priceRules.save(rule);
        audit.record(actor, "PRICE_RULE_CREATED", "PriceRule", rule.getId())
                .after(Map.of("variantId", rule.getVariantId().toString(), "tier", rule.getTier().name(),
                        "unitPriceMinor", rule.getUnitPriceMinor())).save();
        return ApiResponse.of(toResponse(rule));
    }

    @PatchMapping("/price-rules/{ruleId}")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ApiResponse<PriceRuleResponse> updatePriceRule(@PathVariable UUID ruleId,
                                                          @Valid @RequestBody PriceRuleRequest request, Actor actor) {
        PriceRule rule = priceRules.findById(ruleId).orElseThrow(() -> ApiException.notFound("Price rule " + ruleId));
        long before = rule.getUnitPriceMinor();
        rule.setUnitPriceMinor(Money.toMinor(request.unitPrice()));
        if (request.priority() != null) {
            rule.setPriority(request.priority());
        }
        rule.setActiveFrom(request.activeFrom());
        rule.setActiveUntil(request.activeUntil());
        audit.record(actor, "PRICE_RULE_UPDATED", "PriceRule", rule.getId())
                .before(Map.of("unitPriceMinor", before)).after(Map.of("unitPriceMinor", rule.getUnitPriceMinor())).save();
        return ApiResponse.of(toResponse(rule));
    }

    private static PriceRuleResponse toResponse(PriceRule rule) {
        return new PriceRuleResponse(rule.getId(), rule.getVariantId(), rule.getTier().name(), rule.getCurrency(),
                Money.toMajor(rule.getUnitPriceMinor()), rule.getPriority(), rule.getActiveFrom(),
                rule.getActiveUntil());
    }

    // ---------------------------------------------------------------- plans

    @GetMapping("/subscription-plans")
    public ApiResponse<List<PlanResponse>> plans(@RequestParam(required = false) UUID productId, Actor actor) {
        requireInternal(actor);
        List<SubscriptionPlan> rows = productId == null
                ? plans.findByActiveTrueOrderByNameAsc() : plans.findByProductIdAndActiveTrue(productId);
        return ApiResponse.of(rows.stream().map(CatalogAdminController::toResponse).toList());
    }

    @PostMapping("/subscription-plans")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<PlanResponse> createPlan(@Valid @RequestBody PlanRequest request, Actor actor) {
        Product product = products.findById(request.productId())
                .orElseThrow(() -> ApiException.notFound("Product " + request.productId()));
        if (!product.isRecurring()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "Plans belong to recurring products. \"" + product.getName() + "\" is one-time.");
        }
        if (!Set.of(1, 3, 12).contains(request.intervalMonths())) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "intervalMonths must be 1, 3 or 12.");
        }
        SubscriptionPlan plan = new SubscriptionPlan(request.productId(), request.code(), request.name(),
                request.intervalMonths(), Money.toMinor(request.intervalPrice()),
                request.intervalCost() == null ? 0L : Money.toMinor(request.intervalCost()));
        apply(plan, request);
        plans.save(plan);
        audit.record(actor, "PLAN_CREATED", "SubscriptionPlan", plan.getId())
                .after(Map.of("code", plan.getCode())).save();
        return ApiResponse.of(toResponse(plan));
    }

    @PatchMapping("/subscription-plans/{planId}")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ApiResponse<PlanResponse> updatePlan(@PathVariable UUID planId,
                                                @Valid @RequestBody PlanRequest request, Actor actor) {
        SubscriptionPlan plan = plans.findById(planId).orElseThrow(() -> ApiException.notFound("Plan " + planId));
        plan.setName(request.name());
        plan.setIntervalMonths(request.intervalMonths());
        plan.setIntervalPriceMinor(Money.toMinor(request.intervalPrice()));
        if (request.intervalCost() != null) {
            plan.setIntervalCostMinor(Money.toMinor(request.intervalCost()));
        }
        apply(plan, request);
        audit.record(actor, "PLAN_UPDATED", "SubscriptionPlan", plan.getId())
                .after(Map.of("code", plan.getCode(), "prorationPolicy", plan.getProrationPolicy().name(),
                        "cancellationPolicy", plan.getCancellationPolicy().name())).save();
        return ApiResponse.of(toResponse(plan));
    }

    private static void apply(SubscriptionPlan plan, PlanRequest request) {
        if (request.currency() != null) {
            plan.setCurrency(request.currency());
        }
        if (request.taxRateBp() != null) {
            plan.setTaxRateBp(request.taxRateBp());
        }
        if (request.billingAnchor() != null) {
            plan.setBillingAnchor(parse(BillingAnchor.class, request.billingAnchor()));
        }
        if (request.prorationPolicy() != null) {
            plan.setProrationPolicy(parse(ProrationPolicy.class, request.prorationPolicy()));
        }
        if (request.cancellationPolicy() != null) {
            plan.setCancellationPolicy(parse(CancellationPolicy.class, request.cancellationPolicy()));
        }
        if (request.active() != null) {
            plan.setActive(request.active());
        }
    }

    private static PlanResponse toResponse(SubscriptionPlan plan) {
        return new PlanResponse(plan.getId(), plan.getProductId(), plan.getCode(), plan.getName(),
                plan.getIntervalMonths(), plan.getCurrency(), Money.toMajor(plan.getIntervalPriceMinor()),
                Money.toMajor(plan.getIntervalCostMinor()), plan.getTaxRateBp(), plan.getBillingAnchor().name(),
                plan.getProrationPolicy().name(), plan.getCancellationPolicy().name(), plan.getClawbackPolicy(),
                plan.isActive());
    }

    // ----------------------------------------------------------- warehouses

    @GetMapping("/warehouses")
    public ApiResponse<List<WarehouseResponse>> warehouses(Actor actor) {
        requireInternal(actor);
        return ApiResponse.of(warehouses.findAll().stream().map(CatalogAdminController::toResponse).toList());
    }

    @PostMapping("/warehouses")
    @PreAuthorize("hasRole('ADMIN')")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ApiResponse<WarehouseResponse> createWarehouse(@Valid @RequestBody WarehouseRequest request, Actor actor) {
        Warehouse warehouse = new Warehouse(request.code(), request.name(),
                request.shippingFixedCost() == null ? 0L : Money.toMinor(request.shippingFixedCost()),
                request.sortOrder() == null ? 0 : request.sortOrder());
        apply(warehouse, request);
        warehouses.save(warehouse);
        audit.record(actor, "WAREHOUSE_CREATED", "Warehouse", warehouse.getId())
                .after(Map.of("code", warehouse.getCode())).save();
        return ApiResponse.of(toResponse(warehouse));
    }

    @PatchMapping("/warehouses/{warehouseId}")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ApiResponse<WarehouseResponse> updateWarehouse(@PathVariable UUID warehouseId,
                                                          @Valid @RequestBody WarehouseRequest request, Actor actor) {
        Warehouse warehouse = warehouses.findById(warehouseId)
                .orElseThrow(() -> ApiException.notFound("Warehouse " + warehouseId));
        warehouse.setName(request.name());
        if (request.shippingFixedCost() != null) {
            warehouse.setShippingFixedCostMinor(Money.toMinor(request.shippingFixedCost()));
        }
        if (request.sortOrder() != null) {
            warehouse.setSortOrder(request.sortOrder());
        }
        apply(warehouse, request);
        audit.record(actor, "WAREHOUSE_UPDATED", "Warehouse", warehouse.getId())
                .after(Map.of("shippingFixedCostMinor", warehouse.getShippingFixedCostMinor())).save();
        return ApiResponse.of(toResponse(warehouse));
    }

    private static void apply(Warehouse warehouse, WarehouseRequest request) {
        warehouse.setLocation(request.location());
        if (request.shippingCostPerKg() != null) {
            warehouse.setShippingCostPerKgMinor(Money.toMinor(request.shippingCostPerKg()));
        }
        if (request.active() != null) {
            warehouse.setActive(request.active());
        }
    }

    private static WarehouseResponse toResponse(Warehouse warehouse) {
        return new WarehouseResponse(warehouse.getId(), warehouse.getCode(), warehouse.getName(),
                warehouse.getLocation(), Money.toMajor(warehouse.getShippingFixedCostMinor()),
                Money.toMajor(warehouse.getShippingCostPerKgMinor()), warehouse.getSortOrder(),
                warehouse.isActive());
    }

    // -------------------------------------------------------------- helpers

    private static void requireInternal(Actor actor) {
        if (actor.isCustomer()) {
            throw ApiException.forbidden("The catalogue is internal.");
        }
    }

    private static <E extends Enum<E>> E parse(Class<E> type, String value) {
        if (value == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, type.getSimpleName() + " is required.");
        }
        try {
            return Enum.valueOf(type, value.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "\"" + value + "\" is not a valid " + type.getSimpleName() + ".");
        }
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
