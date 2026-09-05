package com.dealflow.support;

import com.dealflow.auth.Profile;
import com.dealflow.auth.ProfileRepository;
import com.dealflow.auth.Role;
import com.dealflow.catalog.CatalogEnums.CategoryKind;
import com.dealflow.catalog.CatalogEnums.ChargeKind;
import com.dealflow.catalog.CatalogEnums.CustomerTier;
import com.dealflow.catalog.CatalogEnums.FulfillmentKind;
import com.dealflow.catalog.CatalogEnums.QuantityMode;
import com.dealflow.catalog.Category;
import com.dealflow.catalog.CategoryRepository;
import com.dealflow.catalog.Customer;
import com.dealflow.catalog.CustomerRepository;
import com.dealflow.catalog.Product;
import com.dealflow.catalog.ProductRepository;
import com.dealflow.catalog.ProductVariant;
import com.dealflow.catalog.ProductVariantRepository;
import com.dealflow.catalog.SubscriptionPlan;
import com.dealflow.catalog.SubscriptionPlanRepository;
import com.dealflow.fulfillment.StockLevel;
import com.dealflow.fulfillment.StockLevelRepository;
import com.dealflow.fulfillment.Warehouse;
import com.dealflow.fulfillment.WarehouseRepository;
import com.dealflow.policy.DiscountPolicyDefinition;
import com.dealflow.policy.DiscountPolicyRepository;
import com.dealflow.policy.DiscountPolicyService;
import java.math.BigDecimal;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;

