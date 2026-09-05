package com.dealflow.shared.audit;

import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditEventRepository extends JpaRepository<AuditEvent, UUID> {

    List<AuditEvent> findByQuoteIdOrderByOccurredAtDesc(UUID quoteId);

    Page<AuditEvent> findByEntityTypeAndEntityIdOrderByOccurredAtDesc(
            String entityType, UUID entityId, Pageable pageable);

    List<AuditEvent> findByOrderIdOrderByOccurredAtDesc(UUID orderId);
}
