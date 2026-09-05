package com.dealflow.health;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {

    Page<Notification> findByRecipientProfileIdOrderByCreatedAtDesc(UUID recipientProfileId,
                                                                   Pageable pageable);

    List<Notification> findByRecipientProfileIdAndReadAtIsNull(UUID recipientProfileId);

    Optional<Notification> findByRecipientProfileIdAndDedupeKey(UUID recipientProfileId,
                                                               String dedupeKey);

    long countByRecipientProfileIdAndReadAtIsNull(UUID recipientProfileId);
}
