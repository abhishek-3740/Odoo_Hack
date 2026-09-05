package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.approvals.ApprovalRequest;
import com.dealflow.approvals.ApprovalRequestRepository;
import com.dealflow.auth.Profile;
import com.dealflow.auth.Role;
import com.dealflow.catalog.CatalogEnums.CustomerTier;
import com.dealflow.catalog.Customer;
import com.dealflow.catalog.ProductVariant;
import com.dealflow.catalog.SubscriptionPlan;
import com.dealflow.catalog.Team;
import com.dealflow.catalog.TeamRepository;
import com.dealflow.fulfillment.Backorder;
import com.dealflow.fulfillment.BackorderRepository;
import com.dealflow.fulfillment.Warehouse;
import com.dealflow.quotes.QuoteEnums.ApprovalRequestStatus;
import com.dealflow.support.AbstractIntegrationTest;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.JsonNode;

/**
 * Flow B (plan section 13.3): a mixed hardware/service/subscription quotation
 * that needs Manager then Finance, receives a customer counteroffer that
 * invalidates the earlier approvals, clears the new gates, splits across two
 * warehouses with a backorder, and consolidates after a stock receipt.
 */
class FlowBNegotiationIT extends AbstractIntegrationTest {

    @Autowired
    ApprovalRequestRepository approvals;
    @Autowired
    BackorderRepository backorders;
    @Autowired
    TeamRepository teams;

    @Test
    @DisplayName("sequential approval, counteroffer re-routing, split with backorder, receipt and consolidation")
    void negotiatedMixedDealCompletes() {
        // ---- fixtures: Beta (Gold), a team with one manager, finance, stock Main 2 / East 1
        Team team = teams.save(new Team("Team " + suffix()));
        Customer beta = customer("Beta", CustomerTier.GOLD);
        Profile rep = person("rep-b-" + suffix(), Role.REP, team.getId(), null);
        Profile manager = person("manager-" + suffix(), Role.MANAGER, team.getId(), null);
        Profile finance = person("finance-" + suffix(), Role.FINANCE, null, null);
        Profile buyer = person("beta-buyer-" + suffix(), Role.CUSTOMER, null, beta.getId());
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        ProductVariant setup = serviceItem("Setup", 500_000L, 350_000L);
        SubscriptionPlan seats = monthlyPlan("Support", 30_000L, 12_000L);
        Warehouse main = warehouse("MAIN", 10_000L, 1);
        Warehouse east = warehouse("EAST", 15_000L, 2);
        stock(main, laptop, "2");
        stock(east, laptop, "1");

        String repToken = tokenFor(rep);
        String managerToken = tokenFor(manager);
        String financeToken = tokenFor(finance);
        String buyerToken = tokenFor(buyer);

        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", repToken)
                .body(toJson(map("customerId", beta.getId(), "title", "Beta rollout")))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());

        // 4 laptops at 12% (inside the 15% ceiling), setup at 18% (8 points over
        // the 10% service ceiling), 10 monthly seats undiscounted.
        JsonNode draft = json(post("/api/v1/quotes/" + quoteId + "/revisions", repToken)
                .body(toJson(map("lines", List.of(
                        map("lineKey", "laptops", "variantId", laptop.getId(), "quantity", "4", "lineDiscountBp", 1200),
                        map("lineKey", "setup", "variantId", setup.getId(), "quantity", "1", "lineDiscountBp", 1800),
                        map("lineKey", "seats", "planId", seats.getId(), "quantity", "10", "lineDiscountBp", 0)),
                        "orderDiscountBp", 0, "backorderTerms", "ALLOW_BACKORDER")))
                .retrieve().toEntity(String.class).getBody()).get("data");

        assertThat(draft.get("totals").get("oneTimeNet").asText()).isEqualTo("39300.00");
        assertThat(draft.get("totals").get("recurringFirstCycleNet").asText()).isEqualTo("3000.00");
        assertThat(draft.get("totals").get("recurring").get(0).get("cadence").asText()).isEqualTo("monthly");
        assertThat(draft.get("totals").get("contribution").asText()).isEqualTo("9600.00");
        assertThat(draft.get("risk").get("requiredLevel").asText()).isEqualTo("MANAGER_FINANCE");
        assertThat(draft.get("risk").get("worstLineExcessPp").asText()).startsWith("8");
        assertThat(draft.get("risk").get("excessConcessionValue").asText()).isEqualTo("400.00");
        UUID revision1 = UUID.fromString(draft.get("revisionId").asText());