/**
 * Base for tests that run the whole application against a real PostgreSQL.
 *
 * <p>The container is a JVM-wide singleton, started once in a static
 * initialiser rather than per test class. Spring caches the application
 * context across test classes, and that context holds a connection pool bound
 * to one container; a per-class container would be stopped while the cached
 * context still pointed at it. Testcontainers' Ryuk reaper removes it at exit.
 *
 * <p>Each test builds the fixtures it needs with unique codes so tests do not
 * depend on ordering. Scheduled jobs and the demo seeder are off so nothing
 * races the assertions.
 *
 * <p>Concurrency and locking assertions are only meaningful on PostgreSQL —
 * an in-memory database has different locking semantics — which is why there
 * is no H2 fallback.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = {
        "dealflow.jobs.enabled=false",
        "dealflow.demo.seed-on-startup=false",
        "dealflow.demo.mode=false",
        "dealflow.auth.jwt-secret=" + TestTokens.SECRET,
        "dealflow.auth.jwk-set-uri=",
        "dealflow.auth.issuer-uri=" + TestTokens.ISSUER,
        "dealflow.auth.auto-provision-rep=true",
        "logging.level.com.dealflow=WARN"
})
public abstract class AbstractIntegrationTest {

    @ServiceConnection
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    static {
        POSTGRES.start();
    }

    @LocalServerPort
    protected int port;

    @Autowired
    protected ObjectMapper objectMapper;
    @Autowired
    protected ProfileRepository profiles;
    @Autowired
    protected CustomerRepository customers;
    @Autowired
    protected CategoryRepository categories;
    @Autowired
    protected ProductRepository products;
    @Autowired
    protected ProductVariantRepository variants;
    @Autowired
    protected SubscriptionPlanRepository plans;
    @Autowired
    protected WarehouseRepository warehouses;
    @Autowired
    protected StockLevelRepository stockLevels;
    @Autowired
    protected DiscountPolicyRepository policies;
    @Autowired
    protected DiscountPolicyService policyService;

    protected RestClient http;

    @BeforeEach
    void setUpClient() {
        http = RestClient.builder()
                .baseUrl("http://localhost:" + port)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .defaultStatusHandler(status -> true, (request, response) -> { })
                .build();
        ensurePolicy();
    }

    /** A published policy is a precondition for any evaluation. */
    protected void ensurePolicy() {
        if (policies.findMaxVersionNo() == 0) {
            Profile admin = person("policy-admin-" + UUID.randomUUID(), Role.ADMIN, null, null);
            policyService.publish(admin.toActor(), DiscountPolicyDefinition.seedDefault(), "test seed");
        }
    }

    // ------------------------------------------------------------ fixtures

    /** A profile bound to a fresh auth user id, ready to be given a token. */
    protected Profile person(String prefix, Role role, UUID teamId, UUID customerId) {
        Profile profile = new Profile(UUID.randomUUID(), prefix + "@test.local", prefix, role);
        profile.setTeamId(teamId);
        profile.setCustomerId(customerId);
        return profiles.save(profile);
    }

    protected String tokenFor(Profile profile) {
        return TestTokens.forUser(profile.getAuthUserId(), profile.getEmail());
    }

    protected Customer customer(String name, CustomerTier tier) {
        return customers.save(new Customer(name + " " + UUID.randomUUID().toString().substring(0, 6), tier, "INR"));
    }

    protected Category category(String code, CategoryKind kind) {
        return categories.findByCode(code).orElseGet(() -> categories.save(new Category(code, code, kind)));
    }

    /** A stocked one-time product with one variant. Price and cost in minor units. */
    protected ProductVariant stockedItem(String code, long priceMinor, long costMinor, boolean promoted) {
        Category hardware = category("HARDWARE", CategoryKind.HARDWARE);
        String unique = code + "-" + UUID.randomUUID().toString().substring(0, 6);
        Product product = new Product(hardware.getId(), unique, code, priceMinor, costMinor,
                FulfillmentKind.STOCK, ChargeKind.ONE_TIME);
        product.setPromoted(promoted);
        products.save(product);
        ProductVariant variant = new ProductVariant(product.getId(), unique + "-STD", code);
        variant.setWeightGrams(1000);
        return variants.save(variant);
    }

    protected ProductVariant serviceItem(String code, long priceMinor, long costMinor) {
        Category service = category("SERVICE", CategoryKind.SERVICE);
        String unique = code + "-" + UUID.randomUUID().toString().substring(0, 6);
        Product product = new Product(service.getId(), unique, code, priceMinor, costMinor,
                FulfillmentKind.NONE, ChargeKind.ONE_TIME);
        product.setQuantityMode(QuantityMode.DECIMAL);
        products.save(product);
        return variants.save(new ProductVariant(product.getId(), unique + "-STD", code));
    }

    protected SubscriptionPlan monthlyPlan(String code, long priceMinor, long costMinor) {
        Category subscription = category("SUBSCRIPTION", CategoryKind.SUBSCRIPTION);
        String unique = code + "-" + UUID.randomUUID().toString().substring(0, 6);
        Product product = products.save(new Product(subscription.getId(), unique, code, priceMinor, costMinor,
                FulfillmentKind.NONE, ChargeKind.RECURRING));
        return plans.save(new SubscriptionPlan(product.getId(), unique + "-M", code + " monthly", 1,
                priceMinor, costMinor));
    }

    protected Warehouse warehouse(String code, long fixedCostMinor, int order) {
        String unique = code + "-" + UUID.randomUUID().toString().substring(0, 6);
        return warehouses.save(new Warehouse(unique, code, fixedCostMinor, order));
    }

    protected StockLevel stock(Warehouse warehouse, ProductVariant variant, String onHand) {
        StockLevel level = new StockLevel(warehouse.getId(), variant.getId());
        level.setOnHand(new BigDecimal(onHand));
        return stockLevels.save(level);
    }

    // ---------------------------------------------------------------- http

    protected RestClient.RequestBodySpec post(String path, String token) {
        return http.post().uri(path).header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON);
    }

    protected RestClient.RequestHeadersSpec<?> get(String path, String token) {
        return http.get().uri(path).header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
    }

    /** Parses a response body into a JSON tree; the caller asserts on status separately. */
    protected tools.jackson.databind.JsonNode json(String body) {
        return objectMapper.readTree(body == null ? "{}" : body);
    }

    /**
     * True when a field is null or not present at all. The API omits null
     * fields ({@code default-property-inclusion: non_null}), so an absent key
     * is the normal representation of "no value".
     */
    protected static boolean absentOrNull(tools.jackson.databind.JsonNode node, String field) {
        tools.jackson.databind.JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull();
    }

    protected String toJson(Object value) {
        return objectMapper.writeValueAsString(value);
    }

    protected static Map<String, Object> map(Object... keyValues) {
        var result = new java.util.LinkedHashMap<String, Object>();
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            result.put(String.valueOf(keyValues[i]), keyValues[i + 1]);
        }
        return result;
    }
}
