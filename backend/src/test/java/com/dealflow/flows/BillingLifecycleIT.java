package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.auth.models.Profile;
import com.dealflow.auth.models.Role;
import com.dealflow.billing.models.Invoice;
import com.dealflow.billing.repo.InvoiceRepository;
import com.dealflow.billing.models.Subscription;
import com.dealflow.billing.repo.SubscriptionRepository;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.models.SubscriptionPlan;
import com.dealflow.jobs.models.JobRun;
import com.dealflow.jobs.service.RecurringBillingJob;
import com.dealflow.orders.repo.OrderRepository;
import com.dealflow.shared.time.BusinessClock;
import com.dealflow.support.AbstractIntegrationTest;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.JsonNode;

/**
 * The recurring side of a hybrid deal (tests T15, T17, T18, T19): mid-period
 * quantity change, backdating refusal, cancellation credit applied to debt,
 * and a billing job that bills each period exactly once however often it runs.
 */
class BillingLifecycleIT extends AbstractIntegrationTest {

    @Autowired
    SubscriptionRepository subscriptions;
    @Autowired
    InvoiceRepository invoices;
    @Autowired
    OrderRepository orders;
    @Autowired
    RecurringBillingJob billingJob;
    @Autowired
    BusinessClock clock;

    @Test
    @DisplayName("quantity change raises one prorated adjustment, replays safely, and refuses backdating")
    void quantityChangeIsProratedOnce() {
        Live live = liveSubscription("10");
        String financeToken = tokenFor(live.finance);

        // Effective on the period start: the full remaining fraction of the
        // added five seats at 300 each = 1,500.00 before tax.
        JsonNode preview = json(post("/api/v1/subscriptions/" + live.subscriptionId + "/change-previews", financeToken)
                .body(toJson(map("newQuantity", "15", "effectiveDate", live.periodStart.toString())))
                .retrieve().toEntity(String.class).getBody()).get("data");
        assertThat(preview.get("adjustmentNet").asText()).isEqualTo("1500.00");
        assertThat(preview.get("applied").asBoolean()).isFalse();

        String key = "change-" + suffix();
        ResponseEntity<String> applied = post("/api/v1/subscriptions/" + live.subscriptionId + "/changes", financeToken)
                .header("Idempotency-Key", key)
                .body(toJson(map("newQuantity", "15", "effectiveDate", live.periodStart.toString())))
                .retrieve().toEntity(String.class);
        assertThat(applied.getStatusCode().value()).as(applied.getBody()).isEqualTo(200);
        JsonNode change = json(applied.getBody()).get("data");
        assertThat(change.get("applied").asBoolean()).isTrue();
        assertThat(absentOrNull(change, "adjustmentInvoiceId")).isFalse();
        assertThat(subscriptions.findById(live.subscriptionId).orElseThrow().getQuantity())
                .isEqualByComparingTo("15");

        // Replay: same key, no second adjustment (T18).
        post("/api/v1/subscriptions/" + live.subscriptionId + "/changes", financeToken)
                .header("Idempotency-Key", key)
                .body(toJson(map("newQuantity", "15", "effectiveDate", live.periodStart.toString())))
                .retrieve().toEntity(String.class);
        List<Invoice> forSubscription = invoices.findBySubscriptionId(live.subscriptionId);
        assertThat(forSubscription).hasSize(2); // first period + one adjustment
        assertThat(forSubscription).anySatisfy(invoice -> {
            assertThat(invoice.getInvoiceKind()).isEqualTo(Invoice.InvoiceKind.ADJUSTMENT);
            assertThat(invoice.getTotalMinor()).isEqualTo(150_000L);
        });

        // Backdating is refused outright (E16).
        ResponseEntity<String> backdated = post("/api/v1/subscriptions/" + live.subscriptionId + "/changes", financeToken)
                .header("Idempotency-Key", "back-" + suffix())
                .body(toJson(map("newQuantity", "20", "effectiveDate", live.periodStart.minusDays(10).toString())))
                .retrieve().toEntity(String.class);
        assertThat(backdated.getStatusCode().value()).isEqualTo(422);
        assertThat(json(backdated.getBody()).get("error").get("code").asText()).isEqualTo("BACKDATED_CHANGE_REJECTED");
    }

