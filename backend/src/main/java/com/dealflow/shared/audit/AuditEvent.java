package com.dealflow.shared.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

/**
 * An append-only record of who changed what.
 *
 * <p>Written in the same transaction as the change it describes, so an audit row
 * and the state it records either both exist or neither does. Nothing updates or
 * deletes these rows.
 *
 * <p>Deliberately not a {@code BaseEntity}: an audit event has exactly one
 * timestamp, the moment it {@code occurred_at}, and a second "created" stamp
 * would only ever duplicate it.
 */
@Entity
@Table(name = "audit_events")
public class AuditEvent implements Persistable<UUID> {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id = UUID.randomUUID();

    /** See {@code BaseEntity}: a pre-assigned id must still persist, not merge. */
    @Transient
    private boolean persisted;

    @PostPersist
    @PostLoad
    void markPersisted() {
        persisted = true;
    }

    @Override
    @Transient
    public boolean isNew() {
        return !persisted;
    }

    @Column(name = "actor_profile_id")
    private UUID actorProfileId;

    /** SYSTEM for scheduled work. A job never signs an action with a person's name. */
    @Column(name = "actor_kind", nullable = false)
    private String actorKind = "USER";

    @Column(name = "action", nullable = false)
    private String action;

    @Column(name = "entity_type", nullable = false)
    private String entityType;

    @Column(name = "entity_id")
    private UUID entityId;

    @Column(name = "quote_id")
    private UUID quoteId;

    @Column(name = "revision_id")
    private UUID revisionId;

    @Column(name = "order_id")
    private UUID orderId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_summary")
    private String beforeSummary;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_summary")
    private String afterSummary;

    @Column(name = "reason")
    private String reason;

    @Column(name = "request_id")
    private String requestId;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    protected AuditEvent() {
    }

    public AuditEvent(UUID actorProfileId, String actorKind, String action, String entityType,
                      UUID entityId, Instant occurredAt) {
        this.actorProfileId = actorProfileId;
        this.actorKind = actorKind;
        this.action = action;
        this.entityType = entityType;
        this.entityId = entityId;
        this.occurredAt = occurredAt;
    }

    @Override
    public UUID getId() {
        return id;
    }

    public void setQuoteId(UUID quoteId) {
        this.quoteId = quoteId;
    }

    public void setRevisionId(UUID revisionId) {
        this.revisionId = revisionId;
    }

    public void setOrderId(UUID orderId) {
        this.orderId = orderId;
    }

    public void setBeforeSummary(String beforeSummary) {
        this.beforeSummary = beforeSummary;
    }

    public void setAfterSummary(String afterSummary) {
        this.afterSummary = afterSummary;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }

    public void setRequestId(String requestId) {
        this.requestId = requestId;
    }

    public UUID getActorProfileId() {
        return actorProfileId;
    }

    public String getActorKind() {
        return actorKind;
    }

    public String getAction() {
        return action;
    }

    public String getEntityType() {
        return entityType;
    }

    public UUID getEntityId() {
        return entityId;
    }

    public UUID getQuoteId() {
        return quoteId;
    }

    public UUID getRevisionId() {
        return revisionId;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public String getReason() {
        return reason;
    }

    public String getBeforeSummary() {
        return beforeSummary;
    }

    public String getAfterSummary() {
        return afterSummary;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }

    public String getRequestId() {
        return requestId;
    }

    @Override
    public boolean equals(Object other) {
        return this == other || (other instanceof AuditEvent that && Objects.equals(id, that.id));
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }
}
