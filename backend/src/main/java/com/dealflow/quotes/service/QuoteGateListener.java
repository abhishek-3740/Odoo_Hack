package com.dealflow.quotes.service;


import com.dealflow.quotes.models.*;
import com.dealflow.quotes.repo.*;
import com.dealflow.quotes.dto.*;
import com.dealflow.quotes.controller.*;
import com.dealflow.auth.models.Actor;
import java.util.Optional;
import java.util.UUID;

/**
 * Lets the quotation module tell the orders module that a gate moved, without
 * depending on it.
 *
 * <p>Approval, seller adoption and customer acceptance are independent and can
 * complete in any order, so <em>every</em> path that changes one of them calls
 * {@link #onGatesPossiblyCleared}. The implementation re-checks all the gates
 * under a lock and creates the order at most once; a unique constraint on
 * {@code orders.quote_id} makes a duplicate attempt a no-op rather than a second
 * order (test T13).
 *
 * <p>Implemented in the orders module. The dependency runs orders → quotes only.
 */
public interface QuoteGateListener {

    /**
     * Called after any change that might have completed the last gate.
     * Safe to call when nothing is ready; it simply does nothing.
     */
    void onGatesPossiblyCleared(UUID quoteId, Actor actor);

    /** The order created from this quotation, if one exists. */
    Optional<UUID> findOrderIdForQuote(UUID quoteId);
}
