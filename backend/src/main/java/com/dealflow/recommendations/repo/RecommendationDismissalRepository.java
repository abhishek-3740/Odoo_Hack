package com.dealflow.recommendations.repo;


import com.dealflow.recommendations.models.*;
import com.dealflow.recommendations.service.*;
import com.dealflow.recommendations.controller.*;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RecommendationDismissalRepository extends JpaRepository<RecommendationDismissal, UUID> {

    List<RecommendationDismissal> findByRevisionId(UUID revisionId);

    Optional<RecommendationDismissal> findByRevisionIdAndVariantId(UUID revisionId, UUID variantId);
}
