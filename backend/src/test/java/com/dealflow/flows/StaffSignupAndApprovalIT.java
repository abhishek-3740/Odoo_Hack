package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.approvals.models.ApprovalRequest;
import com.dealflow.approvals.repo.ApprovalRequestRepository;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.catalog.models.Team;
import com.dealflow.catalog.repo.TeamRepository;
import com.dealflow.support.AbstractIntegrationTest;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.JsonNode;

public class StaffSignupAndApprovalIT extends AbstractIntegrationTest {

    @Autowired
    private TeamRepository teams;

    @Autowired
    private ApprovalRequestRepository approvals;

    @Test
    @DisplayName("Staff registration for Admin, Rep, and Manager, followed by quote submission and manager/admin approval")
    void testStaffRegistrationAndApprovalFlow() {
        Team eastTeam = teams.findByName("Sales East")
                .orElseGet(() -> teams.save(new Team("Sales East")));

        // 1. Check teams listing endpoint
        ResponseEntity<String> teamsRes = http.get().uri("/api/v1/auth/teams").retrieve().toEntity(String.class);
        assertThat(teamsRes.getStatusCode().value()).isEqualTo(200);
        JsonNode teamsJson = json(teamsRes.getBody());
        assertThat(teamsJson.get("data").isArray()).isTrue();
        assertThat(teamsJson.get("data").size()).isGreaterThanOrEqualTo(1);

        String unique = UUID.randomUUID().toString().substring(0, 8);
        String repEmail = "rep." + unique + "@dealflow.test";
        String managerEmail = "manager." + unique + "@dealflow.test";
        String adminEmail = "admin." + unique + "@dealflow.test";

        // 2. Register Sales Rep
        ResponseEntity<String> repRegisterRes = http.post().uri("/api/v1/auth/register-internal")
                .contentType(MediaType.APPLICATION_JSON)
                .body(toJson(Map.of(
                        "email", repEmail,
                        "password", "Password123!",
                        "fullName", "Test Sales Rep",
                        "role", "REP",
                        "teamId", eastTeam.getId().toString()
                )))
                .retrieve().toEntity(String.class);
        assertThat(repRegisterRes.getStatusCode().value()).isEqualTo(201);
        String repToken = json(repRegisterRes.getBody()).get("data").get("accessToken").asText();

        // 3. Register Sales Manager
        ResponseEntity<String> managerRegisterRes = http.post().uri("/api/v1/auth/register-internal")
                .contentType(MediaType.APPLICATION_JSON)
                .body(toJson(Map.of(
                        "email", managerEmail,
                        "password", "Password123!",
                        "fullName", "Test Sales Manager",
                        "role", "MANAGER",
                        "teamId", eastTeam.getId().toString()
                )))
                .retrieve().toEntity(String.class);
        assertThat(managerRegisterRes.getStatusCode().value()).isEqualTo(201);
        String managerToken = json(managerRegisterRes.getBody()).get("data").get("accessToken").asText();

        // 4. Register Administrator
        ResponseEntity<String> adminRegisterRes = http.post().uri("/api/v1/auth/register-internal")
                .contentType(MediaType.APPLICATION_JSON)
                .body(toJson(Map.of(
                        "email", adminEmail,
                        "password", "Password123!",
                        "fullName", "Test System Admin",
                        "role", "ADMIN"
                )))
                .retrieve().toEntity(String.class);
        assertThat(adminRegisterRes.getStatusCode().value()).isEqualTo(201);
        String adminToken = json(adminRegisterRes.getBody()).get("data").get("accessToken").asText();

        // 5. Create customer & stock for quotation
        Customer customer = customer("Customer " + unique, com.dealflow.catalog.models.CatalogEnums.CustomerTier.GOLD);
        ProductVariant laptop = stockedItem("Laptop " + unique, 1_000_000L, 700_000L, false);
        ProductVariant setup = serviceItem("Setup " + unique, 500_000L, 350_000L);
        var wh = warehouse("WH-" + unique, 10_000L, 1);
        stock(wh, laptop, "10");

        // 6. Rep creates quotation
        ResponseEntity<String> createQuoteRes = post("/api/v1/quotes", repToken)
                .body(toJson(Map.of("customerId", customer.getId(), "title", "Enterprise Deal " + unique)))
                .retrieve().toEntity(String.class);
        assertThat(createQuoteRes.getStatusCode().value()).isEqualTo(201);
        UUID quoteId = UUID.fromString(json(createQuoteRes.getBody()).get("data").get("quoteId").asText());

        // 7. Rep adds line terms with concession (18% on setup -> triggers Step 1 Manager approval)
        ResponseEntity<String> reviseRes = post("/api/v1/quotes/" + quoteId + "/revisions", repToken)
                .body(toJson(Map.of(
                        "lines", List.of(
                                Map.of("lineKey", "laptops", "variantId", laptop.getId(), "quantity", "2", "lineDiscountBp", 500),
                                Map.of("lineKey", "setup", "variantId", setup.getId(), "quantity", "1", "lineDiscountBp", 1800)
                        ),
                        "orderDiscountBp", 0
                )))
                .retrieve().toEntity(String.class);
        assertThat(reviseRes.getStatusCode().value()).isEqualTo(200);
        UUID revisionId = UUID.fromString(json(reviseRes.getBody()).get("data").get("revisionId").asText());

        // 8. Rep submits for approval
        ResponseEntity<String> submitRes = post("/api/v1/quotes/" + quoteId + "/submissions", repToken)
                .body(toJson(Map.of("expectedRevisionId", revisionId, "note", "Urgent client discount request")))
                .retrieve().toEntity(String.class);
        assertThat(submitRes.getStatusCode().value()).isEqualTo(200);
        JsonNode submitData = json(submitRes.getBody()).get("data");
        assertThat(submitData.get("gates").get("approvalStatus").asText()).isIn("PENDING_MANAGER", "PENDING_FINANCE");

        // 9. Manager views pending approval queue
        ResponseEntity<String> queueRes = get("/api/v1/approval-requests?status=PENDING", managerToken)
                .retrieve().toEntity(String.class);
        assertThat(queueRes.getStatusCode().value()).isEqualTo(200);
        JsonNode queueItems = json(queueRes.getBody()).get("data").get("items");
        assertThat(queueItems.size()).isGreaterThanOrEqualTo(1);

        List<ApprovalRequest> pending = approvals.findByRevisionIdOrderByStepAsc(revisionId);
        assertThat(pending).isNotEmpty();
        ApprovalRequest managerStep = pending.get(0);

        // 10. Rep tries to self-approve -> Forbidden (SELF_APPROVAL_FORBIDDEN)
        ResponseEntity<String> selfApproveRes = post("/api/v1/approval-requests/" + managerStep.getId() + "/decisions", repToken)
                .header("Idempotency-Key", "self-app-" + unique)
                .body(toJson(Map.of("decision", "APPROVE", "expectedRevisionId", revisionId, "reason", "Trying to self-approve")))
                .retrieve().toEntity(String.class);
        assertThat(selfApproveRes.getStatusCode().value()).isEqualTo(403);

        // 11. Manager approves -> SUCCESS (200 OK)
        ResponseEntity<String> managerApproveRes = post("/api/v1/approval-requests/" + managerStep.getId() + "/decisions", managerToken)
                .header("Idempotency-Key", "mgr-app-" + unique)
                .body(toJson(Map.of("decision", "APPROVE", "expectedRevisionId", revisionId, "reason", "Concessions reviewed and approved")))
                .retrieve().toEntity(String.class);
        assertThat(managerApproveRes.getStatusCode().value()).isEqualTo(200);
        JsonNode managerDecisionData = json(managerApproveRes.getBody()).get("data");
        assertThat(managerDecisionData.get("stepStatus").asText()).isEqualTo("APPROVED");

        // Verify that step 1 is now APPROVED
        ApprovalRequest approvedStep = approvals.findById(managerStep.getId()).orElseThrow();
        assertThat(approvedStep.getStatus().name()).isEqualTo("APPROVED");

        // 12. If step 2 (Finance) exists, test that Admin can approve as executive override
        if (pending.size() > 1) {
            ApprovalRequest step2 = pending.get(1);
            ResponseEntity<String> adminApproveRes = post("/api/v1/approval-requests/" + step2.getId() + "/decisions", adminToken)
                    .header("Idempotency-Key", "admin-app-" + unique)
                    .body(toJson(Map.of("decision", "APPROVE", "expectedRevisionId", revisionId, "reason", "Admin executive approval override")))
                    .retrieve().toEntity(String.class);
            assertThat(adminApproveRes.getStatusCode().value()).isEqualTo(200);
            JsonNode adminDecisionData = json(adminApproveRes.getBody()).get("data");
            assertThat(adminDecisionData.get("stepStatus").asText()).isEqualTo("APPROVED");
        }
    }
}
