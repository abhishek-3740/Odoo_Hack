package com.dealflow.outbox;

import com.dealflow.auth.Profile;
import com.dealflow.auth.ProfileRepository;
import com.dealflow.auth.Role;
import com.dealflow.config.AppProperties;
import com.dealflow.notifications.DealEventPublisher;
import com.dealflow.notifications.DealEventPublisher.DealEvent;
import com.dealflow.shared.time.BusinessClock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Delivers committed outbox events to WebSocket subscribers.
 *
 * <h2>Recovery, not hope</h2>
 *
 * <p>Events are written in the business transaction and claimed here afterwards,
 * so a crash at any point leaves either an undispatched row (redelivered on the
 * next sweep) or a dispatched one — never a lost notification. Redelivery after
 * a crash between send and mark is possible, which is why every frame carries
 * an event id the client deduplicates on (verification I04).
 *
 * <h2>Recipients are resolved now, not when the event was written</h2>
 *
 * <p>The row carries hints — a customer, an owner, a team, roles. Actual
 * recipients are looked up against current profiles at dispatch time, so a
 * deactivated user stops receiving events immediately and a customer only ever
 * receives events for their own company (verification I05).
 */
@Component
@ConditionalOnProperty(prefix = "dealflow.jobs", name = "enabled", havingValue = "true", matchIfMissing = true)
public class OutboxDispatcher {

    private static final Logger log = LoggerFactory.getLogger(OutboxDispatcher.class);

    private final OutboxEventRepository outbox;
    private final ProfileRepository profiles;
    private final DealEventPublisher publisher;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;
    private final AppProperties properties;

    public OutboxDispatcher(OutboxEventRepository outbox, ProfileRepository profiles,
                            DealEventPublisher publisher, BusinessClock clock,
                            ObjectMapper objectMapper, AppProperties properties) {
        this.outbox = outbox;
        this.profiles = profiles;
        this.publisher = publisher;
        this.clock = clock;
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    /** Short sweep so an approval reaches the screen within a couple of seconds. */
    @Scheduled(fixedDelayString = "PT1S", initialDelayString = "PT5S")
    public void sweep() {
        try {
            int sent = dispatchBatch();
            if (sent > 0) {
                log.debug("Dispatched {} outbox events", sent);
            }
        } catch (Exception ex) {
            // The scheduler must survive a bad batch; the rows stay claimable.
            log.error("Outbox sweep failed", ex);
        }
    }

    /**
     * Claims and delivers one batch in one transaction.
     *
     * <p>{@code FOR UPDATE SKIP LOCKED} lets an overlapping sweep take different
     * rows rather than blocking. Sending happens while the rows are locked, and
     * the lock is a row lock on outbox rows only — never on any business table.
     */
    @Transactional
    public int dispatchBatch() {
        Instant now = clock.now();
        List<OutboxEvent> claimed = outbox.claimDue(now, properties.jobs().outboxBatchSize());
        if (claimed.isEmpty()) {
            return 0;
        }
        int sent = 0;
        for (OutboxEvent event : claimed) {
            try {
                deliver(event, now);
                event.setDispatchedAt(clock.now());
                event.setLeaseUntil(null);
                sent++;
            } catch (Exception ex) {
                scheduleRetry(event, ex, now);
            }
        }
        return sent;
    }

    private void deliver(OutboxEvent event, Instant now) {
        Set<UUID> recipients = resolveRecipients(event.getRecipientScope());
        if (recipients.isEmpty()) {
            return;
        }
        Map<String, Object> payload = parsePayload(event.getPayload());
        DealEvent frame = new DealEvent(event.getId(), event.getEventType(), event.getAggregateType(),
                event.getAggregateId(), event.getAggregateVersion(), event.getCreatedAt(), payload);
        for (UUID recipient : recipients) {
            publisher.sendToProfile(recipient, frame);
        }
    }

    /**
     * Recipient hints intersected with current ownership.
     *
     * <p>A customer id resolves to that customer's active portal identities and
     * no one else's. Role hints resolve to active internal profiles only.
     */
    private Set<UUID> resolveRecipients(String scopeJson) {
        Map<String, Object> scope = parsePayload(scopeJson);
        Set<UUID> recipients = new LinkedHashSet<>();

        Object owner = scope.get("ownerProfileId");
        if (owner != null) {
            profiles.findById(UUID.fromString(owner.toString()))
                    .filter(Profile::isActive)
                    .ifPresent(profile -> recipients.add(profile.getId()));
        }
        Object customer = scope.get("customerId");
        if (customer != null) {
            profiles.findByCustomerId(UUID.fromString(customer.toString())).stream()
                    .filter(Profile::isActive)
                    .filter(profile -> profile.getRole() == Role.CUSTOMER)
                    .forEach(profile -> recipients.add(profile.getId()));
        }
        Object team = scope.get("teamId");
        if (team != null) {
            UUID teamId = UUID.fromString(team.toString());
            profiles.findActiveByRole(Role.MANAGER).stream()
                    .filter(profile -> profile.getTeamId() == null || teamId.equals(profile.getTeamId()))
                    .forEach(profile -> recipients.add(profile.getId()));
        }
        Object roles = scope.get("roles");
        if (roles instanceof List<?> roleNames) {
            for (Object roleName : roleNames) {
                try {
                    Role role = Role.valueOf(roleName.toString());
                    if (role == Role.CUSTOMER) {
                        continue; // Never broadcast to every customer.
                    }
                    profiles.findActiveByRole(role).forEach(profile -> recipients.add(profile.getId()));
                } catch (IllegalArgumentException ignored) {
                    log.warn("Unknown role hint in outbox scope: {}", roleName);
                }
            }
        }
        return recipients;
    }

    /** Exponential backoff, then a visible dead-letter state after the last attempt. */
    private void scheduleRetry(OutboxEvent event, Exception failure, Instant now) {
        int attempts = event.getAttemptCount() + 1;
        event.setAttemptCount(attempts);
        event.setLastError(truncate(failure.getMessage()));
        event.setLeaseUntil(null);

        if (attempts >= properties.jobs().outboxMaxAttempts()) {
            // Parked, not lost: the row and its error stay visible in metrics.
            event.setDispatchedAt(now);
            log.error("Outbox event {} ({}) parked after {} attempts: {}",
                    event.getId(), event.getEventType(), attempts, failure.getMessage());
            return;
        }
        long seconds = Math.min(300, (long) Math.pow(2, attempts));
        event.setNextAttemptAt(now.plus(Duration.ofSeconds(seconds)));
        log.warn("Outbox event {} failed (attempt {}), retrying in {}s: {}",
                event.getId(), attempts, seconds, failure.getMessage());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parsePayload(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            return objectMapper.readValue(json, Map.class);
        } catch (RuntimeException ex) {
            log.warn("Unreadable outbox JSON: {}", ex.getMessage());
            return Map.of();
        }
    }

    private static String truncate(String value) {
        if (value == null) {
            return null;
        }
        return value.length() > 500 ? value.substring(0, 500) : value;
    }
}
