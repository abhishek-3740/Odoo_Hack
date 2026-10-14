"""Quote/approval/escalation/recommendation API shapes.

Port of quotes/dto/QuoteDtos.java, approvals/dto/ApprovalDtos.java,
portal/service/{DealEscalationService,NegotiationDeskService} records and
recommendations/controller+service records.

Requests carry identifiers, quantities and *requested* discounts only — never
prices, costs or totals; those resolve server-side. Money crosses the wire as
decimal strings in major units ("39300.00"); discounts are integer basis
points. Response builders return plain dicts holding Decimal objects for money
(the envelope serializer renders them); UUIDs become strings and dates become
ISO strings (the envelope passes those through untouched).
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.engines import shared_math as m
from app.schemas.money import MoneyInput

Decision = Literal["APPROVE", "REJECT", "RETURN_FOR_REVISION"]
EscalationCategory = Literal["DISCOUNT", "POLICY", "REVIEW"]
NegotiationDecision = Literal["ANSWERED", "DECLINED"]

MAX_QUOTE_LINES = 100
MAX_DISCOUNT_BP = 9999


# --------------------------------------------------------------- requests ---


class CreateQuoteRequest(BaseModel):
    customerId: uuid.UUID
    title: str | None = Field(default=None, max_length=200)
    validUntil: date | None = None


class QuoteLineRequest(BaseModel):
    lineKey: str | None = Field(default=None, max_length=64)
    variantId: uuid.UUID | None = None
    planId: uuid.UUID | None = None
    quantity: Annotated[MoneyInput, Field(gt=0)]
    lineDiscountBp: int = Field(default=0, ge=0, le=MAX_DISCOUNT_BP)
    promisedDate: date | None = None
    source: str | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def _exactly_one_item(self) -> "QuoteLineRequest":
        if (self.variantId is None) == (self.planId is None):
            raise ValueError(
                "Each line needs exactly one of a product variant or a subscription plan."
            )
        return self


class QuoteDraftRequest(BaseModel):
    lines: list[QuoteLineRequest] = Field(min_length=1, max_length=MAX_QUOTE_LINES)
    orderDiscountBp: int = Field(default=0, ge=0, le=MAX_DISCOUNT_BP)
    backorderTerms: str = "ALLOW_BACKORDER"
    requestedActivationDate: date | None = None
    expectedRowVersion: int | None = None

    @model_validator(mode="after")
    def _backorder_terms_known(self) -> "QuoteDraftRequest":
        if self.backorderTerms not in ("ALLOW_BACKORDER", "IN_STOCK_ONLY"):
            raise ValueError("backorderTerms must be ALLOW_BACKORDER or IN_STOCK_ONLY.")
        return self


class SubmitQuoteRequest(BaseModel):
    expectedRevisionId: uuid.UUID
    expectedRowVersion: int | None = None
    note: str | None = Field(default=None, max_length=500)


class AdoptRevisionRequest(BaseModel):
    revisionId: uuid.UUID
    expectedRowVersion: int | None = None
    note: str | None = Field(default=None, max_length=500)


class CancelQuoteRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)
    expectedRowVersion: int | None = None


class DecisionRequest(BaseModel):
    decision: Decision
    expectedRevisionId: uuid.UUID | None = None
    expectedRowVersion: int | None = None
    reason: str | None = Field(default=None, max_length=1000)


class ReassignRequest(BaseModel):
    assigneeProfileId: uuid.UUID
    reason: str = Field(min_length=3, max_length=500)


class DismissRequest(BaseModel):
    variantId: uuid.UUID


class ApplyRequest(BaseModel):
    variantId: uuid.UUID
    replaceLineKey: str | None = None
    expectedRevisionId: uuid.UUID
    expectedRowVersion: int


class EscalationCreate(BaseModel):
    quoteId: uuid.UUID
    expectedRevisionId: uuid.UUID
    requestKey: uuid.UUID
    category: EscalationCategory
    reason: str = Field(min_length=1, max_length=2000)


class EscalationResolve(BaseModel):
    resolution: str = Field(min_length=1, max_length=2000)


class ReplyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    decision: NegotiationDecision | None = None


# -------------------------------------------------------------- responses ---


def _iso(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (date,)):
        return value.isoformat()
    if hasattr(value, "isoformat"):
        return value.isoformat()  # type: ignore[no-any-return]
    return value


def evaluated_line_to_dict(line: Any, promised: date | None = None) -> dict:
    return {
        "lineKey": line.line_key,
        "position": line.position,
        "lineKind": line.kind.value if hasattr(line.kind, "value") else str(line.kind),
        "productId": str(line.product_id) if line.product_id else None,
        "variantId": str(line.variant_id) if line.variant_id else None,
        "planId": str(line.plan_id) if line.plan_id else None,
        "categoryCode": line.category_code,
        "description": line.description,
        "quantity": line.quantity,
        "unitPrice": m.to_major(line.unit_price_minor),
        "unitCost": m.to_major(line.unit_cost_minor),
        "taxRateBp": line.tax_rate_bp,
        "lineDiscountBp": line.line_discount_bp,
        "appliedOrderDiscountBp": line.applied_order_discount_bp,
        "effectiveDiscountBp": line.effective_discount_bp,
        "base": m.to_major(line.base_minor),
        "net": m.to_major(line.net_minor),
        "tax": m.to_major(line.tax_minor),
        "costTotal": m.to_major(line.cost_total_minor),
        "margin": m.to_major(line.margin_minor),
        "marginPercent": line.margin_percent,
        "intervalMonths": line.interval_months,
        "requiresStock": line.requires_stock,
        "promisedDate": promised.isoformat() if promised else None,
        "source": line.source,
    }


def totals_to_dict(pricing: Any) -> dict:
    recurring = [
        {
            "intervalMonths": group.interval_months,
            "cadence": group.cadence,
            "net": m.to_major(group.net_minor),
            "tax": m.to_major(group.tax_minor),
            "cost": m.to_major(group.cost_minor),
            "margin": m.to_major(group.margin_minor),
            "marginPercent": group.margin_percent,
        }
        for group in sorted(
            pricing.recurring_by_cadence.values(), key=lambda g: g.interval_months
        )
    ]
    return {
        "currency": pricing.currency,
        "oneTimeNet": m.to_major(pricing.one_time_net_minor),
        "oneTimeTax": m.to_major(pricing.one_time_tax_minor),
        "oneTimeTotal": m.to_major(pricing.one_time_net_minor + pricing.one_time_tax_minor),
        "recurring": recurring,
        "recurringFirstCycleNet": m.to_major(pricing.recurring_first_cycle_net_minor),
        "initialAmountDue": m.to_major(pricing.initial_amount_due_minor),
        "comparisonNet": m.to_major(pricing.comparison_net_minor()),
        "contribution": m.to_major(pricing.contribution_minor),
        "contributionPercent": pricing.contribution_percent,
        "monthlyRecurringRevenue": m.to_major(pricing.monthly_recurring_revenue_minor),
        "totalBase": m.to_major(pricing.total_base_minor),
        "totalDiscount": m.to_major(pricing.total_discount_minor),
    }


def risk_to_dict(risk: Any) -> dict:
    return {
        "requiredLevel": risk.required_level.name,
        "reasons": [
            {
                "code": r.code,
                "lineKey": r.line_key,
                "description": r.description,
                "observedValue": r.observed_value,
                "thresholdValue": r.threshold_value,
                "unit": r.unit,
                "requiredLevel": r.required_level.name,
                "message": r.message,
            }
            for r in risk.reasons
        ],
        "lines": [
            {
                "lineKey": ln.line_key,
                "description": ln.description,
                "categoryCode": ln.category_code,
                "effectiveDiscountPercent": ln.effective_discount_percent,
                "allowedPercent": ln.allowed_percent,
                "excessPp": ln.excess_pp,
                "excessValue": m.to_major(ln.excess_value_minor),
                "margin": m.to_major(ln.margin_minor),
                "marginPercent": ln.margin_percent,
            }
            for ln in risk.lines
        ],
        "worstLineExcessPp": risk.worst_line_excess_pp,
        "weightedExcessPp": risk.weighted_excess_pp,
        "excessConcessionValue": m.to_major(risk.excess_value_minor),
        "aggregateDiscountPercent": risk.aggregate_discount_percent,
        "aggregateMarginPercent": risk.aggregate_margin_percent,
        "policyVersionNo": risk.policy_version_no,
    }


def gates_to_dict(
    *,
    submitted: bool,
    approval_status: str,
    approval_clears: bool,
    seller_adopted: bool,
    customer_accepted: bool,
    expired: bool,
    order_exists: bool,
    order_id: uuid.UUID | None,
    blocking: list[str],
) -> dict:
    return {
        "submitted": submitted,
        "approvalStatus": approval_status,
        "approvalClears": approval_clears,
        "sellerAdopted": seller_adopted,
        "customerAccepted": customer_accepted,
        "expired": expired,
        "unexpired": not expired,
        "orderExists": order_exists,
        "orderId": str(order_id) if order_id else None,
        "readyToExecute": not order_exists and not blocking,
        "blockingReasons": list(blocking),
    }


def evaluation_to_dict(
    *,
    quote: Any,
    revision: Any,
    customer: Any,
    pricing: Any,
    risk: Any,
    promised_by_key: dict | None = None,
    approval_steps: list[dict] | None = None,
    gates: dict | None = None,
    preview: bool = False,
) -> dict:
    promised_by_key = promised_by_key or {}
    return {
        "quoteId": str(quote.id),
        "reference": quote.reference,
        "title": quote.title,
        "customerId": str(customer.id),
        "customerName": customer.name,
        "customerTier": customer.tier,
        "ownerProfileId": str(quote.owner_profile_id),
        "stage": quote.stage,
        "validUntil": quote.valid_until.isoformat() if quote.valid_until else None,
        "revisionId": str(revision.id),
        "revisionNo": revision.revision_no,
        "revisionStatus": revision.status,
        "revisionSource": revision.source,
        "currency": pricing.currency,
        "orderDiscountBp": pricing.order_discount_bp,
        "backorderTerms": revision.backorder_terms,
        "invoicingTerms": revision.invoicing_terms,
        "requestedActivationDate": (
            revision.requested_activation_date.isoformat()
            if revision.requested_activation_date
            else None
        ),
        "lines": [
            evaluated_line_to_dict(line, promised_by_key.get(line.line_key))
            for line in pricing.lines
        ],
        "totals": totals_to_dict(pricing),
        "risk": risk_to_dict(risk),
        "stockPreview": [],
        "gates": gates or {},
        "approvals": approval_steps or [],
        "commercialHash": revision.commercial_hash,
        "rowVersion": quote.row_version,
        "preview": preview,
    }


def quote_summary_to_dict(
    quote: Any, revision: Any | None, customer_name: str | None, owner_name: str | None
) -> dict:
    return {
        "id": str(quote.id),
        "reference": quote.reference,
        "title": quote.title,
        "customerId": str(quote.customer_id),
        "customerName": customer_name,
        "ownerProfileId": str(quote.owner_profile_id),
        "ownerName": owner_name,
        "stage": quote.stage,
        "approvalStatus": revision.approval_status if revision else "NOT_EVALUATED",
        "currency": revision.currency if revision else "INR",
        "oneTimeNet": m.to_major(revision.one_time_net_minor) if revision else None,
        "recurringFirstCycleNet": (
            m.to_major(revision.recurring_first_cycle_net_minor) if revision else None
        ),
        "contributionPercent": revision.margin_percent if revision else None,
        "revisionNo": revision.revision_no if revision else 0,
        "validUntil": quote.valid_until.isoformat() if quote.valid_until else None,
        "lastActivityAt": _iso(quote.last_activity_at),
        "lastProgressAt": _iso(quote.last_progress_at),
        "awaitingExternalSince": _iso(quote.awaiting_external_since),
        "rowVersion": quote.row_version,
    }


def approval_queue_item_to_dict(
    *,
    step: Any,
    quote: Any | None,
    revision: Any | None,
    customer_name: str | None,
    assignee_name: str | None,
    actionable: bool,
    blocked_reason: str | None,
    overdue: bool,
    worst_excess: Decimal | None,
    reasons: list[dict],
) -> dict:
    return {
        "id": str(step.id),
        "quoteId": str(step.quote_id),
        "quoteReference": quote.reference if quote else None,
        "customerName": customer_name,
        "revisionId": str(step.revision_id),
        "revisionNo": revision.revision_no if revision else 0,
        "step": step.step,
        "requiredRole": step.required_role,
        "status": step.status,
        "assigneeProfileId": str(step.assignee_profile_id) if step.assignee_profile_id else None,
        "assigneeName": assignee_name,
        "dueAt": _iso(step.due_at),
        "overdue": overdue,
        "actionable": actionable,
        "blockedReason": blocked_reason,
        "currency": revision.currency if revision else "INR",
        "oneTimeNet": m.to_major(revision.one_time_net_minor) if revision else None,
        "recurringFirstCycleNet": (
            m.to_major(revision.recurring_first_cycle_net_minor) if revision else None
        ),
        "contributionPercent": revision.margin_percent if revision else None,
        "worstLineExcessPp": worst_excess,
        "reasons": reasons,
        "createdAt": _iso(step.created_at),
    }


def decision_to_dict(
    *,
    step: Any,
    revision: Any,
    order_id: uuid.UUID | None,
    finalization_status: str | None,
    remaining_gates: list[str],
) -> dict:
    return {
        "approvalRequestId": str(step.id),
        "stepStatus": step.status,
        "revisionApprovalStatus": revision.approval_status,
        "orderId": str(order_id) if order_id else None,
        "finalizationStatus": finalization_status,
        "remainingGates": list(remaining_gates),
    }


def escalation_to_dict(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "quoteId": str(row["quote_id"]),
        "revisionId": str(row["revision_id"]),
        "reference": row.get("reference"),
        "raisedBy": str(row["raised_by"]),
        "category": row["category"],
        "targetRole": row["target_role"],
        "reason": row["reason"],
        "status": row["status"],
        "resolution": row.get("resolution"),
        "createdAt": _iso(row.get("created_at")),
        "resolvedAt": _iso(row.get("resolved_at")),
    }


def negotiation_view_to_dict(
    record: Any, raised_by: str | None, responded_by: str | None, payload: dict
) -> dict:
    return {
        "id": str(record.id),
        "requestType": record.request_type,
        "lineKey": record.line_key,
        "message": record.message,
        "status": record.status,
        "responseMessage": record.response_message,
        "revisionId": str(record.revision_id),
        "candidateRevisionId": (
            str(record.candidate_revision_id) if record.candidate_revision_id else None
        ),
        "raisedBy": raised_by,
        "respondedBy": responded_by,
        "createdAt": _iso(record.created_at),
        "respondedAt": _iso(record.responded_at),
        "payload": payload,
    }
