package com.dealflow.quotes.service;


import com.dealflow.quotes.models.*;
import com.dealflow.quotes.repo.*;
import com.dealflow.quotes.dto.*;
import com.dealflow.quotes.controller.*;
import com.dealflow.approvals.service.ApprovalRoutingService;
import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.auth.models.Role;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.outbox.service.OutboxWriter;
import com.dealflow.portal.models.NegotiationRequest;
import com.dealflow.portal.repo.NegotiationRequestRepository;
import com.dealflow.quotes.models.QuoteEnums.ApprovalStatus;
import com.dealflow.quotes.models.QuoteEnums.BackorderTerms;
import com.dealflow.quotes.models.QuoteEnums.NegotiationStatus;
import com.dealflow.quotes.models.QuoteEnums.RevisionSource;
import com.dealflow.quotes.models.QuoteEnums.RevisionStatus;
import com.dealflow.quotes.models.QuoteEnums.Stage;
import com.dealflow.quotes.dto.QuoteDtos.AdoptRevisionRequest;
import com.dealflow.quotes.dto.QuoteDtos.CancelQuoteRequest;
import com.dealflow.quotes.dto.QuoteDtos.CreateQuoteRequest;
import com.dealflow.quotes.dto.QuoteDtos.QuoteDraftRequest;
import com.dealflow.quotes.dto.QuoteDtos.QuoteEvaluationResponse;
import com.dealflow.quotes.dto.QuoteDtos.QuoteLineRequest;
import com.dealflow.quotes.dto.QuoteDtos.ShareResponse;
import com.dealflow.quotes.dto.QuoteDtos.SubmitQuoteRequest;
import com.dealflow.quotes.models.PricingModel.LineResult;
import com.dealflow.quotes.models.RiskModel.ApprovalLevel;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.time.BusinessClock;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Commands that change a quotation.
 *
 * <p>Every one of them locks the quotation aggregate first. That single
 * serialisation point is what makes the workflow safe under concurrency: a rep
 * editing while a manager approves, two acceptances arriving together, a
 * cancellation racing a submission — all queue on the same row and the second
 * one sees the first one's result rather than overwriting it.
 *
 * <p>The versioning rule this class implements: <b>submitted terms are
 * immutable</b>. Editing a submitted revision does not modify it; it supersedes
 * it with a new one and retires the pending approvals that referred to the old
 * terms. An approval can never be inherited by terms the approver never saw
 * (edge case E06).
 */
@Service
public class QuoteService {

    private static final Logger log = LoggerFactory.getLogger(QuoteService.class);

    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final QuoteLineRepository quoteLines;
    private final NegotiationRequestRepository negotiations;
    private final CustomerRepository customers;
    private final ProfileRepository profiles;
    private final ApprovalRoutingService approvalRouting;
    private final QuoteEvaluationService evaluationService;
    private final QuoteAccessPolicy accessPolicy;
    private final QuoteGateListener gateListener;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;
    private final AppProperties properties;

