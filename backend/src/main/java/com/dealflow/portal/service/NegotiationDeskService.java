package com.dealflow.portal.service;

import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.outbox.service.OutboxWriter;
import com.dealflow.portal.models.NegotiationRequest;
import com.dealflow.portal.repo.NegotiationRequestRepository;
import com.dealflow.quotes.models.Quote;
import com.dealflow.quotes.models.QuoteEnums.NegotiationStatus;
import com.dealflow.quotes.repo.QuoteRepository;
import com.dealflow.quotes.service.QuoteAccessPolicy;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.time.BusinessClock;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * The seller's side of the deal room: reading what the customer said and
 * answering it in words.
 *
 * <p>A reply here is text only. Changing terms still goes through a revision;
 * agreeing to a counteroffer still goes through adoption. What this adds is the
 * conversational half — so a customer's question does not sit unanswered until
 * the numbers move — and the socket event that makes the answer appear on the
 * customer's screen without a refresh.
 */
@Service
public class NegotiationDeskService {

    public record ReplyRequest(@NotBlank @Size(max = 2000) String message,
                               /* ANSWERED (default) or DECLINED */
                               String decision) {
    }

    public record NegotiationView(UUID id, String requestType, String lineKey, String message, String status,
                                  String responseMessage, UUID revisionId, UUID candidateRevisionId,
                                  String raisedBy, String respondedBy, Instant createdAt, Instant respondedAt,
                                  Map<String, Object> payload) {
    }

    private final NegotiationRequestRepository negotiations;
    private final QuoteRepository quotes;
    private final ProfileRepository profiles;
    private final QuoteAccessPolicy accessPolicy;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;

    public NegotiationDeskService(NegotiationRequestRepository negotiations, QuoteRepository quotes,
                                  ProfileRepository profiles, QuoteAccessPolicy accessPolicy,
                                  AuditService audit, OutboxWriter outbox, BusinessClock clock,
                                  ObjectMapper objectMapper) {
        this.negotiations = negotiations;
        this.quotes = quotes;
        this.profiles = profiles;
        this.accessPolicy = accessPolicy;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    @Transactional(readOnly = true)
    public List<NegotiationView> list(UUID quoteId, Actor actor) {
        Quote quote = quotes.findById(quoteId).orElseThrow(() -> ApiException.notFound("Quotation " + quoteId));
        accessPolicy.requireRead(actor, quote);
        return negotiations.findByQuoteIdOrderByCreatedAtDesc(quoteId).stream().map(this::toView).toList();
    }

    @Transactional
    public NegotiationView reply(UUID quoteId, UUID requestId, ReplyRequest request, Actor actor) {
        Quote quote = quotes.findByIdForUpdate(quoteId)
                .orElseThrow(() -> ApiException.notFound("Quotation " + quoteId));
        accessPolicy.requireAdopt(actor, quote);

        NegotiationRequest record = negotiations.findById(requestId)
                .filter(candidate -> candidate.getQuoteId().equals(quoteId))
                .orElseThrow(() -> ApiException.notFound("Request " + requestId));
        if (record.getStatus() != NegotiationStatus.OPEN && record.getStatus() != NegotiationStatus.ANSWERED) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE,
                    "This request is already " + record.getStatus().name().toLowerCase() + ".");
        }

        NegotiationStatus decision = parseDecision(request.decision());
        Instant now = clock.now();
        record.respond(actor.profileId(), request.message().trim(), decision, now);
        quote.touchActivity(now);

        audit.record(actor, "NEGOTIATION_REPLIED", "NegotiationRequest", record.getId())
                .quote(quote.getId()).revision(record.getRevisionId())
                .after(Map.of("status", decision.name(), "requestType", record.getRequestType().name()))
                .reason(request.message())
                .save();

        outbox.publish(OutboxWriter.Events.NEGOTIATION_UPDATED, "Quote", quote.getId(),
                quote.getRowVersion(),
                Map.of("requestId", record.getId().toString(), "status", decision.name()),
                OutboxWriter.RecipientScope.deal(quote.getCustomerId(), quote.getOwnerProfileId(),
                        quote.getTeamId()));
        return toView(record);
    }

    private static NegotiationStatus parseDecision(String value) {
        if (value == null || value.isBlank()) {
            return NegotiationStatus.ANSWERED;
        }
        try {
            NegotiationStatus status = NegotiationStatus.valueOf(value.toUpperCase(java.util.Locale.ROOT));
            if (status != NegotiationStatus.ANSWERED && status != NegotiationStatus.DECLINED) {
                throw new IllegalArgumentException();
            }
            return status;
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "decision must be ANSWERED or DECLINED.");
        }
    }

    @SuppressWarnings("unchecked")
    private NegotiationView toView(NegotiationRequest record) {
        Map<String, Object> payload;
        try {
            payload = record.getPayload() == null ? Map.of()
                    : objectMapper.readValue(record.getPayload(), Map.class);
        } catch (RuntimeException ex) {
            payload = Map.of();
        }
        return new NegotiationView(record.getId(), record.getRequestType().name(), record.getLineKey(),
                record.getMessage(), record.getStatus().name(), record.getResponseMessage(),
                record.getRevisionId(), record.getCandidateRevisionId(),
                displayName(record.getActorProfileId()), displayName(record.getRespondedByProfileId()),
                record.getCreatedAt(), record.getRespondedAt(), payload);
    }

    private String displayName(UUID profileId) {
        if (profileId == null) {
            return null;
        }
        return profiles.findById(profileId)
                .map(profile -> profile.getFullName() != null ? profile.getFullName() : profile.getEmail())
                .orElse(null);
    }
}
