package com.dealflow.shared.domain;

import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import java.time.Instant;

/** Adds a last-modified stamp. The database keeps its own trigger for native writes. */
@MappedSuperclass
public abstract class TimestampedEntity extends BaseEntity {

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    @PreUpdate
    void stampUpdate() {
        updatedAt = Instant.now();
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
