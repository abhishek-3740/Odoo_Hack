"""Stable API error codes — 1:1 port of shared/error/ErrorCode.java.

Clients branch on the code, never on the message text. Codes are contract;
messages are for people and may be reworded.
"""

from __future__ import annotations

from enum import Enum
from typing import Any


class ErrorCode(Enum):
    # --- input and identity ---
    VALIDATION_FAILED = (400, "The request could not be read.")
    MALFORMED_REQUEST = (400, "The request body is malformed.")
    UNAUTHENTICATED = (401, "Sign in to continue.")
    PROFILE_NOT_PROVISIONED = (403, "This account has no workspace profile yet.")
    PROFILE_INACTIVE = (403, "This account is deactivated.")
    FORBIDDEN = (403, "You do not have access to this action.")
    NOT_FOUND = (404, "That record does not exist.")
    ASSISTANT_UNAVAILABLE = (503, "Assistant is temporarily unavailable.")
    ASSISTANT_RATE_LIMITED = (429, "Too many assistant requests.")

    # --- concurrency and replay ---
    STALE_QUOTE_VERSION = (409, "This quotation changed. Refresh before continuing.")
    STALE_VERSION = (409, "This record changed. Refresh before continuing.")
    CONFLICTING_STATE = (409, "The record is no longer in a state that allows this.")
    IDEMPOTENCY_KEY_REUSED = (409, "This request key was already used for a different request.")
    IDEMPOTENT_REQUEST_IN_PROGRESS = (409, "An identical request is still being processed.")
    IDEMPOTENCY_KEY_REQUIRED = (400, "This operation requires an Idempotency-Key header.")

    # --- pricing and policy ---
    PRICE_NOT_RESOLVABLE = (422, "No price is configured for this item and customer tier.")
    AMBIGUOUS_PRICE_RULE = (422, "Two price rules of equal priority match this item.")
    DISCOUNT_OUT_OF_RANGE = (422, "A discount must be between 0% and 99.99%.")
    ZERO_NET_LINE = (422, "A line cannot be discounted to zero value.")
    EMPTY_QUOTE = (422, "A quotation needs at least one line.")
    POLICY_NOT_CONFIGURED = (422, "No discount policy version is in effect.")

    # --- approval workflow ---
    APPROVAL_SEQUENCE_VIOLATION = (409, "Finance cannot decide before the manager step is complete.")
    APPROVAL_ALREADY_DECIDED = (409, "This approval step already has a decision.")
    SELF_APPROVAL_FORBIDDEN = (403, "A quotation cannot be approved by the person who submitted it.")
    APPROVER_NOT_QUALIFIED = (403, "This account is not a qualified approver for that step.")
    NO_AVAILABLE_APPROVER = (422, "No active approver is available for this step.")
    QUOTE_NOT_SUBMITTED = (409, "This revision has not been submitted for approval.")

    # --- negotiation and acceptance ---
    NEGOTIATION_CLOSED = (409, "This quotation is confirmed and can no longer be negotiated.")
    ACCEPTANCE_HASH_MISMATCH = (409, "The terms changed since this version was shown.")
    ALREADY_ORDERED = (409, "An order already exists for this quotation.")
    QUOTE_EXPIRED = (422, "This quotation has passed its validity date.")
    GATES_NOT_MET = (422, "This quotation still has outstanding approval or acceptance.")

    # --- fulfilment ---
    INSUFFICIENT_STOCK = (409, "There is not enough stock to fulfil these terms.")
    ALLOCATION_INFEASIBLE = (422, "That warehouse split cannot be fulfilled.")
    ALLOCATION_MISMATCH = (422, "Allocated and backordered quantities must equal the ordered quantity.")
    NOTHING_TO_DISPATCH = (422, "This shipment holds no reserved stock.")
    DUPLICATE_STOCK_MOVEMENT = (409, "This stock movement was already recorded.")

    # --- billing ---
    BACKDATED_CHANGE_REJECTED = (422, "A change cannot take effect before today.")
    EFFECTIVE_DATE_OUT_OF_PERIOD = (422, "The effective date is outside the current billing period.")
    SUBSCRIPTION_NOT_ACTIVE = (409, "This subscription is not active.")
    INVOICE_NOT_PAYABLE = (409, "This invoice cannot accept a payment in its current status.")
    OVER_ALLOCATION = (422, "The allocated amount exceeds the payment or the amount outstanding.")
    REFUND_EXCEEDS_ELIGIBLE = (422, "A refund cannot exceed the money actually received.")
    CURRENCY_MISMATCH = (422, "The currencies involved do not match.")

    # --- infrastructure ---
    RATE_LIMITED = (429, "Too many requests. Try again shortly.")
    INTERNAL_ERROR = (500, "Something went wrong on our side.")

    def __init__(self, status: int, default_message: str) -> None:
        self._status = status
        self._default_message = default_message

    @property
    def status(self) -> int:
        return self._status

    @property
    def default_message(self) -> str:
        return self._default_message


class ApiException(Exception):
    """Port of shared/error/ApiException.java."""

    def __init__(
        self,
        code: ErrorCode,
        message: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message or code.default_message)
        self.code = code
        self.status_code = code.status
        self.message = message or code.default_message
        self.details: dict[str, Any] = dict(details or {})

    @classmethod
    def of(cls, code: ErrorCode, message: str, **details: Any) -> "ApiException":
        return cls(code, message, dict(details))

    @classmethod
    def not_found(cls, what: str = "That record does not exist.") -> "ApiException":
        return cls(ErrorCode.NOT_FOUND, what)

    @classmethod
    def forbidden(cls, message: str = "You do not have access to this action.") -> "ApiException":
        return cls(ErrorCode.FORBIDDEN, message)
