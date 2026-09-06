package com.dealflow.quotes.controller;


import com.dealflow.quotes.models.*;
import com.dealflow.quotes.repo.*;
import com.dealflow.quotes.service.*;
import com.dealflow.quotes.dto.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.models.Role;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.quotes.models.QuoteEnums.Stage;
import com.dealflow.quotes.dto.QuoteDtos.AdoptRevisionRequest;
import com.dealflow.quotes.dto.QuoteDtos.CancelQuoteRequest;
import com.dealflow.quotes.dto.QuoteDtos.CreateQuoteRequest;
import com.dealflow.quotes.dto.QuoteDtos.QuoteDraftRequest;
import com.dealflow.quotes.dto.QuoteDtos.QuoteEvaluationResponse;
import com.dealflow.quotes.dto.QuoteDtos.QuoteSummary;
import com.dealflow.quotes.dto.QuoteDtos.ShareResponse;
import com.dealflow.quotes.dto.QuoteDtos.SubmitQuoteRequest;
import com.dealflow.shared.audit.AuditEvent;
import com.dealflow.shared.audit.AuditEventRepository;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.web.ApiResponse;
import com.dealflow.shared.web.PageResponse;
import com.dealflow.shared.web.Paging;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Internal quotation endpoints.
 *
 * <p>Sub-resources are nouns for things that happen to a quotation —
 * {@code /evaluations}, {@code /revisions}, {@code /submissions} — rather than
 * verbs, so each has a clear idempotency and authorisation story of its own.
 */
@RestController
@RequestMapping("/api/v1/quotes")
public class QuoteController {

    private static final Set<String> SORTS = Set.of("createdAt", "updatedAt", "lastActivityAt", "stage");

    private final QuoteService quoteService;
    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final QuoteAccessPolicy accessPolicy;
    private final CustomerRepository customers;
    private final ProfileRepository profiles;
    private final AuditEventRepository auditEvents;

