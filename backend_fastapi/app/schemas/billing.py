"""Billing request schemas + response dict builders — port of billing/dto/BillingDtos."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

from pydantic import BaseModel, Field, field_validator

from app.engines import shared_math as m
from app.schemas.money import MoneyInput


# ------------------------------------------------------------- requests ---

class PaymentAllocationInput(BaseModel):
    invoiceId: uuid.UUID
    amount: MoneyInput

    @field_validator("amount")
    @classmethod
    def _positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Every allocation must be greater than zero.")
        return v


class RecordPaymentRequest(BaseModel):
    customerId: uuid.UUID
    amount: MoneyInput
    method: str = Field(max_length=40)
    externalReference: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)
    allocations: list[PaymentAllocationInput] | None = None

    @field_validator("amount")
    @classmethod
    def _positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("A payment must be greater than zero.")
        return v

    @field_validator("method")
    @classmethod
    def _method(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("method is required.")
        return v.strip()


class RecordRefundRequest(BaseModel):
    creditNoteId: uuid.UUID
    amount: MoneyInput
    method: str = Field(max_length=40)
    externalReference: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("amount")
    @classmethod
    def _positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("A refund must be greater than zero.")
        return v

    @field_validator("method")
    @classmethod
    def _method(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("method is required.")
        return v.strip()


class SubscriptionChangeRequest(BaseModel):
    newQuantity: MoneyInput
    effectiveDate: date | None = None
    note: str | None = Field(default=None, max_length=500)

    @field_validator("newQuantity")
    @classmethod
    def _positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("newQuantity must be greater than zero.")
        return v


class PlanChangeRequest(BaseModel):
    newPlanId: uuid.UUID
    effectiveDate: date | None = None
    note: str | None = Field(default=None, max_length=500)
    expectedRowVersion: int | None = None


class CancelSubscriptionRequest(BaseModel):
    policy: str | None = None
    effectiveDate: date | None = None
    reason: str | None = Field(default=None, max_length=500)


# ------------------------------------------------------------ builders ---

def _major(minor: int) -> Decimal:
    return m.to_major(minor)


def invoice_response(invoice: Any, lines: list[Any], customer_name: str | None) -> dict:
    line_dicts = []
    for ln in lines:
        line_dicts.append({
            "id": ln.id,
            "description": ln.description,
            "quantity": ln.quantity,
            "unitPrice": _major(ln.unit_price_minor),
            "net": _major(ln.net_minor),
            "tax": _major(ln.tax_minor),
            "coverageStart": ln.coverage_start,
            "coverageEnd": ln.coverage_end,
            "lineType": ln.line_type,
        })
    total = getattr(invoice, "total_minor", 0) or 0
    credited = getattr(invoice, "credited_minor", 0) or 0
    paid = getattr(invoice, "paid_minor", 0) or 0
    outstanding = max(0, total - credited - paid)
    return {
        "id": invoice.id,
        "reference": invoice.reference,
        "customerId": invoice.customer_id,
        "customerName": customer_name,
        "orderId": invoice.order_id,
        "subscriptionId": invoice.subscription_id,
        "invoiceKind": invoice.invoice_kind,
        "status": invoice.status,
        "currency": invoice.currency,
        "issueDate": invoice.issue_date,
        "dueDate": invoice.due_date,
        "net": _major(invoice.net_minor),
        "tax": _major(invoice.tax_minor),
        "total": _major(total),
        "credited": _major(credited),
        "paid": _major(paid),
        "outstanding": _major(outstanding),
        "lines": line_dicts,
    }


def payment_response(payment: Any, alloc_details: list[dict]) -> dict:
    allocated_minor = 0
    rows = []
    for a in alloc_details:
        allocated_minor += int(a.get("amountMinor", 0))
        rows.append({
            "invoiceId": a.get("invoiceId"),
            "invoiceReference": a.get("invoiceReference"),
            "amount": _major(int(a.get("amountMinor", 0))),
            "invoiceOutstanding": _major(int(a["invoiceOutstandingMinor"])) if a.get("invoiceOutstandingMinor") is not None else None,
            "invoiceStatus": a.get("invoiceStatus"),
        })
    return {
        "id": payment.id,
        "reference": payment.reference,
        "customerId": payment.customer_id,
        "amount": _major(payment.amount_minor),
        "allocated": _major(allocated_minor),
        "unallocated": _major(payment.amount_minor - allocated_minor),
        "method": payment.method,
        "externalReference": payment.external_reference,
        "recordedAt": payment.recorded_at,
        "allocations": rows,
    }


def credit_note_response(note: Any) -> dict:
    total = note.total_minor or 0
    applied = note.applied_minor or 0
    refunded = note.refunded_minor or 0
    return {
        "id": note.id,
        "reference": note.reference,
        "customerId": note.customer_id,
        "subscriptionId": note.subscription_id,
        "currency": note.currency,
        "reason": note.reason,
        "net": _major(note.net_minor),
        "tax": _major(note.tax_minor),
        "total": _major(total),
        "applied": _major(applied),
        "refunded": _major(refunded),
        "available": _major(max(0, total - applied - refunded)),
        "coverageStart": note.coverage_start,
        "coverageEnd": note.coverage_end,
        "status": note.status,
        "createdAt": note.created_at,
    }


def refund_response(refund: Any) -> dict:
    return {
        "id": refund.id,
        "reference": refund.reference,
        "creditNoteId": refund.credit_note_id,
        "amount": _major(refund.amount_minor),
        "method": refund.method,
        "recordedAt": refund.recorded_at,
    }


def subscription_response(sub: Any, customer_name: str | None, plan_name: str | None) -> dict:
    interval_net = int((Decimal(sub.quantity) * Decimal(sub.unit_interval_price_minor)).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    factor = m.monthly_normalisation_factor(sub.interval_months)
    mrr_minor = int((Decimal(interval_net) * factor).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    return {
        "id": sub.id,
        "reference": sub.reference,
        "orderId": sub.order_id,
        "customerId": sub.customer_id,
        "customerName": customer_name,
        "planId": sub.plan_id,
        "planName": plan_name,
        "currency": sub.currency,
        "quantity": sub.quantity,
        "unitIntervalPrice": _major(sub.unit_interval_price_minor),
        "intervalMonths": sub.interval_months,
        "cadence": m.cadence_label(sub.interval_months),
        "activationDate": sub.activation_date,
        "periodStart": sub.period_start,
        "periodEnd": sub.period_end,
        "nextBillAt": sub.next_bill_at,
        "status": sub.status,
        "cancelEffectiveDate": sub.cancel_effective_date,
        "prorationPolicy": sub.proration_policy,
        "cancellationPolicy": sub.cancellation_policy,
        "monthlyRecurringRevenue": _major(mrr_minor),
        "rowVersion": sub.row_version,
    }


def change_preview(
    *,
    subscription_id: uuid.UUID,
    change_type: str,
    effective_date: date,
    period_start: date,
    period_end: date,
    remaining_days: int,
    total_days: int,
    remaining_fraction: Decimal,
    prior_quantity: Decimal,
    new_quantity: Decimal,
    adjustment_net_minor: int,
    adjustment_tax_minor: int,
    explanation: str,
    adjustment_invoice_id: uuid.UUID | None,
    credit_note_id: uuid.UUID | None,
    applied: bool,
) -> dict:
    return {
        "subscriptionId": subscription_id,
        "changeType": change_type,
        "effectiveDate": effective_date,
        "periodStart": period_start,
        "periodEnd": period_end,
        "remainingDays": remaining_days,
        "totalDays": total_days,
        "remainingFraction": remaining_fraction,
        "priorQuantity": prior_quantity,
        "newQuantity": new_quantity,
        "adjustmentNet": _major(adjustment_net_minor),
        "adjustmentTax": _major(adjustment_tax_minor),
        "explanation": explanation,
        "adjustmentInvoiceId": adjustment_invoice_id,
        "creditNoteId": credit_note_id,
        "applied": applied,
    }


def plan_preview(
    *,
    subscription_id: uuid.UUID,
    new_plan_id: uuid.UUID,
    new_plan_name: str | None,
    row_version: int,
    effective_date: date,
    coverage_end: date,
    old_credit_net_minor: int,
    old_credit_tax_minor: int,
    new_charge_net_minor: int,
    new_charge_tax_minor: int,
    interval_changed: bool,
    explanation: str,
    invoice_id: uuid.UUID | None,
    credit_note_id: uuid.UUID | None,
    applied: bool,
) -> dict:
    return {
        "subscriptionId": subscription_id,
        "newPlanId": new_plan_id,
        "newPlanName": new_plan_name,
        "rowVersion": row_version,
        "effectiveDate": effective_date,
        "coverageEnd": coverage_end,
        "oldCreditNet": _major(old_credit_net_minor),
        "oldCreditTax": _major(old_credit_tax_minor),
        "newChargeNet": _major(new_charge_net_minor),
        "newChargeTax": _major(new_charge_tax_minor),
        "intervalChanged": interval_changed,
        "explanation": explanation,
        "invoiceId": invoice_id,
        "creditNoteId": credit_note_id,
        "applied": applied,
    }
