package com.dealflow.notifications;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Component;

/**
 * Pushes a minimal invalidation to one user's private queue.
 *
 * <p>The frame carries an event id, a type, the entity it concerns, a version
 * and a timestamp — and nothing else. No costs, no margins, no quotation body.
 * The client uses it to decide what to refetch through REST, where the
 * authorised view is assembled per role. A client that has already seen a newer
 * version simply ignores the frame.
 */
@Component
public class DealEventPublisher {

    /** The wire shape. Stable field names; part of the frontend contract. */
    public record DealEvent(UUID eventId, String type, String entityType, UUID entityId,
                            long version, Instant occurredAt, Map<String, Object> payload) {
    }

    private final SimpMessagingTemplate messaging;

    public DealEventPublisher(SimpMessagingTemplate messaging) {
        this.messaging = messaging;
    }

    /**
     * @param profileId the recipient; matches {@code Principal.getName()} on the
     *                  authenticated STOMP session, so only that session receives it
     */
    public void sendToProfile(UUID profileId, DealEvent event) {
        messaging.convertAndSendToUser(profileId.toString(), "/queue/deal-events", event);
    }
}
