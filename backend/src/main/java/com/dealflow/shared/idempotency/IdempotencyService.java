package com.dealflow.shared.idempotency;

import com.dealflow.auth.models.Actor;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.time.BusinessClock;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Tuple;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/**
 * Makes a repeated request harmless.
 *
 * <p>A triple-clicked counteroffer, a retried payment, a browser that resends on
 * a flaky connection — each must produce exactly one approval chain, one
 * payment, one order. The client sends the same {@code Idempotency-Key} for all
 * attempts at one logical action and gets the same answer back every time.
 *
 * <h2>How the race is actually closed</h2>
 *
 * <p>The claim is a single statement:
 *
 * <pre>
 *   INSERT ... ON CONFLICT (actor, operation, key) DO UPDATE SET updated_at = now()
 *   RETURNING ..., (xmax = 0) AS inserted
 * </pre>
 *
 * <p>Three properties make this work where a read-then-write cannot:
 * <ul>
 *   <li>{@code DO UPDATE} — not {@code DO NOTHING} — takes a row lock on the
 *       conflicting row, so a concurrent duplicate <em>blocks</em> until the
 *       first request commits, then sees its stored result. With
 *       {@code DO NOTHING} the second request would see no row and no lock, and
 *       both would proceed.</li>
 *   <li>{@code xmax = 0} distinguishes a fresh insert from a conflict, which a
 *       plain upsert cannot report.</li>
 *   <li>It runs in the caller's transaction, alongside the business write. If
 *       the work rolls back, the claim rolls back with it and a retry is free to
 *       start over — the key is not burned by a failure.</li>
 * </ul>
 *
 * <p>Reusing a key with a <em>different</em> body is refused outright. Returning
 * the first result would answer a question nobody asked, and executing the new
 * body would defeat the point of the key.
 */
@Service
public class IdempotencyService {

    private static final Logger log = LoggerFactory.getLogger(IdempotencyService.class);

    /** A claim left IN_PROGRESS beyond this is treated as an abandoned crash. */
    private static final Duration STALE_CLAIM_AFTER = Duration.ofMinutes(10);

    @PersistenceContext
    private EntityManager entityManager;

    private final BusinessClock clock;
    private final ObjectMapper objectMapper;

    public IdempotencyService(BusinessClock clock, ObjectMapper objectMapper) {
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    /**
     * Runs {@code action} at most once per key.
     *
     * <p>Must be called from inside a transaction — the claim and the mutation
     * share it by design.
     *
     * @param key    the client's {@code Idempotency-Key}; required
     * @param body   the request, hashed to detect key reuse with different content
     * @param action the work to perform; its result is stored and replayed
     */
    @org.springframework.transaction.annotation.Transactional(rollbackFor = Exception.class)
    public <T> T execute(Actor actor, String operation, String key, Object body,
                         Class<T> resultType, Supplier<T> action) {
        if (key == null || key.isBlank()) {
            throw new ApiException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
                    "This operation requires an Idempotency-Key header.");
        }
        if (actor == null || actor.profileId() == null) {
            throw new ApiException(ErrorCode.UNAUTHENTICATED);
        }

        String requestHash = hash(body);
        Instant now = clock.now();
        Claim claim = claim(actor.profileId(), operation, key.trim(), requestHash, now);

        if (!claim.fresh()) {
            if (!claim.requestHash().equals(requestHash)) {
                log.warn("Idempotency key reused with a different body for operation {}", operation);
                throw new ApiException(ErrorCode.IDEMPOTENCY_KEY_REUSED,
                        "This request key was already used for a different request.");
            }
            if ("COMPLETED".equals(claim.status())) {
                return replay(claim, resultType);
            }
            // IN_PROGRESS and visible means the original transaction committed the
            // claim but never finished — only possible after a crash. Anything
            // recent is still genuinely in flight behind the row lock.
            if (claim.updatedAt() != null
                    && Duration.between(claim.updatedAt(), now).compareTo(STALE_CLAIM_AFTER) < 0) {
                throw new ApiException(ErrorCode.IDEMPOTENT_REQUEST_IN_PROGRESS,
                        "An identical request is still being processed. Try again shortly.");
            }
            log.warn("Taking over an abandoned idempotency claim for operation {}", operation);
        }

        T result = action.get();
        complete(claim.id(), result);
        return result;
    }

