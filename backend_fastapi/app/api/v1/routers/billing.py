"""Billing router — port of billing/controller/{BillingController,PlanSwitchController}."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Body, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, idempotency_key, require_roles
from app.api.deps import require_internal as _require_internal
from app.api.paging import page_size_or_default
from app.core.database import get_db
from app.core.exceptions import ApiException, ErrorCode
from app.core.response import ApiResponse, PageResponse
from app.core.security import Actor
from app.models.billing import (
    CreditNote,
    Invoice,
    InvoiceLine,
    Payment,
    PaymentAllocation,
    Subscription,
)
from app.models.catalog import Customer, SubscriptionPlan
from app.schemas.billing import (
    CancelSubscriptionRequest,
    PlanChangeRequest,
    RecordPaymentRequest,
    RecordRefundRequest,
    SubscriptionChangeRequest,
    credit_note_response,
    invoice_response,
    payment_response,
    refund_response,
    subscription_response,
)
from app.services import billing_service, invoice_exporter, settlement_service, subscription_service
from app.services import idempotency_service

router = APIRouter()


async def _invoice_lines(db: AsyncSession, invoice_id: uuid.UUID) -> list[InvoiceLine]:
    return (
        await db.execute(
            select(InvoiceLine).where(InvoiceLine.invoice_id == invoice_id).order_by(InvoiceLine.position.asc())
        )
    ).scalars().all()


async def _customer_name(db: AsyncSession, customer_id: uuid.UUID) -> str | None:
    c = (await db.execute(select(Customer).where(Customer.id == customer_id))).scalars().first()
    return c.name if c else None


async def _customer(db: AsyncSession, customer_id: uuid.UUID):
    return (await db.execute(select(Customer).where(Customer.id == customer_id))).scalars().first()


async def _to_invoice(db: AsyncSession, invoice: Invoice) -> dict:
    lines = await _invoice_lines(db, invoice.id)
    name = await _customer_name(db, invoice.customer_id)
    return invoice_response(invoice, lines, name)


async def _to_subscription(db: AsyncSession, sub: Subscription) -> dict:
    name = await _customer_name(db, sub.customer_id)
    plan = (await db.execute(select(SubscriptionPlan).where(SubscriptionPlan.id == sub.plan_id))).scalars().first()
    return subscription_response(sub, name, plan.name if plan else None)


async def _to_payment(db: AsyncSession, payment: Payment, allocs: list[PaymentAllocation]) -> dict:
    details = []
    for a in allocs:
        inv = (await db.execute(select(Invoice).where(Invoice.id == a.invoice_id))).scalars().first()
        details.append({
            "invoiceId": a.invoice_id,
            "invoiceReference": inv.reference if inv else None,
            "amountMinor": a.amount_minor,
            "invoiceOutstandingMinor": (max(0, inv.total_minor - inv.credited_minor - inv.paid_minor) if inv else None),
            "invoiceStatus": inv.status if inv else None,
        })
    return payment_response(payment, details)


# ------------------------------------------------------------- invoices ---

@router.get("/api/v1/invoices/{id}/export")
async def export_invoice(
    id: uuid.UUID,
    format: str = Query(default="pdf"),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_require_internal),
) -> Response:
    invoice = await billing_service.get_invoice(db, actor, id)
    full = await _to_invoice(db, invoice)
    lines = full["lines"]
    customer = await _customer(db, invoice.customer_id)
    fmt = (format or "pdf").lower()
    if fmt == "pdf":
        body = invoice_exporter.export_invoice_pdf(full, lines, customer)
        media = "application/pdf"
        ext = "pdf"
    elif fmt in ("xlsx", "excel"):
        body = invoice_exporter.export_invoice_xlsx(full, lines, customer)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ext = "xlsx"
    elif fmt in ("doc", "docx", "word"):
        body = invoice_exporter.export_invoice_doc(full, lines, customer)
        media = "application/msword"
        ext = "doc"
    else:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "format must be pdf, xlsx or doc.")
    return Response(
        content=body,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="invoice-{invoice.reference}.{ext}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/api/v1/invoices")
async def list_invoices(
    customerId: uuid.UUID | None = Query(default=None),
    orderId: uuid.UUID | None = Query(default=None),
    page: int | None = Query(default=None),
    pageSize: int | None = Query(default=None, alias="pageSize"),
    sort: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_require_internal),
) -> dict:
    rows, pg, size, total = await billing_service.list_invoices(
        db, actor, customer_id=customerId, order_id=orderId, page=page, page_size=pageSize, sort=sort,
    )
    items = [await _to_invoice(db, r) for r in rows]
    if orderId is not None:
        return PageResponse.of(items, 0, len(items), len(items))
    return PageResponse.of(items, pg, size, total)


@router.get("/api/v1/invoices/{id}")
async def get_invoice(
    id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_require_internal),
) -> dict:
    invoice = await billing_service.get_invoice(db, actor, id)
    return ApiResponse.of(await _to_invoice(db, invoice))


# -------------------------------------------------------- subscriptions ---

@router.get("/api/v1/subscriptions")
async def list_subscriptions(
    customerId: uuid.UUID | None = Query(default=None),
    orderId: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_require_internal),
) -> dict:
    rows = await billing_service.list_subscriptions(db, actor, customer_id=customerId, order_id=orderId)
    return ApiResponse.of([await _to_subscription(db, r) for r in rows])


@router.get("/api/v1/subscriptions/{id}")
async def get_subscription(
    id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_require_internal),
) -> dict:
    sub = await billing_service.get_subscription(db, actor, id)
    return ApiResponse.of(await _to_subscription(db, sub))


@router.post("/api/v1/subscriptions/{id}/change-previews")
async def preview_change(
    id: uuid.UUID,
    body: SubscriptionChangeRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
) -> dict:
    return ApiResponse.of(await subscription_service.preview_quantity_change(db, id, body))


@router.post("/api/v1/subscriptions/{id}/changes")
async def apply_change(
    id: uuid.UUID,
    body: SubscriptionChangeRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
    key: str = Depends(idempotency_key),
) -> dict:
    return ApiResponse.of(await subscription_service.apply_quantity_change(db, actor, id, key, body))


@router.post("/api/v1/subscriptions/{id}/cancellations")
async def cancel_subscription(
    id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
    key: str = Depends(idempotency_key),
    body: CancelSubscriptionRequest | None = Body(default=None),
) -> dict:
    req = body or CancelSubscriptionRequest()
    return ApiResponse.of(await subscription_service.cancel_subscription(db, actor, id, key, req))


@router.post("/api/v1/subscriptions/{id}/plan-change-previews")
async def preview_plan_change(
    id: uuid.UUID,
    body: PlanChangeRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
) -> dict:
    return ApiResponse.of(await subscription_service.preview_plan_change(db, id, body))


@router.post("/api/v1/subscriptions/{id}/plan-changes")
async def apply_plan_change(
    id: uuid.UUID,
    body: PlanChangeRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
    key: str = Depends(idempotency_key),
) -> dict:
    payload = body.model_dump(mode="json")

    async def _handler() -> tuple[int, dict, uuid.UUID | None]:
        preview = await subscription_service.apply_plan_change(db, actor, id, key, body)
        return 200, preview, None

    _status, data, _entity, _replayed = await idempotency_service.execute(
        db, actor, f"plan-switch:{id}", key, payload, _handler,
    )
    return ApiResponse.of(data)


# ------------------------------------------------------------- payments ---

@router.post("/api/v1/payments")
async def record_payment(
    body: RecordPaymentRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
    key: str = Depends(idempotency_key),
) -> dict:
    payload = body.model_dump(mode="json")

    async def _handler() -> tuple[int, dict, uuid.UUID | None]:
        outcome = await settlement_service.record_payment(db, actor, body)
        resp = await _to_payment(db, outcome["payment"], outcome["allocations"])
        return 200, resp, outcome["payment"].id

    _status, data, _entity, _replayed = await idempotency_service.execute(
        db, actor, "record-payment", key, payload, _handler,
    )
    return ApiResponse.of(data)


@router.get("/api/v1/payments")
async def list_payments(
    customerId: uuid.UUID = Query(),
    page: int | None = Query(default=None),
    pageSize: int | None = Query(default=None, alias="pageSize"),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_require_internal),
) -> dict:
    pg = max(0, page or 0)
    size = page_size_or_default(pageSize)
    total = (
        await db.execute(select(func.count()).select_from(Payment).where(Payment.customer_id == customerId))
    ).scalar_one()
    rows = (
        await db.execute(
            select(Payment)
            .where(Payment.customer_id == customerId)
            .order_by(Payment.recorded_at.desc())
            .offset(pg * size)
            .limit(size)
        )
    ).scalars().all()
    items = []
    for p in rows:
        allocs = (await db.execute(select(PaymentAllocation).where(PaymentAllocation.payment_id == p.id))).scalars().all()
        items.append(await _to_payment(db, p, list(allocs)))
    return PageResponse.of(items, pg, size, int(total))


@router.post("/api/v1/refunds")
async def record_refund(
    body: RecordRefundRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
    key: str = Depends(idempotency_key),
) -> dict:
    payload = body.model_dump(mode="json")

    async def _handler() -> tuple[int, dict, uuid.UUID | None]:
        refund = await settlement_service.record_refund(db, actor, body)
        return 200, refund_response(refund), refund.id

    _status, data, _entity, _replayed = await idempotency_service.execute(
        db, actor, "record-refund", key, payload, _handler,
    )
    return ApiResponse.of(data)


@router.get("/api/v1/credit-notes")
async def list_credit_notes(
    customerId: uuid.UUID = Query(),
    page: int | None = Query(default=None),
    pageSize: int | None = Query(default=None, alias="pageSize"),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_require_internal),
) -> dict:
    pg = max(0, page or 0)
    size = page_size_or_default(pageSize)
    total = (
        await db.execute(select(func.count()).select_from(CreditNote).where(CreditNote.customer_id == customerId))
    ).scalar_one()
    rows = (
        await db.execute(
            select(CreditNote)
            .where(CreditNote.customer_id == customerId)
            .order_by(CreditNote.created_at.desc())
            .offset(pg * size)
            .limit(size)
        )
    ).scalars().all()
    return PageResponse.of([credit_note_response(r) for r in rows], pg, size, int(total))


# Re-export for tests that resolve the actor directly.
_ = get_current_actor
