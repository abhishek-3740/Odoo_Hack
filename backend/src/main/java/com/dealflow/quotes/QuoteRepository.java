package com.dealflow.quotes;

import com.dealflow.quotes.QuoteEnums.Stage;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface QuoteRepository extends JpaRepository<Quote, UUID> {

    Optional<Quote> findByReference(String reference);

    /**
     * Takes a write lock on the quotation aggregate.
     *
     * <p>Every command that can change the outcome of a deal — submitting,
     * approving, adopting, accepting, finalising — goes through here first.
     * Serialising on this one row is what stops a manager approval and a finance
     * rejection from both committing against the same step (edge case E05).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select q from Quote q where q.id = :id")
    Optional<Quote> findByIdForUpdate(@Param("id") UUID id);

    @Query("""
            select q from Quote q
             where (:ownerProfileId is null or q.ownerProfileId = :ownerProfileId)
               and (:teamId is null or q.teamId = :teamId)
               and (:customerId is null or q.customerId = :customerId)
               and (:stage is null or q.stage = :stage)
            """)
    Page<Quote> search(@Param("ownerProfileId") UUID ownerProfileId,
                       @Param("teamId") UUID teamId,
                       @Param("customerId") UUID customerId,
                       @Param("stage") Stage stage,
                       Pageable pageable);

    List<Quote> findByCustomerIdOrderByCreatedAtDesc(UUID customerId);

    Page<Quote> findByCustomerId(UUID customerId, Pageable pageable);

    /**
     * Open quotations whose external wait started before a cut-off.
     *
     * <p>Deliberately keyed on {@code awaitingExternalSince}, not on
     * {@code lastActivityAt}: a rep editing their own quotation every day is not
     * progress and must not hide a stalled deal (edge case E22).
     */
    @Query("""
            select q from Quote q
             where q.stage in :openStages
               and q.awaitingExternalSince is not null
               and q.awaitingExternalSince < :cutoff
            """)
    List<Quote> findStalled(@Param("openStages") List<Stage> openStages, @Param("cutoff") Instant cutoff);

    @Query("""
            select q from Quote q
             where q.stage in :openStages
               and q.validUntil is not null
               and q.validUntil < :businessDate
            """)
    List<Quote> findExpired(@Param("openStages") List<Stage> openStages,
                            @Param("businessDate") LocalDate businessDate);

    @Query(value = "select nextval('dealflow.quote_reference_seq')", nativeQuery = true)
    long nextReferenceNumber();

    long countByStage(Stage stage);

    @Query("""
            select q from Quote q
             where q.createdAt >= :from and q.createdAt < :to
               and (:ownerProfileId is null or q.ownerProfileId = :ownerProfileId)
               and (:teamId is null or q.teamId = :teamId)
             order by q.createdAt desc
            """)
    List<Quote> findCreatedBetween(@Param("from") Instant from,
                                   @Param("to") Instant to,
                                   @Param("ownerProfileId") UUID ownerProfileId,
                                   @Param("teamId") UUID teamId);
}
