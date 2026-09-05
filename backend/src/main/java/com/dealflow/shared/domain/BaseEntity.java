package com.dealflow.shared.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PrePersist;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Identity and creation stamp for every persisted record.
 *
 * <p>The UUID is assigned in Java rather than by the database. That lets a
 * service build a whole object graph — order, lines, shipments, reservations,
 * invoice, audit rows, outbox event — and wire the references together before a
 * single INSERT is issued, which is what makes the finalisation transaction one
 * flush instead of a dozen round trips.
 */
@MappedSuperclass
public abstract class BaseEntity {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id = UUID.randomUUID();

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void stampCreation() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof BaseEntity that)) {
            return false;
        }
        // Compare on the assigned identifier only: two loaded copies of the same
        // row are the same entity even when their proxies differ.
        return getClass().equals(org.hibernate.Hibernate.getClass(other)) && Objects.equals(id, that.id);
    }

    @Override
    public int hashCode() {
        return Objects.hashCode(id);
    }
}
