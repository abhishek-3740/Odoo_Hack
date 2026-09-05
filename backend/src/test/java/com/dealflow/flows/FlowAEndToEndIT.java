package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.auth.Profile;
import com.dealflow.auth.Role;
import com.dealflow.catalog.CatalogEnums.CustomerTier;
import com.dealflow.catalog.Customer;
import com.dealflow.catalog.ProductVariant;
import com.dealflow.fulfillment.Warehouse;
import com.dealflow.support.AbstractIntegrationTest;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.JsonNode;

/**
 * Flow A (plan section 13.2): an ordinary sale from quotation to paid invoice,
 * driven entirely through the HTTP API with real tokens against a real
 * PostgreSQL.
 */
class FlowAEndToEndIT extends AbstractIntegrationTest {

    @Test
    @DisplayName("quote → submit → share → customer accepts → order, reservation, invoice → dispatch → paid")
    void ordinarySaleCompletesEndToEnd() {
        // ---- fixtures: Alpha (Bronze), a rep, finance, Main warehouse with stock
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        Profile rep = person("rep-a-" + suffix(), Role.REP, null, null);
        Profile finance = person("finance-" + suffix(), Role.FINANCE, null, null);
        Profile buyer = person("alpha-buyer-" + suffix(), Role.CUSTOMER, null, alpha.getId());
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        ProductVariant dock = stockedItem("Dock", 100_000L, 60_000L, true);
        Warehouse main = warehouse("MAIN", 10_000L, 1);
        stock(main, laptop, "4");
        stock(main, dock, "10");

        String repToken = tokenFor(rep);
        String financeToken = tokenFor(finance);
        String buyerToken = tokenFor(buyer);

        // ---- create the quotation
        ResponseEntity<String> created = post("/api/v1/quotes", repToken)
                .body(toJson(map("customerId", alpha.getId(), "title", "Alpha laptops")))
                .retrieve().toEntity(String.class);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        JsonNode quote = json(created.getBody()).get("data");
        UUID quoteId = UUID.fromString(quote.get("quoteId").asText());

        // ---- save the draft: 2 laptops and the recommended dock, no discount
        ResponseEntity<String> saved = post("/api/v1/quotes/" + quoteId + "/revisions", repToken)
                .body(toJson(map("lines", List.of(
                        map("variantId", laptop.getId(), "quantity", "2", "lineDiscountBp", 0),
                        map("variantId", dock.getId(), "quantity", "1", "lineDiscountBp", 0,
                                "source", "RECOMMENDATION")),
                        "orderDiscountBp", 0)))
                .retrieve().toEntity(String.class);
        assertThat(saved.getStatusCode().value()).as(saved.getBody()).isEqualTo(200);
        JsonNode draft = json(saved.getBody()).get("data");

        // Money crosses the wire as decimal strings, never JSON numbers.
        assertThat(draft.get("totals").get("oneTimeNet").isTextual()).isTrue();
        assertThat(draft.get("totals").get("oneTimeNet").asText()).isEqualTo("21000.00");
        assertThat(draft.get("risk").get("requiredLevel").asText()).isEqualTo("NONE");
        // Stock preview beside the stocked lines, reserving nothing yet.
        assertThat(draft.get("stockPreview")).hasSize(2);
        assertThat(draft.get("stockPreview").get(0).get("shortfall").asText()).isEqualTo("0");
        UUID revisionId = UUID.fromString(draft.get("revisionId").asText());

        // ---- submit: no rule violation, so approval is NOT_REQUIRED
        ResponseEntity<String> submitted = post("/api/v1/quotes/" + quoteId + "/submissions", repToken)
                .body(toJson(map("expectedRevisionId", revisionId)))
                .retrieve().toEntity(String.class);
        assertThat(submitted.getStatusCode().value()).as(submitted.getBody()).isEqualTo(200);
        JsonNode submittedQuote = json(submitted.getBody()).get("data");
        assertThat(submittedQuote.get("gates").get("approvalStatus").asText()).isEqualTo("NOT_REQUIRED");
        assertThat(submittedQuote.get("gates").get("sellerAdopted").asBoolean()).isTrue();
        assertThat(submittedQuote.get("gates").get("customerAccepted").asBoolean()).isFalse();
        assertThat(submittedQuote.get("gates").get("orderExists").asBoolean()).isFalse();
        assertThat(submittedQuote.get("stage").asText()).isEqualTo("REVIEW");

        // ---- share: returns a portal path, sends no email
        ResponseEntity<String> shared = post("/api/v1/quotes/" + quoteId + "/shares", repToken)
                .retrieve().toEntity(String.class);
        assertThat(shared.getStatusCode().value()).isEqualTo(200);
        assertThat(json(shared.getBody()).get("data").get("stage").asText()).isEqualTo("SENT");

        // ---- the customer sees a restricted view with no internal fields
        ResponseEntity<String> portalView = get("/api/v1/portal/quotes/" + quoteId, buyerToken)
                .retrieve().toEntity(String.class);
        assertThat(portalView.getStatusCode().value()).as(portalView.getBody()).isEqualTo(200);
        JsonNode portal = json(portalView.getBody()).get("data");
        assertThat(portal.get("acceptable").asBoolean()).isTrue();
        assertThat(portal.get("awaitingInternalApproval").asBoolean()).isFalse();
        assertThat(portal.get("totals").get("dueOnConfirmation").asText()).isEqualTo("21000.00");
        String hash = portal.get("commercialHash").asText();
        assertThat(portal.toString()).doesNotContain("unitCost").doesNotContain("margin")
                .doesNotContain("threshold");

        // ---- a customer bound to a different company cannot see it at all (T08)
        Customer other = customer("Other", CustomerTier.GOLD);
        Profile stranger = person("stranger-" + suffix(), Role.CUSTOMER, null, other.getId());
        ResponseEntity<String> foreign = get("/api/v1/portal/quotes/" + quoteId, tokenFor(stranger))
                .retrieve().toEntity(String.class);
        assertThat(foreign.getStatusCode().value()).isEqualTo(404);
        // ...and no customer reaches the internal representation, even of their own deal.
        ResponseEntity<String> internal = get("/api/v1/quotes/" + quoteId, buyerToken)
                .retrieve().toEntity(String.class);
        assertThat(internal.getStatusCode().value()).isEqualTo(404);

        // ---- the customer accepts the exact version; that completes the last gate
        ResponseEntity<String> accepted = post("/api/v1/portal/quotes/" + quoteId + "/acceptances", buyerToken)
                .header("Idempotency-Key", "accept-" + suffix())
                .body(toJson(map("revisionId", revisionId, "commercialHash", hash)))
                .retrieve().toEntity(String.class);
        assertThat(accepted.getStatusCode().value()).as(accepted.getBody()).isEqualTo(200);
        JsonNode acceptance = json(accepted.getBody()).get("data");
        assertThat(acceptance.get("accepted").asBoolean()).isTrue();
        assertThat(acceptance.get("conditional").asBoolean()).isFalse();
        assertThat(acceptance.get("orderReference").asText()).startsWith("SO-");

        // ---- the order exists once, with stock held at Main
        JsonNode afterOrder = json(get("/api/v1/quotes/" + quoteId, repToken)
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(afterOrder.get("stage").asText()).isEqualTo("CONFIRMED");
        assertThat(afterOrder.get("gates").get("orderExists").asBoolean()).isTrue();
        UUID orderId = UUID.fromString(afterOrder.get("gates").get("orderId").asText());

        JsonNode fulfillment = json(get("/api/v1/orders/" + orderId + "/fulfillment", financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(fulfillment.get("fulfillmentStatus").asText()).isEqualTo("RESERVED");
        assertThat(fulfillment.get("shipments")).hasSize(1);
        assertThat(fulfillment.get("backorders")).isEmpty();
        UUID shipmentId = UUID.fromString(fulfillment.get("shipments").get(0).get("id").asText());

        assertThat(stockLevels.findByWarehouseIdAndVariantId(main.getId(), laptop.getId()).orElseThrow()
                .getReserved()).isEqualByComparingTo("2");

        // ---- one one-time invoice for INR 21,000, issued on confirmation
        JsonNode invoices = json(get("/api/v1/invoices?orderId=" + orderId, financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data").get("items");
        assertThat(invoices).hasSize(1);
        JsonNode invoice = invoices.get(0);
        assertThat(invoice.get("invoiceKind").asText()).isEqualTo("ONE_TIME");
        assertThat(invoice.get("status").asText()).isEqualTo("ISSUED");
        assertThat(invoice.get("total").asText()).isEqualTo("21000.00");
        assertThat(invoice.get("outstanding").asText()).isEqualTo("21000.00");
        UUID invoiceId = UUID.fromString(invoice.get("id").asText());

        // ---- dispatch: on-hand and reserved both drop by the shipped quantity
        ResponseEntity<String> dispatched = post("/api/v1/shipments/" + shipmentId + "/dispatches", financeToken)
                .body(toJson(map("trackingReference", "TRK-1")))
                .retrieve().toEntity(String.class);
        assertThat(dispatched.getStatusCode().value()).as(dispatched.getBody()).isEqualTo(200);
        assertThat(json(dispatched.getBody()).get("data").get("status").asText()).isEqualTo("DISPATCHED");
        var laptopStock = stockLevels.findByWarehouseIdAndVariantId(main.getId(), laptop.getId()).orElseThrow();
        assertThat(laptopStock.getOnHand()).isEqualByComparingTo("2");
        assertThat(laptopStock.getReserved()).isEqualByComparingTo("0");

        // ---- a rep cannot record payments; finance can
        ResponseEntity<String> repPays = post("/api/v1/payments", repToken)
                .header("Idempotency-Key", "pay-rep-" + suffix())
                .body(toJson(map("customerId", alpha.getId(), "amount", "21000.00", "method", "BANK_TRANSFER")))
                .retrieve().toEntity(String.class);
        assertThat(repPays.getStatusCode().value()).isEqualTo(403);

        // ---- partial then full payment: PARTIALLY_PAID, then PAID with zero outstanding
        ResponseEntity<String> partial = post("/api/v1/payments", financeToken)
                .header("Idempotency-Key", "pay-1-" + suffix())
                .body(toJson(map("customerId", alpha.getId(), "amount", "5000.00", "method", "BANK_TRANSFER")))
                .retrieve().toEntity(String.class);
        assertThat(partial.getStatusCode().value()).as(partial.getBody()).isEqualTo(200);
        assertThat(json(partial.getBody()).get("data").get("allocated").asText()).isEqualTo("5000.00");

        JsonNode afterPartial = json(get("/api/v1/invoices/" + invoiceId, financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(afterPartial.get("status").asText()).isEqualTo("PARTIALLY_PAID");
        assertThat(afterPartial.get("outstanding").asText()).isEqualTo("16000.00");

        post("/api/v1/payments", financeToken)
                .header("Idempotency-Key", "pay-2-" + suffix())
                .body(toJson(map("customerId", alpha.getId(), "amount", "16000.00", "method", "BANK_TRANSFER")))
                .retrieve().toEntity(String.class);

        JsonNode paid = json(get("/api/v1/invoices/" + invoiceId, financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(paid.get("status").asText()).isEqualTo("PAID");
        assertThat(paid.get("outstanding").asText()).isEqualTo("0.00");
        assertThat(paid.get("paid").asText()).isEqualTo("21000.00");

        // ---- negotiation is closed once an order exists (E20)
        ResponseEntity<String> lateCounter = post("/api/v1/portal/quotes/" + quoteId + "/requests", buyerToken)
                .header("Idempotency-Key", "late-" + suffix())
                .body(toJson(map("requestType", "COUNTER", "expectedRevisionId", revisionId,
                        "requestedOrderDiscountBp", 500)))
                .retrieve().toEntity(String.class);
        assertThat(lateCounter.getStatusCode().value()).isEqualTo(409);
        assertThat(json(lateCounter.getBody()).get("error").get("code").asText()).isEqualTo("NEGOTIATION_CLOSED");
    }

    @Test
    @DisplayName("an expired token and a spoofed role are both refused")
    void identityIsVerifiedNotTrusted() {
        Profile rep = person("rep-x-" + suffix(), Role.REP, null, null);
        ResponseEntity<String> expired = get("/api/v1/me",
                com.dealflow.support.TestTokens.expiredForUser(rep.getAuthUserId(), rep.getEmail()))
                .retrieve().toEntity(String.class);
        assertThat(expired.getStatusCode().value()).isEqualTo(401);

        // The role is read from the database; the token's claims cannot raise it.
        JsonNode me = json(get("/api/v1/me", tokenFor(rep)).retrieve().toEntity(String.class).getBody())
                .get("data");
        assertThat(me.get("role").asText()).isEqualTo("REP");
        assertThat(me.get("capabilities").toString()).doesNotContain("approvals:manager");
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
