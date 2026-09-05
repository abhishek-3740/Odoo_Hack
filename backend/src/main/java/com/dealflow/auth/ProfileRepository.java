package com.dealflow.auth;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface ProfileRepository extends JpaRepository<Profile, UUID> {

    Optional<Profile> findByAuthUserId(UUID authUserId);

    Optional<Profile> findByEmailIgnoreCase(String email);

    List<Profile> findByCustomerId(UUID customerId);

    Page<Profile> findByRole(Role role, Pageable pageable);

    /**
     * Approvers who could take a step right now: correct role, active, not on
     * leave, and — when the step is team-scoped — on that team. An empty result
     * is a real operational condition (raise NO_APPROVER), never a reason to let
     * the quotation through unapproved.
     */
    @Query("""
            select p from Profile p
             where p.role = :role
               and p.active = true
               and (p.unavailableUntil is null or p.unavailableUntil < :now)
               and (:teamId is null or p.teamId = :teamId)
             order by p.fullName asc
            """)
    List<Profile> findAvailableApprovers(@Param("role") Role role,
                                         @Param("teamId") UUID teamId,
                                         @Param("now") Instant now);

    @Query("""
            select p from Profile p
             where p.role = :role
               and p.active = true
             order by p.fullName asc
            """)
    List<Profile> findActiveByRole(@Param("role") Role role);
}
