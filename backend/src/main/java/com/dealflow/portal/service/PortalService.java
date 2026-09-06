package com.dealflow.portal.service;


import com.dealflow.portal.models.*;
import com.dealflow.portal.repo.*;
import com.dealflow.portal.dto.*;
import com.dealflow.portal.controller.*;
import com.dealflow.approvals.service.ApprovalRoutingService;
import com.dealflow.auth.models.Actor;
import com.dealflow.billing.dto.BillingDtos.InvoiceLineResponse;
import com.dealflow.billing.dto.BillingDtos.InvoiceResponse;
import com.dealflow.billing.models.Invoice;
import com.dealflow.billing.repo.InvoiceLineRepository;
import com.dealflow.billing.repo.InvoiceRepository;
import com.dealflow.billing.service.InvoiceDocumentExporter;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.fulfillment.service.StockAvailabilityService;
import com.dealflow.orders.models.Order;
import com.dealflow.orders.repo.OrderRepository;
import com.dealflow.outbox.service.OutboxWriter;
import com.dealflow.portal.dto.PortalDtos.AcceptanceRequest;
import com.dealflow.portal.dto.PortalDtos.AcceptanceResponse;
import com.dealflow.portal.dto.PortalDtos.CounterLineRequest;
import com.dealflow.portal.dto.PortalDtos.PortalActivity;
import com.dealflow.portal.dto.PortalDtos.PortalInvoiceSummary;
import com.dealflow.portal.dto.PortalDtos.PortalLine;
import com.dealflow.portal.dto.PortalDtos.PortalQuoteDetail;
import com.dealflow.portal.dto.PortalDtos.PortalQuoteSummary;
import com.dealflow.portal.dto.PortalDtos.PortalRecurringTotal;
import com.dealflow.portal.dto.PortalDtos.PortalRequest;
import com.dealflow.portal.dto.PortalDtos.PortalTotals;
import com.dealflow.quotes.models.CommercialHash;
import com.dealflow.quotes.models.Quote;
import com.dealflow.quotes.service.QuoteAccessPolicy;
import com.dealflow.quotes.models.QuoteEnums.NegotiationStatus;
import com.dealflow.quotes.models.QuoteEnums.NegotiationType;
import com.dealflow.quotes.models.QuoteEnums.RevisionSource;
import com.dealflow.quotes.models.QuoteEnums.RevisionStatus;
import com.dealflow.quotes.models.QuoteEnums.Stage;
import com.dealflow.quotes.service.QuoteEvaluationService;
import com.dealflow.quotes.service.QuoteGateListener;
import com.dealflow.quotes.models.QuoteLine;
import com.dealflow.quotes.repo.QuoteLineRepository;
import com.dealflow.quotes.repo.QuoteRepository;
import com.dealflow.quotes.models.QuoteRevision;
import com.dealflow.quotes.repo.QuoteRevisionRepository;
import com.dealflow.quotes.dto.QuoteDtos.QuoteLineRequest;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.money.Bp;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessCalendar;
import com.dealflow.shared.time.BusinessClock;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * The customer's view of their own deals, and the only way they can act on one.
 *
 * <h2>Isolation</h2>
 *
 * <p>Every method starts by checking that the authenticated identity is bound to
 * the quotation's customer, and a mismatch is a 404 — not a 403, because
 * "forbidden" would confirm the record exists. Responses are built from separate
 * portal types that have no field for cost, margin, policy thresholds or other
 * customers, so there is nothing to leak even by accident.
 *
 * <h2>Negotiation cannot outrun execution</h2>
 *
 * <p>The moment an order exists, this path closes: counter and accept are
 * refused with a 409, not merely hidden in the UI. Later changes go through the
 * billing workflows, which keep their own records (edge case E20).
 */
@Service
public class PortalService {

    private static final Logger log = LoggerFactory.getLogger(PortalService.class);

    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final QuoteLineRepository quoteLines;
    private final NegotiationRequestRepository negotiations;
    private final CustomerRepository customers;
    private final OrderRepository orders;
    private final InvoiceRepository invoices;
    private final InvoiceLineRepository invoiceLines;
    private final InvoiceDocumentExporter documentExporter;
    private final QuoteEvaluationService evaluationService;
    private final QuoteAccessPolicy accessPolicy;
    private final QuoteGateListener gateListener;
    private final ApprovalRoutingService approvalRouting;
    private final StockAvailabilityService availability;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;

