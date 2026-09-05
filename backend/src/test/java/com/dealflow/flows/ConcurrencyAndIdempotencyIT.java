package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.auth.models.Profile;
import com.dealflow.auth.models.Role;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.fulfillment.repo.BackorderRepository;
import com.dealflow.fulfillment.models.Warehouse;
import com.dealflow.orders.repo.OrderRepository;
import com.dealflow.support.AbstractIntegrationTest;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.JsonNode;

/**
 * Races run against real PostgreSQL transactions, not an in-memory database
 * with different locking semantics (tests T10, T13, T27).
 */
class ConcurrencyAndIdempotencyIT extends AbstractIntegrationTest {

    @Autowired
    OrderRepository orders;
    @Autowired
    BackorderRepository backorders;

    @Test
    @DisplayName("two simultaneous acceptances of one quotation produce exactly one order (T13)")
    void concurrentAcceptancesCreateOneOrder() throws Exception {
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        Profile rep = person("rep-" + suffix(), Role.REP, null, null);
        Profile buyer = person("buyer-" + suffix(), Role.CUSTOMER, null, alpha.getId());
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        Warehouse main = warehouse("MAIN", 10_000L, 1);
        stock(main, laptop, "10");

        Ready ready = readyToAccept(rep, buyer, alpha, laptop, "2", "ALLOW_BACKORDER");

        List<ResponseEntity<String>> responses = inParallel(List.of(
                () -> accept(ready, buyer, "k1-" + suffix()),
                () -> accept(ready, buyer, "k2-" + suffix())));

        assertThat(responses).allSatisfy(response ->
                assertThat(response.getStatusCode().value()).as(response.getBody()).isEqualTo(200));
        assertThat(orders.findByQuoteId(ready.quoteId)).isPresent();
        assertThat(orders.findAll().stream().filter(order -> order.getQuoteId().equals(ready.quoteId)))
                .hasSize(1);
        assertThat(stockLevels.findByWarehouseIdAndVariantId(main.getId(), laptop.getId()).orElseThrow()
                .getReserved()).isEqualByComparingTo("2");
    }

    @Test
    @DisplayName("two orders competing for the last unit never oversell (T10, E10)")
    void competingOrdersDoNotOversell() throws Exception {
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        Warehouse main = warehouse("MAIN", 10_000L, 1);
        stock(main, laptop, "1");

        Customer first = customer("First", CustomerTier.SILVER);
        Customer second = customer("Second", CustomerTier.SILVER);
        Profile rep = person("rep-" + suffix(), Role.REP, null, null);
        Profile buyerOne = person("buyer1-" + suffix(), Role.CUSTOMER, null, first.getId());
        Profile buyerTwo = person("buyer2-" + suffix(), Role.CUSTOMER, null, second.getId());

        Ready one = readyToAccept(rep, buyerOne, first, laptop, "1", "ALLOW_BACKORDER");
        Ready two = readyToAccept(rep, buyerTwo, second, laptop, "1", "ALLOW_BACKORDER");

        List<ResponseEntity<String>> responses = inParallel(List.of(
                () -> accept(one, buyerOne, "race1-" + suffix()),
                () -> accept(two, buyerTwo, "race2-" + suffix())));

        assertThat(responses).allSatisfy(response ->
                assertThat(response.getStatusCode().value()).as(response.getBody()).isEqualTo(200));

        var level = stockLevels.findByWarehouseIdAndVariantId(main.getId(), laptop.getId()).orElseThrow();
        assertThat(level.getReserved()).as("reserved never exceeds on hand").isEqualByComparingTo("1");
        assertThat(level.getOnHand()).isEqualByComparingTo("1");

        // Both orders exist; exactly one of them holds the unit, the other is backordered.
        UUID orderOne = orders.findByQuoteId(one.quoteId).orElseThrow().getId();
        UUID orderTwo = orders.findByQuoteId(two.quoteId).orElseThrow().getId();
        int openBackorders = backorders.findOpenForOrder(orderOne).size() + backorders.findOpenForOrder(orderTwo).size();
        assertThat(openBackorders).isEqualTo(1);
    }

