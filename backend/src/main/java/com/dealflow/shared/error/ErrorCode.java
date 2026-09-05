package com.dealflow.shared.error;

import org.springframework.http.HttpStatus;

/**
 * Stable API error codes.
 *
 * <p>Clients branch on the code, never on the message text. Messages are for
 * people and may be reworded; codes are part of the contract.
 *
 * <p>Status conventions (Implementation Plan section 8.2): 400 malformed input,
 * 401 unauthenticated, 403 forbidden capability, 404 missing <em>or foreign</em>
 * resource, 409 stale or conflicting state, 422 a well-formed request that
 * breaks a business rule, 500 unexpected.
 */
public enum ErrorCode {

    // --- input and identity ---
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "The request could not be read."),
    MALFORMED_REQUEST(HttpStatus.BAD_REQUEST, "The request body is malformed."),
    UNAUTHENTICATED(HttpStatus.UNAUTHORIZED, "Sign in to continue."),
    PROFILE_NOT_PROVISIONED(HttpStatus.FORBIDDEN, "This account has no workspace profile yet."),
    PROFILE_INACTIVE(HttpStatus.FORBIDDEN, "This account is deactivated."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "You do not have access to this action."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "That record does not exist."),
    ASSISTANT_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "Assistant is temporarily unavailable."),
    ASSISTANT_RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "Too many assistant requests."),

    // --- concurrency and replay ---
    STALE_QUOTE_VERSION(HttpStatus.CONFLICT, "This quotation changed. Refresh before continuing."),
    STALE_VERSION(HttpStatus.CONFLICT, "This record changed. Refresh before continuing."),
    CONFLICTING_STATE(HttpStatus.CONFLICT, "The record is no longer in a state that allows this."),
    IDEMPOTENCY_KEY_REUSED(HttpStatus.CONFLICT, "This request key was already used for a different request."),
    IDEMPOTENT_REQUEST_IN_PROGRESS(HttpStatus.CONFLICT, "An identical request is still being processed."),
    IDEMPOTENCY_KEY_REQUIRED(HttpStatus.BAD_REQUEST, "This operation requires an Idempotency-Key header."),

    // --- pricing and policy ---
    PRICE_NOT_RESOLVABLE(HttpStatus.UNPROCESSABLE_ENTITY, "No price is configured for this item and customer tier."),
    AMBIGUOUS_PRICE_RULE(HttpStatus.UNPROCESSABLE_ENTITY, "Two price rules of equal priority match this item."),
    DISCOUNT_OUT_OF_RANGE(HttpStatus.UNPROCESSABLE_ENTITY, "A discount must be between 0% and 99.99%."),
    ZERO_NET_LINE(HttpStatus.UNPROCESSABLE_ENTITY, "A line cannot be discounted to zero value."),
    EMPTY_QUOTE(HttpStatus.UNPROCESSABLE_ENTITY, "A quotation needs at least one line."),
    POLICY_NOT_CONFIGURED(HttpStatus.UNPROCESSABLE_ENTITY, "No discount policy version is in effect."),

    // --- approval workflow ---
    APPROVAL_SEQUENCE_VIOLATION(HttpStatus.CONFLICT, "Finance cannot decide before the manager step is complete."),
    APPROVAL_ALREADY_DECIDED(HttpStatus.CONFLICT, "This approval step already has a decision."),
    SELF_APPROVAL_FORBIDDEN(HttpStatus.FORBIDDEN, "A quotation cannot be approved by the person who submitted it."),
    APPROVER_NOT_QUALIFIED(HttpStatus.FORBIDDEN, "This account is not a qualified approver for that step."),
    NO_AVAILABLE_APPROVER(HttpStatus.UNPROCESSABLE_ENTITY, "No active approver is available for this step."),
    QUOTE_NOT_SUBMITTED(HttpStatus.CONFLICT, "This revision has not been submitted for approval."),

    // --- negotiation and acceptance ---
    NEGOTIATION_CLOSED(HttpStatus.CONFLICT, "This quotation is confirmed and can no longer be negotiated."),
    ACCEPTANCE_HASH_MISMATCH(HttpStatus.CONFLICT, "The terms changed since this version was shown."),
    ALREADY_ORDERED(HttpStatus.CONFLICT, "An order already exists for this quotation."),
    QUOTE_EXPIRED(HttpStatus.UNPROCESSABLE_ENTITY, "This quotation has passed its validity date."),
    GATES_NOT_MET(HttpStatus.UNPROCESSABLE_ENTITY, "This quotation still has outstanding approval or acceptance."),

    // --- fulfilment ---
    INSUFFICIENT_STOCK(HttpStatus.CONFLICT, "There is not enough stock to fulfil these terms."),
    ALLOCATION_INFEASIBLE(HttpStatus.UNPROCESSABLE_ENTITY, "That warehouse split cannot be fulfilled."),
    ALLOCATION_MISMATCH(HttpStatus.UNPROCESSABLE_ENTITY, "Allocated and backordered quantities must equal the ordered quantity."),
    NOTHING_TO_DISPATCH(HttpStatus.UNPROCESSABLE_ENTITY, "This shipment holds no reserved stock."),
    DUPLICATE_STOCK_MOVEMENT(HttpStatus.CONFLICT, "This stock movement was already recorded."),

    // --- billing ---
    BACKDATED_CHANGE_REJECTED(HttpStatus.UNPROCESSABLE_ENTITY, "A change cannot take effect before today."),
    EFFECTIVE_DATE_OUT_OF_PERIOD(HttpStatus.UNPROCESSABLE_ENTITY, "The effective date is outside the current billing period."),
    SUBSCRIPTION_NOT_ACTIVE(HttpStatus.CONFLICT, "This subscription is not active."),
    INVOICE_NOT_PAYABLE(HttpStatus.CONFLICT, "This invoice cannot accept a payment in its current status."),
    OVER_ALLOCATION(HttpStatus.UNPROCESSABLE_ENTITY, "The allocated amount exceeds the payment or the amount outstanding."),
    REFUND_EXCEEDS_ELIGIBLE(HttpStatus.UNPROCESSABLE_ENTITY, "A refund cannot exceed the money actually received."),
    CURRENCY_MISMATCH(HttpStatus.UNPROCESSABLE_ENTITY, "The currencies involved do not match."),

    // --- infrastructure ---
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "Too many requests. Try again shortly."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Something went wrong on our side.");

    private final HttpStatus status;
    private final String defaultMessage;

    ErrorCode(HttpStatus status, String defaultMessage) {
        this.status = status;
        this.defaultMessage = defaultMessage;
    }

    public HttpStatus status() {
        return status;
    }

    public String defaultMessage() {
        return defaultMessage;
    }
}
