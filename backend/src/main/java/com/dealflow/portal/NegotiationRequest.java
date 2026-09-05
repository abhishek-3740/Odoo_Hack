package com.dealflow.portal;

import com.dealflow.quotes.QuoteEnums.NegotiationStatus;
import com.dealflow.quotes.QuoteEnums.NegotiationType;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * Something the customer said about a quotation.
 *
 * <p>Three kinds, and the difference matters:
 * <ul>
 *   <li>{@code COMMENT} — a question or note. Changes nothing, invalidates no
 *       approval. A customer writing "can you do better on the setup fee?" has
 *       not proposed terms, and treating that text as an executable discount
 *       would be a serious bug (edge case E18).</li>
 *   <li>{@code CHANGE} — a request to alter one line.</li>
 *   <li>{@code COUNTER} — a proposal of different commercial terms.</li>
 * </ul>
 *
 * <p>The last two create a candidate revision, which is re-priced and re-routed
 * for approval immediately. Neither one executes on its own: the seller must
 * adopt it and the customer must then accept that exact version.
 */
@Entity
@Table(name = "negotiation_requests")
public class NegotiationRequest extends TimestampedEntity {

    @Column(name = "quote_id", nullable = false, updatable = false)
    private UUID quoteId;

    /** The revision the customer was looking at when they raised this. */
    @Column(name = "revision_id", nullable = false, updatable = false)
    private UUID revisionId;

    /** The candidate holding the proposed terms. Null for a plain comment. */
    @Column(name = "candidate_revision_id")
    private UUID candidateRevisionId;

    @Column(name = "actor_profile_id", nullable = false, updatable = false)
    private UUID actorProfileId;

    /** Stable across revisions, so a comment keeps pointing at the same line. */
    @Column(name = "line_key")
    private String lineKey;

    @Enumerated(EnumType.STRING)
    @Column(name = "request_type", nullable = false, updatable = false)
    private NegotiationType requestType;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload", nullable = false)
    private String payload = "{}";

    @Column(name = "message")
    private String message;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false)
    private NegotiationStatus status = NegotiationStatus.OPEN;

    @Column(name = "response_message")
    private String responseMessage;

    @Column(name = "responded_by_profile_id")
    private UUID respondedByProfileId;

    @Column(name = "responded_at")
    private Instant respondedAt;

    protected NegotiationRequest() {
    }

    public NegotiationRequest(UUID quoteId, UUID revisionId, UUID actorProfileId,
                              NegotiationType requestType) {
        this.quoteId = quoteId;
        this.revisionId = revisionId;
        this.actorProfileId = actorProfileId;
        this.requestType = requestType;
    }

    public void respond(UUID profileId, String message, NegotiationStatus newStatus, Instant when) {
        this.respondedByProfileId = profileId;
        this.responseMessage = message;
        this.status = newStatus;
        this.respondedAt = when;
    }

    public UUID getQuoteId() {
        return quoteId;
    }

    public UUID getRevisionId() {
        return revisionId;
    }

    public UUID getCandidateRevisionId() {
        return candidateRevisionId;
    }

    public void setCandidateRevisionId(UUID candidateRevisionId) {
        this.candidateRevisionId = candidateRevisionId;
    }

    public UUID getActorProfileId() {
        return actorProfileId;
    }

    public String getLineKey() {
        return lineKey;
    }

    public void setLineKey(String lineKey) {
        this.lineKey = lineKey;
    }

    public NegotiationType getRequestType() {
        return requestType;
    }

    public String getPayload() {
        return payload;
    }

    public void setPayload(String payload) {
        this.payload = payload;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public NegotiationStatus getStatus() {
        return status;
    }

    public void setStatus(NegotiationStatus status) {
        this.status = status;
    }

    public String getResponseMessage() {
        return responseMessage;
    }

    public UUID getRespondedByProfileId() {
        return respondedByProfileId;
    }

    public Instant getRespondedAt() {
        return respondedAt;
    }
}
