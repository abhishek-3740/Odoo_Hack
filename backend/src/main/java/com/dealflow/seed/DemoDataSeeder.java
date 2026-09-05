package com.dealflow.seed;

import com.dealflow.auth.ApprovalDelegation;
import com.dealflow.auth.ApprovalDelegationRepository;
import com.dealflow.auth.Profile;
import com.dealflow.auth.ProfileRepository;
import com.dealflow.auth.Role;
import com.dealflow.catalog.CatalogEnums.BillingAnchor;
import com.dealflow.catalog.CatalogEnums.CancellationPolicy;
import com.dealflow.catalog.CatalogEnums.CategoryKind;
import com.dealflow.catalog.CatalogEnums.ChargeKind;
import com.dealflow.catalog.CatalogEnums.CustomerTier;
import com.dealflow.catalog.CatalogEnums.FulfillmentKind;
import com.dealflow.catalog.CatalogEnums.ProrationPolicy;
import com.dealflow.catalog.CatalogEnums.QuantityMode;
import com.dealflow.catalog.Category;
import com.dealflow.catalog.CategoryRepository;
import com.dealflow.catalog.Customer;
import com.dealflow.catalog.CustomerRepository;
import com.dealflow.catalog.PriceRule;
import com.dealflow.catalog.PriceRuleRepository;
import com.dealflow.catalog.Product;
import com.dealflow.catalog.ProductRepository;
import com.dealflow.catalog.ProductVariant;
import com.dealflow.catalog.ProductVariantRepository;
import com.dealflow.catalog.SubscriptionPlan;
import com.dealflow.catalog.SubscriptionPlanRepository;
import com.dealflow.catalog.Team;
import com.dealflow.catalog.TeamRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.fulfillment.Backorder;
import com.dealflow.fulfillment.BackorderRepository;
import com.dealflow.fulfillment.StockLevel;
import com.dealflow.fulfillment.StockLevelRepository;
import com.dealflow.fulfillment.Warehouse;
import com.dealflow.fulfillment.WarehouseRepository;
import com.dealflow.orders.Order;
import com.dealflow.orders.OrderLine;
import com.dealflow.orders.OrderLineRepository;
import com.dealflow.orders.OrderRepository;
import com.dealflow.policy.DiscountPolicyDefinition;
import com.dealflow.policy.DiscountPolicyRepository;
import com.dealflow.policy.DiscountPolicyService;
import com.dealflow.quotes.CommercialHash;
import com.dealflow.quotes.Quote;
import com.dealflow.quotes.QuoteEnums.ApprovalStatus;
import com.dealflow.quotes.QuoteEnums.RevisionSource;
import com.dealflow.quotes.QuoteEnums.Stage;
import com.dealflow.quotes.QuoteLine;
import com.dealflow.quotes.QuoteLineRepository;
import com.dealflow.quotes.QuoteRepository;
import com.dealflow.quotes.QuoteRevision;
import com.dealflow.quotes.QuoteRevisionRepository;
import com.dealflow.quotes.engine.PricingEngine;
import com.dealflow.quotes.engine.PricingModel.LineInput;
import com.dealflow.quotes.engine.PricingModel.LineKind;
import com.dealflow.quotes.engine.PricingModel.LineResult;
import com.dealflow.quotes.engine.PricingModel.PricingInput;
import com.dealflow.quotes.engine.PricingModel.PricingResult;
import com.dealflow.quotes.engine.RiskModel.ApprovalLevel;
import com.dealflow.shared.time.BusinessClock;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Deterministic demo data (Implementation Plan section 13.1).
 *
 * <p><b>Everything here is synthetic.</b> Historical orders exist so the
 * recommendation query has real rows to aggregate and the anomaly detector has
 * a baseline; they are labelled as demo fixtures and must never be described
 * as customer behaviour.
 *
 * <p>Idempotent: keyed on emails, codes and SKUs, so restarting the API does
 * not duplicate the catalogue. Profiles are provisioned by email with no auth
 * user id; the first verified Supabase sign-in for that email binds it. Auth
 * users themselves are created by {@code scripts/create-demo-users.mjs} with a
 * password supplied locally — never from source.
 *
 * <p>Stock is seeded exactly as the demo script expects: Main holds 4 laptops
 * and 10 docks, East holds 1 laptop. Flow A consumes 2 Main laptops and a dock;
 * Flow B then finds Main 2 / East 1 and backorders one.
 */
