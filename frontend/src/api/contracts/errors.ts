/**
 * The server's stable error codes, mirrored from `shared/error/ErrorCode.java`.
 *
 * Branch on these, never on message text. Each entry carries the one sentence a
 * user needs to know what to do next — the server's own message explains what
 * happened, this explains what to do about it.
 */

export type ErrorCode =
  // input and identity
  | 'VALIDATION_FAILED'
  | 'MALFORMED_REQUEST'
  | 'UNAUTHENTICATED'
  | 'PROFILE_NOT_PROVISIONED'
  | 'PROFILE_INACTIVE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ASSISTANT_UNAVAILABLE'
  | 'ASSISTANT_RATE_LIMITED'
  // concurrency and replay
  | 'STALE_QUOTE_VERSION'
  | 'STALE_VERSION'
  | 'CONFLICTING_STATE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'IDEMPOTENT_REQUEST_IN_PROGRESS'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  // pricing and policy
  | 'PRICE_NOT_RESOLVABLE'
  | 'AMBIGUOUS_PRICE_RULE'
  | 'DISCOUNT_OUT_OF_RANGE'
  | 'ZERO_NET_LINE'
  | 'EMPTY_QUOTE'
  | 'POLICY_NOT_CONFIGURED'
  // approval workflow
  | 'APPROVAL_SEQUENCE_VIOLATION'
  | 'APPROVAL_ALREADY_DECIDED'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'APPROVER_NOT_QUALIFIED'
  | 'NO_AVAILABLE_APPROVER'
  | 'QUOTE_NOT_SUBMITTED'
  // negotiation and acceptance
  | 'NEGOTIATION_CLOSED'
  | 'ACCEPTANCE_HASH_MISMATCH'
  | 'ALREADY_ORDERED'
  | 'QUOTE_EXPIRED'
  | 'GATES_NOT_MET'
  // fulfilment
  | 'INSUFFICIENT_STOCK'
  | 'ALLOCATION_INFEASIBLE'
  | 'ALLOCATION_MISMATCH'
  | 'NOTHING_TO_DISPATCH'
  | 'DUPLICATE_STOCK_MOVEMENT'
  // billing
  | 'BACKDATED_CHANGE_REJECTED'
  | 'EFFECTIVE_DATE_OUT_OF_PERIOD'
  | 'SUBSCRIPTION_NOT_ACTIVE'
  | 'INVOICE_NOT_PAYABLE'
  | 'INTERNAL_ERROR'

/** What the user should do about it. Empty when the server's message suffices. */
export const RECOVERY_GUIDANCE: Partial<Record<string, string>> = {
  STALE_QUOTE_VERSION:
    'Someone changed this quotation while you were working. Your edits are kept below — compare them with the current version before continuing.',
  STALE_VERSION: 'This record changed while you were working. Reload it and confirm again.',
  CONFLICTING_STATE: 'The record has moved on. Reload to see its current state.',
  ACCEPTANCE_HASH_MISMATCH:
    'The terms changed after this version was shown to you. Review the current version before accepting.',
  APPROVAL_SEQUENCE_VIOLATION:
    'The manager step has to be approved before finance can decide. This step will become actionable on its own.',
  APPROVAL_ALREADY_DECIDED: 'Someone already recorded a decision on this step.',
  SELF_APPROVAL_FORBIDDEN: 'A quotation cannot be approved by the person who submitted it.',
  IDEMPOTENCY_KEY_REUSED:
    'That request key was already used for a different request. Start the action again.',
  IDEMPOTENT_REQUEST_IN_PROGRESS: 'An identical request is still running. Wait a moment before retrying.',
  PRICE_NOT_RESOLVABLE:
    'No price rule covers this item for this customer tier. An administrator can add one in Catalog.',
  DISCOUNT_OUT_OF_RANGE: 'A discount has to be between 0% and 99.99%.',
  ZERO_NET_LINE: 'A line cannot be discounted down to nothing. Reduce the discount or remove the line.',
  POLICY_NOT_CONFIGURED: 'No discount policy version is in effect. Publish one in Governance.',
  INSUFFICIENT_STOCK: 'There is not enough stock for these terms. Record a receipt or re-plan the order.',
  ALLOCATION_INFEASIBLE: 'That warehouse split cannot be fulfilled. The feasible plan is shown alongside.',
  BACKDATED_CHANGE_REJECTED: 'A change cannot take effect before today. Pick today or a later date.',
  EFFECTIVE_DATE_OUT_OF_PERIOD:
    'The effective date has to fall inside the current billing period shown above.',
  ASSISTANT_RATE_LIMITED: 'The assistant is busy. Your message is kept — try sending it again shortly.',
  ASSISTANT_UNAVAILABLE: 'The assistant provider is unavailable. Your message is kept for retry.',
  PROFILE_NOT_PROVISIONED: 'This account has no workspace profile yet. An administrator can create one.',
  NETWORK_ERROR: 'The workspace could not reach the server. Your work is not lost — try again.',
  FORBIDDEN: 'Your role does not allow this action.',
}
