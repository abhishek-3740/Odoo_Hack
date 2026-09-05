package com.dealflow.health.repo;


import com.dealflow.health.models.*;
import com.dealflow.health.service.*;
import com.dealflow.health.controller.*;
import com.dealflow.health.models.AlertEnums.AlertStatus;
import com.dealflow.health.models.AlertEnums.AlertType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AlertRepository extends JpaRepository<Alert, UUID> {

    Optional<Alert> findByDedupeKey(String dedupeKey);

    List<Alert> findByStatus(AlertStatus status);

    List<Alert> findByAlertTypeAndStatus(AlertType alertType, AlertStatus status);

    @Query("""
            select a from Alert a
             where (:status is null or a.status = :status)
               and (:alertType is null or a.alertType = :alertType)
               and (:ownerProfileId is null or a.ownerProfileId = :ownerProfileId)
               and (:teamId is null or a.teamId is null or a.teamId = :teamId)
             order by a.severity desc, a.lastSeenAt desc
            """)
    Page<Alert> search(@Param("status") AlertStatus status,
                       @Param("alertType") AlertType alertType,
                       @Param("ownerProfileId") UUID ownerProfileId,
                       @Param("teamId") UUID teamId,
                       Pageable pageable);

    List<Alert> findByQuoteIdAndStatus(UUID quoteId, AlertStatus status);
}
