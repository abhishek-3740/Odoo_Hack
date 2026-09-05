package com.dealflow.outbox;

import com.dealflow.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A committed notification, waiting to be delivered.
 *
 * <p>Written inside the business transaction. A WebSocket frame is never the
 * source of truth for anything, so if the process dies between committing an
 * approval and pushing the notification, the row is still here and the
 * dispatcher picks it up on the next sweep.
 *
 * <p>Payloads stay minimal on purpose — an id, a type, an entity reference and a
 * version. Costs, margins and quotation bodies never travel in a push frame;
 * the client is told something changed and refetches the view it is allowed to
 * see.
 */
@Entity
@Table(name = "outbox_events")
public class OutboxEvent extends BaseEntity {

    @Column(name = "event_type", nullable = false, updatable = false)
    private String eventType;

    @Column(name = "aggregate_type", nullable = false, updatable = false)
    private String aggregateType;

    @Column(name = "aggregate_id", nullable = false, updatable = false)
    private UUID aggregateId;

    @Column(name = "aggregate_version", nullable = false)
    private long aggregateVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload", nullable = false)
    private String payload = "{}";

    /** Hints for recipient resolution; ownership is re-checked at dispatch time. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "recipient_scope", nullable = false)
    private String recipientScope = "{}";

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "next_attempt_at", nullable = false)
    private Instant nextAttemptAt;

    @Column(name = "lease_until")
    private Instant leaseUntil;

    @Column(name = "dispatched_at")
    private Instant dispatchedAt;

    @Column(name = "last_error")
    private String lastError;

    protected OutboxEvent() {
    }

    public OutboxEvent(String eventType, String aggregateType, UUID aggregateId, long aggregateVersion,
                       String payload, String recipientScope, Instant createdAt) {
        this.eventType = eventType;
        this.aggregateType = aggregateType;
        this.aggregateId = aggregateId;
        this.aggregateVersion = aggregateVersion;
        this.payload = payload == null ? "{}" : payload;
        this.recipientScope = recipientScope == null ? "{}" : recipientScope;
        this.nextAttemptAt = createdAt;
        setCreatedAt(createdAt);
    }

    public String getEventType() {
        return eventType;
    }

    public String getAggregateType() {
        return aggregateType;
    }

    public UUID getAggregateId() {
        return aggregateId;
    }

    public long getAggregateVersion() {
        return aggregateVersion;
    }

    public String getPayload() {
        return payload;
    }

    public String getRecipientScope() {
        return recipientScope;
    }

    public int getAttemptCount() {
        return attemptCount;
    }

    public void setAttemptCount(int attemptCount) {
        this.attemptCount = attemptCount;
    }

    public Instant getNextAttemptAt() {
        return nextAttemptAt;
    }

    public void setNextAttemptAt(Instant nextAttemptAt) {
        this.nextAttemptAt = nextAttemptAt;
    }

    public Instant getLeaseUntil() {
        return leaseUntil;
    }

    public void setLeaseUntil(Instant leaseUntil) {
        this.leaseUntil = leaseUntil;
    }

    public Instant getDispatchedAt() {
        return dispatchedAt;
    }

    public void setDispatchedAt(Instant dispatchedAt) {
        this.dispatchedAt = dispatchedAt;
    }

    public String getLastError() {
        return lastError;
    }

    public void setLastError(String lastError) {
        this.lastError = lastError;
    }
}
