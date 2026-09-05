package com.dealflow.quotes;

import com.dealflow.auth.Actor;
import com.dealflow.auth.Role;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import java.util.Objects;
import org.springframework.stereotype.Component;

/**
 * Who may see and change which quotation.
 *
 * <p>Enforced in the service layer, on every path. The frontend hiding a button
 * is a courtesy to the user; this class is the boundary.
 *
 * <h2>Why out-of-scope reads are 404, not 403</h2>
 *
 * <p>Answering "403 forbidden" confirms the record exists. A customer probing
 * quotation ids could map a competitor's deal flow without ever reading a
 * field. Foreign records are therefore indistinguishable from absent ones
 * (test T08).
 *
 * <p>A portal identity is refused outright here: customers reach their
 * quotations through the portal endpoints, which return a different, restricted
 * shape. There is no path by which an internal DTO reaches a customer.
 */
@Component
public class QuoteAccessPolicy {

    /** Internal read: owner, their manager, finance, or an administrator. */
    public void requireRead(Actor actor, Quote quote) {
        if (actor.isCustomer()) {
            // Customers never read the internal representation, even of their
            // own deal. The portal has its own endpoints and its own DTOs.
            throw ApiException.notFound("Quotation " + quote.getId());
        }
        if (!canRead(actor, quote)) {
            throw ApiException.notFound("Quotation " + quote.getId());
        }
    }

    /** Commercial edits: the owning rep, or an administrator. */
    public void requireEdit(Actor actor, Quote quote) {
        requireRead(actor, quote);
        boolean allowed = actor.isAdmin() || isOwner(actor, quote);
        if (!allowed) {
            throw ApiException.forbidden("Only the rep who owns this quotation can change its terms.");
        }
        if (!quote.getStage().isOpen()) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE,
                    "This quotation is " + quote.getStage().name().toLowerCase()
                            + " and its terms can no longer be changed.");
        }
    }

    /** Seller adoption of a customer's proposed terms. */
    public void requireAdopt(Actor actor, Quote quote) {
        requireRead(actor, quote);
        if (!(actor.isAdmin() || isOwner(actor, quote))) {
            throw ApiException.forbidden("Only the rep who owns this quotation can adopt proposed terms.");
        }
    }

    public boolean canRead(Actor actor, Quote quote) {
        return switch (actor.role()) {
            case ADMIN, FINANCE -> true;
            case MANAGER -> actor.teamId() == null || Objects.equals(actor.teamId(), quote.getTeamId());
            case REP -> isOwner(actor, quote);
            case CUSTOMER -> false;
        };
    }

    /** Portal access: the identity must be bound to this quotation's customer. */
    public void requirePortalAccess(Actor actor, Quote quote) {
        if (!actor.isCustomer() || actor.customerId() == null
                || !actor.customerId().equals(quote.getCustomerId())) {
            throw ApiException.notFound("Quotation " + quote.getId());
        }
    }

    private static boolean isOwner(Actor actor, Quote quote) {
        return Objects.equals(actor.profileId(), quote.getOwnerProfileId());
    }

    /** Whether this actor may decide the given approval step. */
    public void requireApprovalRole(Actor actor, Role requiredRole) {
        if (!actor.role().canDecide(requiredRole)) {
            throw new ApiException(ErrorCode.APPROVER_NOT_QUALIFIED,
                    "This step must be decided by " + requiredRole.name().toLowerCase() + ".");
        }
    }
}
