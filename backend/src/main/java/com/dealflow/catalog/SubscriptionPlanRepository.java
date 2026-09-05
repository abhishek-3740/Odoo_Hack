package com.dealflow.catalog;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SubscriptionPlanRepository extends JpaRepository<SubscriptionPlan, UUID> {

    Optional<SubscriptionPlan> findByCode(String code);

    List<SubscriptionPlan> findByActiveTrueOrderByNameAsc();

    List<SubscriptionPlan> findByProductIdAndActiveTrue(UUID productId);
}
