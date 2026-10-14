"""Settlement service — port of billing/service/SettlementService.java."""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import shared_math as m
from app.models.billing import CreditAllocation, CreditNote, Invoice, Payment, PaymentAllocation, Refund
from app.models.catalog import Customer
from app.repositories.sequences import (
    CREDIT_NOTE_REFERENCE_SEQ,
    PAYMENT_REFERENCE_SEQ,
    REFUND_REFERENCE_SEQ,
    nextval,
)
from app.services import audit_service, clock, outbox_writer


def _recompute_status(invoice: Invoice) -> None:
    if invoice.status in ("DRAFT", "VOID"):
        return
    outstanding = max(0, invoice.total_minor - invoice.credited_minor - invoice.paid_minor)
    if outstanding == 0:
        invoice.status = "PAID"
    elif (invoice.paid_minor or 0) > 0 or (invoice.credited_minor or 0) > 0:
        invoice.status = "PARTIALLY_PAID"
    else:
        invoice.status = "ISSUED"


async def _lock_invoices(db: AsyncSession, ids: list[uuid.UUID]) -> list[Invoice]:
    if not ids:
        return []
    ordered = sorted(ids)
    rows = (
        await db.execute(select(Invoice).where(Invoice.id.in_(ordered)).with_for_update())
    ).scalars().all()
    by_id = {r.id: r for r in rows}
    return [by_id[i] for i in ordered if i in by_id]


async def record_payment(db: AsyncSession, actor: Actor, request) -> dict:
    customer = (await db.execute(select(Customer).where(Customer.id == request.customerId))).scalars().first()
    if customer is None:
        raise ApiException.not_found(f"Customer {request.customerId}")
    amount_minor = m.to_minor(request.amount)
    if amount_minor <= 0:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "A payment must be greater than zero.")

    pay_no = await nextval(db, PAYMENT_REFERENCE_SEQ)
    payment = Payment(
        reference=f"PAY-{pay_no}",
        customer_id=customer.id,
        currency=customer.currency,
        amount_minor=amount_minor,
        method=request.method,
        external_reference=request.externalReference,
        note=request.note,
        recorded_by_profile_id=actor.profile_id,
        recorded_at=clock.now_utc(),
    )
    db.add(payment)
    await db.flush()

    allocs = request.allocations or []
    if not allocs:
        plan = await _auto_allocate(db, customer.id, amount_minor)
    else:
        plan = _explicit_allocation(allocs, amount_minor)

    created: list[PaymentAllocation] = []
    allocated = 0
    if plan:
        locked = await _lock_invoices(db, list(plan.keys()))
        by_id = {inv.id: inv for inv in locked}
        for inv_id, requested in plan.items():
            invoice = by_id.get(inv_id)
            if invoice is None:
                raise ApiException.not_found(f"Invoice {inv_id}")
            if invoice.customer_id != customer.id:
                raise ApiException.not_found(f"Invoice {inv_id}")
            if invoice.currency != customer.currency:
                raise ApiException(
                    ErrorCode.CURRENCY_MISMATCH,
                    f"Invoice {invoice.reference} is in another currency.",
                )
            if invoice.status not in ("ISSUED", "PARTIALLY_PAID"):
                raise ApiException.of(
                    ErrorCode.INVOICE_NOT_PAYABLE,
                    f"Invoice {invoice.reference} is {invoice.status.lower()}.",
                    invoiceId=str(invoice.id),
                )
            outstanding = max(0, invoice.total_minor - invoice.credited_minor - invoice.paid_minor)
            if requested > outstanding:
                raise ApiException.of(
                    ErrorCode.OVER_ALLOCATION,
                    f"Allocating {m.format_money(requested)} to invoice {invoice.reference} exceeds the {m.format_money(outstanding)} outstanding.",
                    invoiceId=str(invoice.id),
                    outstandingMinor=outstanding,
                )
            if requested <= 0:
                continue
            invoice.paid_minor += requested
            _recompute_status(invoice)
            row = PaymentAllocation(payment_id=payment.id, invoice_id=invoice.id, amount_minor=requested)
            db.add(row)
            created.append(row)
            allocated += requested
            await outbox_writer.publish(
                db, outbox_writer.INVOICE_UPDATED, "Invoice", invoice.id,
                invoice.row_version or 0,
                {"status": invoice.status, "outstandingMinor": max(0, invoice.total_minor - invoice.credited_minor - invoice.paid_minor)},
                outbox_writer.deal_scope(invoice.customer_id, None, None),
            )
    if allocated > amount_minor:
        raise ApiException(ErrorCode.OVER_ALLOCATION, "Allocations exceed the payment amount.")
    unallocated = amount_minor - allocated
    await audit_service.record(
        db, actor, "PAYMENT_RECORDED", "Payment", payment.id,
        after={"reference": payment.reference, "amountMinor": amount_minor, "allocatedMinor": allocated, "unallocatedMinor": unallocated},
        reason=request.note,
    )
    await db.flush()
    return {"payment": payment, "allocations": created, "allocatedMinor": allocated, "unallocatedMinor": unallocated}


async def _auto_allocate(db: AsyncSession, customer_id: uuid.UUID, amount_minor: int) -> dict[uuid.UUID, int]:
    rows = (
        await db.execute(
            select(Invoice)
            .where(
                Invoice.customer_id == customer_id,
                Invoice.status.in_(["ISSUED", "PARTIALLY_PAID"]),
            )
            .order_by(Invoice.due_date.asc().nulls_last(), Invoice.invoice_no.asc())
        )
    ).scalars().all()
    plan: dict[uuid.UUID, int] = {}
    remaining = amount_minor
    for inv in rows:
        if remaining <= 0:
            break
        outstanding = max(0, inv.total_minor - inv.credited_minor - inv.paid_minor)
        if outstanding <= 0:
            continue
        take = min(remaining, outstanding)
        plan[inv.id] = take
        remaining -= take
    return plan


