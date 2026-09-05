package com.dealflow.outbox;

import com.dealflow.shared.time.BusinessClock;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Records notification events inside the business transaction.
 *
 * <p>No {@code @Transactional} here on purpose — every call joins the caller's
 * transaction, which is the entire point: the event and the change it announces
 * commit together or not at all. There is no window in which an approval is
 * recorded but its notification is lost, and none in which a notification goes
 * out for an approval that then rolled back.
 */
@Service
public class OutboxWriter {

    /** Event types the frontend subscribes to. Stable strings; part of the contract. */
    public static final class Events {
        public static final String QUOTE_REVISED = "QUOTE_REVISED";
        public static final String QUOTE_SUBMITTED = "QUOTE_SUBMITTED";
        public static final String APPROVAL_UPDATED = "APPROVAL_UPDATED";
        public static final String NEGOTIATION_UPDATED = "NEGOTIATION_UPDATED";
        public static final String ORDER_CREATED = "ORDER_CREATED";
        public static final String ALLOCATION_UPDATED = "ALLOCATION_UPDATED";
        public static final String BACKORDER_UPDATED = "BACKORDER_UPDATED";
        public static final String INVOICE_UPDATED = "INVOICE_UPDATED";
        public static final String SUBSCRIPTION_UPDATED = "SUBSCRIPTION_UPDATED";
        public static final String ALERT_UPDATED = "ALERT_UPDATED";
        public static final String STOCK_UPDATED = "STOCK_UPDATED";

        private Events() {
        }
    }

    private final OutboxEventRepository repository;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;

    public OutboxWriter(OutboxEventRepository repository, BusinessClock clock, ObjectMapper objectMapper) {
        this.repository = repository;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    /**
     * @param aggregateVersion the row version the change produced; a client that
     *                         has already seen a newer version ignores this event
     *                         rather than refetching for nothing
     * @param scope            recipient hints (customer id, owner id, roles),
     *                         re-resolved against live ownership at dispatch
     */
    public OutboxEvent publish(String eventType, String aggregateType, UUID aggregateId,
                               long aggregateVersion, Map<String, ?> payload, RecipientScope scope) {
        return repository.save(new OutboxEvent(
                eventType, aggregateType, aggregateId, aggregateVersion,
                json(payload), json(scope == null ? RecipientScope.internalOnly().asMap() : scope.asMap()),
                clock.now()));
    }

    public OutboxEvent publish(String eventType, String aggregateType, UUID aggregateId,
                               long aggregateVersion, RecipientScope scope) {
        return publish(eventType, aggregateType, aggregateId, aggregateVersion, Map.of(), scope);
    }

    /**
     * Who should hear about an event.
     *
     * <p>A customer id here means "the portal identities of that customer", and
     * nothing else. It never widens delivery — the dispatcher intersects this
     * with current database ownership before sending anything.
     */
    public record RecipientScope(UUID customerId, UUID ownerProfileId, UUID teamId,
                                 java.util.List<String> roles) {

        public static RecipientScope internalOnly() {
            return new RecipientScope(null, null, null, java.util.List.of());
        }

        public static RecipientScope owner(UUID ownerProfileId) {
            return new RecipientScope(null, ownerProfileId, null, java.util.List.of());
        }

        public static RecipientScope deal(UUID customerId, UUID ownerProfileId, UUID teamId) {
            return new RecipientScope(customerId, ownerProfileId, teamId, java.util.List.of());
        }

        public static RecipientScope roles(String... roles) {
            return new RecipientScope(null, null, null, java.util.List.of(roles));
        }

        public RecipientScope andRoles(String... extraRoles) {
            return new RecipientScope(customerId, ownerProfileId, teamId, java.util.List.of(extraRoles));
        }

        Map<String, Object> asMap() {
            Map<String, Object> map = new LinkedHashMap<>();
            if (customerId != null) {
                map.put("customerId", customerId.toString());
            }
            if (ownerProfileId != null) {
                map.put("ownerProfileId", ownerProfileId.toString());
            }
            if (teamId != null) {
                map.put("teamId", teamId.toString());
            }
            if (roles != null && !roles.isEmpty()) {
                map.put("roles", roles);
            }
            return map;
        }
    }

    private String json(Object value) {
        return objectMapper.writeValueAsString(value == null ? Map.of() : value);
    }
}
