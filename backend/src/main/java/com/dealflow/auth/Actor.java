package com.dealflow.auth;

import java.util.UUID;

/**
 * The verified identity behind a request.
 *
 * <p>Every service command takes an {@code Actor} explicitly rather than
 * reaching into a security context, so authorisation decisions are visible in
 * the method signature and testable without a servlet.
 *
 * @param profileId  primary key in {@code dealflow.profiles}
 * @param authUserId the Supabase {@code auth.users} id from the token subject
 * @param role       authoritative role, read from the database on every request
 * @param teamId     team scope for a manager's queue, may be null
 * @param customerId set only for a portal identity; null for internal staff
 */
public record Actor(UUID profileId, UUID authUserId, String email, Role role, UUID teamId, UUID customerId) {

    public boolean isCustomer() {
        return role == Role.CUSTOMER;
    }

    public boolean isAdmin() {
        return role == Role.ADMIN;
    }

    public boolean isInternal() {
        return role.isInternal();
    }

    /** A system actor for scheduled work. Jobs never borrow a person's identity. */
    public static Actor system() {
        return new Actor(null, null, "system@dealflow", Role.ADMIN, null, null);
    }

    public boolean isSystem() {
        return profileId == null;
    }
}