    public QuoteService(QuoteRepository quotes, QuoteRevisionRepository revisions,
                        QuoteLineRepository quoteLines, NegotiationRequestRepository negotiations,
                        CustomerRepository customers,
                        ProfileRepository profiles, ApprovalRoutingService approvalRouting,
                        QuoteEvaluationService evaluationService, QuoteAccessPolicy accessPolicy,
                        QuoteGateListener gateListener, AuditService audit, OutboxWriter outbox,
                        BusinessClock clock, ObjectMapper objectMapper, AppProperties properties) {
        this.quotes = quotes;
        this.revisions = revisions;
        this.quoteLines = quoteLines;
        this.negotiations = negotiations;
        this.customers = customers;
        this.profiles = profiles;
        this.approvalRouting = approvalRouting;
        this.evaluationService = evaluationService;
        this.accessPolicy = accessPolicy;
        this.gateListener = gateListener;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    // ------------------------------------------------------------- creation

    @Transactional
    public QuoteEvaluationResponse create(CreateQuoteRequest request, Actor actor) {
        if (actor.isCustomer()) {
            throw ApiException.forbidden("Customers cannot create quotations.");
        }
        Customer customer = customers.findById(request.customerId())
                .orElseThrow(() -> ApiException.notFound("Customer " + request.customerId()));
        if (!customer.isActive()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "That customer is no longer active.");
        }

        Instant now = clock.now();
        Profile owner = profiles.findById(actor.profileId())
                .orElseThrow(() -> ApiException.notFound("Your profile"));

        Quote quote = new Quote(nextQuoteReference(), customer.getId(), actor.profileId(),
                owner.getTeamId(), now);
        quote.setTitle(request.title());
        quote.setValidUntil(request.validUntil());
        quotes.save(quote);

        QuoteRevision revision = new QuoteRevision(quote.getId(), quote.nextRevisionNo(),
                RevisionSource.SELLER, customer.getCurrency(), actor.profileId());
        revisions.save(revision);
        quote.setCurrentRevisionId(revision.getId());

        // @Version advances at flush. Return the committed version so the next
        // client mutation does not falsely report an optimistic-lock conflict.
        quotes.flush();

        audit.record(actor, "QUOTE_CREATED", "Quote", quote.getId())
                .quote(quote.getId()).revision(revision.getId())
                .after(Map.of("reference", quote.getReference(), "customerId", customer.getId()))
                .save();

        return evaluationService.toResponse(quote, revision, customer,
                emptyEvaluation(customer, revision), null, false);
    }

    // ----------------------------------------------------------- evaluation

    /** Live re-price while building. Persists nothing. */
    @Transactional(readOnly = true)
    public QuoteEvaluationResponse evaluate(UUID quoteId, QuoteDraftRequest request, Actor actor) {
        Quote quote = load(quoteId);
        accessPolicy.requireRead(actor, quote);
        Customer customer = loadCustomer(quote);
        QuoteRevision revision = currentRevision(quote);

        var evaluation = evaluationService.evaluateRequest(customer, request.lines(),
                request.orderDiscountBpOrZero());
        return evaluationService.toResponse(quote, revision, customer, evaluation,
                gateListener.findOrderIdForQuote(quoteId).orElse(null), true);
    }

    /** The current state of a quotation, from its stored lines. */
    @Transactional(readOnly = true)
    public QuoteEvaluationResponse get(UUID quoteId, Actor actor) {
        Quote quote = load(quoteId);
        accessPolicy.requireRead(actor, quote);
        return renderCurrent(quote);
    }

    @Transactional(readOnly = true)
    public QuoteEvaluationResponse getRevision(UUID quoteId, UUID revisionId, Actor actor) {
        Quote quote = load(quoteId);
        accessPolicy.requireRead(actor, quote);
        QuoteRevision revision = revisions.findById(revisionId)
                .filter(candidate -> candidate.getQuoteId().equals(quoteId))
                .orElseThrow(() -> ApiException.notFound("Revision " + revisionId));
        return render(quote, revision);
    }

    // ---------------------------------------------------------------- edits

