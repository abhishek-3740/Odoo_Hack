package com.dealflow.recommendations;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RecommendationDismissalRepository extends JpaRepository<RecommendationDismissal, UUID> {

    List<RecommendationDismissal> findByRevisionId(UUID revisionId);

    Optional<RecommendationDismissal> findByRevisionIdAndVariantId(UUID revisionId, UUID variantId);
}
