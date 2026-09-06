package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.auth.models.Profile;
import com.dealflow.auth.models.Role;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.fulfillment.models.Warehouse;
import com.dealflow.support.AbstractIntegrationTest;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.JsonNode;

/**
 * The counteroffer a customer makes about the whole quotation rather than one
 * line: "ten percent off, please" (plan section 6.2).
 *
 * <p>Flow B already covers a line-level counter. This covers the order-level
 * one, and the fields the two user interfaces read to drive it: the source name
 * that tells the rep these are the customer's terms, the request payload that
 * says what was asked for, the split between a line's own discount and its
 * effective one, and the status the request lands in once the rep agrees.
 *
 * <p>The last assertion is the point of the whole exercise: the invoice raised
 * at the end carries the reduced amount. A counteroffer that leaves the money
 * untouched is not a counteroffer.
 */
class OrderLevelCounterofferIT extends AbstractIntegrationTest {

    @Test
    @DisplayName("a 10% order-level counteroffer reprices the deal, is adoptable, and reaches the invoice")
    void orderLevelCounterofferRepricesThroughToTheInvoice() {
        // Gold: a 10% ask sits inside the tier ceiling, so this test is about
        // the money moving rather than about approval routing, which Flow B
        // already covers.
        Customer alpha = customer("Alpha", CustomerTier.GOLD);
        Profile rep = person("rep-counter-" + suffix(), Role.REP, null, null);
        Profile finance = person("finance-counter-" + suffix(), Role.FINANCE, null, null);
        Profile buyer = person("alpha-buyer-" + suffix(), Role.CUSTOMER, null, alpha.getId());
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        Warehouse main = warehouse("MAIN", 10_000L, 1);
        stock(main, laptop, "10");

        String repToken = tokenFor(rep);
        String financeToken = tokenFor(finance);
        String buyerToken = tokenFor(buyer);

        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", repToken)
                .body(toJson(map("customerId", alpha.getId(), "title", "Alpha refresh")))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());

