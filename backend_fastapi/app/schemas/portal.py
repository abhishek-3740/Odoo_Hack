"""Portal request shapes + customer-facing response builders.

Port of portal/dto/{PortalDtos,PortalAccountDtos}.java.

The response builders below are the isolation boundary: they are separate
dict constructors with no field for unit cost, margin, policy thresholds or
internal approval data, so there is nothing to leak even by accident.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.engines import shared_math as m
from app.models.billing import Invoice
from app.models.catalog import Customer
from app.models.fulfillment import StockLevel, Warehouse
from app.models.orders import Order
from app.models.portal import NegotiationRequest
from app.models.quotes import Quote, QuoteLine, QuoteRevision
from app.schemas.money import MoneyInput
from app.services.clock import business_today

TERMINAL_STAGES = ("CONFIRMED", "CANCELED", "LOST", "EXPIRED")


def _qty(value: Decimal | None) -> Decimal | None:
    """Quantities compare by value: 1.000 renders as "1" on the wire.

    (Route dicts are pre-encoded by FastAPI's jsonable_encoder, which keeps
    DB scale, so builders normalise scale>2 themselves, mirroring
    Money.plainQuantity.)
    """
    if value is None:
        return None
    d = value if isinstance(value, Decimal) else Decimal(str(value))
    if d.as_tuple().exponent < -2:
        d = d.normalize()
    if d.as_tuple().exponent > 0:
        d = d.quantize(Decimal(1))
    return d


def _clears_approval(status: str) -> bool:
    return status in ("NOT_REQUIRED", "APPROVED")


# ------------------------------------------------------------- requests ---


class CounterLineRequest(BaseModel):
    lineKey: str = Field(max_length=64)
    quantity: MoneyInput | None = Field(default=None, gt=0)
    requestedDiscountBp: int | None = Field(default=None, ge=0, le=9999)


class PortalRequest(BaseModel):
    requestType: str
    lineKey: str | None = Field(default=None, max_length=64)
    message: str | None = Field(default=None, max_length=2000)
    lines: list[CounterLineRequest] | None = None
    requestedOrderDiscountBp: int | None = Field(default=None, ge=0, le=9999)
    expectedRevisionId: uuid.UUID


class AcceptanceRequest(BaseModel):
    revisionId: uuid.UUID
    commercialHash: str = Field(min_length=8, max_length=128)
    note: str | None = Field(default=None, max_length=500)


class QuoteRequestLine(BaseModel):
    variantId: uuid.UUID | None = None
    planId: uuid.UUID | None = None
    quantity: MoneyInput = Field(gt=0)


class QuoteRequest(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=2000)
    lines: list[QuoteRequestLine] = Field(min_length=1, max_length=50)


class AccountUpdateRequest(BaseModel):
    fullName: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    contactEmail: str | None = Field(default=None, max_length=200)
    contactPhone: str | None = Field(default=None, max_length=40)
    billingAddress: str | None = Field(default=None, max_length=500)


class PreferencesRequest(BaseModel):
    preferences: dict[str, Any]


class ChangePasswordRequest(BaseModel):
    currentPassword: str = Field(min_length=1, max_length=128)
    newPassword: str = Field(min_length=8, max_length=128)


class RecommendationRequest(BaseModel):
    variantId: uuid.UUID
    replaceLineKey: str | None = None
    expectedRevisionId: uuid.UUID


# ------------------------------------------------------------------ quotes ---


def quote_summary(quote: Quote, revision: QuoteRevision | None) -> dict[str, Any]:
    return {
        "id": str(quote.id),
        "reference": quote.reference,
        "title": quote.title,
        "status": customer_facing_status(quote, revision, False),
        "currency": revision.currency if revision else "INR",
        "oneTimeTotal": m.to_major(
            (revision.one_time_net_minor if revision else 0)
            + (revision.one_time_tax_minor if revision else 0)
        ),
        "validUntil": quote.valid_until,
        "updatedAt": quote.updated_at,
    }


def customer_facing_status(
    quote: Quote, revision: QuoteRevision | None, ordered: bool
) -> str:
    if ordered:
        return "CONFIRMED"
    match quote.stage:
        case "DRAFT" | "REVIEW":
            return "IN_PREPARATION"
        case "SENT":
            if revision is not None and revision.customer_accepted_at is not None:
                return "ACCEPTED_PENDING_CONFIRMATION"
            return "AWAITING_YOUR_REVIEW"
        case "UNDER_NEGOTIATION":
            return "UNDER_DISCUSSION"
        case "CONFIRMED":
            return "CONFIRMED"
        case "CANCELED":
            return "WITHDRAWN"
        case "LOST":
            return "CLOSED"
        case _:
            return "EXPIRED"


def status_message(
    quote: Quote, revision: QuoteRevision, ordered: bool, expired: bool
) -> str:
    if ordered:
        return "Your order is confirmed."
    if expired:
        return "This quotation has passed its validity date."
    if (
        revision.customer_accepted_at is not None
        and not _clears_approval(revision.approval_status)
    ):
        return (
            "Your acceptance is recorded. We are completing an internal approval "
            "before confirming the order."
        )
    if not _clears_approval(revision.approval_status):
        return "These terms are awaiting internal approval."
    if revision.customer_accepted_at is not None:
        return "Your acceptance is recorded. We are finalising your order."
    return "These terms are ready for your review."


async def _availability_for(
    db: AsyncSession, lines: list[QuoteLine]
) -> dict[uuid.UUID, tuple[Decimal, Any]]:
    """variant_id -> (total available, earliest expected receipt date|None).

    Plain sums over active warehouses only; no warehouse detail leaves here.
    """
    wanted = {ln.variant_id for ln in lines if ln.requires_stock and ln.variant_id}
    if not wanted:
        return {}
    rows = (
        await db.execute(
            select(
                StockLevel.variant_id,
                func.coalesce(func.sum(StockLevel.on_hand - StockLevel.reserved), 0),
                func.min(StockLevel.expected_receipt_date),
            )
            .join(Warehouse, Warehouse.id == StockLevel.warehouse_id)
            .where(StockLevel.variant_id.in_(wanted), Warehouse.is_active.is_(True))
            .group_by(StockLevel.variant_id)
        )
    ).all()
    return {vid: (Decimal(str(avail)), receipt) for vid, avail, receipt in rows}


def _availability_note(
    line: QuoteLine, stock: dict[uuid.UUID, tuple[Decimal, Any]]
) -> str | None:
    if not line.requires_stock or line.variant_id is None:
        return None
    entry = stock.get(line.variant_id)
    available = entry[0] if entry else Decimal(0)
    if available >= line.quantity:
        return "In stock"
    if entry is not None and entry[1] is not None:
        return f"Partly on backorder, expected {entry[1].isoformat()}"
    return "Partly on backorder, delivery date unconfirmed"


def portal_lines(
    lines: list[QuoteLine], stock: dict[uuid.UUID, tuple[Decimal, Any]]
) -> list[dict[str, Any]]:
    out = []
    for line in lines:
        out.append(
            {
                "lineKey": line.line_key,
                "description": line.description,
                "quantity": _qty(line.quantity),
                "unitPrice": m.to_major(line.unit_price_minor),
                "discountPercentBp": line.effective_discount_bp,
                "lineDiscountPercentBp": line.line_discount_bp,
                "lineTotal": m.to_major(line.net_minor),
                "tax": m.to_major(line.tax_minor),
                "billingCadence": "one-time"
                if line.interval_months is None
                else m.cadence_label(line.interval_months),
                "promisedDate": line.promised_date,
                "availabilityNote": _availability_note(line, stock),
            }
        )
    return out


def portal_totals(revision: QuoteRevision, lines: list[QuoteLine]) -> dict[str, Any]:
    buckets: dict[int, list[int]] = {}
    for line in lines:
        if line.interval_months is None:
            continue
        bucket = buckets.setdefault(line.interval_months, [0, 0])
        bucket[0] += line.net_minor
        bucket[1] += line.tax_minor
    recurring = [
        {
            "cadence": m.cadence_label(months),
            "amount": m.to_major(net),
            "tax": m.to_major(tax),
        }
        for months, (net, tax) in sorted(buckets.items())
    ]
    return {
        "currency": revision.currency,
        "oneTimeSubtotal": m.to_major(revision.one_time_net_minor),
        "oneTimeTax": m.to_major(revision.one_time_tax_minor),
        "oneTimeTotal": m.to_major(
            revision.one_time_net_minor + revision.one_time_tax_minor
        ),
        "recurring": recurring,
        "dueOnConfirmation": m.to_major(
            revision.one_time_net_minor + revision.one_time_tax_minor
        ),
    }


async def portal_activity(
    db: AsyncSession, quote_id: uuid.UUID
) -> list[dict[str, Any]]:
    rows = (
        await db.execute(
            select(NegotiationRequest)
            .where(NegotiationRequest.quote_id == quote_id)
            .order_by(NegotiationRequest.created_at.desc())
        )
    ).scalars().all()
    return [
        {
            "id": str(row.id),
            "requestType": row.request_type,
            "lineKey": row.line_key,
            "message": row.message,
            "status": row.status,
            "responseMessage": row.response_message,
            "fromCustomer": True,
            "createdAt": row.created_at,
            "respondedAt": row.responded_at,
        }
        for row in rows
    ]


async def portal_quote_detail(
    db: AsyncSession, quote: Quote, revision: QuoteRevision
) -> dict[str, Any]:
    lines = (
        await db.execute(
            select(QuoteLine)
            .where(QuoteLine.revision_id == revision.id)
            .order_by(QuoteLine.position.asc())
        )
    ).scalars().all()
    lines = list(lines)
    order = (
        await db.execute(select(Order).where(Order.quote_id == quote.id))
    ).scalars().first()
    stock = await _availability_for(db, lines)
    expired = quote.valid_until is not None and business_today() > quote.valid_until
    acceptable = (
        order is None
        and quote.stage not in TERMINAL_STAGES
        and not expired
        and revision.status == "SUBMITTED"
        and revision.customer_accepted_at is None
    )
    return {
        "id": str(quote.id),
        "reference": quote.reference,
        "title": quote.title,
        "revisionId": str(revision.id),
        "versionNumber": revision.revision_no,
        "status": customer_facing_status(quote, revision, order is not None),
        "statusMessage": status_message(quote, revision, order is not None, expired),
        "awaitingInternalApproval": not _clears_approval(revision.approval_status),
        "acceptable": acceptable,
        "acceptedByYou": revision.customer_accepted_at is not None,
        "acceptedAt": revision.customer_accepted_at,
        "orderPlaced": order is not None,
        "orderReference": order.reference if order else None,
        "validUntil": quote.valid_until,
        "expired": expired,
        "backorderTerms": revision.backorder_terms,
        "invoicingNote": (
            "Items ordered are invoiced on confirmation. Recurring charges are "
            "billed separately for each period."
        ),
        "orderDiscountBp": revision.order_discount_bp,
        "lines": portal_lines(lines, stock),
        "totals": portal_totals(revision, lines),
        "activity": await portal_activity(db, quote.id),
        "commercialHash": revision.commercial_hash,
    }


# ---------------------------------------------------------------- invoices ---


def invoice_summary(invoice: Invoice) -> dict[str, Any]:
    return {
        "id": str(invoice.id),
        "reference": invoice.reference,
        "status": invoice.status,
        "currency": invoice.currency,
        "total": m.to_major(invoice.total_minor),
        "outstanding": m.to_major(invoice.outstanding_minor()),
        "issueDate": invoice.issue_date,
        "dueDate": invoice.due_date,
    }


async def invoice_response(
    db: AsyncSession, invoice: Invoice, customer_name: str | None
) -> dict[str, Any]:
    from app.models.billing import InvoiceLine

    rows = (
        await db.execute(
            select(InvoiceLine)
            .where(InvoiceLine.invoice_id == invoice.id)
            .order_by(InvoiceLine.position.asc())
        )
    ).scalars().all()
    return {
        "id": str(invoice.id),
        "reference": invoice.reference,
        "customerId": str(invoice.customer_id),
        "customerName": customer_name,
        "orderId": str(invoice.order_id) if invoice.order_id else None,
        "subscriptionId": str(invoice.subscription_id)
        if invoice.subscription_id
        else None,
        "invoiceKind": invoice.invoice_kind,
        "status": invoice.status,
        "currency": invoice.currency,
        "issueDate": invoice.issue_date.isoformat() if invoice.issue_date else None,
        "dueDate": invoice.due_date.isoformat() if invoice.due_date else None,
        "net": m.to_major(invoice.net_minor),
        "tax": m.to_major(invoice.tax_minor),
        "total": m.to_major(invoice.total_minor),
        "credited": m.to_major(invoice.credited_minor),
        "paid": m.to_major(invoice.paid_minor),
        "outstanding": m.to_major(invoice.outstanding_minor()),
        "lines": [
            {
                "id": str(line.id),
                "description": line.description,
                "quantity": _qty(line.quantity),
                "unitPrice": m.to_major(line.unit_price_minor),
                "net": m.to_major(line.net_minor),
                "tax": m.to_major(line.tax_minor),
                "coverageStart": line.coverage_start.isoformat()
                if line.coverage_start
                else None,
                "coverageEnd": line.coverage_end.isoformat()
                if line.coverage_end
                else None,
                "lineType": line.line_type,
            }
            for line in rows
        ],
    }


# ----------------------------------------------------------------- account ---


def account_response(
    profile: Any,
    customer: Customer,
    manager: Any | None,
    provider: str,
    preferences: dict[str, Any],
) -> dict[str, Any]:
    return {
        "profileId": str(profile.id),
        "email": profile.email,
        "fullName": profile.full_name,
        "phone": profile.phone,
        "role": profile.role,
        "authProvider": provider,
        "canChangePassword": provider == "LOCAL",
        "memberSince": profile.created_at,
        "organisation": {
            "id": str(customer.id),
            "name": customer.name,
            "tier": customer.tier,
            "currency": customer.currency,
            "contactEmail": customer.contact_email,
            "contactPhone": customer.contact_phone,
            "billingAddress": customer.billing_address,
        },
        "accountManager": (
            {
                "name": manager.full_name or manager.email,
                "email": manager.email,
            }
            if manager is not None
            else None
        ),
        "preferences": preferences,
    }


def acceptance_response(
    quote_id: uuid.UUID,
    revision_id: uuid.UUID,
    conditional: bool,
    order_reference: str | None,
    remaining: list[str],
) -> dict[str, Any]:
    return {
        "quoteId": str(quote_id),
        "revisionId": str(revision_id),
        "accepted": True,
        "conditional": conditional,
        "message": (
            "Thanks — your acceptance is recorded. We will confirm once the "
            "remaining internal steps are complete."
            if conditional
            else "Thanks — your order is confirmed."
        ),
        "orderReference": order_reference,
        "remainingSteps": remaining,
    }
