package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.auth.models.Profile;
import com.dealflow.auth.models.Role;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.fulfillment.models.StockLevel;
import com.dealflow.fulfillment.models.Warehouse;
import com.dealflow.outbox.service.OutboxDispatcher;
import com.dealflow.outbox.models.OutboxEvent;
import com.dealflow.outbox.repo.OutboxEventRepository;
import com.dealflow.support.AbstractIntegrationTest;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/**
 * Deal health (tests T21-T23), role-scoped reporting with genuine exports
 * (test T24), and outbox delivery marking (verification I04).
 */
class HealthAndReportingIT extends AbstractIntegrationTest {

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    OutboxDispatcher outboxDispatcher;
    @Autowired
    OutboxEventRepository outboxEvents;

    @Test
    @DisplayName("a stalled quotation is flagged, survives rep edits and resends, and clears when the customer replies")
    void stallTimerTracksProgressNotActivity() {
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        Profile rep = person("rep-" + suffix(), Role.REP, null, null);
        Profile manager = person("manager-" + suffix(), Role.MANAGER, null, null);
        Profile buyer = person("buyer-" + suffix(), Role.CUSTOMER, null, alpha.getId());
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        Warehouse main = warehouse("MAIN", 10_000L, 1);
        stock(main, laptop, "5");
        String repToken = tokenFor(rep);
        String managerToken = tokenFor(manager);

        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", repToken)
                .body(toJson(map("customerId", alpha.getId())))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());
        UUID revisionId = UUID.fromString(json(post("/api/v1/quotes/" + quoteId + "/revisions", repToken)
                .body(toJson(map("lines", List.of(map("variantId", laptop.getId(), "quantity", "1")))))
                .retrieve().toEntity(String.class).getBody()).get("data").get("revisionId").asText());
        post("/api/v1/quotes/" + quoteId + "/submissions", repToken)
                .body(toJson(map("expectedRevisionId", revisionId))).retrieve().toEntity(String.class);
        post("/api/v1/quotes/" + quoteId + "/shares", repToken).retrieve().toEntity(String.class);

        // Four days of customer silence. Set directly: the clock is the only
        // thing being faked here, and only for this row.
        jdbc.update("update dealflow.quotes set awaiting_external_since = now() - interval '4 days' where id = ?",
                quoteId);

        // ---- the sweep opens exactly one stalled alert for it
        ResponseEntity<String> sweep = post("/api/v1/alerts/sweeps", managerToken).retrieve().toEntity(String.class);
        assertThat(sweep.getStatusCode().value()).as(sweep.getBody()).isEqualTo(200);
        JsonNode alert = openStalledAlert(quoteId, repToken);
        assertThat(alert).as("stalled alert visible to the owning rep").isNotNull();
        assertThat(alert.get("reasons").get(0).get("hoursWaiting").asLong()).isGreaterThanOrEqualTo(95);
        UUID alertId = UUID.fromString(alert.get("id").asText());

        // ---- a rep's own edit and resend are activity, not progress (E22)
        post("/api/v1/quotes/" + quoteId + "/revisions", repToken)
                .body(toJson(map("lines", List.of(map("variantId", laptop.getId(), "quantity", "2")))))
                .retrieve().toEntity(String.class);
        JsonNode edited = json(get("/api/v1/quotes/" + quoteId, repToken)
                .retrieve().toEntity(String.class).getBody()).get("data");
        UUID revision2 = UUID.fromString(edited.get("revisionId").asText());
        post("/api/v1/quotes/" + quoteId + "/submissions", repToken)
                .body(toJson(map("expectedRevisionId", revision2))).retrieve().toEntity(String.class);
        post("/api/v1/quotes/" + quoteId + "/shares", repToken).retrieve().toEntity(String.class);

        post("/api/v1/alerts/sweeps", managerToken).retrieve().toEntity(String.class);
        assertThat(openStalledAlert(quoteId, repToken)).as("still stalled after rep edit + resend").isNotNull();

