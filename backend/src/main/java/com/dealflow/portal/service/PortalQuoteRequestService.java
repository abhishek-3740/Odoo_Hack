package com.dealflow.portal.service;

import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.models.Role;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.outbox.service.OutboxWriter;
import com.dealflow.portal.dto.PortalAccountDtos.QuoteRequest;
import com.dealflow.portal.dto.PortalAccountDtos.QuoteRequestLine;
import com.dealflow.portal.dto.PortalDtos.PortalQuoteDetail;
import com.dealflow.portal.models.NegotiationRequest;
import com.dealflow.portal.repo.NegotiationRequestRepository;
import com.dealflow.quotes.dto.QuoteDtos.QuoteLineRequest;
import com.dealflow.quotes.models.Quote;
import com.dealflow.quotes.models.QuoteEnums.ApprovalStatus;
import com.dealflow.quotes.models.QuoteEnums.LineSource;
import com.dealflow.quotes.models.QuoteEnums.NegotiationType;
import com.dealflow.quotes.models.QuoteEnums.RevisionSource;
import com.dealflow.quotes.models.QuoteEnums.Stage;
import com.dealflow.quotes.models.QuoteLine;
import com.dealflow.quotes.models.QuoteRevision;
import com.dealflow.quotes.models.RiskModel.ApprovalLevel;
import com.dealflow.quotes.repo.QuoteLineRepository;
import com.dealflow.quotes.repo.QuoteRepository;
import com.dealflow.quotes.repo.QuoteRevisionRepository;
import com.dealflow.approvals.service.ApprovalRoutingService;
import com.dealflow.quotes.models.CommercialHash;
import com.dealflow.quotes.service.QuoteEvaluationService;
import com.dealflow.quotes.service.QuoteLineFactory;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.time.BusinessClock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * A customer asking for a quotation from the catalogue.
 *
 * <p>The request becomes a real quotation owned by the customer's account
 * manager, priced by the same engine a rep uses, and left in review for the rep
 * to refine, submit and share. The customer sees it in their portal at once
 * ("in preparation"); the rep is told over the socket. Nothing here bypasses
 * approval or acceptance: the customer cannot set a price or a discount, only
 * say what they want and how many.
 */
@Service
public class PortalQuoteRequestService {

    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final QuoteLineRepository quoteLines;
    private final NegotiationRequestRepository negotiations;
    private final CustomerRepository customers;
    private final ProfileRepository profiles;
    private final QuoteEvaluationService evaluationService;
    private final PortalService portalService;
    private final ApprovalRoutingService approvalRouting;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;

    public PortalQuoteRequestService(QuoteRepository quotes, QuoteRevisionRepository revisions,
                                     QuoteLineRepository quoteLines, NegotiationRequestRepository negotiations,
                                     CustomerRepository customers, ProfileRepository profiles,
                                     QuoteEvaluationService evaluationService, PortalService portalService,
                                     ApprovalRoutingService approvalRouting,
                                     AuditService audit, OutboxWriter outbox, BusinessClock clock,
                                     ObjectMapper objectMapper) {
        this.quotes = quotes;
        this.revisions = revisions;
        this.quoteLines = quoteLines;
        this.negotiations = negotiations;
        this.customers = customers;
        this.profiles = profiles;
        this.evaluationService = evaluationService;
        this.portalService = portalService;
        this.approvalRouting = approvalRouting;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    @Transactional(rollbackFor = Exception.class)
    public PortalQuoteDetail submit(QuoteRequest request, Actor actor) {
        if (!actor.isCustomer() || actor.customerId() == null) {
            throw ApiException.forbidden("This area is for customer accounts.");
        }
        Customer customer = customers.findById(actor.customerId())
                .orElseThrow(() -> ApiException.notFound("Your organisation"));
        Profile owner = resolveOwner(customer);
        Instant now = clock.now();

        List<QuoteLineRequest> lineRequests = new ArrayList<>(request.lines().size());
        int position = 0;
        for (QuoteRequestLine line : request.lines()) {
            if ((line.variantId() == null) == (line.planId() == null)) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED,
                        "Each requested line needs exactly one of variantId or planId.");
            }
            lineRequests.add(new QuoteLineRequest("req-" + (++position), line.variantId(), line.planId(),
                    line.quantity(), 0, null, LineSource.MANUAL.name()));
        }
        // List prices for this customer's tier, no discount. The rep may
        // concede later, through the same approval rules as any other deal.
        var evaluation = evaluationService.evaluateRequest(customer, lineRequests, 0);

