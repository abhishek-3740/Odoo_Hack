package com.dealflow.auth.models;


import com.dealflow.auth.repo.*;
import com.dealflow.auth.service.*;
import com.dealflow.auth.controller.*;
import com.dealflow.shared.domain.TimestampedEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * A person's workspace identity.
 *
 * <p>{@code authUserId} mirrors the Supabase {@code auth.users} id but carries
 * no foreign key: the identity provider lives outside this schema, and the same
 * migrations have to apply to a bare PostgreSQL container in the tests. It is
 * nullable so an administrator can provision a profile by email before the
 * person ever signs in; the first verified token for that email binds it.
 */
@Entity
@Table(name = "profiles")
public class Profile extends TimestampedEntity {

    @Column(name = "auth_user_id", unique = true)
    private UUID authUserId;

    @Column(name = "email", nullable = false)
    private String email;

    @Column(name = "full_name")
    private String fullName;

    @Enumerated(EnumType.STRING)
    @Column(name = "role", nullable = false)
    private Role role;

    @Column(name = "team_id")
    private UUID teamId;

    /** Non-null exactly when the role is CUSTOMER; the database enforces that pairing. */
    @Column(name = "customer_id")
    private UUID customerId;

    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    /**
     * Approver leave window. An approval step is not routed to someone who is
     * unavailable, and an administrator may reassign it to a qualified backup.
     */
    @Column(name = "unavailable_until")
    private Instant unavailableUntil;

    /** BCrypt hash for accounts registered through the storefront; null for external identities. */
    @Column(name = "password_hash")
    private String passwordHash;

    @Column(name = "phone")
    private String phone;

    /** Portal UI preferences as raw JSON text; the portal validates the keys. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "preferences", nullable = false)
    private String preferences = "{}";

    protected Profile() {
    }

    public Profile(UUID authUserId, String email, String fullName, Role role) {
        this.authUserId = authUserId;
        this.email = email;
        this.fullName = fullName;
        this.role = role;
    }

    /** True when the person can be handed a pending approval right now. */
    public boolean isAvailableAt(Instant moment) {
        return active && (unavailableUntil == null || unavailableUntil.isBefore(moment));
    }

    public Actor toActor() {
        return new Actor(getId(), authUserId, email, role, teamId, customerId);
    }

    public UUID getAuthUserId() {
        return authUserId;
    }

    public void setAuthUserId(UUID authUserId) {
        this.authUserId = authUserId;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public Role getRole() {
        return role;
    }

    public void setRole(Role role) {
        this.role = role;
    }

    public UUID getTeamId() {
        return teamId;
    }

    public void setTeamId(UUID teamId) {
        this.teamId = teamId;
    }

    public UUID getCustomerId() {
        return customerId;
    }

    public void setCustomerId(UUID customerId) {
        this.customerId = customerId;
    }

    public boolean isActive() {
        return active;
    }

    public void setActive(boolean active) {
        this.active = active;
    }

    public Instant getUnavailableUntil() {
        return unavailableUntil;
    }

    public void setUnavailableUntil(Instant unavailableUntil) {
        this.unavailableUntil = unavailableUntil;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getPreferences() {
        return preferences;
    }

    public void setPreferences(String preferences) {
        this.preferences = preferences;
    }
}
