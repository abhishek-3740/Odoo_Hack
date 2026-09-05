package com.dealflow.policy;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface DiscountPolicyRepository extends JpaRepository<DiscountPolicy, UUID> {

    Optional<DiscountPolicy> findByVersionNo(int versionNo);

    /** The version in force at a moment: latest effective_at not in the future. */
    @Query("""
            select p from DiscountPolicy p
             where p.effectiveAt <= :at
             order by p.effectiveAt desc, p.versionNo desc
            """)
    List<DiscountPolicy> findEffectiveAt(@Param("at") Instant at, Limit limit);

    @Query("select coalesce(max(p.versionNo), 0) from DiscountPolicy p")
    int findMaxVersionNo();

    List<DiscountPolicy> findAllByOrderByVersionNoDesc();
}
