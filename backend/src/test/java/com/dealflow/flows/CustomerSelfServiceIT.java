package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.auth.models.Role;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.support.AbstractIntegrationTest;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import tools.jackson.databind.JsonNode;

/**
 * The storefront journey: a stranger browses the public catalogue, registers,
 * asks for a quotation, edits their account and changes their password; the
 * rep sees the request and answers in the deal room.
 */
@TestPropertySource(properties = {
        "dealflow.auth.local-jwt-secret=integration-local-signing-secret-with-at-least-32-bytes"
})
class CustomerSelfServiceIT extends AbstractIntegrationTest {

    @Test
    void anonymousCatalogueHidesCostAndStockCounts() {
        ProductVariant laptop = stockedItem("Storefront Laptop", 1_000_000L, 700_000L, false);
        stock(warehouse("MAIN", 10_000L, 1), laptop, "3");

        var response = http.get().uri("/api/v1/public/catalog").retrieve().toEntity(String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        String body = response.getBody();
        assertThat(body).doesNotContain("baseCost").doesNotContain("costMinor").doesNotContain("margin");

        JsonNode variants = json(body).path("data").path("variants");
        JsonNode ours = null;
        for (JsonNode node : variants) {
            if (node.path("id").asText().equals(laptop.getId().toString())) {
                ours = node;
            }
        }
        assertThat(ours).isNotNull();
        assertThat(ours.path("inStock").asBoolean()).isTrue();
        assertThat(ours.path("listPrice").asText()).isEqualTo("10000.00");
        assertThat(ours.has("totalAvailable")).isFalse();

        // Everything else under /api still needs a token.
        assertThat(http.get().uri("/api/v1/portal/quotes").retrieve().toBodilessEntity()
                .getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void customerRegistersRequestsQuoteAndManagesAccount() {
        person("storefront-rep-" + UUID.randomUUID(), Role.REP, null, null);
        com.dealflow.auth.models.Profile rep;
        ProductVariant laptop = stockedItem("Storefront Laptop", 1_000_000L, 700_000L, false);
        var plan = monthlyPlan("Storefront Support", 30_000L, 12_000L);
        String email = "buyer-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";

        // ---- register: a CUSTOMER bound to a brand-new organisation --------
        var registered = http.post().uri("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .body(map("email", email, "password", "correct horse battery", "fullName", "Pat Buyer",
                        "companyName", "Buyer & Co", "phone", "+91 98765 43210"))
                .retrieve().toEntity(String.class);
        assertThat(registered.getStatusCode().value()).isEqualTo(201);
        JsonNode tokenBody = json(registered.getBody()).path("data");
        assertThat(tokenBody.path("role").asText()).isEqualTo("CUSTOMER");
        String token = tokenBody.path("accessToken").asText();

        // Duplicate signup is refused; the role is never chosen by the caller.
        assertThat(http.post().uri("/api/v1/auth/register").contentType(MediaType.APPLICATION_JSON)
                .body(map("email", email, "password", "another password", "fullName", "X",
                        "companyName", "Y", "role", "ADMIN"))
                .retrieve().toBodilessEntity().getStatusCode().value()).isEqualTo(409);

        JsonNode me = json(get("/api/v1/me", token).retrieve().toEntity(String.class).getBody()).path("data");
        assertThat(me.path("role").asText()).isEqualTo("CUSTOMER");
        assertThat(me.path("customerName").asText()).isEqualTo("Buyer & Co");
        assertThat(me.path("customerTier").asText()).isEqualTo("BRONZE");
        assertThat(me.path("authProvider").asText()).isEqualTo("LOCAL");

        // ---- login: right and wrong password ----------------------------------
        assertThat(http.post().uri("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                .body(map("email", email, "password", "wrong"))
                .retrieve().toBodilessEntity().getStatusCode().value()).isEqualTo(401);
        var login = http.post().uri("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                .body(map("email", email.toUpperCase(), "password", "correct horse battery"))
                .retrieve().toEntity(String.class);
        assertThat(login.getStatusCode().value()).isEqualTo(200);

        // ---- quotation request from the catalogue ----------------------------
        var requested = post("/api/v1/portal/quote-requests", token)
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .body(map("note", "Please quote for our new office.", "lines", List.of(
                        map("variantId", laptop.getId(), "quantity", 2),
                        map("planId", plan.getId(), "quantity", 5))))
                .retrieve().toEntity(String.class);
        assertThat(requested.getStatusCode().value()).isEqualTo(201);
        JsonNode detail = json(requested.getBody()).path("data");
        String quoteId = detail.path("id").asText();
        assertThat(detail.path("status").asText()).isEqualTo("IN_PREPARATION");
        assertThat(detail.path("acceptable").asBoolean()).isFalse();
        assertThat(detail.path("lines").size()).isEqualTo(2);
        assertThat(detail.path("totals").path("oneTimeSubtotal").asText()).isEqualTo("20000.00");
        assertThat(detail.path("activity").get(0).path("message").asText()).contains("new office");
        assertThat(requested.getBody()).doesNotContain("margin").doesNotContain("unitCost");

        // The customer sees it in their list; a stranger does not.
        JsonNode list = json(get("/api/v1/portal/quotes", token).retrieve().toEntity(String.class).getBody())
                .path("data");
        assertThat(list.size()).isEqualTo(1);
        var stranger = person("stranger-" + UUID.randomUUID(), Role.CUSTOMER, null,
                customer("Other", com.dealflow.catalog.models.CatalogEnums.CustomerTier.GOLD).getId());
        assertThat(get("/api/v1/portal/quotes/" + quoteId, tokenFor(stranger)).retrieve().toBodilessEntity()
                .getStatusCode().value()).isEqualTo(404);

        // ---- the account manager owns it and answers the opening note --------
        // Whichever active rep was first by name got the new customer; when
        // other suites share the context that need not be the one made above.
        JsonNode account = json(get("/api/v1/portal/account", token).retrieve().toEntity(String.class)
                .getBody()).path("data");
        assertThat(account.path("organisation").path("name").asText()).isEqualTo("Buyer & Co");
        assertThat(account.path("canChangePassword").asBoolean()).isTrue();
        String managerEmail = account.path("accountManager").path("email").asText();
        assertThat(managerEmail).isNotBlank();
        rep = profiles.findByEmailIgnoreCase(managerEmail).orElseThrow();
        assertThat(rep.getRole()).isEqualTo(Role.REP);
        String repToken = tokenFor(rep);
        JsonNode internal = json(get("/api/v1/quotes/" + quoteId, repToken).retrieve().toEntity(String.class)
                .getBody()).path("data");
        assertThat(internal.path("stage").asText()).isEqualTo("REVIEW");

        JsonNode requests = json(get("/api/v1/quotes/" + quoteId + "/requests", repToken).retrieve()
                .toEntity(String.class).getBody()).path("data");
        assertThat(requests.size()).isEqualTo(1);
        String requestId = requests.get(0).path("id").asText();

        var replied = post("/api/v1/quotes/" + quoteId + "/requests/" + requestId + "/responses", repToken)
                .body(map("message", "Thanks — pricing this now."))
                .retrieve().toEntity(String.class);
        assertThat(replied.getStatusCode().value()).isEqualTo(200);
        assertThat(json(replied.getBody()).path("data").path("status").asText()).isEqualTo("ANSWERED");

        // A customer cannot use the internal reply endpoint.
        assertThat(post("/api/v1/quotes/" + quoteId + "/requests/" + requestId + "/responses", token)
                .body(map("message", "me too")).retrieve().toBodilessEntity().getStatusCode().value())
                .isEqualTo(404);

        JsonNode after = json(get("/api/v1/portal/quotes/" + quoteId, token).retrieve().toEntity(String.class)
                .getBody()).path("data");
        assertThat(after.path("activity").get(0).path("responseMessage").asText()).contains("pricing this now");

        // ---- account and settings --------------------------------------------
        // Use the blocking Apache transport for PATCH, including Windows hosts
        // where the JDK selector's loopback connection is unavailable.
        var patchClient = org.springframework.web.client.RestClient.builder()
                .requestFactory(new org.springframework.http.client.HttpComponentsClientHttpRequestFactory())
                .baseUrl("http://localhost:" + port)
                .defaultStatusHandler(status -> true, (request, response) -> { })
                .build();
        var updated = patchClient.patch().uri("/api/v1/portal/account")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token).contentType(MediaType.APPLICATION_JSON)
                .body(map("fullName", "Pat B.", "billingAddress", "1 Market St, Mumbai"))
                .retrieve().toEntity(String.class);
        assertThat(updated.getStatusCode().value()).isEqualTo(200);
        assertThat(json(updated.getBody()).path("data").path("fullName").asText()).isEqualTo("Pat B.");
        assertThat(json(updated.getBody()).path("data").path("organisation").path("billingAddress").asText())
                .isEqualTo("1 Market St, Mumbai");

        var prefs = http.put().uri("/api/v1/portal/account/preferences")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token).contentType(MediaType.APPLICATION_JSON)
                .body(map("preferences", map("emailNotifications", false, "ignoredKey", "x")))
                .retrieve().toEntity(String.class);
        assertThat(prefs.getStatusCode().value()).isEqualTo(200);
        JsonNode stored = json(prefs.getBody()).path("data").path("preferences");
        assertThat(stored.path("emailNotifications").asBoolean()).isFalse();
        assertThat(stored.has("ignoredKey")).isFalse();

        assertThat(post("/api/v1/portal/account/password", token)
                .body(map("currentPassword", "wrong", "newPassword", "new password 123"))
                .retrieve().toBodilessEntity().getStatusCode().value()).isEqualTo(400);
        assertThat(post("/api/v1/portal/account/password", token)
                .body(map("currentPassword", "correct horse battery", "newPassword", "new password 123"))
                .retrieve().toBodilessEntity().getStatusCode().value()).isEqualTo(200);
        assertThat(http.post().uri("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
                .body(map("email", email, "password", "new password 123"))
                .retrieve().toBodilessEntity().getStatusCode().value()).isEqualTo(200);

        // Internal staff never reach the portal account endpoints.
        assertThat(get("/api/v1/portal/account", repToken).retrieve().toBodilessEntity()
                .getStatusCode().value()).isEqualTo(403);
    }
}
