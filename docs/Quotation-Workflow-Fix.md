# Quotation workflow fix — 6 September 2026

The customer portal enables acceptance only for a submitted quotation in `SENT`.
Seller adoption previously left counteroffers in `UNDER_NEGOTIATION` and customer
requests in `REVIEW`. The backend could accept the version through an API call,
but the customer could not see the final acceptance button. Earlier tests called
that API directly and missed the UI prerequisite.

## Corrected behavior

- A customer catalogue request creates a submitted customer proposal, without
  pretending the assigned salesperson has already agreed.
- Seller adoption moves the current proposal to `SENT`, closes its associated
  request, and publishes the update. Pending internal approvals remain required.
- Manager approval advances a two-step chain to finance. Finance cannot act
  before the manager; its screen shows the waiting reason.
- Seller agreement, internal approval, and exact-version customer acceptance
  remain separate gates. Customer acceptance and an approver decision no longer
  silently supply seller agreement. Order creation runs when the last gate clears.
- The quotation editor refreshes workflow state on deal events/reconnection,
  protects unsaved edits, shows the next actor and approval route, and disables
  duplicate submission of an already-submitted version.
- Restored owner/admin commercial edits; an unassigned team no longer gives a
  salesperson access to every quotation.

Existing adopted quotes still waiting in REVIEW or UNDER_NEGOTIATION can use
**Share Customer Portal** to expose their current submitted version. Do not
resubmit that version. If commercial terms change, save and submit a new revision.
Approvals are required only when the configured risk policy calls for them.

## Validation

- `backend`: `mvnw.cmd -q verify` — 88 unit tests and 37 integration tests passed.
- Regression assertions cover catalogue request → adoption → customer-visible
  acceptance → order; adopted counteroffer visibility; manager → finance → order.
- `frontend`: production build passed after merging the latest remote branch.
- Playwright: customer request → salesperson adoption → customer acceptance →
  confirmed order with live salesperson refresh passed against a disposable database.
- Remote merge repair: regenerated the malformed frontend lockfile, resolved
  conflict markers in the Vite proxy, and removed duplicate page imports while
  preserving the new landing page. Demo and Supabase authentication settings stay intact.

This verification covers the quotation-flow fix; it is not a claim that every
optional item in the original implementation plan has been exhaustively tested.
