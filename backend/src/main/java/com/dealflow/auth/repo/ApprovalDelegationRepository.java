package com.dealflow.auth.repo;


import com.dealflow.auth.models.*;
import com.dealflow.auth.service.*;
import com.dealflow.auth.controller.*;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ApprovalDelegationRepository extends JpaRepository<ApprovalDelegation, UUID> {

    @Query("""
            select d from ApprovalDelegation d
             where d.approverRole = :role
               and d.validFrom <= :now
               and d.validUntil > :now
               and (:teamId is null or d.teamId is null or d.teamId = :teamId)
            """)
    List<ApprovalDelegation> findActive(@Param("role") Role role,
                                        @Param("teamId") UUID teamId,
                                        @Param("now") Instant now);

    List<ApprovalDelegation> findByDelegateProfileId(UUID delegateProfileId);
}