def _explicit_allocation(allocs: list, amount_minor: int) -> dict[uuid.UUID, int]:
    plan: dict[uuid.UUID, int] = {}
    total = 0
    for a in allocs:
        amt = m.to_minor(a.amount)
        if amt <= 0:
            raise ApiException(ErrorCode.VALIDATION_FAILED, "Every allocation must be greater than zero.")
        if a.invoiceId in plan:
            raise ApiException(ErrorCode.VALIDATION_FAILED, "The same invoice appears twice in the allocation.")
        plan[a.invoiceId] = amt
        total += amt
    if total > amount_minor:
        raise ApiException.of(
            ErrorCode.OVER_ALLOCATION,
            f"Allocations total {m.format_money(total)} but the payment is {m.format_money(amount_minor)}.",
            allocatedMinor=total,
            paymentMinor=amount_minor,
        )
    return plan


async def apply_credit_to_open_invoices(db: AsyncSession, note: CreditNote, actor: Actor) -> int:
    available = max(0, note.total_minor - note.applied_minor - note.refunded_minor)
    if available <= 0:
        return 0
    open_rows = (
        await db.execute(
            select(Invoice)
            .where(
                Invoice.customer_id == note.customer_id,
                Invoice.status.in_(["ISSUED", "PARTIALLY_PAID"]),
            )
            .order_by(Invoice.due_date.asc().nulls_last(), Invoice.invoice_no.asc())
        )
    ).scalars().all()
    if not open_rows:
        return 0
    locked = await _lock_invoices(db, [r.id for r in open_rows])
    applied = 0
    for invoice in locked:
        if available <= 0:
            break
        if invoice.status not in ("ISSUED", "PARTIALLY_PAID") or invoice.currency != note.currency:
            continue
        outstanding = max(0, invoice.total_minor - invoice.credited_minor - invoice.paid_minor)
        if outstanding <= 0:
            continue
        amount = min(available, outstanding)
        invoice.credited_minor += amount
        _recompute_status(invoice)
        db.add(CreditAllocation(credit_note_id=note.id, invoice_id=invoice.id, amount_minor=amount))
        note.applied_minor += amount
        if note.status != "VOID":
            used = note.applied_minor + note.refunded_minor
            if used >= note.total_minor:
                note.status = "APPLIED"
            elif used > 0:
                note.status = "PARTIALLY_APPLIED"
        available -= amount
        applied += amount
        await outbox_writer.publish(
            db, outbox_writer.INVOICE_UPDATED, "Invoice", invoice.id,
            invoice.row_version or 0,
            {"status": invoice.status, "creditedMinor": invoice.credited_minor},
            outbox_writer.deal_scope(invoice.customer_id, None, None),
        )
    if applied > 0:
        await audit_service.record(
            db, actor, "CREDIT_APPLIED", "CreditNote", note.id,
            after={"appliedMinor": applied, "remainingMinor": max(0, note.total_minor - note.applied_minor - note.refunded_minor)},
        )
    await db.flush()
    return applied


async def record_refund(db: AsyncSession, actor: Actor, request) -> Refund:
    note = (
        await db.execute(select(CreditNote).where(CreditNote.id == request.creditNoteId).with_for_update())
    ).scalars().first()
    if note is None:
        raise ApiException.not_found(f"Credit note {request.creditNoteId}")
    amount_minor = m.to_minor(request.amount)
    if amount_minor <= 0:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "A refund must be greater than zero.")
    available = max(0, note.total_minor - note.applied_minor - note.refunded_minor)
    if amount_minor > available:
        raise ApiException.of(
            ErrorCode.REFUND_EXCEEDS_ELIGIBLE,
            f"Only {m.format_money(available)} of this credit note is unused.",
            availableMinor=available,
        )
    received = (await db.execute(select(func.coalesce(func.sum(Payment.amount_minor), 0)).where(Payment.customer_id == note.customer_id))).scalar_one()
    already = (await db.execute(select(func.coalesce(func.sum(Refund.amount_minor), 0)).where(Refund.customer_id == note.customer_id))).scalar_one()
    refundable = int(received or 0) - int(already or 0)
    if amount_minor > refundable:
        raise ApiException.of(
            ErrorCode.REFUND_EXCEEDS_ELIGIBLE,
            f"This customer has paid {m.format_money(int(received or 0))} and been refunded {m.format_money(int(already or 0))}. At most {m.format_money(max(0, refundable))} can be refunded.",
            refundableMinor=max(0, refundable),
        )
    ref_no = await nextval(db, REFUND_REFERENCE_SEQ)
    refund = Refund(
        reference=f"REF-{ref_no}",
        customer_id=note.customer_id,
        credit_note_id=note.id,
        currency=note.currency,
        amount_minor=amount_minor,
        method=request.method,
        external_reference=request.externalReference,
        note=request.note,
        recorded_by_profile_id=actor.profile_id,
        recorded_at=clock.now_utc(),
    )
    db.add(refund)
    note.refunded_minor += amount_minor
    if note.status != "VOID":
        used = note.applied_minor + note.refunded_minor
        if used >= note.total_minor:
            note.status = "APPLIED"
        elif used > 0:
            note.status = "PARTIALLY_APPLIED"
    await audit_service.record(
        db, actor, "REFUND_RECORDED", "Refund", refund.id,
        after={"reference": refund.reference, "amountMinor": amount_minor, "creditNoteId": str(note.id)},
        reason=request.note,
    )
    await db.flush()
    return refund