        // ---- a nudge creates a durable, assigned notification; a second one is rate-limited
        ResponseEntity<String> nudged = post("/api/v1/alerts/" + alertId + "/nudges", managerToken)
                .body(toJson(map("message", "Please chase Alpha")))
                .retrieve().toEntity(String.class);
        assertThat(nudged.getStatusCode().value()).as(nudged.getBody()).isEqualTo(200);
        JsonNode inbox = json(get("/api/v1/notifications", repToken).retrieve().toEntity(String.class).getBody());
        assertThat(inbox.get("meta").get("unread").asLong()).isGreaterThanOrEqualTo(1);
        assertThat(inbox.get("data").get("items").toString()).contains(alertId.toString());

        ResponseEntity<String> nudgedAgain = post("/api/v1/alerts/" + alertId + "/nudges", managerToken)
                .retrieve().toEntity(String.class);
        assertThat(nudgedAgain.getStatusCode().value()).isEqualTo(429);

        // ---- the customer replying IS progress: the condition clears and the alert resolves
        JsonNode portal = json(get("/api/v1/portal/quotes/" + quoteId, tokenFor(buyer))
                .retrieve().toEntity(String.class).getBody()).get("data");
        ResponseEntity<String> comment = post("/api/v1/portal/quotes/" + quoteId + "/requests", tokenFor(buyer))
                .header("Idempotency-Key", "comment-" + suffix())
                .body(toJson(map("requestType", "COMMENT", "expectedRevisionId", portal.get("revisionId").asText(),
                        "message", "Looks good, checking internally.")))
                .retrieve().toEntity(String.class);
        assertThat(comment.getStatusCode().value()).as(comment.getBody()).isEqualTo(200);