        // ---- submit routes to Manager then Finance
        JsonNode submitted = json(post("/api/v1/quotes/" + quoteId + "/submissions", repToken)
                .body(toJson(map("expectedRevisionId", revision1)))
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(submitted.get("gates").get("approvalStatus").asText()).isEqualTo("PENDING_MANAGER");
        assertThat(submitted.get("approvals")).hasSize(2);

        List<ApprovalRequest> chain = approvals.findByRevisionIdOrderByStepAsc(revision1);
        ApprovalRequest managerStep = chain.get(0);
        ApprovalRequest financeStep = chain.get(1);
        assertThat(managerStep.getAssigneeProfileId()).isEqualTo(manager.getId());

        // ---- Finance cannot act before Manager (T06)
        ResponseEntity<String> tooEarly = decide(financeStep.getId(), financeToken, "APPROVE");
        assertThat(tooEarly.getStatusCode().value()).isEqualTo(409);
        assertThat(json(tooEarly.getBody()).get("error").get("code").asText())
                .isEqualTo("APPROVAL_SEQUENCE_VIOLATION");

        // ---- a rep cannot decide a manager step
        assertThat(decide(managerStep.getId(), repToken, "APPROVE").getStatusCode().value()).isEqualTo(403);

        // ---- Manager approves, then Finance approves: revision 1 is APPROVED
        assertThat(decide(managerStep.getId(), managerToken, "APPROVE").getStatusCode().value()).isEqualTo(200);
        ResponseEntity<String> financeDecision = decide(financeStep.getId(), financeToken, "APPROVE");
        assertThat(financeDecision.getStatusCode().value()).as(financeDecision.getBody()).isEqualTo(200);
        JsonNode decision = json(financeDecision.getBody()).get("data");
        assertThat(decision.get("revisionApprovalStatus").asText()).isEqualTo("APPROVED");
        assertThat(decision.get("finalizationStatus").asText()).isEqualTo("WAITING");

        // ---- a decided step is immutable (E05)
        ResponseEntity<String> again = decide(managerStep.getId(), managerToken, "REJECT");
        assertThat(again.getStatusCode().value()).isEqualTo(409);
        assertThat(json(again.getBody()).get("error").get("code").asText()).isEqualTo("APPROVAL_ALREADY_DECIDED");

        post("/api/v1/quotes/" + quoteId + "/shares", repToken).retrieve().toEntity(String.class);

        // ---- the customer counters: 25% on setup. Revision 2 is re-routed and
        // revision 1's approvals cannot authorise it (E07/E08, T07).
        ResponseEntity<String> countered = post("/api/v1/portal/quotes/" + quoteId + "/requests", buyerToken)
                .header("Idempotency-Key", "counter-" + suffix())
                .body(toJson(map("requestType", "COUNTER", "expectedRevisionId", revision1,
                        "lines", List.of(map("lineKey", "setup", "requestedDiscountBp", 2500)),
                        "message", "Can you do 25% on the setup?")))
                .retrieve().toEntity(String.class);
        assertThat(countered.getStatusCode().value()).as(countered.getBody()).isEqualTo(200);
        JsonNode counterView = json(countered.getBody()).get("data");
        assertThat(counterView.get("versionNumber").asInt()).isEqualTo(2);
        assertThat(counterView.get("awaitingInternalApproval").asBoolean()).isTrue();
        assertThat(counterView.get("totals").get("oneTimeSubtotal").asText()).isEqualTo("38950.00");
        UUID revision2 = UUID.fromString(counterView.get("revisionId").asText());
        String hash2 = counterView.get("commercialHash").asText();

        List<ApprovalRequest> chain2 = approvals.findByRevisionIdOrderByStepAsc(revision2);
        assertThat(chain2).hasSize(2);
        assertThat(chain2).allMatch(ApprovalRequest::isPending);

        // ---- accepting the old version is refused; the terms moved (E19)
        ResponseEntity<String> stale = post("/api/v1/portal/quotes/" + quoteId + "/acceptances", buyerToken)
                .header("Idempotency-Key", "stale-" + suffix())
                .body(toJson(map("revisionId", revision1, "commercialHash", "0000000000000000")))
                .retrieve().toEntity(String.class);
        assertThat(stale.getStatusCode().value()).isEqualTo(409);
        assertThat(json(stale.getBody()).get("error").get("code").asText()).isEqualTo("STALE_QUOTE_VERSION");

        // ---- the customer accepts revision 2 conditionally: approvals still outstanding
        JsonNode conditional = json(post("/api/v1/portal/quotes/" + quoteId + "/acceptances", buyerToken)
                .header("Idempotency-Key", "accept2-" + suffix())
                .body(toJson(map("revisionId", revision2, "commercialHash", hash2)))
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(conditional.get("accepted").asBoolean()).isTrue();
        assertThat(conditional.get("conditional").asBoolean()).isTrue();
        assertThat(conditional.get("orderReference").isNull()).isTrue();

        // ---- seller adopts the customer's proposal; approvals clear; the order finalises
        ResponseEntity<String> adopted = post("/api/v1/quotes/" + quoteId + "/adoptions", repToken)
                .body(toJson(map("revisionId", revision2)))
                .retrieve().toEntity(String.class);
        assertThat(adopted.getStatusCode().value()).as(adopted.getBody()).isEqualTo(200);
        assertThat(json(adopted.getBody()).get("data").get("gates").get("orderExists").asBoolean()).isFalse();

        assertThat(decide(chain2.get(0).getId(), managerToken, "APPROVE").getStatusCode().value()).isEqualTo(200);
        JsonNode finalDecision = json(decide(chain2.get(1).getId(), financeToken, "APPROVE").getBody()).get("data");
        assertThat(finalDecision.get("finalizationStatus").asText()).isEqualTo("FINALIZED");
        UUID orderId = UUID.fromString(finalDecision.get("orderId").asText());

        // Revision 1's steps are history, not authority.
        assertThat(approvals.findById(managerStep.getId()).orElseThrow().getStatus())
                .isEqualTo(ApprovalRequestStatus.APPROVED);
        assertThat(approvals.findByRevisionIdOrderByStepAsc(revision1))
                .noneMatch(ApprovalRequest::isPending);

        // ---- split: Main 2, East 1, backorder 1, two shipments
        JsonNode fulfillment = json(get("/api/v1/orders/" + orderId + "/fulfillment", financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(fulfillment.get("fulfillmentStatus").asText()).isEqualTo("PARTIALLY_RESERVED");
        assertThat(fulfillment.get("shipments")).hasSize(2);
        assertThat(fulfillment.get("backorders")).hasSize(1);
        assertThat(fulfillment.get("backorders").get(0).get("quantity").asText()).isEqualTo("1");
        // No expected receipt is recorded, so no date is invented (E09).
        assertThat(fulfillment.get("backorders").get(0).get("expectedDate").isNull()).isTrue();

        // ---- one-time invoice 38,950 and a separate 3,000 recurring invoice
        JsonNode invoices = json(get("/api/v1/invoices?orderId=" + orderId, financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data").get("items");
        assertThat(invoices).hasSize(2);
        assertThat(invoices).anySatisfy(invoice -> {
            assertThat(invoice.get("invoiceKind").asText()).isEqualTo("ONE_TIME");
            assertThat(invoice.get("total").asText()).isEqualTo("38950.00");
        });
        assertThat(invoices).anySatisfy(invoice -> {
            assertThat(invoice.get("invoiceKind").asText()).isEqualTo("RECURRING");
            assertThat(invoice.get("total").asText()).isEqualTo("3000.00");
        });

        // ---- receipt of 1 laptop into Main; replaying the same key adds nothing (T11)
        String receiptKey = "receipt-" + suffix();
        ResponseEntity<String> receipt = post("/api/v1/stock-movements", financeToken)
                .header("Idempotency-Key", receiptKey)
                .body(toJson(map("variantId", laptop.getId(), "warehouseId", main.getId(),
                        "quantity", "1", "movementType", "RECEIPT")))
                .retrieve().toEntity(String.class);
        assertThat(receipt.getStatusCode().value()).as(receipt.getBody()).isEqualTo(200);
        assertThat(json(receipt.getBody()).get("meta").get("consolidatableOrderIds").toString())
                .contains(orderId.toString());

        ResponseEntity<String> replay = post("/api/v1/stock-movements", financeToken)
                .header("Idempotency-Key", receiptKey)
                .body(toJson(map("variantId", laptop.getId(), "warehouseId", main.getId(),
                        "quantity", "1", "movementType", "RECEIPT")))
                .retrieve().toEntity(String.class);
        assertThat(json(replay.getBody()).get("data").get("replayed").asBoolean()).isTrue();
        assertThat(stockLevels.findByWarehouseIdAndVariantId(main.getId(), laptop.getId()).orElseThrow()
                .getOnHand()).isEqualByComparingTo("3");

        // ---- replan consolidates the unit into the open Main shipment (T12)
        JsonNode replanned = json(post("/api/v1/orders/" + orderId + "/replans", financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(replanned.get("fulfillmentStatus").asText()).isEqualTo("RESERVED");
        assertThat(replanned.get("shipments")).hasSize(2);
        List<Backorder> open = backorders.findOpenForOrder(orderId);
        assertThat(open).isEmpty();

        JsonNode mainShipment = null;
        for (JsonNode shipment : replanned.get("shipments")) {
            if (shipment.get("warehouseId").asText().equals(main.getId().toString())) {
                mainShipment = shipment;
            }
        }
        assertThat(mainShipment).isNotNull();
        assertThat(mainShipment.get("lines").get(0).get("quantity").asText()).isEqualTo("3");

        // ---- dispatch both parcels; stock is fully consumed
        for (JsonNode shipment : replanned.get("shipments")) {
            ResponseEntity<String> dispatched = post("/api/v1/shipments/" + shipment.get("id").asText()
                    + "/dispatches", financeToken).retrieve().toEntity(String.class);
            assertThat(dispatched.getStatusCode().value()).as(dispatched.getBody()).isEqualTo(200);
        }
        assertThat(json(get("/api/v1/orders/" + orderId + "/fulfillment", financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data").get("fulfillmentStatus").asText())
                .isEqualTo("DISPATCHED");
        assertThat(stockLevels.findByWarehouseIdAndVariantId(main.getId(), laptop.getId()).orElseThrow()
                .getOnHand()).isEqualByComparingTo("0");
        assertThat(stockLevels.findByWarehouseIdAndVariantId(east.getId(), laptop.getId()).orElseThrow()
                .getOnHand()).isEqualByComparingTo("0");
    }

    @Test
    @DisplayName("in-stock-only terms fail finalisation outright when stock is short")
    void inStockOnlyRefusesPartialOrder() {
        Customer gamma = customer("Gamma", CustomerTier.SILVER);
        Profile rep = person("rep-c-" + suffix(), Role.REP, null, null);
        Profile buyer = person("gamma-buyer-" + suffix(), Role.CUSTOMER, null, gamma.getId());
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        Warehouse main = warehouse("MAIN", 10_000L, 1);
        stock(main, laptop, "1");
        String repToken = tokenFor(rep);

        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", repToken)
                .body(toJson(map("customerId", gamma.getId())))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());
        UUID revisionId = UUID.fromString(json(post("/api/v1/quotes/" + quoteId + "/revisions", repToken)
                .body(toJson(map("lines", List.of(map("variantId", laptop.getId(), "quantity", "5")),
                        "backorderTerms", "IN_STOCK_ONLY")))
                .retrieve().toEntity(String.class).getBody()).get("data").get("revisionId").asText());
        post("/api/v1/quotes/" + quoteId + "/submissions", repToken)
                .body(toJson(map("expectedRevisionId", revisionId))).retrieve().toEntity(String.class);
        post("/api/v1/quotes/" + quoteId + "/shares", repToken).retrieve().toEntity(String.class);

        String hash = json(get("/api/v1/portal/quotes/" + quoteId, tokenFor(buyer))
                .retrieve().toEntity(String.class).getBody()).get("data").get("commercialHash").asText();
        ResponseEntity<String> accepted = post("/api/v1/portal/quotes/" + quoteId + "/acceptances", tokenFor(buyer))
                .header("Idempotency-Key", "accept-iso-" + suffix())
                .body(toJson(map("revisionId", revisionId, "commercialHash", hash)))
                .retrieve().toEntity(String.class);

        // The whole finalisation rolls back: no order, no reservation, no invoice.
        assertThat(accepted.getStatusCode().value()).isEqualTo(409);
        assertThat(json(accepted.getBody()).get("error").get("code").asText()).isEqualTo("INSUFFICIENT_STOCK");
        assertThat(json(get("/api/v1/quotes/" + quoteId, repToken).retrieve().toEntity(String.class).getBody())
                .get("data").get("gates").get("orderExists").asBoolean()).isFalse();
        assertThat(stockLevels.findByWarehouseIdAndVariantId(main.getId(), laptop.getId()).orElseThrow()
                .getReserved()).isEqualByComparingTo("0");
    }

    private ResponseEntity<String> decide(UUID stepId, String token, String decision) {
        return post("/api/v1/approval-requests/" + stepId + "/decisions", token)
                .header("Idempotency-Key", "decide-" + stepId + "-" + decision + "-" + suffix())
                .body(toJson(map("decision", decision, "reason", "test")))
                .retrieve().toEntity(String.class);
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