        // Two laptops at INR 10,000, nothing off: INR 20,000.
        JsonNode draft = json(post("/api/v1/quotes/" + quoteId + "/revisions", repToken)
                .body(toJson(map("lines", List.of(
                        map("lineKey", "laptops", "variantId", laptop.getId(),
                                "quantity", "2", "lineDiscountBp", 0)),
                        "orderDiscountBp", 0)))
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(draft.get("totals").get("oneTimeNet").asText()).isEqualTo("20000.00");
        UUID revision1 = UUID.fromString(draft.get("revisionId").asText());

        post("/api/v1/quotes/" + quoteId + "/submissions", repToken)
                .body(toJson(map("expectedRevisionId", revision1)))
                .retrieve().toEntity(String.class);
        post("/api/v1/quotes/" + quoteId + "/shares", repToken).retrieve().toEntity(String.class);

        // ---- the customer asks for 10% off the quotation, naming no line
        ResponseEntity<String> countered = post("/api/v1/portal/quotes/" + quoteId + "/requests", buyerToken)
                .header("Idempotency-Key", "order-counter-" + suffix())
                .body(toJson(map("requestType", "COUNTER", "expectedRevisionId", revision1,
                        "requestedOrderDiscountBp", 1000,
                        "message", "We can sign today at 10% off.")))
                .retrieve().toEntity(String.class);
        assertThat(countered.getStatusCode().value()).as(countered.getBody()).isEqualTo(200);

        JsonNode counterView = json(countered.getBody()).get("data");
        assertThat(counterView.get("versionNumber").asInt()).isEqualTo(2);
        assertThat(counterView.get("awaitingInternalApproval").asBoolean()).isFalse();
        // The money actually moved: 20,000 less ten percent.
        assertThat(counterView.get("totals").get("oneTimeSubtotal").asText()).isEqualTo("18000.00");
        assertThat(counterView.get("orderDiscountBp").asInt()).isEqualTo(1000);

        // A line's own discount and its effective one are reported separately.
        // Seeding a counteroffer form from the effective figure would apply the
        // order discount a second time on the next round.
        JsonNode counterLine = counterView.get("lines").get(0);
        assertThat(counterLine.get("discountPercentBp").asInt()).isEqualTo(1000);
        assertThat(counterLine.get("lineDiscountPercentBp").asInt()).isZero();

        UUID revision2 = UUID.fromString(counterView.get("revisionId").asText());
        String hash2 = counterView.get("commercialHash").asText();

        // ---- the rep's view names the source the workspace keys off
        JsonNode internal = json(get("/api/v1/quotes/" + quoteId, repToken)
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(internal.get("revisionSource").asText()).isEqualTo("CUSTOMER_COUNTER");
        assertThat(internal.get("orderDiscountBp").asInt()).isEqualTo(1000);
        assertThat(internal.get("gates").get("sellerAdopted").asBoolean()).isFalse();
        assertThat(internal.get("totals").get("oneTimeNet").asText()).isEqualTo("18000.00");

        // ---- the deal room carries the numbers, not only the sentence
        JsonNode requests = json(get("/api/v1/quotes/" + quoteId + "/requests", repToken)
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(requests).hasSize(1);
        JsonNode request = requests.get(0);
        assertThat(request.get("status").asText()).isEqualTo("OPEN");
        assertThat(request.get("requestType").asText()).isEqualTo("COUNTER");
        assertThat(request.get("candidateRevisionId").asText()).isEqualTo(revision2.toString());
        assertThat(request.get("payload").get("requestedOrderDiscountBp").asInt()).isEqualTo(1000);

        // ---- the rep agrees; the request stops asking
        ResponseEntity<String> adopted = post("/api/v1/quotes/" + quoteId + "/adoptions", repToken)
                .body(toJson(map("revisionId", revision2, "note", "Agreed at 10%.")))
                .retrieve().toEntity(String.class);
        assertThat(adopted.getStatusCode().value()).as(adopted.getBody()).isEqualTo(200);
        assertThat(json(adopted.getBody()).get("data").get("gates").get("sellerAdopted").asBoolean()).isTrue();

        JsonNode afterAdoption = json(get("/api/v1/quotes/" + quoteId + "/requests", repToken)
                .retrieve().toEntity(String.class).getBody()).get("data").get(0);
        assertThat(afterAdoption.get("status").asText()).isEqualTo("ADOPTED");
        assertThat(afterAdoption.get("respondedAt").isNull()).isFalse();

        // ---- the customer accepts those exact terms and the order is created
        JsonNode acceptance = json(post("/api/v1/portal/quotes/" + quoteId + "/acceptances", buyerToken)
                .header("Idempotency-Key", "accept-counter-" + suffix())
                .body(toJson(map("revisionId", revision2, "commercialHash", hash2)))
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(acceptance.get("conditional").asBoolean()).isFalse();
        assertThat(acceptance.get("orderReference").asText()).isNotBlank();

        // ---- and the invoice is raised at the negotiated amount, not the original
        JsonNode invoices = json(get("/api/v1/invoices?customerId=" + alpha.getId(), financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data").get("items");
        assertThat(invoices).hasSize(1);
        assertThat(invoices.get(0).get("total").asText()).isEqualTo("18000.00");
    }

    @Test
    @DisplayName("a second counteroffer supersedes the first, so only one proposal is ever live")
    void anEarlierProposalStopsBeingAdoptable() {
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        Profile rep = person("rep-super-" + suffix(), Role.REP, null, null);
        Profile buyer = person("alpha-buyer-" + suffix(), Role.CUSTOMER, null, alpha.getId());
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);

        String repToken = tokenFor(rep);
        String buyerToken = tokenFor(buyer);

        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", repToken)
                .body(toJson(map("customerId", alpha.getId(), "title", "Alpha refresh")))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());

        JsonNode draft = json(post("/api/v1/quotes/" + quoteId + "/revisions", repToken)
                .body(toJson(map("lines", List.of(
                        map("lineKey", "laptops", "variantId", laptop.getId(),
                                "quantity", "2", "lineDiscountBp", 0)),
                        "orderDiscountBp", 0)))
                .retrieve().toEntity(String.class).getBody()).get("data");
        UUID revision1 = UUID.fromString(draft.get("revisionId").asText());

        post("/api/v1/quotes/" + quoteId + "/submissions", repToken)
                .body(toJson(map("expectedRevisionId", revision1)))
                .retrieve().toEntity(String.class);
        post("/api/v1/quotes/" + quoteId + "/shares", repToken).retrieve().toEntity(String.class);

        JsonNode first = json(post("/api/v1/portal/quotes/" + quoteId + "/requests", buyerToken)
                .header("Idempotency-Key", "counter-1-" + suffix())
                .body(toJson(map("requestType", "COUNTER", "expectedRevisionId", revision1,
                        "requestedOrderDiscountBp", 500, "message", "Can you do 5%?")))
                .retrieve().toEntity(String.class).getBody()).get("data");
        UUID revision2 = UUID.fromString(first.get("revisionId").asText());

        JsonNode second = json(post("/api/v1/portal/quotes/" + quoteId + "/requests", buyerToken)
                .header("Idempotency-Key", "counter-2-" + suffix())
                .body(toJson(map("requestType", "COUNTER", "expectedRevisionId", revision2,
                        "requestedOrderDiscountBp", 1200, "message", "Actually we need 12%.")))
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(second.get("versionNumber").asInt()).isEqualTo(3);

        JsonNode requests = json(get("/api/v1/quotes/" + quoteId + "/requests", repToken)
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(requests).hasSize(2);
        // Newest first: the live proposal, then the one it replaced.
        assertThat(requests.get(0).get("status").asText()).isEqualTo("OPEN");
        assertThat(requests.get(1).get("status").asText()).isEqualTo("SUPERSEDED");

        // The superseded candidate is no longer the current revision, so it
        // cannot be adopted even if a stale screen still offers the button.
        ResponseEntity<String> staleAdoption = post("/api/v1/quotes/" + quoteId + "/adoptions", repToken)
                .body(toJson(map("revisionId", revision2)))
                .retrieve().toEntity(String.class);
        assertThat(staleAdoption.getStatusCode().value()).isEqualTo(409);
        assertThat(json(staleAdoption.getBody()).get("error").get("code").asText())
                .isEqualTo("STALE_QUOTE_VERSION");
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
