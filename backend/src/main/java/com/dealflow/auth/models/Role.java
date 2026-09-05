package com.dealflow.auth.models;


import com.dealflow.auth.repo.*;
import com.dealflow.auth.service.*;
import com.dealflow.auth.controller.*;
import java.util.Set;

/**
 * Application roles. The role lives in {@code dealflow.profiles}, not in the
 * token: a JWT that was minted before an account was deactivated or demoted
 * must not still carry its old privileges.
 */
public enum Role {

    /** Own quotations and related orders. No approval or override privilege. */
    REP,

    /** Team approvals (step 1), discount policy, team health and reporting. */
    MANAGER,

    /** Approval step 2, allocation overrides, receipts, payments, credits, refunds. */
    FINANCE,

    /** Configuration and user administration, including audited reassignment. */
    ADMIN,

    /** Portal identity, bound to exactly one customer. */
    CUSTOMER;

    private static final Set<Role> INTERNAL = Set.of(REP, MANAGER, FINANCE, ADMIN);
    private static final Set<Role> APPROVERS = Set.of(MANAGER, FINANCE);

    public String authority() {
        return "ROLE_" + name();
    }

    public boolean isInternal() {
        return INTERNAL.contains(this);
    }

    public boolean isApprover() {
        return APPROVERS.contains(this);
    }

    /**
     * Whether this role can act on an approval step.
     *
     * <p>An administrator can reassign a step but never decide it: reassignment
     * changes who is asked, not whether the business still requires the
     * approval (edge case E07).
     */
    public boolean canDecide(Role requiredRole) {
        return this == requiredRole;
    }
}