    /**
     * Saves commercial terms.
     *
     * <p>While the current revision is still a draft its lines are replaced in
     * place. Once it has been submitted the terms are frozen, so this creates a
     * new revision instead and supersedes the approvals attached to the old one.
     */
    @Transactional
    public QuoteEvaluationResponse saveDraft(UUID quoteId, QuoteDraftRequest request, Actor actor) {
        Quote quote = lockQuote(quoteId);
        accessPolicy.requireEdit(actor, quote);
        requireNoOrder(quote);
        checkExpectedVersion(quote, request.expectedRowVersion());
        enforceLineLimit(request.lines());

        Customer customer = loadCustomer(quote);
        Instant now = clock.now();

        var evaluation = evaluationService.evaluateRequest(customer, request.lines(),
                request.orderDiscountBpOrZero());

        QuoteRevision current = currentRevision(quote);
        QuoteRevision target;
        boolean createdNewRevision;

        if (current.getStatus() == RevisionStatus.DRAFT) {
            target = current;
            quoteLines.deleteByRevisionId(target.getId());
            quoteLines.flush();
            createdNewRevision = false;
        } else {
            // Submitted terms are immutable: supersede rather than mutate.
            current.markSuperseded();
            supersedePendingApprovals(current, actor, now,
                    "The quotation was revised before this step was decided.");
            // Countering back is a valid answer to a proposal, but the proposal
            // itself is now history: its candidate revision is no longer current
            // and can never be adopted (edge case E07).
            closeCandidateRequests(current.getId(), actor, now, NegotiationStatus.SUPERSEDED,
                    "Your account manager responded with revised terms.");
            target = new QuoteRevision(quote.getId(), quote.nextRevisionNo(),
                    RevisionSource.SELLER, customer.getCurrency(), actor.profileId());
            revisions.save(target);
            quote.setCurrentRevisionId(target.getId());
            createdNewRevision = true;
        }

        target.setOrderDiscountBp(request.orderDiscountBpOrZero());
        target.setBackorderTerms(request.backorderTerms() == null
                ? BackorderTerms.ALLOW_BACKORDER : request.backorderTerms());
        target.setRequestedActivationDate(request.requestedActivationDate());
        persistLines(target, evaluation.pricing().lines(), request.lines());
        applyTotals(target, evaluation);
        target.setApprovalStatus(ApprovalStatus.NOT_EVALUATED);
        target.setRequiredLevel(ApprovalLevel.NONE);

        // Editing is activity, not progress: it must not reset the stall timer
        // or the age of the customer's silence (edge case E22).
        quote.touchActivity(now);
        if (createdNewRevision && quote.getStage() != Stage.UNDER_NEGOTIATION) {
            quote.setStage(Stage.DRAFT);
        }

        audit.record(actor, createdNewRevision ? "QUOTE_REVISED" : "QUOTE_DRAFT_SAVED",
                        "QuoteRevision", target.getId())
                .quote(quote.getId()).revision(target.getId())
                .after(Map.of("revisionNo", target.getRevisionNo(),
                        "oneTimeNetMinor", target.getOneTimeNetMinor(),
                        "lineCount", request.lines().size()))
                .save();

        quotes.flush();
        outbox.publish(OutboxWriter.Events.QUOTE_REVISED, "Quote", quote.getId(),
                quote.getRowVersion(), Map.of("revisionId", target.getId().toString()),
                OutboxWriter.RecipientScope.deal(quote.getCustomerId(), quote.getOwnerProfileId(),
                        quote.getTeamId()));

        return evaluationService.toResponse(quote, target, customer, evaluation, null, false);
    }

    // ----------------------------------------------------------- submission