        post("/api/v1/alerts/sweeps", managerToken).retrieve().toEntity(String.class);
        assertThat(openStalledAlert(quoteId, repToken)).as("resolved after customer reply").isNull();
    }

    @Test
    @DisplayName("stock below its reorder point raises a low-stock alert with a suggested order quantity")
    void lowStockAlert() {
        Profile finance = person("finance-" + suffix(), Role.FINANCE, null, null);
        ProductVariant part = stockedItem("Part", 10_000L, 5_000L, false);
        Warehouse main = warehouse("MAIN", 10_000L, 1);
        StockLevel level = stock(main, part, "2");
        level.setReorderPoint(new BigDecimal("5"));
        level.setTargetQty(new BigDecimal("12"));
        stockLevels.save(level);

        post("/api/v1/alerts/sweeps", tokenFor(finance)).retrieve().toEntity(String.class);
        JsonNode alerts = json(get("/api/v1/alerts?status=OPEN&type=LOW_STOCK&pageSize=100", tokenFor(finance))
                .retrieve().toEntity(String.class).getBody()).get("data").get("items");

        JsonNode found = null;
        for (JsonNode alert : alerts) {
            if (part.getId().toString().equals(alert.get("variantId").asText())) {
                found = alert;
            }
        }
        assertThat(found).isNotNull();
        assertThat(found.get("reasons").get(0).get("suggestedOrderQuantity").asText()).isEqualTo("10");
    }

    @Test
    @DisplayName("reports are scoped to the caller and exports are genuine PDF, XLSX and XLS files")
    void scopedReportsAndRealExports() {
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        Profile repOne = person("rep1-" + suffix(), Role.REP, null, null);
        Profile repTwo = person("rep2-" + suffix(), Role.REP, null, null);
        Profile finance = person("finance-" + suffix(), Role.FINANCE, null, null);
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);

        for (Profile rep : List.of(repOne, repOne, repTwo)) {
            UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", tokenFor(rep))
                    .body(toJson(map("customerId", alpha.getId())))
                    .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());
            post("/api/v1/quotes/" + quoteId + "/revisions", tokenFor(rep))
                    .body(toJson(map("lines", List.of(map("variantId", laptop.getId(), "quantity", "1")))))
                    .retrieve().toEntity(String.class);
        }

        // A rep's report contains only their own quotations, whatever they ask for.
        JsonNode mine = json(get("/api/v1/reports/sales?ownerProfileId=" + repTwo.getId(), tokenFor(repOne))
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(mine.get("quotationCount").asLong()).isEqualTo(2);
        assertThat(mine.get("filter").get("ownerProfileId").asText()).isEqualTo(repOne.getId().toString());
        assertThat(mine.get("quotations")).allSatisfy(row ->
                assertThat(row.get("ownerName").asText()).isEqualTo(repOne.getFullName()));
        // The four headline figures are reported separately.
        assertThat(mine.has("oneTimeSales") && mine.has("monthlyRecurringRevenue")
                && mine.has("invoicedRevenue") && mine.has("cashCollected")).isTrue();

        // Finance sees across reps and can filter by customer.
        JsonNode all = json(get("/api/v1/reports/sales?customerId=" + alpha.getId(), tokenFor(finance))
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(all.get("quotationCount").asLong()).isEqualTo(3);
        assertThat(all.get("byRep")).hasSize(2);

        // ---- exports: the file is the screen, rendered, and each is really that format
        byte[] pdf = export("pdf", tokenFor(repOne), "application/pdf");
        assertThat(new String(pdf, 0, 5, StandardCharsets.US_ASCII)).isEqualTo("%PDF-");

        byte[] xlsx = export("xlsx", tokenFor(repOne),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        assertThat(xlsx[0]).isEqualTo((byte) 'P');
        assertThat(xlsx[1]).isEqualTo((byte) 'K');

        byte[] xls = export("xls", tokenFor(repOne), "application/vnd.ms-excel");
        assertThat(xls[0] & 0xFF).isEqualTo(0xD0);
        assertThat(xls[1] & 0xFF).isEqualTo(0xCF);
        assertThat(xls[2] & 0xFF).isEqualTo(0x11);
        assertThat(xls[3] & 0xFF).isEqualTo(0xE0);

        // A customer never reaches reporting.
        Profile buyer = person("buyer-" + suffix(), Role.CUSTOMER, null, alpha.getId());
        assertThat(get("/api/v1/reports/sales", tokenFor(buyer)).retrieve().toEntity(String.class)
                .getStatusCode().value()).isEqualTo(403);
    }

    @Test
    @DisplayName("committed outbox events are claimed and marked dispatched by a delivery pass")
    void outboxEventsAreDispatched() {
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        Profile rep = person("rep-" + suffix(), Role.REP, null, null);
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        String token = tokenFor(rep);

        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", token)
                .body(toJson(map("customerId", alpha.getId())))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());
        post("/api/v1/quotes/" + quoteId + "/revisions", token)
                .body(toJson(map("lines", List.of(map("variantId", laptop.getId(), "quantity", "1")))))
                .retrieve().toEntity(String.class);

        List<OutboxEvent> before = outboxEvents.findByAggregateTypeAndAggregateId("Quote", quoteId);
        assertThat(before).isNotEmpty();
        assertThat(before).allMatch(event -> event.getDispatchedAt() == null);

        // Each pass claims a bounded batch, oldest first; with the scheduler off
        // every earlier test left rows queued ahead of this one, so drain until quiet.
        while (outboxDispatcher.dispatchNow() > 0) {
            // keep draining
        }

        List<OutboxEvent> after = outboxEvents.findByAggregateTypeAndAggregateId("Quote", quoteId);
        assertThat(after).allMatch(event -> event.getDispatchedAt() != null);
        assertThat(after).allMatch(event -> event.getLastError() == null);
    }

    // -------------------------------------------------------------- helpers

    private JsonNode openStalledAlert(UUID quoteId, String token) {
        JsonNode alerts = json(get("/api/v1/alerts?status=OPEN&type=STALLED_QUOTE&pageSize=100", token)
                .retrieve().toEntity(String.class).getBody()).get("data").get("items");
        for (JsonNode alert : alerts) {
            if (quoteId.toString().equals(alert.get("quoteId").asText())) {
                return alert;
            }
        }
        return null;
    }

    private byte[] export(String format, String token, String expectedMediaType) {
        ResponseEntity<byte[]> response = http.get()
                .uri("/api/v1/reports/sales/export?format=" + format)
                .header("Authorization", "Bearer " + token)
                .retrieve().toEntity(byte[].class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getHeaders().getContentType().toString()).startsWith(expectedMediaType);
        assertThat(response.getHeaders().getFirst("Content-Disposition"))
                .contains("attachment").contains("." + format);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().length).isGreaterThan(100);
        return response.getBody();
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