    public PortalService(QuoteRepository quotes, QuoteRevisionRepository revisions,
                         QuoteLineRepository quoteLines, NegotiationRequestRepository negotiations,
                         CustomerRepository customers, OrderRepository orders,
                         InvoiceRepository invoices, InvoiceLineRepository invoiceLines,
                         InvoiceDocumentExporter documentExporter,
                         QuoteEvaluationService evaluationService,
                         QuoteAccessPolicy accessPolicy, QuoteGateListener gateListener,
                         ApprovalRoutingService approvalRouting,
                         StockAvailabilityService availability, AuditService audit,
                         OutboxWriter outbox, BusinessClock clock, ObjectMapper objectMapper) {
        this.quotes = quotes;
        this.revisions = revisions;
        this.quoteLines = quoteLines;
        this.negotiations = negotiations;
        this.customers = customers;
        this.orders = orders;
        this.invoices = invoices;
        this.invoiceLines = invoiceLines;
        this.documentExporter = documentExporter;
        this.evaluationService = evaluationService;
        this.accessPolicy = accessPolicy;
        this.gateListener = gateListener;
        this.approvalRouting = approvalRouting;
        this.availability = availability;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    // ----------------------------------------------------------------- read

    @Transactional(readOnly = true)
    public List<PortalQuoteSummary> listQuotes(Actor actor) {
        UUID customerId = requireCustomer(actor);
        return quotes.findByCustomerIdOrderByCreatedAtDesc(customerId).stream()
                // A draft the rep has not sent is not the customer's business yet.
                .filter(quote -> quote.getStage() != Stage.DRAFT)
                .map(this::toSummary)
                .toList();
    }

    @Transactional(readOnly = true)
    public PortalQuoteDetail getQuote(UUID quoteId, Actor actor) {
        Quote quote = loadForCustomer(quoteId, actor);
        QuoteRevision revision = currentRevision(quote);
        return toDetail(quote, revision);
    }

    @Transactional(readOnly = true)
    public List<PortalInvoiceSummary> listInvoices(Actor actor) {
        UUID customerId = requireCustomer(actor);
        return invoices.findByCustomerId(customerId,
                        org.springframework.data.domain.PageRequest.of(0, 100)).stream()
                .filter(invoice -> invoice.getStatus() != Invoice.InvoiceStatus.DRAFT)
                .map(invoice -> new PortalInvoiceSummary(invoice.getId(), invoice.getReference(),
                        invoice.getStatus().name(), invoice.getCurrency(),
                        Money.toMajor(invoice.getTotalMinor()),
                        Money.toMajor(invoice.outstandingMinor()),
                        invoice.getIssueDate(), invoice.getDueDate()))
                .toList();
    }

    @Transactional(readOnly = true)
    public InvoiceResponse getInvoice(UUID invoiceId, Actor actor) {
        UUID customerId = requireCustomer(actor);
        Invoice invoice = invoices.findById(invoiceId)
                .orElseThrow(() -> ApiException.notFound("Invoice " + invoiceId));
        if (!invoice.getCustomerId().equals(customerId) || invoice.getStatus() == Invoice.InvoiceStatus.DRAFT) {
            throw ApiException.notFound("Invoice " + invoiceId);
        }
        return toInvoiceResponse(invoice);
    }

    @Transactional(readOnly = true)
    public byte[] exportInvoice(UUID invoiceId, String format, Actor actor) {
        InvoiceResponse invoice = getInvoice(invoiceId, actor);
        String fmt = format == null ? "pdf" : format.trim().toLowerCase(java.util.Locale.ROOT);
        return switch (fmt) {
            case "pdf" -> documentExporter.exportPdf(invoice);
            case "xlsx", "excel" -> documentExporter.exportExcel(invoice);
            case "doc", "docx", "word" -> documentExporter.exportDoc(invoice);
            default -> throw new ApiException(ErrorCode.VALIDATION_FAILED, "format must be pdf, xlsx or doc.");
        };
    }

    private InvoiceResponse toInvoiceResponse(Invoice invoice) {
        Customer customer = customers.findById(invoice.getCustomerId()).orElse(null);
        List<InvoiceLineResponse> lines = invoiceLines.findByInvoiceIdOrderByPositionAsc(invoice.getId()).stream()
                .map(line -> new InvoiceLineResponse(line.getId(), line.getDescription(), line.getQuantity(),
                        Money.toMajor(line.getUnitPriceMinor()), Money.toMajor(line.getNetMinor()),
                        Money.toMajor(line.getTaxMinor()), line.getCoverageStart(), line.getCoverageEnd(),
                        line.getLineType().name()))
                .toList();
        return new InvoiceResponse(invoice.getId(), invoice.getReference(), invoice.getCustomerId(),
                customer == null ? null : customer.getName(), invoice.getOrderId(), invoice.getSubscriptionId(),
                invoice.getInvoiceKind().name(), invoice.getStatus().name(), invoice.getCurrency(),
                invoice.getIssueDate(), invoice.getDueDate(), Money.toMajor(invoice.getNetMinor()),
                Money.toMajor(invoice.getTaxMinor()), Money.toMajor(invoice.getTotalMinor()),
                Money.toMajor(invoice.getCreditedMinor()), Money.toMajor(invoice.getPaidMinor()),
                Money.toMajor(invoice.outstandingMinor()), lines);
    }

    // ---------------------------------------------------------- negotiation

    /**
     * Records a comment, change request or counteroffer.
     *
     * <p>A comment changes nothing. A change or counter builds a candidate
     * revision from the current terms plus the customer's proposal, prices it
     * server-side, re-runs risk, and routes whatever approval the new terms
     * require. The customer's numbers are inputs, never outputs: they supply a
     * discount they would like, not a price.
     *
     * <p>Even a counteroffer that sits inside every ceiling still needs the
     * seller to adopt it before it can execute.
     */
    @Transactional(rollbackFor = Exception.class)
    public PortalQuoteDetail submitRequest(UUID quoteId, PortalRequest request, Actor actor) {
        UUID customerId = requireCustomer(actor);
        Quote quote = quotes.findByIdForUpdate(quoteId)
                .orElseThrow(() -> ApiException.notFound("Quotation " + quoteId));
        if (!quote.getCustomerId().equals(customerId)) {
            throw ApiException.notFound("Quotation " + quoteId);
        }
        requireNegotiable(quote);

        QuoteRevision current = currentRevision(quote);
        if (!current.getId().equals(request.expectedRevisionId())) {
            throw ApiException.of(ErrorCode.STALE_QUOTE_VERSION,
                    "This quotation has been updated. Refresh to see the current version.",
                    "currentRevisionId", current.getId().toString());
        }

        NegotiationType type = parseType(request.requestType());
        Instant now = clock.now();

        NegotiationRequest record = new NegotiationRequest(quote.getId(), current.getId(),
                actor.profileId(), type);
        record.setLineKey(request.lineKey());
        record.setMessage(request.message());

        if (type == NegotiationType.COMMENT) {
            // Text is text. It never becomes a discount, and it never
            // invalidates an approval already given. It IS the customer
            // responding, though, so it counts as external progress and clears
            // the stall timer (edge case E22) — unlike a rep's own edits.
            record.setPayload(objectMapper.writeValueAsString(Map.of("message",
                    request.message() == null ? "" : request.message())));
            negotiations.save(record);
            quote.recordProgress(now);

            audit.record(actor, "PORTAL_COMMENT", "Quote", quote.getId())
                    .quote(quote.getId()).revision(current.getId())
                    .after(Map.of("lineKey", String.valueOf(request.lineKey())))
                    .save();
            publishNegotiationEvent(quote);
            return toDetail(quote, current);
        }

        QuoteRevision candidate = buildCandidateRevision(quote, current, request, actor, now);
        record.setCandidateRevisionId(candidate.getId());
        record.setPayload(objectMapper.writeValueAsString(Map.of(
                "requestedOrderDiscountBp", request.requestedOrderDiscountBp() == null
                        ? 0 : request.requestedOrderDiscountBp(),
                "lines", request.lines() == null ? List.of() : request.lines())));
        negotiations.save(record);

        quote.setStage(Stage.UNDER_NEGOTIATION);
        // The customer responding is real progress: it clears the wait that
        // started when the quotation was sent.
        quote.recordProgress(now);

        audit.record(actor, "PORTAL_COUNTER", "QuoteRevision", candidate.getId())
                .quote(quote.getId()).revision(candidate.getId())
                .after(Map.of("revisionNo", candidate.getRevisionNo(),
                        "requiredLevel", candidate.getRequiredLevel().name()))
                .reason(request.message())
                .save();

        publishNegotiationEvent(quote);
        return toDetail(quote, candidate);
    }

    /**
     * Accepts one exact version.
     *
     * <p>Both the revision id and the commercial hash must match what is current.
     * If the rep changed anything since the page was rendered, the acceptance is
     * refused with a 409 and the customer is shown the new terms; a stale click
     * is never reinterpreted as consent (edge case E19).
     *
     * <p>Acceptance with approvals outstanding is <em>conditional</em>: it is
     * recorded, it does not release stock, and it does not create an order.
     */
    @Transactional(rollbackFor = Exception.class)
    public AcceptanceResponse accept(UUID quoteId, AcceptanceRequest request, Actor actor) {
        UUID customerId = requireCustomer(actor);
        Quote quote = quotes.findByIdForUpdate(quoteId)
                .orElseThrow(() -> ApiException.notFound("Quotation " + quoteId));
        if (!quote.getCustomerId().equals(customerId)) {
            throw ApiException.notFound("Quotation " + quoteId);
        }

        Optional<Order> existingOrder = orders.findByQuoteId(quoteId);
        QuoteRevision current = currentRevision(quote);

        if (existingOrder.isPresent()) {
            // Replaying the acceptance that already produced this order is fine
            // and returns the same answer. Accepting a different version is not.
            if (current.getCustomerAcceptedAt() != null
                    && request.revisionId().equals(current.getId())) {
                return new AcceptanceResponse(quoteId, current.getId(), true, false,
                        "This quotation is already confirmed.",
                        existingOrder.get().getReference(), List.of());
            }
            throw new ApiException(ErrorCode.ALREADY_ORDERED,
                    "This quotation is already confirmed and can no longer be changed.");
        }

        requireNegotiable(quote);

        if (!request.revisionId().equals(current.getId())) {
            throw ApiException.of(ErrorCode.STALE_QUOTE_VERSION,
                    "These terms have been updated. Review the current version before accepting.",
                    "currentRevisionId", current.getId().toString());
        }
        if (current.getStatus() != RevisionStatus.SUBMITTED) {
            throw new ApiException(ErrorCode.QUOTE_NOT_SUBMITTED,
                    "This version is not ready to accept yet.");
        }
        if (quote.isExpiredOn(clock.businessToday())) {
            throw new ApiException(ErrorCode.QUOTE_EXPIRED,
                    "This quotation has passed its validity date. Ask your contact to re-issue it.");
        }

        List<QuoteLine> lines = quoteLines.findByRevisionIdOrderByPositionAsc(current.getId());
        String currentHash = CommercialHash.of(current, lines);
        if (!currentHash.equals(request.commercialHash())) {
            throw ApiException.of(ErrorCode.ACCEPTANCE_HASH_MISMATCH,
                    "These terms changed since this page was opened. Refresh to see what is on offer now.",
                    "currentHash", currentHash);
        }

        Instant now = clock.now();
        if (current.getCustomerAcceptedAt() == null) {
            current.recordCustomerAcceptance(actor.profileId(), now, currentHash);
            quote.recordProgress(now);

            audit.record(actor, "PORTAL_ACCEPTED", "QuoteRevision", current.getId())
                    .quote(quote.getId()).revision(current.getId())
                    .after(Map.of("commercialHash", currentHash))
                    .reason(request.note())
                    .save();
        }

        // Acceptance may have been the last gate — or not. The coordinator
        // decides, and does nothing if approvals are still outstanding.
        gateListener.onGatesPossiblyCleared(quote.getId(), actor);
        Optional<Order> created = orders.findByQuoteId(quoteId);

        boolean conditional = created.isEmpty();
        List<String> remaining = new ArrayList<>();
        if (conditional) {
            if (!current.getApprovalStatus().clearsApprovalGate()) {
                remaining.add("Internal approval is still in progress.");
            }
            if (current.getSellerAdoptedAt() == null) {
                remaining.add("Your contact has not yet confirmed these terms.");
            }
        }

        publishNegotiationEvent(quote);

        return new AcceptanceResponse(quoteId, current.getId(), true, conditional,
                conditional
                        ? "Thanks — your acceptance is recorded. We will confirm once the remaining "
                                + "internal steps are complete."
                        : "Thanks — your order is confirmed.",
                created.map(Order::getReference).orElse(null), remaining);
    }

    // -------------------------------------------------------------- helpers

    /**
     * Builds a candidate revision from the customer's proposal.
     *
     * <p>The current lines are the base; the proposal may adjust quantity and
     * requested discount per line and at order level. Everything else — price,
     * cost, tax, eligibility — is resolved from the catalogue, so a customer
     * cannot propose a price, only ask for a discount.
     */
    private QuoteRevision buildCandidateRevision(Quote quote, QuoteRevision current,
                                                 PortalRequest request, Actor actor, Instant now) {
        Customer customer = customers.findById(quote.getCustomerId())
                .orElseThrow(() -> ApiException.notFound("Customer " + quote.getCustomerId()));

        List<QuoteLine> currentLines = quoteLines.findByRevisionIdOrderByPositionAsc(current.getId());
        Map<String, CounterLineRequest> proposals = new HashMap<>();
        if (request.lines() != null) {
            request.lines().forEach(line -> proposals.put(line.lineKey(), line));
        }

        List<QuoteLineRequest> lineRequests = new ArrayList<>(currentLines.size());
        for (QuoteLine line : currentLines) {
            CounterLineRequest proposal = proposals.get(line.getLineKey());
            BigDecimal quantity = proposal != null && proposal.quantity() != null
                    ? proposal.quantity() : line.getQuantity();
            Integer discountBp = proposal != null && proposal.requestedDiscountBp() != null
                    ? proposal.requestedDiscountBp() : line.getLineDiscountBp();

            if (discountBp > Bp.MAX_DISCOUNT) {
                throw new ApiException(ErrorCode.DISCOUNT_OUT_OF_RANGE,
                        "A discount must be between 0% and 99.99%.");
            }
            lineRequests.add(new QuoteLineRequest(line.getLineKey(), line.getVariantId(),
                    line.getPlanId(), quantity, discountBp, line.getPromisedDate(), "COUNTER"));
        }

        int orderDiscountBp = request.requestedOrderDiscountBp() == null
                ? current.getOrderDiscountBp() : request.requestedOrderDiscountBp();

        // Prices come from the catalogue; the engine rejects a line that nets to
        // zero before anything is persisted (edge case E18).
        var evaluation = evaluationService.evaluateRequest(customer, lineRequests, orderDiscountBp);

        // The version the customer was looking at becomes history, and its
        // pending steps are retired: an approval given for the old terms must
        // not authorise the new ones (edge case E07/E08).
        current.markSuperseded();
        approvalRouting.supersedePending(current, actor,
                "The customer proposed different terms.");

        // Only the newest proposal is live. An earlier candidate the seller
        // never adopted describes terms that no longer exist, and leaving it
        // OPEN would offer the rep an Adopt button for a dead revision.
        negotiations.findOpenCandidates(quote.getId())
                .forEach(stale -> stale.setStatus(NegotiationStatus.SUPERSEDED));

        QuoteRevision candidate = new QuoteRevision(quote.getId(), quote.nextRevisionNo(),
                RevisionSource.CUSTOMER_COUNTER, customer.getCurrency(), actor.profileId());
        candidate.setOrderDiscountBp(orderDiscountBp);
        candidate.setBackorderTerms(current.getBackorderTerms());
        candidate.setInvoicingTerms(current.getInvoicingTerms());
        candidate.setRequestedActivationDate(current.getRequestedActivationDate());
        revisions.save(candidate);

        persistCandidateLines(candidate, evaluation);
        var pricing = evaluation.pricing();
        candidate.applyTotals(pricing.oneTimeNetMinor(), pricing.oneTimeTaxMinor(),
                pricing.oneTimeCostMinor(), pricing.recurringFirstCycleNetMinor(),
                pricing.recurringFirstCycleTaxMinor(), pricing.recurringFirstCycleCostMinor(),
                pricing.contributionMinor(), pricing.contributionPercent(),
                pricing.totalBaseMinor(), pricing.totalDiscountMinor());

        candidate.setPolicyVersionNo(evaluation.policyVersionNo());
        candidate.setPolicySnapshot(evaluation.policyJson());
        candidate.setRiskResult(objectMapper.writeValueAsString(evaluation.risk()));
        candidate.setRequiredLevel(evaluation.risk().requiredLevel());
        candidate.markSubmitted(now);

        List<QuoteLine> candidateLines = quoteLines.findByRevisionIdOrderByPositionAsc(candidate.getId());
        candidate.setCommercialHash(CommercialHash.of(candidate, candidateLines));

        // Routed from scratch through the same router a rep submission uses, so
        // the counteroffer actually reaches an approver's queue. A smaller
        // discount does not inherit the old approval: quantity, cadence or
        // delivery terms may have moved too (edge case E08).
        approvalRouting.createChain(quote, candidate, evaluation.risk().requiredLevel(),
                objectMapper.writeValueAsString(evaluation.risk().reasons()), now);

        // Seller adoption stays deliberately unset. Even a counteroffer inside
        // every ceiling needs the business to agree to sell on those terms.
        quote.setCurrentRevisionId(candidate.getId());
        return candidate;
    }

    private void persistCandidateLines(QuoteRevision candidate,
                                       QuoteEvaluationService.Evaluation evaluation) {
        List<QuoteLine> rows = new ArrayList<>();
        for (var result : evaluation.pricing().lines()) {
            QuoteLine line = new QuoteLine(candidate.getId(), result.lineKey(), result.position());
            line.setLineKind(result.kind());
            line.setProductId(result.productId());
            line.setCategoryId(result.categoryId());
            line.setVariantId(result.variantId());
            line.setPlanId(result.planId());
            line.setDescription(result.description());
            line.setQuantity(result.quantity());
            line.setUnitPriceMinor(result.unitPriceMinor());
            line.setUnitCostMinor(result.unitCostMinor());
            line.setTaxRateBp(result.taxRateBp());
            line.setLineDiscountBp(result.lineDiscountBp());
            line.setAppliedOrderDiscountBp(result.appliedOrderDiscountBp());
            line.setEffectiveDiscountBp(result.effectiveDiscountBp());
            line.setBaseMinor(result.baseMinor());
            line.setNetMinor(result.netMinor());
            line.setTaxMinor(result.taxMinor());
            line.setCostTotalMinor(result.costTotalMinor());
            line.setMarginMinor(result.marginMinor());
            line.setIntervalMonths(result.intervalMonths());
            line.setRequiresStock(result.requiresStock());
            line.setSource(com.dealflow.quotes.models.QuoteEnums.LineSource.COUNTER);
            rows.add(line);
        }
        quoteLines.saveAll(rows);
    }

    private void requireNegotiable(Quote quote) {
        if (orders.findByQuoteId(quote.getId()).isPresent()) {
            throw new ApiException(ErrorCode.NEGOTIATION_CLOSED,
                    "This quotation is confirmed. Please contact your account manager for changes.");
        }
        if (!quote.getStage().isOpen()) {
            throw new ApiException(ErrorCode.NEGOTIATION_CLOSED,
                    "This quotation is closed and can no longer be changed.");
        }
    }

    private UUID requireCustomer(Actor actor) {
        if (!actor.isCustomer() || actor.customerId() == null) {
            throw ApiException.forbidden("This area is for customer accounts.");
        }
        return actor.customerId();
    }

    private Quote loadForCustomer(UUID quoteId, Actor actor) {
        Quote quote = quotes.findById(quoteId)
                .orElseThrow(() -> ApiException.notFound("Quotation " + quoteId));
        accessPolicy.requirePortalAccess(actor, quote);
        if (quote.getStage() == Stage.DRAFT) {
            throw ApiException.notFound("Quotation " + quoteId);
        }
        return quote;
    }

    private QuoteRevision currentRevision(Quote quote) {
        return revisions.findById(quote.getCurrentRevisionId())
                .orElseThrow(() -> ApiException.notFound("Current version of quotation " + quote.getId()));
    }

    private static NegotiationType parseType(String value) {
        try {
            return NegotiationType.valueOf(value.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "requestType must be COMMENT, CHANGE or COUNTER.");
        }
    }

    private void publishNegotiationEvent(Quote quote) {
        outbox.publish(OutboxWriter.Events.NEGOTIATION_UPDATED, "Quote", quote.getId(),
                quote.getRowVersion(), Map.of("stage", quote.getStage().name()),
                OutboxWriter.RecipientScope.deal(quote.getCustomerId(), quote.getOwnerProfileId(),
                        quote.getTeamId()));
    }

    // -------------------------------------------------------------- mapping

    private PortalQuoteSummary toSummary(Quote quote) {
        QuoteRevision revision = revisions.findById(quote.getCurrentRevisionId()).orElse(null);
        return new PortalQuoteSummary(quote.getId(), quote.getReference(), quote.getTitle(),
                customerFacingStatus(quote, revision), revision == null ? "INR" : revision.getCurrency(),
                revision == null ? BigDecimal.ZERO
                        : Money.toMajor(revision.getOneTimeNetMinor() + revision.getOneTimeTaxMinor()),
                quote.getValidUntil(), quote.getUpdatedAt());
    }

    private PortalQuoteDetail toDetail(Quote quote, QuoteRevision revision) {
        List<QuoteLine> lines = quoteLines.findByRevisionIdOrderByPositionAsc(revision.getId());
        Optional<Order> order = orders.findByQuoteId(quote.getId());

        Map<UUID, StockAvailabilityService.VariantAvailability> stock = availability.availabilityFor(
                lines.stream().filter(QuoteLine::isRequiresStock)
                        .map(QuoteLine::getVariantId)
                        .filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet()));

        List<PortalLine> portalLines = lines.stream()
                .map(line -> new PortalLine(
                        line.getLineKey(), line.getDescription(), line.getQuantity(),
                        Money.toMajor(line.getUnitPriceMinor()), line.getEffectiveDiscountBp(),
                        line.getLineDiscountBp(),
                        Money.toMajor(line.getNetMinor()), Money.toMajor(line.getTaxMinor()),
                        line.getIntervalMonths() == null ? "one-time"
                                : BusinessCalendar.cadenceLabel(line.getIntervalMonths()),
                        line.getPromisedDate(),
                        availabilityNote(line, stock)))
                .toList();

        boolean expired = quote.isExpiredOn(clock.businessToday());
        boolean awaitingApproval = !revision.getApprovalStatus().clearsApprovalGate();
        boolean acceptable = order.isEmpty() && quote.getStage().isOpen() && !expired
                && revision.getStatus() == RevisionStatus.SUBMITTED
                && revision.getCustomerAcceptedAt() == null;

        return new PortalQuoteDetail(
                quote.getId(), quote.getReference(), quote.getTitle(),
                revision.getId(), revision.getRevisionNo(),
                customerFacingStatus(quote, revision), statusMessage(quote, revision, order.isPresent()),
                awaitingApproval, acceptable,
                revision.getCustomerAcceptedAt() != null, revision.getCustomerAcceptedAt(),
                order.isPresent(), order.map(Order::getReference).orElse(null),
                quote.getValidUntil(), expired,
                revision.getBackorderTerms().name(),
                "Items ordered are invoiced on confirmation. Recurring charges are billed separately "
                        + "for each period.",
                revision.getOrderDiscountBp(),
                portalLines, buildTotals(revision, lines),
                activityFor(quote), revision.getCommercialHash());
    }