        Quote quote = new Quote("Q-" + quotes.nextReferenceNumber(), customer.getId(), owner.getId(),
                owner.getTeamId(), now);
        quote.setTitle(request.title() == null || request.title().isBlank()
                ? "Quotation request from " + customer.getName() : request.title().trim());
        quote.setStage(Stage.REVIEW);
        quotes.save(quote);

        QuoteRevision revision = new QuoteRevision(quote.getId(), quote.nextRevisionNo(),
                RevisionSource.SELLER, customer.getCurrency(), owner.getId());
        revision.setBackorderTerms(evaluationService.defaultBackorderTerms());
        revisions.save(revision);
        quote.setCurrentRevisionId(revision.getId());

        List<QuoteLine> rows = new ArrayList<>();
        for (var result : evaluation.pricing().lines()) {
            rows.add(QuoteLineFactory.fromResult(revision.getId(), result, LineSource.MANUAL));
        }
        quoteLines.saveAll(rows);

        var pricing = evaluation.pricing();
        revision.applyTotals(pricing.oneTimeNetMinor(), pricing.oneTimeTaxMinor(), pricing.oneTimeCostMinor(),
                pricing.recurringFirstCycleNetMinor(), pricing.recurringFirstCycleTaxMinor(),
                pricing.recurringFirstCycleCostMinor(), pricing.contributionMinor(),
                pricing.contributionPercent(), pricing.totalBaseMinor(), pricing.totalDiscountMinor());
        revision.setPolicyVersionNo(evaluation.policyVersionNo());
        revision.setPolicySnapshot(evaluation.policyJson());
        revision.setRiskResult(objectMapper.writeValueAsString(evaluation.risk()));
        revision.setCommercialHash(CommercialHash.of(revision, rows));
        revision.markSubmitted(now);
        revision.recordSellerAdoption(owner.getId(), now);

        ApprovalLevel required = evaluation.risk().requiredLevel();
        approvalRouting.createChain(quote, revision, required,
                objectMapper.writeValueAsString(evaluation.risk().reasons()), now);

        quote.setStage(Stage.REVIEW);
        quote.setCurrentRevisionId(revision.getId());
        quotes.save(quote);
        revisions.save(revision);

        // The customer's note opens the discussion trail on the deal room.
        NegotiationRequest opener = new NegotiationRequest(quote.getId(), revision.getId(),
                actor.profileId(), NegotiationType.COMMENT);
        String note = request.note() == null || request.note().isBlank()
                ? "Quotation requested from the catalogue." : request.note().trim();
        opener.setMessage(note);
        opener.setPayload(objectMapper.writeValueAsString(Map.of("message", note, "origin", "CATALOGUE")));
        negotiations.save(opener);
        quote.recordProgress(now);

        audit.record(actor, "PORTAL_QUOTE_REQUESTED", "Quote", quote.getId())
                .quote(quote.getId()).revision(revision.getId())
                .after(Map.of("reference", quote.getReference(), "lineCount", rows.size(),
                        "ownerProfileId", owner.getId().toString()))
                .reason(note)
                .save();

        outbox.publish(OutboxWriter.Events.NEGOTIATION_UPDATED, "Quote", quote.getId(),
                quote.getRowVersion(), Map.of("stage", quote.getStage().name(), "origin", "CUSTOMER_REQUEST"),
                OutboxWriter.RecipientScope.deal(customer.getId(), owner.getId(), owner.getTeamId()));

        return portalService.getQuote(quote.getId(), actor);
    }

    /** The customer's account manager, or any active rep when none is assigned yet. */
    private Profile resolveOwner(Customer customer) {
        UUID ownerId = customer.getOwnerRepProfileId();
        if (ownerId != null) {
            Profile owner = profiles.findById(ownerId).filter(Profile::isActive).orElse(null);
            if (owner != null) {
                return owner;
            }
        }
        Profile fallback = profiles.findActiveByRole(Role.REP).stream().findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.CONFLICTING_STATE,
                        "No sales representative is available to take this request right now."));
        customer.setOwnerRepProfileId(fallback.getId());
        return fallback;
    }
}
