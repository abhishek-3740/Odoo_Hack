package com.dealflow.shared.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Id;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Transient;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.springframework.data.domain.Persistable;

/**
 * Identity and creation stamp for every persisted record.
 *
 * <p>The UUID is assigned in Java rather than by the database. That lets a
 * service build a whole object graph — order, lines, shipments, reservations,
 * invoice, audit rows, outbox event — and wire the references together before a
 * single INSERT is issued, which is what makes the finalisation transaction one
 * flush instead of a dozen round trips.
 *
 * <h2>Why this implements {@link Persistable}</h2>
 *
 * <p>Spring Data decides between {@code persist} and {@code merge} by asking
 * whether an entity is new, and its default answer for an entity that already
 * has an id is "no". A pre-assigned UUID would therefore route every
 * {@code save()} of a brand-new object through {@code merge}, which copies the
 * state into a <em>different</em> managed instance and leaves the caller
 * holding a detached one — so any field set after {@code save()} is silently
 * lost. Answering the question explicitly, with a flag that flips once the row
 * exists, keeps the instance the service is working on managed.
 */
@MappedSuperclass
public abstract class BaseEntity implements Persistable<UUID> {

    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id = UUID.randomUUID();

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** True once the row exists in the database. Never mapped to a column. */
    @Transient
    private boolean persisted;

    @PrePersist
    void stampCreation() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    @PostPersist
    @PostLoad
    void markPersisted() {
        persisted = true;
    }

    @Override
    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    @Override
    @Transient
    public boolean isNew() {
        return !persisted;
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