    public QuoteController(QuoteService quoteService, QuoteRepository quotes,
                           QuoteRevisionRepository revisions, QuoteAccessPolicy accessPolicy,
                           CustomerRepository customers, ProfileRepository profiles,
                           AuditEventRepository auditEvents) {
        this.quoteService = quoteService;
        this.quotes = quotes;
        this.revisions = revisions;
        this.accessPolicy = accessPolicy;
        this.customers = customers;
        this.profiles = profiles;
        this.auditEvents = auditEvents;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public ApiResponse<PageResponse<QuoteSummary>> list(
            @RequestParam(required = false) String stage,
            @RequestParam(required = false) UUID customerId,
            @RequestParam(required = false) UUID ownerProfileId,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer pageSize,
            @RequestParam(required = false) String sort,
            Actor actor) {
        if (actor.isCustomer()) {
            throw ApiException.forbidden("Use the portal endpoints.");
        }
        // A rep with no explicit owner filter views their team's quotes (or all desk quotes if unassigned);
        // an explicit owner filter always wins. A manager's default scope is their team.
        UUID owner = ownerProfileId;
        UUID team = (actor.role() == Role.REP || actor.role() == Role.MANAGER) ? actor.teamId() : null;
        Stage stageFilter = parseStage(stage);

        Page<Quote> result = quotes.search(owner, team, customerId, stageFilter,
                Paging.of(page, pageSize, sort, SORTS, "updatedAt"));
        return ApiResponse.of(PageResponse.of(result, this::summarise));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<QuoteEvaluationResponse> create(@Valid @RequestBody CreateQuoteRequest request,
                                                       Actor actor) {
        return ApiResponse.of(quoteService.create(request, actor));
    }

    @GetMapping("/{quoteId}")
    public ApiResponse<QuoteEvaluationResponse> get(@PathVariable UUID quoteId, Actor actor) {
        return ApiResponse.of(quoteService.get(quoteId, actor));
    }

    /** Read-only re-price of draft terms. Persists nothing. */
    @PostMapping("/{quoteId}/evaluations")
    public ApiResponse<QuoteEvaluationResponse> evaluate(@PathVariable UUID quoteId,
                                                         @Valid @RequestBody QuoteDraftRequest request,
                                                         Actor actor) {
        return ApiResponse.of(quoteService.evaluate(quoteId, request, actor));
    }

    /** Saves draft terms, or supersedes a submitted version with a new one. */
    @PostMapping("/{quoteId}/revisions")
    public ApiResponse<QuoteEvaluationResponse> saveRevision(@PathVariable UUID quoteId,
                                                             @Valid @RequestBody QuoteDraftRequest request,
                                                             Actor actor) {
        return ApiResponse.of(quoteService.saveDraft(quoteId, request, actor));
    }

    @GetMapping("/{quoteId}/revisions")
    @Transactional(readOnly = true)
    public ApiResponse<List<Map<String, Object>>> revisions(@PathVariable UUID quoteId, Actor actor) {
        Quote quote = quoteService.load(quoteId);
        accessPolicy.requireRead(actor, quote);
        return ApiResponse.of(revisions.findByQuoteIdOrderByRevisionNoDesc(quoteId).stream()
                .map(revision -> Map.<String, Object>of(
                        "id", revision.getId(),
                        "revisionNo", revision.getRevisionNo(),
                        "status", revision.getStatus().name(),
                        "source", revision.getSource().name(),
                        "approvalStatus", revision.getApprovalStatus().name(),
                        "oneTimeNet", Money.toMajor(revision.getOneTimeNetMinor()),
                        "recurringFirstCycleNet", Money.toMajor(revision.getRecurringFirstCycleNetMinor()),
                        "submittedAt", String.valueOf(revision.getSubmittedAt()),
                        "customerAcceptedAt", String.valueOf(revision.getCustomerAcceptedAt()),
                        "current", revision.getId().equals(quote.getCurrentRevisionId())))
                .toList());
    }

    @GetMapping("/{quoteId}/revisions/{revisionId}")
    public ApiResponse<QuoteEvaluationResponse> revision(@PathVariable UUID quoteId,
                                                         @PathVariable UUID revisionId, Actor actor) {
        return ApiResponse.of(quoteService.getRevision(quoteId, revisionId, actor));
    }

    @PostMapping("/{quoteId}/submissions")
    public ApiResponse<QuoteEvaluationResponse> submit(@PathVariable UUID quoteId,
                                                       @Valid @RequestBody SubmitQuoteRequest request,
                                                       Actor actor) {
        return ApiResponse.of(quoteService.submit(quoteId, request, actor));
    }

    @PostMapping("/{quoteId}/shares")
    public ApiResponse<ShareResponse> share(@PathVariable UUID quoteId, Actor actor) {
        return ApiResponse.of(quoteService.share(quoteId, actor));
    }

    @PostMapping("/{quoteId}/adoptions")
    public ApiResponse<QuoteEvaluationResponse> adopt(@PathVariable UUID quoteId,
                                                      @Valid @RequestBody AdoptRevisionRequest request,
                                                      Actor actor) {
        return ApiResponse.of(quoteService.adopt(quoteId, request, actor));
    }

    @PostMapping("/{quoteId}/cancellations")
    public ApiResponse<QuoteEvaluationResponse> cancel(@PathVariable UUID quoteId,
                                                       @RequestBody(required = false) CancelQuoteRequest request,
                                                       Actor actor) {
        CancelQuoteRequest body = request == null ? new CancelQuoteRequest(null, null) : request;
        return ApiResponse.of(quoteService.cancel(quoteId, body, actor));
    }

    /** The attributable history of a deal: who did what, when, and why. */
    @GetMapping("/{quoteId}/history")
    @Transactional(readOnly = true)
    public ApiResponse<List<Map<String, Object>>> history(@PathVariable UUID quoteId, Actor actor) {
        Quote quote = quoteService.load(quoteId);
        accessPolicy.requireRead(actor, quote);
        List<AuditEvent> events = auditEvents.findByQuoteIdOrderByOccurredAtDesc(quoteId);
        Map<UUID, Profile> people = profiles.findAllById(events.stream()
                        .map(AuditEvent::getActorProfileId).filter(java.util.Objects::nonNull)
                        .collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(Profile::getId, profile -> profile));
        return ApiResponse.of(events.stream().map(event -> {
            Profile person = event.getActorProfileId() == null ? null : people.get(event.getActorProfileId());
            return Map.<String, Object>of(
                    "id", event.getId(),
                    "action", event.getAction(),
                    "entityType", event.getEntityType(),
                    "actor", person == null ? event.getActorKind()
                            : (person.getFullName() != null ? person.getFullName() : person.getEmail()),
                    "reason", String.valueOf(event.getReason()),
                    "after", String.valueOf(event.getAfterSummary()),
                    "occurredAt", event.getOccurredAt());
        }).toList());
    }

    // -------------------------------------------------------------- helpers

    private QuoteSummary summarise(Quote quote) {
        QuoteRevision revision = quote.getCurrentRevisionId() == null ? null
                : revisions.findById(quote.getCurrentRevisionId()).orElse(null);
        Customer customer = customers.findById(quote.getCustomerId()).orElse(null);
        Profile owner = profiles.findById(quote.getOwnerProfileId()).orElse(null);
        return new QuoteSummary(quote.getId(), quote.getReference(), quote.getTitle(),
                quote.getCustomerId(), customer == null ? null : customer.getName(),
                quote.getOwnerProfileId(),
                owner == null ? null : (owner.getFullName() != null ? owner.getFullName() : owner.getEmail()),
                quote.getStage().name(),
                revision == null ? "NOT_EVALUATED" : revision.getApprovalStatus().name(),
                revision == null ? "INR" : revision.getCurrency(),
                revision == null ? null : Money.toMajor(revision.getOneTimeNetMinor()),
                revision == null ? null : Money.toMajor(revision.getRecurringFirstCycleNetMinor()),
                revision == null ? null : revision.getMarginPercent(),
                revision == null ? 0 : revision.getRevisionNo(),
                quote.getValidUntil(), quote.getLastActivityAt(), quote.getLastProgressAt(),
                quote.getAwaitingExternalSince(), quote.getRowVersion());
    }

    private static Stage parseStage(String stage) {
        if (stage == null || stage.isBlank()) {
            return null;
        }
        try {
            return Stage.valueOf(stage.toUpperCase(java.util.Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Unknown stage \"" + stage + "\".");
        }
    }
}
