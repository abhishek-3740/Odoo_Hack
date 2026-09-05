package com.dealflow.approvals.repo;


import com.dealflow.approvals.models.*;
import com.dealflow.approvals.service.*;
import com.dealflow.approvals.dto.*;
import com.dealflow.approvals.controller.*;
import com.dealflow.approvals.models.ApprovalRequest;
import com.dealflow.auth.models.Role;
import com.dealflow.quotes.models.QuoteEnums.ApprovalRequestStatus;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ApprovalRequestRepository extends JpaRepository<ApprovalRequest, UUID> {

    List<ApprovalRequest> findByRevisionIdOrderByStepAsc(UUID revisionId);

    List<ApprovalRequest> findByQuoteIdOrderByCreatedAtDesc(UUID quoteId);

    Optional<ApprovalRequest> findByRevisionIdAndStep(UUID revisionId, int step);

    /**
     * Locks one step for a decision.
     *
     * <p>Combined with the aggregate lock on the quotation, this is what makes a
     * terminal decision immutable: a second approve-or-reject on the same step
     * finds it already decided and is refused, rather than overwriting the
     * first (edge case E05).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from ApprovalRequest a where a.id = :id")
    Optional<ApprovalRequest> findByIdForUpdate(@Param("id") UUID id);

    @Query("""
            select a from ApprovalRequest a
             where a.status = com.dealflow.quotes.models.QuoteEnums.ApprovalRequestStatus.PENDING
               and a.revisionId in :revisionIds
            """)
    List<ApprovalRequest> findPendingForRevisions(@Param("revisionIds") List<UUID> revisionIds);

    /** Every step still waiting for a decision, for the health sweep. */
    @Query("""
            select a from ApprovalRequest a
             where a.status = com.dealflow.quotes.models.QuoteEnums.ApprovalRequestStatus.PENDING
            """)
    List<ApprovalRequest> findAllPending();

    /**
     * The approver's queue.
     *
     * <p>Scoped by role and, for a manager with a team, by that team. An
     * unassigned step is visible to every qualified approver so that a leave of
     * absence does not silently park work in one person's inbox.
     */
    @Query("""
            select a from ApprovalRequest a
             where a.status = :status
               and (:requiredRole is null or a.requiredRole = :requiredRole)
               and (:teamId is null or a.teamId is null or a.teamId = :teamId)
               and (:assigneeProfileId is null or a.assigneeProfileId is null
                    or a.assigneeProfileId = :assigneeProfileId)
            """)
    Page<ApprovalRequest> queue(@Param("status") ApprovalRequestStatus status,
                                @Param("requiredRole") Role requiredRole,
                                @Param("teamId") UUID teamId,
                                @Param("assigneeProfileId") UUID assigneeProfileId,
                                Pageable pageable);

    @Query("""
            select a from ApprovalRequest a
             where a.status = com.dealflow.quotes.models.QuoteEnums.ApprovalRequestStatus.PENDING
               and a.dueAt is not null
               and a.dueAt < :now
            """)
    List<ApprovalRequest> findOverdue(@Param("now") Instant now);

    long countByStatusAndRequiredRole(ApprovalRequestStatus status, Role requiredRole);

    /** Explicit quote ownership/team scope for assistant summaries. */
    @Query("""
            select a from ApprovalRequest a join Quote q on q.id = a.quoteId
             where a.status = com.dealflow.quotes.models.QuoteEnums.ApprovalRequestStatus.PENDING
               and (:requiredRole is null or a.requiredRole = :requiredRole)
               and (:ownerId is null or q.ownerProfileId = :ownerId)
               and (:teamId is null or q.teamId = :teamId)
            """)
    Page<ApprovalRequest> pendingForWorkspace(@Param("requiredRole") Role requiredRole,
            @Param("ownerId") UUID ownerId, @Param("teamId") UUID teamId, Pageable pageable);
}