@Component
@ConditionalOnProperty(prefix = "dealflow.demo", name = "seed-on-startup", havingValue = "true")
public class DemoDataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DemoDataSeeder.class);

    private final TeamRepository teams;
    private final ProfileRepository profiles;
    private final ApprovalDelegationRepository delegations;
    private final CustomerRepository customers;
    private final CategoryRepository categories;
    private final ProductRepository products;
    private final ProductVariantRepository variants;
    private final PriceRuleRepository priceRules;
    private final SubscriptionPlanRepository plans;
    private final WarehouseRepository warehouses;
    private final StockLevelRepository stockLevels;
    private final DiscountPolicyRepository policies;
    private final DiscountPolicyService policyService;
    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final QuoteLineRepository quoteLines;
    private final OrderRepository orders;
    private final OrderLineRepository orderLines;
    private final BackorderRepository backorders;
    private final PricingEngine pricingEngine;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;
    private final AppProperties properties;

    public DemoDataSeeder(TeamRepository teams, ProfileRepository profiles,
                          ApprovalDelegationRepository delegations, CustomerRepository customers,
                          CategoryRepository categories, ProductRepository products,
                          ProductVariantRepository variants, PriceRuleRepository priceRules,
                          SubscriptionPlanRepository plans, WarehouseRepository warehouses,
                          StockLevelRepository stockLevels, DiscountPolicyRepository policies,
                          DiscountPolicyService policyService, QuoteRepository quotes,
                          QuoteRevisionRepository revisions, QuoteLineRepository quoteLines,
                          OrderRepository orders, OrderLineRepository orderLines,
                          BackorderRepository backorders, PricingEngine pricingEngine,
                          BusinessClock clock, ObjectMapper objectMapper, AppProperties properties) {
        this.teams = teams;
        this.profiles = profiles;
        this.delegations = delegations;
        this.customers = customers;
        this.categories = categories;
        this.products = products;
        this.variants = variants;
        this.priceRules = priceRules;
        this.plans = plans;
        this.warehouses = warehouses;
        this.stockLevels = stockLevels;
        this.policies = policies;
        this.policyService = policyService;
        this.quotes = quotes;
        this.revisions = revisions;
        this.quoteLines = quoteLines;
        this.orders = orders;
        this.orderLines = orderLines;
        this.backorders = backorders;
        this.pricingEngine = pricingEngine;
        this.clock = clock;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (profiles.findByEmailIgnoreCase("admin@dealflow.demo").isPresent()
                && !products.findByCode("LAPTOP").isEmpty()
                && !quotes.findByReference("Q-DEMO-HIST-01").isEmpty()) {
            log.info("Demo data already present; seeder skipped");
            return;
        }
        log.warn("Seeding SYNTHETIC demo data. Nothing in this dataset reflects real customers.");

        Team team = teams.findByName("Sales East").orElseGet(() -> teams.save(new Team("Sales East")));

        Profile admin = profile("admin@dealflow.demo", "Demo Admin", Role.ADMIN, null, null);
        Profile repA = profile("rep.a@dealflow.demo", "Rep A", Role.REP, team.getId(), null);
        Profile repB = profile("rep.b@dealflow.demo", "Rep B", Role.REP, team.getId(), null);
        Profile managerA = profile("manager.a@dealflow.demo", "Manager A", Role.MANAGER, team.getId(), null);
        Profile managerBackup = profile("manager.backup@dealflow.demo", "Backup Manager", Role.MANAGER,
                team.getId(), null);
        Profile finance = profile("finance@dealflow.demo", "Finance Ops", Role.FINANCE, null, null);

        Customer alpha = customer("Alpha Traders", CustomerTier.BRONZE, repA.getId());
        Customer beta = customer("Beta Systems", CustomerTier.GOLD, repA.getId());
        Customer gamma = customer("Gamma Retail", CustomerTier.SILVER, repB.getId());
        Customer delta = customer("Delta Logistics", CustomerTier.SILVER, repA.getId());
        Customer epsilon = customer("Epsilon Labs", CustomerTier.GOLD, repB.getId());

        profile("alpha@customer.demo", "Alpha Buyer", Role.CUSTOMER, null, alpha.getId());
        profile("beta@customer.demo", "Beta Buyer", Role.CUSTOMER, null, beta.getId());

        Instant now = clock.now();
        if (delegations.findByDelegateProfileId(managerBackup.getId()).isEmpty()) {
            // One valid and one expired delegation for the unavailability tests (E07).
            delegations.save(new ApprovalDelegation(Role.MANAGER, team.getId(), managerBackup.getId(),
                    now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(30)),
                    "Manager A on leave (demo)", admin.getId()));
            delegations.save(new ApprovalDelegation(Role.MANAGER, team.getId(), managerBackup.getId(),
                    now.minus(Duration.ofDays(60)), now.minus(Duration.ofDays(30)),
                    "Expired cover (demo)", admin.getId()));
        }

        Category hardware = category("HARDWARE", "Hardware", CategoryKind.HARDWARE);
        Category service = category("SERVICE", "Services", CategoryKind.SERVICE);
        Category subscription = category("SUBSCRIPTION", "Subscriptions", CategoryKind.SUBSCRIPTION);

        // Plan section 13: laptop 10,000 / cost 7,000; dock 1,000; setup 5,000 /
        // cost 3,500; support seat 300 a month / cost 120.
        Product laptop = product(hardware, "LAPTOP", "Business Laptop", 1_000_000L, 700_000L,
                FulfillmentKind.STOCK, ChargeKind.ONE_TIME, QuantityMode.INTEGER, false);
        Product dock = product(hardware, "DOCK", "USB-C Docking Station", 100_000L, 60_000L,
                FulfillmentKind.STOCK, ChargeKind.ONE_TIME, QuantityMode.INTEGER, true);
        Product setup = product(service, "SETUP", "On-site Setup Service", 500_000L, 350_000L,
                FulfillmentKind.NONE, ChargeKind.ONE_TIME, QuantityMode.DECIMAL, false);
        Product support = product(subscription, "SUPPORT", "Support Seat", 30_000L, 12_000L,
                FulfillmentKind.NONE, ChargeKind.RECURRING, QuantityMode.INTEGER, false);

        ProductVariant laptop14 = variant(laptop, "LAPTOP-14", "Business Laptop 14\"", 0L, 1_400, "LAPTOP");
        ProductVariant laptop16 = variant(laptop, "LAPTOP-16", "Business Laptop 16\"", 150_000L, 1_900, "LAPTOP");
        ProductVariant dockStd = variant(dock, "DOCK-STD", "Docking Station", 0L, 400, null);
        ProductVariant setupStd = variant(setup, "SETUP-STD", "On-site Setup", 0L, 0, null);
        ProductVariant seatStd = variant(support, "SUPPORT-SEAT", "Support Seat", 0L, 0, null);

        // A tier rule on the 16" model so tier pricing is demonstrably real (T01)
        // without disturbing the 14" numbers the demo script quotes.
        if (priceRules.findByVariantId(laptop16.getId()).isEmpty()) {
            priceRules.save(new PriceRule(laptop16.getId(), CustomerTier.GOLD, "INR", 1_100_000L, 10,
                    LocalDate.of(2026, 1, 1)));
        }

        SubscriptionPlan monthly = plan(support, "SUPPORT-M", "Support Seat (monthly)", 1, 30_000L, 12_000L);
        plan(support, "SUPPORT-Q", "Support Seat (quarterly)", 3, 90_000L, 36_000L);
        plan(support, "SUPPORT-Y", "Support Seat (yearly)", 12, 360_000L, 144_000L);

        Warehouse main = warehouse("MAIN", "Main Warehouse", "Mumbai", 10_000L, 1);
        Warehouse east = warehouse("EAST", "East Warehouse", "Kolkata", 15_000L, 2);

        stock(main, laptop14, "4", "2", "6");
        stock(main, dockStd, "10", "3", "12");
        stock(east, laptop14, "1", "1", "3");
        stock(main, laptop16, "2", "1", "4");

        if (policies.findMaxVersionNo() == 0) {
            policyService.publish(admin.toActor(), DiscountPolicyDefinition.seedDefault(),
                    "Illustrative seed policy from the implementation plan");
        }

        seedHistory(repA, repB, alpha, beta, gamma, delta, epsilon, laptop14, dockStd, setupStd,
                laptop, dock, setup, hardware, service, monthly, seatStd, support, subscription, now);

        log.warn("Demo seed complete. Create the matching Supabase auth users with "
                + "scripts/create-demo-users.mjs; profiles bind on first sign-in.");
    }

    // ------------------------------------------------------------- history

    /**
     * Historical orders for the recommendation query and the anomaly baseline.
     *
     * <p>Twelve confirmed laptop orders, eight of which include a dock, so the
     * panel can honestly say "appeared with laptops in 8 of 12 orders". Six of
     * them belong to Rep A at discounts between 4% and 9%, which gives the
     * anomaly detector a real mean and spread to compare against.
     */
    private void seedHistory(Profile repA, Profile repB, Customer alpha, Customer beta, Customer gamma,
                             Customer delta, Customer epsilon, ProductVariant laptop14,
                             ProductVariant dockStd, ProductVariant setupStd, Product laptop, Product dock,
                             Product setup, Category hardware, Category service, SubscriptionPlan monthly,
                             ProductVariant seatStd, Product support, Category subscription, Instant now) {
        if (quotes.findByReference("Q-DEMO-HIST-01").isPresent()) {
            return;
        }
        Customer[] buyers = {gamma, delta, epsilon, gamma, delta, epsilon, gamma, delta, epsilon, gamma, delta, epsilon};
        int[] discountsBp = {500, 700, 600, 900, 400, 800, 1000, 600, 500, 700, 800, 600};
        boolean[] withDock = {true, true, false, true, true, false, true, true, false, true, true, false};

        for (int i = 0; i < 12; i++) {
            Profile owner = i < 6 ? repA : repB;
            List<LineInput> inputs = new ArrayList<>();
            inputs.add(line("hist-laptop", 0, LineKind.ONE_TIME, laptop, hardware, laptop14, null,
                    "Business Laptop 14\"", "2", 1_000_000L, 700_000L, discountsBp[i], null, true));
            if (withDock[i]) {
                inputs.add(line("hist-dock", 1, LineKind.ONE_TIME, dock, hardware, dockStd, null,
                        "Docking Station", "2", 100_000L, 60_000L, discountsBp[i], null, true));
            }
            if (i % 4 == 0) {
                inputs.add(line("hist-setup", 2, LineKind.ONE_TIME, setup, service, setupStd, null,
                        "On-site Setup", "1", 500_000L, 350_000L, 0, null, false));
            }
            Instant when = now.minus(Duration.ofDays(120L - i * 8L));
            historicalOrder("Q-DEMO-HIST-" + String.format("%02d", i + 1), owner, buyers[i], inputs, when,
                    Order.FulfillmentStatus.DISPATCHED, null);
        }

        // Two support-only orders so the subscription product has history too.
        for (int i = 0; i < 2; i++) {
            List<LineInput> inputs = List.of(
                    line("hist-seats", 0, LineKind.RECURRING, support, subscription, null, monthly.getId(),
                            "Support Seat (monthly)", "5", 30_000L, 12_000L, 0, 1, false));
            historicalOrder("Q-DEMO-SUB-" + (i + 1), repB, i == 0 ? gamma : epsilon, inputs,
                    now.minus(Duration.ofDays(40L + i * 10L)), Order.FulfillmentStatus.NOT_REQUIRED, null);
        }

        // An order with an open backorder past its promised date: delivery
        // slippage with no invented receipt date (E09, T23).
        List<LineInput> late = List.of(line("late-laptop", 0, LineKind.ONE_TIME, laptop, hardware, laptop14,
                null, "Business Laptop 14\"", "3", 1_000_000L, 700_000L, 0, null, true));
        Order lateOrder = historicalOrder("Q-DEMO-LATE-01", repA, delta, late, now.minus(Duration.ofDays(20)),
                Order.FulfillmentStatus.UNALLOCATED, LocalDate.now(clock.clock()).minusDays(5));
        OrderLine lateLine = orderLines.findByOrderIdOrderByPositionAsc(lateOrder.getId()).getFirst();
        if (backorders.findOpenForLine(lateLine.getId()).isEmpty()) {
            backorders.save(new Backorder(lateOrder.getId(), lateLine.getId(), laptop14.getId(),
                    new BigDecimal("3")));
        }

        // A quotation sent five days ago with no customer response: stalled (T21).
        if (quotes.findByReference("Q-DEMO-STALLED-01").isEmpty()) {
            Instant sentAt = now.minus(Duration.ofDays(5));
            Quote stalled = new Quote("Q-DEMO-STALLED-01", alpha.getId(), repA.getId(), repA.getTeamId(), sentAt);
            stalled.setTitle("Alpha refresh (demo, awaiting customer)");
            stalled.setStage(Stage.SENT);
            quotes.save(stalled);
            QuoteRevision revision = submittedRevision(stalled, repA, List.of(
                    line("stalled-laptop", 0, LineKind.ONE_TIME, laptop, hardware, laptop14, null,
                            "Business Laptop 14\"", "1", 1_000_000L, 700_000L, 0, null, true)), sentAt);
            stalled.setCurrentRevisionId(revision.getId());
            stalled.beginAwaitingExternal(sentAt);
        }
    }

    private Order historicalOrder(String reference, Profile owner, Customer customer, List<LineInput> inputs,
                                  Instant when, Order.FulfillmentStatus fulfillment, LocalDate promisedDate) {
        var existing = quotes.findByReference(reference);
        if (existing.isPresent()) {
            return orders.findByQuoteId(existing.get().getId()).orElseThrow();
        }
        Quote quote = new Quote(reference, customer.getId(), owner.getId(), owner.getTeamId(), when);
        quote.setTitle("Historical order (synthetic demo fixture)");
        quote.setStage(Stage.CONFIRMED);
        quotes.save(quote);

        QuoteRevision revision = submittedRevision(quote, owner, inputs, when);
        revision.recordCustomerAcceptance(null, when, revision.getCommercialHash());
        quote.setCurrentRevisionId(revision.getId());

        Order order = new Order("SO-" + reference.substring(2), quote.getId(), revision.getId(),
                customer.getId(), owner.getId(), "INR", when);
        order.setFulfillmentStatus(fulfillment);
        order.setBillingStatus(Order.BillingStatus.INITIALIZED);
        order.setOneTimeNetMinor(revision.getOneTimeNetMinor());
        order.setOneTimeTaxMinor(revision.getOneTimeTaxMinor());
        orders.save(order);

        for (QuoteLine line : quoteLines.findByRevisionIdOrderByPositionAsc(revision.getId())) {
            OrderLine copy = new OrderLine(order.getId(), line.getId(), line.getLineKey(), line.getPosition());
            copy.setLineKind(line.getLineKind());
            copy.setProductId(line.getProductId());
            copy.setCategoryId(line.getCategoryId());
            copy.setVariantId(line.getVariantId());
            copy.setPlanId(line.getPlanId());
            copy.setDescription(line.getDescription());
            copy.setQuantity(line.getQuantity());
            copy.setUnitPriceMinor(line.getUnitPriceMinor());
            copy.setUnitCostMinor(line.getUnitCostMinor());
            copy.setTaxRateBp(line.getTaxRateBp());
            copy.setEffectiveDiscountBp(line.getEffectiveDiscountBp());
            copy.setNetMinor(line.getNetMinor());
            copy.setTaxMinor(line.getTaxMinor());
            copy.setIntervalMonths(line.getIntervalMonths());
            copy.setRequiresStock(line.isRequiresStock());
            copy.setPromisedDate(promisedDate);
            orderLines.save(copy);
        }
        return order;
    }

    /** Prices a fixture through the real engine so its stored totals are honest. */
    private QuoteRevision submittedRevision(Quote quote, Profile owner, List<LineInput> inputs, Instant when) {
        PricingResult pricing = pricingEngine.evaluate(new PricingInput("INR", 0, inputs));
        QuoteRevision revision = new QuoteRevision(quote.getId(), quote.nextRevisionNo(),
                RevisionSource.SELLER, "INR", owner.getId());
        revision.applyTotals(pricing.oneTimeNetMinor(), pricing.oneTimeTaxMinor(), pricing.oneTimeCostMinor(),
                pricing.recurringFirstCycleNetMinor(), pricing.recurringFirstCycleTaxMinor(),
                pricing.recurringFirstCycleCostMinor(), pricing.contributionMinor(),
                pricing.contributionPercent(), pricing.totalBaseMinor(), pricing.totalDiscountMinor());
        revision.setPolicyVersionNo(1);
        revision.setApprovalStatus(ApprovalStatus.NOT_REQUIRED);
        revision.setRequiredLevel(ApprovalLevel.NONE);
        revision.markSubmitted(when);
        revision.recordSellerAdoption(owner.getId(), when);
        revisions.save(revision);

        List<QuoteLine> rows = new ArrayList<>();
        for (LineResult result : pricing.lines()) {
            QuoteLine line = new QuoteLine(revision.getId(), result.lineKey(), result.position());
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
            rows.add(line);
        }
        quoteLines.saveAll(rows);
        revision.setCommercialHash(CommercialHash.of(revision, rows));
        return revision;
    }

    private static LineInput line(String key, int position, LineKind kind, Product product, Category category,
                                  ProductVariant variant, UUID planId, String description, String quantity,
                                  long priceMinor, long costMinor, int discountBp, Integer intervalMonths,
                                  boolean requiresStock) {
        return new LineInput(key, position, kind, product.getId(), category.getId(), category.getCode(),
                variant == null ? null : variant.getId(), planId, description, new BigDecimal(quantity),
                priceMinor, costMinor, 0, discountBp, intervalMonths, requiresStock, "MANUAL");
    }

    // ------------------------------------------------------------ catalogue

    private Profile profile(String email, String name, Role role, UUID teamId, UUID customerId) {
        return profiles.findByEmailIgnoreCase(email).orElseGet(() -> {
            Profile profile = new Profile(null, email, name, role);
            profile.setTeamId(teamId);
            profile.setCustomerId(customerId);
            return profiles.save(profile);
        });
    }

    private Customer customer(String name, CustomerTier tier, UUID ownerRepId) {
        return customers.findByNameIgnoreCase(name).orElseGet(() -> {
            Customer customer = new Customer(name, tier, "INR");
            customer.setOwnerRepProfileId(ownerRepId);
            customer.setContactEmail(name.toLowerCase(java.util.Locale.ROOT).replace(' ', '.') + "@example.demo");
            return customers.save(customer);
        });
    }

    private Category category(String code, String name, CategoryKind kind) {
        return categories.findByCode(code).orElseGet(() -> categories.save(new Category(code, name, kind)));
    }

    private Product product(Category category, String code, String name, long priceMinor, long costMinor,
                            FulfillmentKind fulfillment, ChargeKind charge, QuantityMode quantityMode,
                            boolean promoted) {
        return products.findByCode(code).orElseGet(() -> {
            Product product = new Product(category.getId(), code, name, priceMinor, costMinor, fulfillment, charge);
            product.setQuantityMode(quantityMode);
            product.setPromoted(promoted);
            product.setDescription("Synthetic demo product");
            return products.save(product);
        });
    }

    private ProductVariant variant(Product product, String sku, String name, long extraMinor, int weightGrams,
                                   String substitutionGroup) {
        return variants.findBySku(sku).orElseGet(() -> {
            ProductVariant variant = new ProductVariant(product.getId(), sku, name);
            variant.setPriceExtraMinor(extraMinor);
            variant.setWeightGrams(weightGrams);
            variant.setSubstitutionGroup(substitutionGroup);
            variant.setAttributes(objectMapper.writeValueAsString(Map.of("sku", sku)));
            return variants.save(variant);
        });
    }

    private SubscriptionPlan plan(Product product, String code, String name, int months, long priceMinor,
                                  long costMinor) {
        return plans.findByCode(code).orElseGet(() -> {
            SubscriptionPlan plan = new SubscriptionPlan(product.getId(), code, name, months, priceMinor, costMinor);
            plan.setBillingAnchor(BillingAnchor.CALENDAR_MONTH_START);
            plan.setProrationPolicy(ProrationPolicy.IMMEDIATE_PRORATED);
            plan.setCancellationPolicy(CancellationPolicy.IMMEDIATE_PRORATED);
            return plans.save(plan);
        });
    }

    private Warehouse warehouse(String code, String name, String location, long fixedCostMinor, int order) {
        return warehouses.findByCode(code).orElseGet(() -> {
            Warehouse warehouse = new Warehouse(code, name, fixedCostMinor, order);
            warehouse.setLocation(location);
            return warehouses.save(warehouse);
        });
    }

    private void stock(Warehouse warehouse, ProductVariant variant, String onHand, String reorder, String target) {
        if (stockLevels.findByWarehouseIdAndVariantId(warehouse.getId(), variant.getId()).isPresent()) {
            return;
        }
        StockLevel level = new StockLevel(warehouse.getId(), variant.getId());
        level.setOnHand(new BigDecimal(onHand));
        level.setReorderPoint(new BigDecimal(reorder));
        level.setTargetQty(new BigDecimal(target));
        stockLevels.save(level);
    }
}
