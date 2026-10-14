"""String enums persisted as UPPER text (check constraints own validity)."""

from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    def __str__(self) -> str:  # keep JSON/DB values as plain "NAME"
        return self.value


class Role(StrEnum):
    REP = "REP"
    MANAGER = "MANAGER"
    FINANCE = "FINANCE"
    ADMIN = "ADMIN"
    CUSTOMER = "CUSTOMER"


class CustomerTier(StrEnum):
    BRONZE = "BRONZE"
    SILVER = "SILVER"
    GOLD = "GOLD"


class Stage(StrEnum):
    DRAFT = "DRAFT"
    REVIEW = "REVIEW"
    SENT = "SENT"
    UNDER_NEGOTIATION = "UNDER_NEGOTIATION"
    CONFIRMED = "CONFIRMED"
    CANCELED = "CANCELED"
    LOST = "LOST"
    EXPIRED = "EXPIRED"


class RevisionStatus(StrEnum):
    DRAFT = "DRAFT"
    SUBMITTED = "SUBMITTED"
    SUPERSEDED = "SUPERSEDED"
    CANCELED = "CANCELED"


class RevisionSource(StrEnum):
    SELLER = "SELLER"
    CUSTOMER_COUNTER = "CUSTOMER_COUNTER"
    SYSTEM = "SYSTEM"


class ApprovalStatus(StrEnum):
    NOT_EVALUATED = "NOT_EVALUATED"
    NOT_REQUIRED = "NOT_REQUIRED"
    PENDING_MANAGER = "PENDING_MANAGER"
    PENDING_FINANCE = "PENDING_FINANCE"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REVISION_REQUIRED = "REVISION_REQUIRED"


class ApprovalRequestStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REVISION_REQUIRED = "REVISION_REQUIRED"
    SUPERSEDED = "SUPERSEDED"


class NegotiationType(StrEnum):
    COMMENT = "COMMENT"
    CHANGE = "CHANGE"
    COUNTER = "COUNTER"


class NegotiationStatus(StrEnum):
    OPEN = "OPEN"
    ANSWERED = "ANSWERED"
    ADOPTED = "ADOPTED"
    DECLINED = "DECLINED"
    SUPERSEDED = "SUPERSEDED"


class BackorderTerms(StrEnum):
    ALLOW_BACKORDER = "ALLOW_BACKORDER"
    IN_STOCK_ONLY = "IN_STOCK_ONLY"
