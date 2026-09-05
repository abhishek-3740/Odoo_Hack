package com.dealflow.billing;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SubscriptionChangeRepository extends JpaRepository<SubscriptionChange, UUID> {

    List<SubscriptionChange> findBySubscriptionIdOrderByEffectiveDateAsc(UUID subscriptionId);

    Optional<SubscriptionChange> findBySubscriptionIdAndRequestKey(UUID subscriptionId, String requestKey);
}
