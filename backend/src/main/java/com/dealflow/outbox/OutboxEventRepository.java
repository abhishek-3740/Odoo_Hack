package com.dealflow.outbox;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, UUID> {

    /**
     * Claims a batch of due events for this dispatcher.
     *
     * <p>{@code FOR UPDATE SKIP LOCKED} lets a second sweep — or a second
     * process — take different rows instead of queuing behind the first. The
     * lease column is a belt-and-braces guard for a dispatcher that dies holding
     * rows: the lease expires and the work becomes claimable again.
     */
    @Query(value = """
            select * from dealflow.outbox_events
             where dispatched_at is null
               and next_attempt_at <= :now
               and (lease_until is null or lease_until < :now)
             order by created_at asc
             limit :batchSize
             for update skip locked
            """, nativeQuery = true)
    List<OutboxEvent> claimDue(@Param("now") Instant now, @Param("batchSize") int batchSize);

    @Modifying
    @Query("update OutboxEvent e set e.leaseUntil = :leaseUntil where e.id in :ids")
    void lease(@Param("ids") List<UUID> ids, @Param("leaseUntil") Instant leaseUntil);

    long countByDispatchedAtIsNull();

    @Query("select min(e.createdAt) from OutboxEvent e where e.dispatchedAt is null")
    Instant oldestUndispatchedAt();
}