    @Test
    @DisplayName("immediate cancellation credits unused coverage against outstanding debt, never twice")
    void cancellationCreditsUnusedCoverage() {
        Live live = liveSubscription("10");
        String financeToken = tokenFor(live.finance);

        // Cancel on the first day of the period: the whole 3,000.00 is unused.
        String key = "cancel-" + suffix();
        ResponseEntity<String> cancelled = post("/api/v1/subscriptions/" + live.subscriptionId + "/cancellations", financeToken)
                .header("Idempotency-Key", key)
                .body(toJson(map("policy", "IMMEDIATE_PRORATED", "effectiveDate", live.periodStart.toString(),
                        "reason", "customer request")))
                .retrieve().toEntity(String.class);
        assertThat(cancelled.getStatusCode().value()).as(cancelled.getBody()).isEqualTo(200);
        JsonNode result = json(cancelled.getBody()).get("data");
        assertThat(result.get("adjustmentNet").asText()).isEqualTo("-3000.00");
        assertThat(absentOrNull(result, "creditNoteId")).isFalse();

        Subscription subscription = subscriptions.findById(live.subscriptionId).orElseThrow();
        assertThat(subscription.getStatus()).isEqualTo(Subscription.SubscriptionStatus.CANCELED);
        assertThat(subscription.getNextBillAt()).isNull();

        // The credit settled the unpaid first-period invoice: debt gone, no refund
        // of money that was never received (E17).
        Invoice firstPeriod = invoices.findBySubscriptionId(live.subscriptionId).getFirst();
        assertThat(firstPeriod.getCreditedMinor()).isEqualTo(300_000L);
        assertThat(firstPeriod.outstandingMinor()).isZero();
        assertThat(firstPeriod.getPaidMinor()).isZero();

        JsonNode notes = json(get("/api/v1/credit-notes?customerId=" + live.customerId, financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data").get("items");
        assertThat(notes).hasSize(1);
        assertThat(notes.get(0).get("total").asText()).isEqualTo("3000.00");
        assertThat(notes.get(0).get("available").asText()).isEqualTo("0.00");

        // A refund needs money that was actually paid; none was.
        ResponseEntity<String> refund = post("/api/v1/refunds", financeToken)
                .header("Idempotency-Key", "refund-" + suffix())
                .body(toJson(map("creditNoteId", notes.get(0).get("id").asText(), "amount", "100.00",
                        "method", "BANK_TRANSFER")))
                .retrieve().toEntity(String.class);
        assertThat(refund.getStatusCode().value()).isEqualTo(422);
        assertThat(json(refund.getBody()).get("error").get("code").asText()).isEqualTo("REFUND_EXCEEDS_ELIGIBLE");

        // Replaying the cancellation raises no second credit.
        post("/api/v1/subscriptions/" + live.subscriptionId + "/cancellations", financeToken)
                .header("Idempotency-Key", key)
                .body(toJson(map("policy", "IMMEDIATE_PRORATED", "effectiveDate", live.periodStart.toString())))
                .retrieve().toEntity(String.class);
        assertThat(json(get("/api/v1/credit-notes?customerId=" + live.customerId, financeToken)
                .retrieve().toEntity(String.class).getBody()).get("data").get("items")).hasSize(1);
    }

    @Test
    @DisplayName("the recurring job bills a due period exactly once, however many times it runs (T19)")
    void recurringJobIsIdempotent() {
        Live live = liveSubscription("10");
        Subscription subscription = subscriptions.findById(live.subscriptionId).orElseThrow();

        // Make the next period due today.
        subscription.setNextBillAt(clock.businessToday());
        subscriptions.save(subscription);

        RecurringBillingJob.RunSummary first = billingJob.run(JobRun.Trigger.MANUAL);
        RecurringBillingJob.RunSummary second = billingJob.run(JobRun.Trigger.MANUAL);
        assertThat(first.skippedNoLease()).isFalse();
        assertThat(first.failed()).as("a swallowed per-subscription failure is still a failure").isZero();
        assertThat(second.skippedNoLease()).isFalse();
        assertThat(second.failed()).isZero();

        List<Invoice> all = invoices.findBySubscriptionId(live.subscriptionId);
        assertThat(all).as("first period + exactly one renewal").hasSize(2);
        assertThat(all).allSatisfy(invoice -> assertThat(invoice.getTotalMinor()).isEqualTo(300_000L));

        Subscription advanced = subscriptions.findById(live.subscriptionId).orElseThrow();
        assertThat(advanced.getPeriodStart()).isEqualTo(live.periodEnd);
        assertThat(advanced.getNextBillAt()).isAfter(clock.businessToday());
    }

    // -------------------------------------------------------------- helpers

    private record Live(UUID subscriptionId, UUID customerId, Profile finance,
                        LocalDate periodStart, LocalDate periodEnd) {
    }

    /** Runs a seats-only quotation through to a confirmed order with a live subscription. */
    private Live liveSubscription(String seats) {
        Customer customer = customer("Subscriber", CustomerTier.GOLD);
        Profile rep = person("rep-" + suffix(), Role.REP, null, null);
        Profile finance = person("finance-" + suffix(), Role.FINANCE, null, null);
        Profile buyer = person("buyer-" + suffix(), Role.CUSTOMER, null, customer.getId());
        SubscriptionPlan plan = monthlyPlan("Support", 30_000L, 12_000L);
        String repToken = tokenFor(rep);

        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", repToken)
                .body(toJson(map("customerId", customer.getId())))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());
        UUID revisionId = UUID.fromString(json(post("/api/v1/quotes/" + quoteId + "/revisions", repToken)
                .body(toJson(map("lines", List.of(map("planId", plan.getId(), "quantity", seats)))))
                .retrieve().toEntity(String.class).getBody()).get("data").get("revisionId").asText());
        post("/api/v1/quotes/" + quoteId + "/submissions", repToken)
                .body(toJson(map("expectedRevisionId", revisionId))).retrieve().toEntity(String.class);
        post("/api/v1/quotes/" + quoteId + "/shares", repToken).retrieve().toEntity(String.class);
        String hash = json(get("/api/v1/portal/quotes/" + quoteId, tokenFor(buyer))
                .retrieve().toEntity(String.class).getBody()).get("data").get("commercialHash").asText();
        ResponseEntity<String> accepted = post("/api/v1/portal/quotes/" + quoteId + "/acceptances", tokenFor(buyer))
                .header("Idempotency-Key", "accept-" + suffix())
                .body(toJson(map("revisionId", revisionId, "commercialHash", hash)))
                .retrieve().toEntity(String.class);
        assertThat(accepted.getStatusCode().value()).as(accepted.getBody()).isEqualTo(200);

        UUID orderId = orders.findByQuoteId(quoteId).orElseThrow().getId();
        Subscription subscription = subscriptions.findByOrderId(orderId).getFirst();
        assertThat(subscription.getStatus()).isEqualTo(Subscription.SubscriptionStatus.ACTIVE);
        assertThat(subscription.intervalNetMinor()).isEqualTo(300_000L);
        return new Live(subscription.getId(), customer.getId(), finance,
                subscription.getPeriodStart(), subscription.getPeriodEnd());
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
