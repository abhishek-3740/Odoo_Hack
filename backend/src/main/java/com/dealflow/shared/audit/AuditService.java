package com.dealflow.shared.audit;

import com.dealflow.auth.Actor;
import com.dealflow.shared.time.BusinessClock;
import com.dealflow.shared.web.RequestContext;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Writes the audit trail.
 *
 * <p>Deliberately has no {@code @Transactional} of its own: every call joins the
 * caller's transaction. If the business change rolls back, so does its audit
 * row, and the trail never claims something happened that did not.
 */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final AuditEventRepository repository;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;

    public AuditService(AuditEventRepository repository, BusinessClock clock, ObjectMapper objectMapper) {
        this.repository = repository;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    /** Fluent builder so call sites read as a sentence rather than a parameter list. */
    public final class Entry {
        private final AuditEvent event;

        private Entry(AuditEvent event) {
            this.event = event;
        }

        public Entry quote(UUID quoteId) {
            event.setQuoteId(quoteId);
            return this;
        }

        public Entry revision(UUID revisionId) {
            event.setRevisionId(revisionId);
            return this;
        }

        public Entry order(UUID orderId) {
            event.setOrderId(orderId);
            return this;
        }

        public Entry before(Map<String, ?> summary) {
            event.setBeforeSummary(toJson(summary));
            return this;
        }

        public Entry after(Map<String, ?> summary) {
            event.setAfterSummary(toJson(summary));
            return this;
        }

        public Entry reason(String reason) {
            event.setReason(reason);
            return this;
        }

        public AuditEvent save() {
            return repository.save(event);
        }
    }

    public Entry record(Actor actor, String action, String entityType, UUID entityId) {
        AuditEvent event = new AuditEvent(
                actor == null ? null : actor.profileId(),
                actor == null || actor.isSystem() ? "SYSTEM" : "USER",
                action, entityType, entityId, clock.now());
        event.setRequestId(RequestContext.currentRequestId());
        return new Entry(event);
    }

    /** Convenience for scheduled work, which is never attributed to a person. */
    public Entry recordSystem(String action, String entityType, UUID entityId) {
        return record(Actor.system(), action, entityType, entityId);
    }

    private String toJson(Object value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (RuntimeException ex) {
            // A summary that will not serialise must never sink the business
            // transaction that produced it.
            log.warn("Could not serialise audit summary: {}", ex.getMessage());
            return null;
        }
    }
}