    @Test
    @DisplayName("an idempotency key replays its result and refuses a different body (T27)")
    void idempotencyKeyIsBoundToItsBody() {
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        Profile finance = person("finance-" + suffix(), Role.FINANCE, null, null);
        String token = tokenFor(finance);
        String key = "pay-" + suffix();

        ResponseEntity<String> first = post("/api/v1/payments", token)
                .header("Idempotency-Key", key)
                .body(toJson(map("customerId", alpha.getId(), "amount", "500.00", "method", "CASH")))
                .retrieve().toEntity(String.class);
        assertThat(first.getStatusCode().value()).as(first.getBody()).isEqualTo(200);
        String paymentId = json(first.getBody()).get("data").get("id").asText();

        // Same key, same body: the stored result comes back, no second payment.
        ResponseEntity<String> replay = post("/api/v1/payments", token)
                .header("Idempotency-Key", key)
                .body(toJson(map("customerId", alpha.getId(), "amount", "500.00", "method", "CASH")))
                .retrieve().toEntity(String.class);
        assertThat(replay.getStatusCode().value()).isEqualTo(200);
        assertThat(json(replay.getBody()).get("data").get("id").asText()).isEqualTo(paymentId);

        // Same key, different body: refused rather than silently mutated.
        ResponseEntity<String> reused = post("/api/v1/payments", token)
                .header("Idempotency-Key", key)
                .body(toJson(map("customerId", alpha.getId(), "amount", "9999.00", "method", "CASH")))
                .retrieve().toEntity(String.class);
        assertThat(reused.getStatusCode().value()).isEqualTo(409);
        assertThat(json(reused.getBody()).get("error").get("code").asText()).isEqualTo("IDEMPOTENCY_KEY_REUSED");

        // No key at all is a client error, not a silently unprotected write.
        ResponseEntity<String> missing = post("/api/v1/payments", token)
                .body(toJson(map("customerId", alpha.getId(), "amount", "1.00", "method", "CASH")))
                .retrieve().toEntity(String.class);
        assertThat(missing.getStatusCode().value()).isEqualTo(400);
        assertThat(json(missing.getBody()).get("error").get("code").asText()).isEqualTo("IDEMPOTENCY_KEY_REQUIRED");
    }

    @Test
    @DisplayName("a stale row version is refused with the current version (E06/E19)")
    void staleEditIsRefused() {
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        Profile rep = person("rep-" + suffix(), Role.REP, null, null);
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        String token = tokenFor(rep);

        JsonNode created = json(post("/api/v1/quotes", token)
                .body(toJson(map("customerId", alpha.getId())))
                .retrieve().toEntity(String.class).getBody()).get("data");
        UUID quoteId = UUID.fromString(created.get("quoteId").asText());
        long version = created.get("rowVersion").asLong();

        post("/api/v1/quotes/" + quoteId + "/revisions", token)
                .body(toJson(map("lines", List.of(map("variantId", laptop.getId(), "quantity", "1")),
                        "expectedRowVersion", version)))
                .retrieve().toEntity(String.class);

        ResponseEntity<String> stale = post("/api/v1/quotes/" + quoteId + "/revisions", token)
                .body(toJson(map("lines", List.of(map("variantId", laptop.getId(), "quantity", "2")),
                        "expectedRowVersion", version)))
                .retrieve().toEntity(String.class);
        assertThat(stale.getStatusCode().value()).isEqualTo(409);
        JsonNode error = json(stale.getBody()).get("error");
        assertThat(error.get("code").asText()).isEqualTo("STALE_QUOTE_VERSION");
        assertThat(error.get("details").get("currentVersion").asLong()).isGreaterThan(version);
    }

    // -------------------------------------------------------------- helpers

    private record Ready(UUID quoteId, UUID revisionId, String hash) {
    }

    private Ready readyToAccept(Profile rep, Profile buyer, Customer customer, ProductVariant variant,
                                String quantity, String terms) {
        String repToken = tokenFor(rep);
        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", repToken)
                .body(toJson(map("customerId", customer.getId())))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());
        UUID revisionId = UUID.fromString(json(post("/api/v1/quotes/" + quoteId + "/revisions", repToken)
                .body(toJson(map("lines", List.of(map("variantId", variant.getId(), "quantity", quantity)),
                        "backorderTerms", terms)))
                .retrieve().toEntity(String.class).getBody()).get("data").get("revisionId").asText());
        post("/api/v1/quotes/" + quoteId + "/submissions", repToken)
                .body(toJson(map("expectedRevisionId", revisionId))).retrieve().toEntity(String.class);
        post("/api/v1/quotes/" + quoteId + "/shares", repToken).retrieve().toEntity(String.class);
        String hash = json(get("/api/v1/portal/quotes/" + quoteId, tokenFor(buyer))
                .retrieve().toEntity(String.class).getBody()).get("data").get("commercialHash").asText();
        return new Ready(quoteId, revisionId, hash);
    }

    private ResponseEntity<String> accept(Ready ready, Profile buyer, String key) {
        return post("/api/v1/portal/quotes/" + ready.quoteId + "/acceptances", tokenFor(buyer))
                .header("Idempotency-Key", key)
                .body(toJson(map("revisionId", ready.revisionId, "commercialHash", ready.hash)))
                .retrieve().toEntity(String.class);
    }

    /** Fires every task on its own thread at the same instant. */
    private static List<ResponseEntity<String>> inParallel(List<Callable<ResponseEntity<String>>> tasks)
            throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(tasks.size());
        CountDownLatch gate = new CountDownLatch(1);
        List<Future<ResponseEntity<String>>> futures = new ArrayList<>();
        try {
            for (Callable<ResponseEntity<String>> task : tasks) {
                futures.add(pool.submit(() -> {
                    gate.await();
                    return task.call();
                }));
            }
            gate.countDown();
            List<ResponseEntity<String>> results = new ArrayList<>();
            for (Future<ResponseEntity<String>> future : futures) {
                results.add(future.get());
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
