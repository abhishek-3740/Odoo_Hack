package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.auth.models.Profile;
import com.dealflow.auth.models.Role;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.models.Product;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.orders.models.Order;
import com.dealflow.orders.models.OrderLine;
import com.dealflow.orders.repo.OrderLineRepository;
import com.dealflow.orders.repo.OrderRepository;
import com.dealflow.quotes.models.Quote;
import com.dealflow.quotes.models.QuoteEnums.RevisionSource;
import com.dealflow.quotes.models.QuoteEnums.Stage;
import com.dealflow.quotes.models.QuoteLine;
import com.dealflow.quotes.repo.QuoteLineRepository;
import com.dealflow.quotes.repo.QuoteRepository;
import com.dealflow.quotes.models.QuoteRevision;
import com.dealflow.quotes.repo.QuoteRevisionRepository;
import com.dealflow.quotes.models.PricingModel.LineKind;
import com.dealflow.support.AbstractIntegrationTest;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

/**
 * Recommendations come from real finalised order lines (test T09). The
 * co-purchase statistics are a native query, so this is the only place that
 * SQL is actually executed before the demo.
 */
class RecommendationIT extends AbstractIntegrationTest {

    @Autowired
    QuoteRepository quotes;
    @Autowired
    QuoteRevisionRepository revisions;
    @Autowired
    QuoteLineRepository quoteLines;
    @Autowired
    OrderRepository orders;
    @Autowired
    OrderLineRepository orderLines;

    @Test
    @DisplayName("a dock is suggested with laptops because it appeared in 4 of 6 real orders; dismissal sticks")
    void coPurchaseSuggestionWithEvidence() {
        Profile rep = person("rep-" + suffix(), Role.REP, null, null);
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        ProductVariant dock = stockedItem("Dock", 100_000L, 60_000L, true);
        ProductVariant mouse = stockedItem("Mouse", 50_000L, 20_000L, false);

        // Six confirmed laptop orders; the dock rode along on four of them, the
        // mouse on none. Synthetic history, built the way the seeder builds it.
        for (int i = 0; i < 6; i++) {
            historicalOrder(rep, alpha, i < 4 ? List.of(laptop, dock) : List.of(laptop));
        }
        historicalOrder(rep, alpha, List.of(mouse));

        String token = tokenFor(rep);
        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", token)
                .body(toJson(map("customerId", alpha.getId())))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());
        post("/api/v1/quotes/" + quoteId + "/revisions", token)
                .body(toJson(map("lines", List.of(map("variantId", laptop.getId(), "quantity", "2")))))
                .retrieve().toEntity(String.class);

        JsonNode result = json(get("/api/v1/quotes/" + quoteId + "/recommendations", token)
                .retrieve().toEntity(String.class).getBody()).get("data");

        assertThat(result.get("limitedHistory").asBoolean()).isFalse();
        assertThat(result.get("eligibleHistoricalOrders").asLong()).isEqualTo(6);

        JsonNode dockSuggestion = null;
        for (JsonNode suggestion : result.get("suggestions")) {
            if (suggestion.get("variantId").asText().equals(dock.getId().toString())) {
                dockSuggestion = suggestion;
            }
            // The mouse was never bought with a laptop; it must not be suggested.
            assertThat(suggestion.get("variantId").asText()).isNotEqualTo(mouse.getId().toString());
        }
        assertThat(dockSuggestion).as("dock suggested").isNotNull();
        assertThat(dockSuggestion.get("basis").asText()).isEqualTo("CO_PURCHASE");
        assertThat(dockSuggestion.get("reason").asText()).contains("4 of 6");
        assertThat(dockSuggestion.get("promoted").asBoolean()).isTrue();
        // Repriced for this customer's tier, and the margin effect is shown.
        assertThat(dockSuggestion.get("unitPrice").asText()).isEqualTo("1000.00");
        assertThat(dockSuggestion.get("contributionDelta").asText()).isEqualTo("400.00");
        assertThat(dockSuggestion.get("inStock").asBoolean()).isFalse();
        assertThat(dockSuggestion.get("availabilityNote").asText()).contains("backordered");