    private String availabilityNote(QuoteLine line,
                                    Map<UUID, StockAvailabilityService.VariantAvailability> stock) {
        if (!line.isRequiresStock() || line.getVariantId() == null) {
            return null;
        }
        var variant = stock.get(line.getVariantId());
        BigDecimal available = variant == null ? BigDecimal.ZERO : variant.totalAvailable();
        if (available.compareTo(line.getQuantity()) >= 0) {
            return "In stock";
        }
        // No warehouse detail, and no invented date. If a real expected receipt
        // exists we say so; otherwise we say we do not know (edge case E09).
        if (variant != null && variant.earliestExpectedReceipt() != null) {
            return "Partly on backorder, expected " + variant.earliestExpectedReceipt();
        }
        return "Partly on backorder, delivery date unconfirmed";
    }

    private PortalTotals buildTotals(QuoteRevision revision, List<QuoteLine> lines) {
        Map<Integer, long[]> byCadence = new LinkedHashMap<>();
        for (QuoteLine line : lines) {
            if (line.getIntervalMonths() == null) {
                continue;
            }
            long[] bucket = byCadence.computeIfAbsent(line.getIntervalMonths(), key -> new long[2]);
            bucket[0] += line.getNetMinor();
            bucket[1] += line.getTaxMinor();
        }
        List<PortalRecurringTotal> recurring = byCadence.entrySet().stream()
                .map(entry -> new PortalRecurringTotal(BusinessCalendar.cadenceLabel(entry.getKey()),
                        Money.toMajor(entry.getValue()[0]), Money.toMajor(entry.getValue()[1])))
                .toList();

        return new PortalTotals(revision.getCurrency(),
                Money.toMajor(revision.getOneTimeNetMinor()),
                Money.toMajor(revision.getOneTimeTaxMinor()),
                Money.toMajor(revision.getOneTimeNetMinor() + revision.getOneTimeTaxMinor()),
                recurring,
                Money.toMajor(revision.getOneTimeNetMinor() + revision.getOneTimeTaxMinor()));
    }

