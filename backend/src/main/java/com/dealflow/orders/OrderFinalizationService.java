package com.dealflow.orders;

import com.dealflow.auth.Actor;
import com.dealflow.billing.BillingService;
import com.dealflow.fulfillment.AllocationService;
import com.dealflow.fulfillment.engine.AllocationModel.AllocationResult;
import com.dealflow.outbox.OutboxWriter;
import com.dealflow.quotes.CommercialHash;
import com.dealflow.quotes.Quote;
import com.dealflow.quotes.QuoteEnums.RevisionStatus;
import com.dealflow.quotes.QuoteEnums.Stage;
import com.dealflow.quotes.QuoteGateListener;
import com.dealflow.quotes.QuoteLine;
import com.dealflow.quotes.QuoteLineRepository;
import com.dealflow.quotes.QuoteRepository;
import com.dealflow.quotes.QuoteRevision;
import com.dealflow.quotes.QuoteRevisionRepository;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.time.BusinessClock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The transaction coordinator: turns an accepted quotation into an order.
 *
 * <h2>Why this is one transaction</h2>
 *
 * <p>Creating the order, holding the stock and raising the first invoice have to
 * succeed or fail together. If billing failed after stock was reserved, the
 * warehouse would be holding units for an order nobody was ever billed for; if
 * the order committed and reservation failed, two customers could be promised
 * the same laptop. Splitting these across services would turn a database
 * transaction into a distributed-consistency problem — which is the concrete
 * reason this system is a modular monolith rather than microservices.
 *
 * <h2>Why it can be called from anywhere, repeatedly</h2>
 *
 * <p>Approval, seller adoption and customer acceptance complete in any order, so
 * every one of those paths calls {@link #onGatesPossiblyCleared}. This method
 * re-reads all the gates under a lock and does nothing unless every one holds.
 * A missing gate is a {@code WAITING} result, not an error — it is the normal
 * answer when the customer has accepted but finance has not yet approved.
 *
 * <p>Duplicate creation is prevented at three levels, deliberately: the
 * aggregate lock serialises callers, the explicit existence check returns the
 * existing order, and {@code orders.quote_id} is UNIQUE so that even a race the
 * first two somehow missed ends in a rolled-back second transaction rather than
 * a second order (test T13).
 */
@Service
public class OrderFinalizationService implements QuoteGateListener {

    private static final Logger log = LoggerFactory.getLogger(OrderFinalizationService.class);

    /** {@code WAITING} is a normal outcome, not a failure. */
    public enum Status {
        FINALIZED, ALREADY_FINALIZED, WAITING
    }

    public record FinalizationResult(Status status, UUID orderId, String orderReference,
                                     List<String> blockingReasons, boolean hasShortage,
                                     UUID oneTimeInvoiceId) {

        public static FinalizationResult waiting(List<String> reasons) {
            return new FinalizationResult(Status.WAITING, null, null, reasons, false, null);
        }
    }

    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final QuoteLineRepository quoteLines;
    private final OrderRepository orders;
    private final OrderLineRepository orderLines;
    private final AllocationService allocationService;
    private final BillingService billingService;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;

    public OrderFinalizationService(QuoteRepository quotes, QuoteRevisionRepository revisions,
                                    QuoteLineRepository quoteLines, OrderRepository orders,
                                    OrderLineRepository orderLines, AllocationService allocationService,
                                    BillingService billingService, AuditService audit,
                                    OutboxWriter outbox, BusinessClock clock) {
        this.quotes = quotes;
        this.revisions = revisions;
        this.quoteLines = quoteLines;
        this.orders = orders;
        this.orderLines = orderLines;
        this.allocationService = allocationService;
        this.billingService = billingService;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<UUID> findOrderIdForQuote(UUID quoteId) {
        return orders.findByQuoteId(quoteId).map(Order::getId);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void onGatesPossiblyCleared(UUID quoteId, Actor actor) {
        FinalizationResult result = tryFinalize(quoteId, actor);
        if (result.status() == Status.WAITING) {
            log.debug("Quote {} not ready to finalise: {}", quoteId, result.blockingReasons());
        }
    }

    /**
     * Creates the order if — and only if — every gate holds.
     *
     * <p>{@code rollbackFor = Exception.class} is deliberate: a checked exception
     * escaping from stock or billing must undo the order too, not leave it half
     * created (verification I01).
     */
    @Transactional(rollbackFor = Exception.class)
    public FinalizationResult tryFinalize(UUID quoteId, Actor actor) {
        Quote quote = quotes.findByIdForUpdate(quoteId)
                .orElseThrow(() -> ApiException.notFound("Quotation " + quoteId));

        Optional<Order> existing = orders.findByQuoteId(quoteId);
        if (existing.isPresent()) {
            // An exact replay. Returning the existing order is the honest answer
            // and keeps a retried request idempotent.
            Order order = existing.get();
            return new FinalizationResult(Status.ALREADY_FINALIZED, order.getId(),
                    order.getReference(), List.of(), false, null);
        }

        QuoteRevision revision = revisions.findById(quote.getCurrentRevisionId())
                .orElseThrow(() -> ApiException.notFound("Current revision of quotation " + quoteId));

        List<String> blocking = blockingReasons(quote, revision);
        if (!blocking.isEmpty()) {
            return FinalizationResult.waiting(blocking);
        }

        List<QuoteLine> lines = quoteLines.findByRevisionIdOrderByPositionAsc(revision.getId());
        if (lines.isEmpty()) {
            throw new ApiException(ErrorCode.EMPTY_QUOTE);
        }

        // The customer accepted a specific set of terms. Re-derive the hash and
        // confirm it still describes this revision before executing anything.
        String currentHash = CommercialHash.of(revision, lines);
        if (revision.getCustomerAcceptedHash() != null
                && !revision.getCustomerAcceptedHash().equals(currentHash)) {
            throw ApiException.of(ErrorCode.ACCEPTANCE_HASH_MISMATCH,
                    "These terms changed after the customer accepted them. A fresh acceptance is needed.",
                    "acceptedHash", revision.getCustomerAcceptedHash(), "currentHash", currentHash);
        }

        Instant now = clock.now();
        Order order = new Order(nextOrderReference(), quote.getId(), revision.getId(),
                quote.getCustomerId(), quote.getOwnerProfileId(), revision.getCurrency(), now);
        order.setBackorderTerms(revision.getBackorderTerms());
        order.setOneTimeNetMinor(revision.getOneTimeNetMinor());
        order.setOneTimeTaxMinor(revision.getOneTimeTaxMinor());
        orders.save(order);

        List<OrderLine> createdLines = copyLines(order, lines);
        orderLines.saveAll(createdLines);

        // Stock first: if in-stock-only terms cannot be met, this throws and the
        // whole order — including the invoice below — never comes into being.
        AllocationResult allocation = allocationService.reserveForOrder(order, createdLines, actor);

        BillingService.BillingResult billing = billingService.initializeBilling(
                order, createdLines, revision.getInvoicingTerms(),
                revision.getRequestedActivationDate(), actor);

        quote.setStage(Stage.CONFIRMED);
        quote.recordProgress(now);
        revision.setStatus(RevisionStatus.SUBMITTED);

        audit.record(actor, "ORDER_CREATED", "Order", order.getId())
                .quote(quote.getId()).revision(revision.getId()).order(order.getId())
                .after(Map.of("reference", order.getReference(),
                        "oneTimeNetMinor", order.getOneTimeNetMinor(),
                        "subscriptions", billing.subscriptionIds().size(),
                        "shortages", allocation == null ? 0 : allocation.shortages().size()))
                .save();

        outbox.publish(OutboxWriter.Events.ORDER_CREATED, "Order", order.getId(),
                order.getRowVersion(),
                Map.of("quoteId", quote.getId().toString(), "reference", order.getReference()),
                OutboxWriter.RecipientScope.deal(quote.getCustomerId(), quote.getOwnerProfileId(),
                        quote.getTeamId()));

        if (allocation != null && allocation.hasShortage()) {
            outbox.publish(OutboxWriter.Events.BACKORDER_UPDATED, "Order", order.getId(),
                    order.getRowVersion(), Map.of("shortages", allocation.shortages().size()),
                    OutboxWriter.RecipientScope.deal(quote.getCustomerId(),
                            quote.getOwnerProfileId(), quote.getTeamId()));
        }

        return new FinalizationResult(Status.FINALIZED, order.getId(), order.getReference(),
                List.of(), allocation != null && allocation.hasShortage(), billing.oneTimeInvoiceId());
    }

    /**
     * The gates, in the order a user would ask about them.
     *
     * <p>Approval and acceptance are genuinely independent: either can arrive
     * first, and neither implies the other. Seller adoption is a third,
     * separate fact — even a counteroffer inside every ceiling needs the
     * business to agree to sell on those terms.
     */
    private List<String> blockingReasons(Quote quote, QuoteRevision revision) {
        List<String> blocking = new ArrayList<>();
        if (quote.getStage() == Stage.CANCELED) {
            blocking.add("This quotation was cancelled.");
            return blocking;
        }
        if (revision.getStatus() != RevisionStatus.SUBMITTED) {
            blocking.add("The current version has not been submitted.");
        }
        if (!revision.getApprovalStatus().clearsApprovalGate()) {
            blocking.add("Approval is not complete (" + revision.getApprovalStatus().name() + ").");
        }
        if (revision.getSellerAdoptedAt() == null) {
            blocking.add("The sales rep has not adopted these terms.");
        }
        if (revision.getCustomerAcceptedAt() == null) {
            blocking.add("The customer has not accepted these terms.");
        }
        if (quote.isExpiredOn(clock.businessToday())) {
            blocking.add("This quotation passed its validity date.");
        }
        return blocking;
    }

    /** Freezes each accepted quotation line as an immutable order line. */
    private List<OrderLine> copyLines(Order order, List<QuoteLine> lines) {
        List<OrderLine> copies = new ArrayList<>(lines.size());
        for (QuoteLine line : lines) {
            OrderLine copy = new OrderLine(order.getId(), line.getId(),
                    line.getLineKey(), line.getPosition());
            copy.setLineKind(line.getLineKind());
            copy.setProductId(line.getProductId());
            copy.setCategoryId(line.getCategoryId());
            copy.setVariantId(line.getVariantId());
            copy.setPlanId(line.getPlanId());
            copy.setDescription(line.getDescription());
            copy.setQuantity(line.getQuantity());
            copy.setUnitPriceMinor(line.getUnitPriceMinor());
            copy.setUnitCostMinor(line.getUnitCostMinor());
            copy.setTaxRateBp(line.getTaxRateBp());
            copy.setEffectiveDiscountBp(line.getEffectiveDiscountBp());
            copy.setNetMinor(line.getNetMinor());
            copy.setTaxMinor(line.getTaxMinor());
            copy.setIntervalMonths(line.getIntervalMonths());
            copy.setRequiresStock(line.isRequiresStock());
            copy.setPromisedDate(line.getPromisedDate());
            copies.add(copy);
        }
        return copies;
    }

    private String nextOrderReference() {
        return "SO-" + orders.nextReferenceNumber();
    }
}