    /**
     * Freezes a draft and routes it for approval.
     *
     * <p>Everything the decision depends on is snapshotted here: prices, costs,
     * the policy version, the risk result and the commercial hash. From this
     * point the revision cannot change — only be superseded.
     */
    @Transactional
    public QuoteEvaluationResponse submit(UUID quoteId, SubmitQuoteRequest request, Actor actor) {
        Quote quote = lockQuote(quoteId);
        accessPolicy.requireEdit(actor, quote);
        requireNoOrder(quote);
        checkExpectedVersion(quote, request.expectedRowVersion());

        QuoteRevision revision = currentRevision(quote);
        if (!revision.getId().equals(request.expectedRevisionId())) {
            throw ApiException.of(ErrorCode.STALE_QUOTE_VERSION,
                    "This quotation changed. Refresh before submitting it.",
                    "currentRevisionId", revision.getId().toString());
        }
        if (revision.getStatus() != RevisionStatus.DRAFT) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE,
                    "This version has already been submitted.");
        }

        Instant now = clock.now();
        if (quote.isExpiredOn(clock.businessToday())) {
            throw new ApiException(ErrorCode.QUOTE_EXPIRED,
                    "This quotation passed its validity date. Extend it before submitting.");
        }

        Customer customer = loadCustomer(quote);
        List<QuoteLine> lines = quoteLines.findByRevisionIdOrderByPositionAsc(revision.getId());
        if (lines.isEmpty()) {
            throw new ApiException(ErrorCode.EMPTY_QUOTE);
        }

        var evaluation = evaluationService.evaluateStored(customer, revision, lines);
        applyTotals(revision, evaluation);
        revision.setPolicyVersionNo(evaluation.policyVersionNo());
        revision.setPolicySnapshot(evaluation.policyJson());
        revision.setRiskResult(objectMapper.writeValueAsString(evaluation.risk()));
        revision.setCommercialHash(CommercialHash.of(revision, lines));
        revision.markSubmitted(now);

        // Submitting IS the seller adopting their own terms. A customer-proposed
        // candidate is different: it needs an explicit adoption step.
        revision.recordSellerAdoption(actor.profileId(), now);

        // Routed from scratch by the shared router, so a rep submission and a
        // customer counteroffer produce identical chains for identical terms.
        ApprovalLevel required = evaluation.risk().requiredLevel();
        approvalRouting.createChain(quote, revision, required,
                objectMapper.writeValueAsString(evaluation.risk().reasons()), now);

        quote.setStage(Stage.REVIEW);
        // The first submission starts the external wait. Resubmitting later does
        // not restart it, so a deal that has been waiting five days still reads
        // as five days (edge case E22).
        quote.beginAwaitingExternal(now);

        audit.record(actor, "QUOTE_SUBMITTED", "QuoteRevision", revision.getId())
                .quote(quote.getId()).revision(revision.getId())
                .after(Map.of("revisionNo", revision.getRevisionNo(),
                        "requiredLevel", required.name(),
                        "policyVersionNo", evaluation.policyVersionNo(),
                        "commercialHash", revision.getCommercialHash()))
                .reason(request.note())
                .save();

        outbox.publish(OutboxWriter.Events.QUOTE_SUBMITTED, "Quote", quote.getId(),
                quote.getRowVersion(),
                Map.of("revisionId", revision.getId().toString(), "requiredLevel", required.name()),
                OutboxWriter.RecipientScope.deal(quote.getCustomerId(), quote.getOwnerProfileId(),
                        quote.getTeamId()).andRoles(Role.MANAGER.name(), Role.FINANCE.name()));

        // No approval needed and the customer may already have accepted an
        // identical earlier version: give the coordinator a chance to finalise.
        gateListener.onGatesPossiblyCleared(quote.getId(), actor);

        quotes.flush();
        return evaluationService.toResponse(quote, revision, customer, evaluation,
                gateListener.findOrderIdForQuote(quoteId).orElse(null), false);
    }

    // -------------------------------------------------------------- sharing

    /**
     * Marks the quotation as sent and returns the customer's portal path.
     *
     * <p>Sends no email — this build has no configured transport, and claiming
     * otherwise would be a lie in the demo. The returned path is an identifier,
     * not a credential: the portal still authenticates the customer and checks
     * that the quotation belongs to them.
     */
    @Transactional
    public ShareResponse share(UUID quoteId, Actor actor) {
        Quote quote = lockQuote(quoteId);
        accessPolicy.requireEdit(actor, quote);
        QuoteRevision revision = currentRevision(quote);
        if (revision.getStatus() != RevisionStatus.SUBMITTED) {
            throw new ApiException(ErrorCode.QUOTE_NOT_SUBMITTED,
                    "Submit this quotation before sharing it with the customer.");
        }
        Instant now = clock.now();
        if (quote.getStage() == Stage.REVIEW || quote.getStage() == Stage.DRAFT) {
            quote.setStage(Stage.SENT);
        }
        quote.beginAwaitingExternal(now);

        audit.record(actor, "QUOTE_SHARED", "Quote", quote.getId())
                .quote(quote.getId()).revision(revision.getId())
                .save();

        outbox.publish(OutboxWriter.Events.QUOTE_REVISED, "Quote", quote.getId(),
                quote.getRowVersion(), Map.of("stage", quote.getStage().name()),
                OutboxWriter.RecipientScope.deal(quote.getCustomerId(), quote.getOwnerProfileId(),
                        quote.getTeamId()));

        return new ShareResponse(quote.getId(), quote.getStage().name(),
                "/customer/quotes/" + quote.getId(), revision.getCommercialHash());
    }

    // ------------------------------------------------------------- adoption

    /**
     * The rep accepting terms the customer proposed.
     *
     * <p>A separate gate from approval. Even a counteroffer that sits inside
     * every policy ceiling needs the seller to actually agree to it — the
     * business decides what it is willing to sell, not the buyer.
     */
    @Transactional
    public QuoteEvaluationResponse adopt(UUID quoteId, AdoptRevisionRequest request, Actor actor) {
        Quote quote = lockQuote(quoteId);
        accessPolicy.requireAdopt(actor, quote);
        requireNoOrder(quote);
        checkExpectedVersion(quote, request.expectedRowVersion());

        QuoteRevision revision = revisions.findById(request.revisionId())
                .filter(candidate -> candidate.getQuoteId().equals(quoteId))
                .orElseThrow(() -> ApiException.notFound("Revision " + request.revisionId()));

        if (!revision.getId().equals(quote.getCurrentRevisionId())) {
            throw ApiException.of(ErrorCode.STALE_QUOTE_VERSION,
                    "That version is no longer the active one.",
                    "currentRevisionId", String.valueOf(quote.getCurrentRevisionId()));
        }
        if (revision.getStatus() != RevisionStatus.SUBMITTED) {
            throw new ApiException(ErrorCode.QUOTE_NOT_SUBMITTED,
                    "This version has not been submitted for approval yet.");
        }
        Instant now = clock.now();
        if (revision.getSellerAdoptedAt() == null) {
            revision.recordSellerAdoption(actor.profileId(), now);
            quote.touchActivity(now);

            // The customer asked for these terms in a negotiation request. Now
            // that the seller has agreed to them, that request is answered:
            // leaving it OPEN would keep offering an Adopt button for terms
            // already adopted, and the customer's deal room would still show
            // the ask as unanswered.
            closeCandidateRequests(revision.getId(), actor, now, NegotiationStatus.ADOPTED,
                    request.note() == null || request.note().isBlank()
                            ? "Your proposed terms were accepted." : request.note());

            audit.record(actor, "REVISION_ADOPTED", "QuoteRevision", revision.getId())
                    .quote(quote.getId()).revision(revision.getId())
                    .reason(request.note())
                    .save();

            outbox.publish(OutboxWriter.Events.NEGOTIATION_UPDATED, "Quote", quote.getId(),
                    quote.getRowVersion(), Map.of("revisionId", revision.getId().toString()),
                    OutboxWriter.RecipientScope.deal(quote.getCustomerId(),
                            quote.getOwnerProfileId(), quote.getTeamId()));
        }

        // Adoption exposes the exact submitted terms for customer acceptance.
        // Approval remains an independent gate and may still be pending.
        if (quote.getStage() == Stage.REVIEW || quote.getStage() == Stage.UNDER_NEGOTIATION) {
            quote.setStage(Stage.SENT);
            quote.beginAwaitingExternal(now);
            outbox.publish(OutboxWriter.Events.QUOTE_REVISED, "Quote", quote.getId(),
                    quote.getRowVersion(), Map.of("stage", quote.getStage().name()),
                    OutboxWriter.RecipientScope.deal(quote.getCustomerId(),
                            quote.getOwnerProfileId(), quote.getTeamId()));
        }
        gateListener.onGatesPossiblyCleared(quote.getId(), actor);
        quotes.flush();
        return renderCurrent(quote);
    }

    /**
     * Moves the negotiation requests that produced {@code candidateRevisionId}
     * out of OPEN once that candidate has been answered by an action rather
     * than by words.
     *
     * <p>Nothing here changes commercial terms. It only stops a settled ask
     * from being presented as still waiting on both sides of the deal room.
     */
    private void closeCandidateRequests(UUID candidateRevisionId, Actor actor, Instant when,
                                        NegotiationStatus outcome, String message) {
        for (NegotiationRequest record : negotiations.findByCandidateRevisionId(candidateRevisionId)) {
            if (record.getStatus() != NegotiationStatus.OPEN
                    && record.getStatus() != NegotiationStatus.ANSWERED) {
                continue;
            }
            record.respond(actor.profileId(),
                    record.getResponseMessage() == null ? message : record.getResponseMessage(),
                    outcome, when);
        }
    }

    // --------------------------------------------------------- cancellation

    /**
     * Cancels a quotation before it becomes an order.
     *
     * <p>Outstanding approvals are superseded, not left pending: a decision
     * recorded after this point must not be able to authorise anything (edge
     * case E06).
     */
    @Transactional
    public QuoteEvaluationResponse cancel(UUID quoteId, CancelQuoteRequest request, Actor actor) {
        Quote quote = lockQuote(quoteId);
        accessPolicy.requireRead(actor, quote);
        if (!(actor.isAdmin() || actor.profileId().equals(quote.getOwnerProfileId()))) {
            throw ApiException.forbidden("Only the owning rep or an administrator can cancel this quotation.");
        }
        requireNoOrder(quote);
        checkExpectedVersion(quote, request.expectedRowVersion());

        if (quote.getStage() == Stage.CANCELED) {
            return renderCurrent(quote);
        }
        if (!quote.getStage().isOpen()) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE,
                    "This quotation is " + quote.getStage().name().toLowerCase() + " and cannot be cancelled.");
        }

        Instant now = clock.now();
        QuoteRevision revision = currentRevision(quote);
        supersedePendingApprovals(revision, actor, now, "The quotation was cancelled.");
        revision.setStatus(RevisionStatus.CANCELED);
        quote.setStage(Stage.CANCELED);
        quote.touchActivity(now);

        audit.record(actor, "QUOTE_CANCELED", "Quote", quote.getId())
                .quote(quote.getId()).revision(revision.getId())
                .reason(request.reason())
                .save();

        outbox.publish(OutboxWriter.Events.QUOTE_REVISED, "Quote", quote.getId(),
                quote.getRowVersion(), Map.of("stage", Stage.CANCELED.name()),
                OutboxWriter.RecipientScope.deal(quote.getCustomerId(), quote.getOwnerProfileId(),
                        quote.getTeamId()));

        return renderCurrent(quote);
    }

    // ------------------------------------------------------------- internals

    /** Retires steps that referred to terms which no longer exist. */
    void supersedePendingApprovals(QuoteRevision revision, Actor actor, Instant now, String reason) {
        approvalRouting.supersedePending(revision, actor, reason);
    }

    private void persistLines(QuoteRevision revision, List<LineResult> priced,
                              List<QuoteLineRequest> requests) {
        Map<String, QuoteLineRequest> requestByKey = new LinkedHashMap<>();
        for (int i = 0; i < requests.size() && i < priced.size(); i++) {
            requestByKey.put(priced.get(i).lineKey(), requests.get(i));
        }

        List<QuoteLine> rows = new ArrayList<>(priced.size());
        for (LineResult result : priced) {
            QuoteLine line = new QuoteLine(revision.getId(), result.lineKey(), result.position());
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
            QuoteLineRequest request = requestByKey.get(result.lineKey());
            if (request != null) {
                line.setPromisedDate(request.promisedDate());
            }
            line.setSource(parseSource(result.source()));
            rows.add(line);
        }
        quoteLines.saveAll(rows);
    }

    private static QuoteEnums.LineSource parseSource(String source) {
        try {
            return QuoteEnums.LineSource.valueOf(source);
        } catch (IllegalArgumentException | NullPointerException ex) {
            return QuoteEnums.LineSource.MANUAL;
        }
    }

    private static void applyTotals(QuoteRevision revision, QuoteEvaluationService.Evaluation evaluation) {
        var pricing = evaluation.pricing();
        revision.applyTotals(
                pricing.oneTimeNetMinor(), pricing.oneTimeTaxMinor(), pricing.oneTimeCostMinor(),
                pricing.recurringFirstCycleNetMinor(), pricing.recurringFirstCycleTaxMinor(),
                pricing.recurringFirstCycleCostMinor(),
                pricing.contributionMinor(), pricing.contributionPercent(),
                pricing.totalBaseMinor(), pricing.totalDiscountMinor());
    }

    QuoteEvaluationResponse renderCurrent(Quote quote) {
        return render(quote, currentRevision(quote));
    }

    QuoteEvaluationResponse render(Quote quote, QuoteRevision revision) {
        Customer customer = loadCustomer(quote);
        List<QuoteLine> lines = quoteLines.findByRevisionIdOrderByPositionAsc(revision.getId());
        var evaluation = lines.isEmpty()
                ? emptyEvaluation(customer, revision)
                : evaluationService.evaluateStored(customer, revision, lines);
        return evaluationService.toResponse(quote, revision, customer, evaluation,
                gateListener.findOrderIdForQuote(quote.getId()).orElse(null), false);
    }

    /** A quotation with no lines yet: valid to display, not valid to submit. */
    private QuoteEvaluationService.Evaluation emptyEvaluation(Customer customer, QuoteRevision revision) {
        var pricing = new com.dealflow.quotes.models.PricingModel.PricingResult(
                revision.getCurrency(), revision.getOrderDiscountBp(), List.of(),
                0, 0, 0, 0, 0, 0, Map.of(), 0, 0, 0, null, 0, 0);
        var risk = new com.dealflow.quotes.models.RiskModel.RiskResult(
                ApprovalLevel.NONE, List.of(), List.of(),
                java.math.BigDecimal.ZERO, java.math.BigDecimal.ZERO, 0,
                java.math.BigDecimal.ZERO, null, 0, 0,
                revision.getPolicyVersionNo() == null ? 0 : revision.getPolicyVersionNo());
        return new QuoteEvaluationService.Evaluation(pricing, risk,
                revision.getPolicyVersionNo() == null ? 0 : revision.getPolicyVersionNo(),
                revision.getPolicySnapshot(), List.of());
    }

    public Quote load(UUID quoteId) {
        return quotes.findById(quoteId).orElseThrow(() -> ApiException.notFound("Quotation " + quoteId));
    }

    Quote lockQuote(UUID quoteId) {
        return quotes.findByIdForUpdate(quoteId)
                .orElseThrow(() -> ApiException.notFound("Quotation " + quoteId));
    }

    Customer loadCustomer(Quote quote) {
        return customers.findById(quote.getCustomerId())
                .orElseThrow(() -> ApiException.notFound("Customer " + quote.getCustomerId()));
    }

    QuoteRevision currentRevision(Quote quote) {
        if (quote.getCurrentRevisionId() == null) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE, "This quotation has no active version.");
        }
        return revisions.findById(quote.getCurrentRevisionId())
                .orElseThrow(() -> ApiException.notFound("Revision " + quote.getCurrentRevisionId()));
    }

    private void requireNoOrder(Quote quote) {
        Optional<UUID> orderId = gateListener.findOrderIdForQuote(quote.getId());
        if (orderId.isPresent()) {
            throw ApiException.of(ErrorCode.ALREADY_ORDERED,
                    "An order already exists for this quotation. Changes now go through the order.",
                    "orderId", orderId.get().toString());
        }
    }

    /**
     * Optimistic guard for a client that has been looking at a stale screen.
     *
     * <p>Checked eagerly so the caller gets a clear 409 with the current version,
     * rather than a generic optimistic-lock failure at flush time.
     */
    private static void checkExpectedVersion(Quote quote, Long expectedRowVersion) {
        if (expectedRowVersion != null && expectedRowVersion != quote.getRowVersion()) {
            throw ApiException.of(ErrorCode.STALE_QUOTE_VERSION,
                    "This quotation changed. Refresh before continuing.",
                    "currentVersion", quote.getRowVersion(), "expectedVersion", expectedRowVersion);
        }
    }

    private void enforceLineLimit(List<QuoteLineRequest> lines) {
        int limit = properties.limits().maxQuoteLines();
        if (lines.size() > limit) {
            throw ApiException.of(ErrorCode.VALIDATION_FAILED,
                    "A quotation is limited to " + limit + " lines.", "limit", limit);
        }
    }

    private String nextQuoteReference() {
        return "Q-" + quotes.nextReferenceNumber();
    }
}
