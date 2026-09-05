package com.dealflow.policy.models;


import com.dealflow.policy.repo.*;
import com.dealflow.policy.service.*;
import com.dealflow.policy.controller.*;
import com.dealflow.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * An immutable version of the discount policy.
 *
 * <p>Editing policy publishes a new row; nothing here is ever updated. That is
 * what lets a submitted revision reference "the policy as it stood at 14:07 on
 * Tuesday" and have that mean something six versions later.
 */
@Entity
@Table(name = "discount_policies")
public class DiscountPolicy extends BaseEntity {

    @Column(name = "version_no", nullable = false, unique = true, updatable = false)
    private int versionNo;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "definition", nullable = false, updatable = false)
    private String definition;

    @Column(name = "effective_at", nullable = false, updatable = false)
    private Instant effectiveAt;

    @Column(name = "note")
    private String note;

    @Column(name = "created_by_profile_id")
    private UUID createdByProfileId;

    protected DiscountPolicy() {
    }

    public DiscountPolicy(int versionNo, String definition, Instant effectiveAt, String note, UUID createdBy) {
        this.versionNo = versionNo;
        this.definition = definition;
        this.effectiveAt = effectiveAt;
        this.note = note;
        this.createdByProfileId = createdBy;
    }

    public int getVersionNo() {
        return versionNo;
    }

    public String getDefinition() {
        return definition;
    }

    public Instant getEffectiveAt() {
        return effectiveAt;
    }

    public String getNote() {
        return note;
    }

    public UUID getCreatedByProfileId() {
        return createdByProfileId;
    }
}