        // Dismissal is persisted for this revision.
        post("/api/v1/quotes/" + quoteId + "/recommendation-dismissals", token)
                .body(toJson(map("variantId", dock.getId())))
                .retrieve().toEntity(String.class);
        JsonNode after = json(get("/api/v1/quotes/" + quoteId + "/recommendations", token)
                .retrieve().toEntity(String.class).getBody()).get("data");
        for (JsonNode suggestion : after.get("suggestions")) {
            assertThat(suggestion.get("variantId").asText()).isNotEqualTo(dock.getId().toString());
        }
    }

    @Test
    @DisplayName("with too little history the panel says so instead of inventing a confidence")
    void thinHistoryIsLabelled() {
        Profile rep = person("rep-" + suffix(), Role.REP, null, null);
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        ProductVariant widget = stockedItem("Widget", 10_000L, 5_000L, false);
        ProductVariant gadget = stockedItem("Gadget", 20_000L, 5_000L, true);
        historicalOrder(rep, alpha, List.of(widget, gadget));

        String token = tokenFor(rep);
        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", token)
                .body(toJson(map("customerId", alpha.getId())))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());
        post("/api/v1/quotes/" + quoteId + "/revisions", token)
                .body(toJson(map("lines", List.of(map("variantId", widget.getId(), "quantity", "1")))))
                .retrieve().toEntity(String.class);

        JsonNode result = json(get("/api/v1/quotes/" + quoteId + "/recommendations", token)
                .retrieve().toEntity(String.class).getBody()).get("data");

        assertThat(result.get("limitedHistory").asBoolean()).isTrue();
        assertThat(result.get("note").asText()).contains("Limited purchase history");
        // "1 of 1" is a coincidence with a percentage sign, not a pattern: any
        // suggestion here is the promoted/category fallback, labelled as such.
        for (JsonNode suggestion : result.get("suggestions")) {
            assertThat(suggestion.get("basis").asText()).isEqualTo("LIMITED_HISTORY");
        }
    }

    // -------------------------------------------------------------- fixture

    /** A confirmed order with one unit of each item, written the way the seeder writes history. */
    private void historicalOrder(Profile owner, Customer customer, List<ProductVariant> items) {
        Instant when = Instant.now().minusSeconds(86_400L * 30);
        Quote quote = new Quote("Q-HIST-" + suffix(), customer.getId(), owner.getId(), null, when);
        quote.setStage(Stage.CONFIRMED);
        quotes.save(quote);

        QuoteRevision revision = new QuoteRevision(quote.getId(), quote.nextRevisionNo(),
                RevisionSource.SELLER, "INR", owner.getId());
        revision.markSubmitted(when);
        revision.recordSellerAdoption(owner.getId(), when);
        revisions.save(revision);
        quote.setCurrentRevisionId(revision.getId());

        Order order = new Order("SO-HIST-" + suffix(), quote.getId(), revision.getId(),
                customer.getId(), owner.getId(), "INR", when);
        order.setFulfillmentStatus(Order.FulfillmentStatus.DISPATCHED);
        order.setBillingStatus(Order.BillingStatus.INITIALIZED);
        orders.save(order);

        long totalBase = 0;
        for (int i = 0; i < items.size(); i++) {
            ProductVariant variant = items.get(i);
            Product product = products.findById(variant.getProductId()).orElseThrow();
            long price = variant.resolveDefaultPriceMinor(product);
            long cost = variant.resolveCostMinor(product);
            totalBase += price;

            QuoteLine line = new QuoteLine(revision.getId(), "line-" + i, i);
            line.setLineKind(LineKind.ONE_TIME);
            line.setProductId(product.getId());
            line.setCategoryId(product.getCategoryId());
            line.setVariantId(variant.getId());
            line.setDescription(variant.getName());
            line.setQuantity(BigDecimal.ONE);
            line.setUnitPriceMinor(price);
            line.setUnitCostMinor(cost);
            line.setBaseMinor(price);
            line.setNetMinor(price);
            line.setCostTotalMinor(cost);
            line.setMarginMinor(price - cost);
            line.setRequiresStock(true);
            quoteLines.save(line);

            OrderLine orderLine = new OrderLine(order.getId(), line.getId(), line.getLineKey(), i);
            orderLine.setLineKind(LineKind.ONE_TIME);
            orderLine.setProductId(product.getId());
            orderLine.setCategoryId(product.getCategoryId());
            orderLine.setVariantId(variant.getId());
            orderLine.setDescription(variant.getName());
            orderLine.setQuantity(BigDecimal.ONE);
            orderLine.setUnitPriceMinor(price);
            orderLine.setUnitCostMinor(cost);
            orderLine.setNetMinor(price);
            orderLine.setRequiresStock(true);
            orderLines.save(orderLine);
        }
        revision.applyTotals(totalBase, 0, 0, 0, 0, 0, totalBase, null, totalBase, 0);
        order.setOneTimeNetMinor(totalBase);
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