    /** Same contract, for commands whose result the client does not need echoed. */
    @org.springframework.transaction.annotation.Transactional(rollbackFor = Exception.class)
    public void executeVoid(Actor actor, String operation, String key, Object body, Runnable action) {
        execute(actor, operation, key, body, Void.class, () -> {
            action.run();
            return null;
        });
    }

    // --------------------------------------------------------------- internals

    private record Claim(UUID id, boolean fresh, String status, String requestHash,
                         Integer responseStatus, String responseBody, Instant updatedAt) {
    }

    private Claim claim(UUID actorProfileId, String operation, String key, String requestHash, Instant now) {
        Tuple row = (Tuple) entityManager.createNativeQuery("""
                insert into dealflow.idempotency_requests
                    (id, actor_profile_id, operation, idempotency_key, request_hash,
                     status, created_at, updated_at)
                values (:id, :actorProfileId, :operation, :key, :requestHash, 'IN_PROGRESS', :now, :now)
                on conflict (actor_profile_id, operation, idempotency_key)
                    do update set updated_at = dealflow.idempotency_requests.updated_at
                returning id, status, request_hash, response_status, response_body,
                          updated_at, (xmax = 0) as inserted
                """, Tuple.class)
                .setParameter("id", UUID.randomUUID())
                .setParameter("actorProfileId", actorProfileId)
                .setParameter("operation", operation)
                .setParameter("key", key)
                .setParameter("requestHash", requestHash)
                .setParameter("now", now)
                .getSingleResult();

        return new Claim(
                (UUID) row.get("id"),
                (Boolean) row.get("inserted"),
                (String) row.get("status"),
                (String) row.get("request_hash"),
                (Integer) row.get("response_status"),
                (String) row.get("response_body"),
                toInstant(row.get("updated_at")));
    }

    private void complete(UUID claimId, Object result) {
        entityManager.createNativeQuery("""
                update dealflow.idempotency_requests
                   set status = 'COMPLETED',
                       response_status = 200,
                       response_body = :body,
                       updated_at = :now
                 where id = :id
                """)
                .setParameter("body", result == null ? null : objectMapper.writeValueAsString(result))
                .setParameter("now", clock.now())
                .setParameter("id", claimId)
                .executeUpdate();
    }

    private <T> T replay(Claim claim, Class<T> resultType) {
        if (claim.responseBody() == null || resultType == Void.class) {
            return null;
        }
        try {
            return objectMapper.readValue(claim.responseBody(), resultType);
        } catch (RuntimeException ex) {
            // The stored result no longer matches the current DTO shape, which
            // means a deploy changed it. Reporting a conflict is honest; silently
            // re-running a payment would not be.
            log.warn("Stored idempotent result could not be replayed: {}", ex.getMessage());
            throw new ApiException(ErrorCode.CONFLICTING_STATE,
                    "This request already completed, but its saved result can no longer be returned. "
                            + "Refresh to see the current state.");
        }
    }

    /**
     * Canonical hash of the request body.
     *
     * <p>Serialised through the same mapper the API uses, so equivalent bodies
     * hash equally regardless of incidental key ordering in the JSON the client
     * happened to send.
     */
    private String hash(Object body) {
        String canonical = body == null ? "" : objectMapper.writeValueAsString(body);
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable", ex);
        }
    }

    private static Instant toInstant(Object value) {
        return switch (value) {
            case null -> null;
            case Instant instant -> instant;
            case java.sql.Timestamp timestamp -> timestamp.toInstant();
            case java.time.OffsetDateTime offset -> offset.toInstant();
            default -> null;
        };
    }
}