    private List<PortalActivity> activityFor(Quote quote) {
        return negotiations.findByQuoteIdOrderByCreatedAtDesc(quote.getId()).stream()
                .map(record -> new PortalActivity(record.getId(), record.getRequestType().name(),
                        record.getLineKey(), record.getMessage(), record.getStatus().name(),
                        record.getResponseMessage(), true,
                        record.getCreatedAt(), record.getRespondedAt()))
                .toList();
    }

    /** Plain language. Internal stage names and thresholds stay internal. */
    private String customerFacingStatus(Quote quote, QuoteRevision revision) {
        if (orders.findByQuoteId(quote.getId()).isPresent()) {
            return "CONFIRMED";
        }
        return switch (quote.getStage()) {
            case DRAFT, REVIEW -> "IN_PREPARATION";
            case SENT -> revision != null && revision.getCustomerAcceptedAt() != null
                    ? "ACCEPTED_PENDING_CONFIRMATION" : "AWAITING_YOUR_REVIEW";
            case UNDER_NEGOTIATION -> "UNDER_DISCUSSION";
            case CONFIRMED -> "CONFIRMED";
            case CANCELED -> "WITHDRAWN";
            case LOST -> "CLOSED";
            case EXPIRED -> "EXPIRED";
        };
    }

    private String statusMessage(Quote quote, QuoteRevision revision, boolean ordered) {
        if (ordered) {
            return "Your order is confirmed.";
        }
        if (quote.isExpiredOn(clock.businessToday())) {
            return "This quotation has passed its validity date.";
        }
        if (revision.getCustomerAcceptedAt() != null
                && !revision.getApprovalStatus().clearsApprovalGate()) {
            return "Your acceptance is recorded. We are completing an internal approval before "
                    + "confirming the order.";
        }
        if (!revision.getApprovalStatus().clearsApprovalGate()) {
            return "These terms are awaiting internal approval.";
        }
        if (revision.getCustomerAcceptedAt() != null) {
            return "Your acceptance is recorded. We are finalising your order.";
        }
        return "These terms are ready for your review.";
    }
}
