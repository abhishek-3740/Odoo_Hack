"""BILLING domain verification — invoices, subscriptions, payments, credits,
refunds, quantity changes, cancellations, plan switches and exports."""

from __future__ import annotations

import asyncio
import uuid
from datetime import date, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.v1.routers.billing import router as billing_router
from app.core.security import Actor
from app.engines import shared_math as m
from app.main import create_app
from app.models.auth import Profile
from app.models.billing import Invoice, InvoiceLine, Subscription
from app.models.catalog import Category, Customer, Product, SubscriptionPlan
from app.models.orders import Order, OrderLine
from app.models.quotes import Quote, QuoteLine, QuoteRevision
from app.repositories.sequences import INVOICE_NUMBER_SEQ, nextval
from app.services.clock import business_today
from tests.itutil import TestSession, override_app_deps, unique

UNIT_PRICE = 30000  # 300.00 / interval
QTY = Decimal(10)


def _finance_actor(profile_id) -> Actor:
    return Actor(
        profile_id=profile_id, auth_user_id=uuid.uuid4(),
        email=f"{unique('fin')}@test.dev", role="FINANCE",
    )


async def _seed(*, qty=QTY, unit_price=UNIT_PRICE, interval=1,
                cancellation="END_OF_PERIOD", anchor="ACTIVATION_DATE",
                with_second_invoice=False) -> dict:
    async with TestSession() as db:
        profile = Profile(
            auth_user_id=uuid.uuid4(), email=f"{unique('rep')}@test.dev",
            full_name="Bill Rep", role="FINANCE", is_active=True,
        )
        db.add(profile)
        await db.flush()
        customer = Customer(
            name=unique("Cust"), tier="BRONZE", currency="INR",
            owner_rep_profile_id=profile.id, is_active=True,
        )
        db.add(customer)
        await db.flush()
        category = Category(code=unique("CAT"), name="Subs", kind="SUBSCRIPTION")
        db.add(category)
        await db.flush()
        product = Product(
            category_id=category.id, code=unique("PRD"), name="Support",
            base_price_minor=unit_price, base_cost_minor=0, currency="INR",
            tax_rate_bp=0, fulfillment_kind="NONE", charge_kind="RECURRING",
            is_active=True,
        )
        db.add(product)
        await db.flush()
        plan = SubscriptionPlan(
            product_id=product.id, code=unique("PLAN"), name="Support-M",
            interval_months=interval, currency="INR",
            interval_price_minor=unit_price, interval_cost_minor=0,
            tax_rate_bp=0, billing_anchor=anchor,
            proration_policy="IMMEDIATE_PRORATED",
            cancellation_policy=cancellation, clawback_policy="NONE",
            is_active=True,
        )
        db.add(plan)
        await db.flush()
        plan_y = SubscriptionPlan(
            product_id=product.id, code=unique("PLAN"), name="Support-Y",
            interval_months=12, currency="INR",
            interval_price_minor=unit_price * 12, interval_cost_minor=0,
            tax_rate_bp=0, billing_anchor="ACTIVATION_DATE",
            proration_policy="IMMEDIATE_PRORATED",
            cancellation_policy="END_OF_PERIOD", clawback_policy="NONE",
            is_active=True,
        )
        db.add(plan_y)
        await db.flush()
        today = business_today()
        quote = Quote(
            reference=unique("Q"), customer_id=customer.id,
            owner_profile_id=profile.id, stage="CONFIRMED",
            valid_until=today + timedelta(days=30), revision_count=1,
        )
        db.add(quote)
        await db.flush()
        revision = QuoteRevision(
            quote_id=quote.id, revision_no=1, source="SELLER", status="SUBMITTED",
            currency="INR", approval_status="NOT_REQUIRED", required_level="NONE",
            backorder_terms="ALLOW_BACKORDER", invoicing_terms="ON_CONFIRMATION",
        )
        db.add(revision)
        await db.flush()
        qline = QuoteLine(
            revision_id=revision.id, line_key="L1", position=0,
            line_kind="RECURRING", product_id=product.id,
            category_id=category.id, plan_id=plan.id,
            description="Support", quantity=qty,
            unit_price_minor=unit_price, unit_cost_minor=0, tax_rate_bp=0,
            line_discount_bp=0, applied_order_discount_bp=0,
            effective_discount_bp=0, base_minor=unit_price * int(qty),
            net_minor=unit_price * int(qty), tax_minor=0,
            cost_total_minor=0, margin_minor=unit_price * int(qty),
            interval_months=interval, source="MANUAL",
        )
        db.add(qline)
        await db.flush()
        quote.current_revision_id = revision.id
        order = Order(
            reference=unique("SO"), quote_id=quote.id, revision_id=revision.id,
            customer_id=customer.id, owner_profile_id=profile.id,
            currency="INR", backorder_terms="ALLOW_BACKORDER",
        )
        db.add(order)
        await db.flush()
        oline = OrderLine(
            order_id=order.id, quote_line_id=qline.id, line_key="L1",
            position=0, line_kind="RECURRING", product_id=product.id,
            category_id=category.id, plan_id=plan.id,
            description="Support", quantity=qty,
            unit_price_minor=unit_price, unit_cost_minor=0, tax_rate_bp=0,
            net_minor=unit_price * int(qty), tax_minor=0,
            interval_months=interval,
        )
        db.add(oline)
        await db.flush()
        anchor_day = 1 if anchor == "CALENDAR_MONTH_START" else today.day
        period_end = m.next_boundary(today, anchor_day, interval)
        sub = Subscription(
            reference="SUB-" + uuid.uuid4().hex[:8].upper(),
            order_id=order.id, order_line_id=oline.id,
            customer_id=customer.id, plan_id=plan.id, currency="INR",
            quantity=qty, unit_interval_price_minor=unit_price,
            unit_interval_cost_minor=0, tax_rate_bp=0,
            interval_months=interval, anchor_day=anchor_day,
            billing_anchor=anchor, activation_date=today,
            period_start=today, period_end=period_end,
            next_bill_at=period_end, status="ACTIVE",
            proration_policy="IMMEDIATE_PRORATED",
            cancellation_policy=cancellation, clawback_policy="NONE",
        )
        db.add(sub)
        await db.flush()
        net = unit_price * int(qty)
        inv_no = await nextval(db, INVOICE_NUMBER_SEQ)
        invoice = Invoice(
            invoice_no=inv_no, reference=f"INV-{inv_no}",
            customer_id=customer.id, order_id=order.id,
            subscription_id=sub.id, invoice_kind="RECURRING",
            currency="INR", status="ISSUED",
            issue_date=today, due_date=today + timedelta(days=15),
            net_minor=net, tax_minor=0, total_minor=net,
            credited_minor=0, paid_minor=0,
        )
        db.add(invoice)
        await db.flush()
        db.add(InvoiceLine(
            invoice_id=invoice.id, subscription_id=sub.id,
            position=0, description=f"Support (monthly, {today} to {period_end})",
            quantity=qty, unit_price_minor=unit_price,
            net_minor=net, tax_rate_bp=0, tax_minor=0,
            coverage_start=today, coverage_end=period_end,
            line_type="RECURRING",
            charge_key=f"sub:{sub.id}|{today}|{period_end}|RECURRING|base",
        ))
        await db.flush()
        second_id = None
        if with_second_invoice:
            inv_no2 = await nextval(db, INVOICE_NUMBER_SEQ)
            older_due = today + timedelta(days=5)
            inv2 = Invoice(
                invoice_no=inv_no2, reference=f"INV-{inv_no2}",
                customer_id=customer.id, order_id=order.id,
                invoice_kind="RECURRING", currency="INR",
                status="ISSUED", issue_date=today,
                due_date=older_due, net_minor=10000, tax_minor=0,
                total_minor=10000, credited_minor=0, paid_minor=0,
            )
            db.add(inv2)
            await db.flush()
            db.add(InvoiceLine(
                invoice_id=inv2.id, position=0, description="Older charge",
                quantity=Decimal(1), unit_price_minor=10000,
                net_minor=10000, tax_rate_bp=0, tax_minor=0,
                line_type="RECURRING",
            ))
            await db.flush()
            # make the main invoice due later so ordering is deterministic
            invoice.due_date = today + timedelta(days=15)
            second_id = inv2.id
        await db.commit()
        return {
            "profile_id": profile.id, "customer_id": customer.id,
            "plan_id": plan.id, "plan_y_id": plan_y.id,
            "product_id": product.id, "order_id": order.id,
            "sub_id": sub.id, "invoice_id": invoice.id,
            "second_invoice_id": second_id,
            "period_end": period_end, "today": today,
        }


_HELD: list = []


def _client(profile_id) -> TestClient:
    app = create_app()
    app.include_router(billing_router)
    ctx = override_app_deps(app, _finance_actor(profile_id))
    ctx.__enter__()
    _HELD.append(ctx)
    return TestClient(app, raise_server_exceptions=False)


# ------------------------------------------------------- qty changes ---

def test_quantity_preview_apply_replay_and_backdate():
    seed = asyncio.run(_seed())
    client = _client(seed["profile_id"])
    sid = str(seed["sub_id"])
    preview = client.post(f"/api/v1/subscriptions/{sid}/change-previews",
                          json={"newQuantity": "15"}).json()["data"]
    assert preview["applied"] is False
    assert preview["adjustmentNet"] == "1500.00"
    assert preview["remainingDays"] == preview["totalDays"]
    key = unique("key")
    applied = client.post(f"/api/v1/subscriptions/{sid}/changes",
                          headers={"Idempotency-Key": key},
                          json={"newQuantity": "15"}).json()["data"]
    assert applied["applied"] is True
    assert applied["adjustmentNet"] == "1500.00"
    assert applied["adjustmentInvoiceId"]
    replay = client.post(f"/api/v1/subscriptions/{sid}/changes",
                         headers={"Idempotency-Key": key},
                         json={"newQuantity": "15"}).json()["data"]
    assert replay["applied"] is True
    assert replay["adjustmentInvoiceId"] == applied["adjustmentInvoiceId"]
    bad = client.post(f"/api/v1/subscriptions/{sid}/changes",
                      headers={"Idempotency-Key": unique("key")},
                      json={"newQuantity": "20",
                            "effectiveDate": str(seed["today"] - timedelta(days=1))})
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "BACKDATED_CHANGE_REJECTED"


def test_cancel_immediate_credits_and_refund_guard():
    seed = asyncio.run(_seed(cancellation="IMMEDIATE_PRORATED"))
    client = _client(seed["profile_id"])
    sid = str(seed["sub_id"])
    cancelled = client.post(f"/api/v1/subscriptions/{sid}/cancellations",
                            headers={"Idempotency-Key": unique("key")},
                            json={"policy": "IMMEDIATE_PRORATED"}).json()["data"]
    assert cancelled["applied"] is True
    assert cancelled["creditNoteId"]
    sub = client.get(f"/api/v1/subscriptions/{sid}").json()["data"]
    assert sub["status"] == "CANCELED"
    notes = client.get("/api/v1/credit-notes",
                       params={"customerId": str(seed["customer_id"])}).json()["data"]
    assert len(notes) >= 1
    cn_id = cancelled["creditNoteId"]
    refund = client.post("/api/v1/refunds",
                         headers={"Idempotency-Key": unique("key")},
                         json={"creditNoteId": cn_id, "amount": "10.00",
                               "method": "BANK"})
    assert refund.status_code == 422
    assert refund.json()["error"]["code"] == "REFUND_EXCEEDS_ELIGIBLE"


# ------------------------------------------------------------- payments ---

def test_payment_auto_alloc_oldest_first_over_alloc_and_replay():
    seed = asyncio.run(_seed(with_second_invoice=True))
    client = _client(seed["profile_id"])
    cust = str(seed["customer_id"])
    first = str(seed["invoice_id"])
    second = str(seed["second_invoice_id"])
    # oldest-due-first: second invoice (due +5) before main (due +15)
    resp = client.post("/api/v1/payments",
                       headers={"Idempotency-Key": unique("key")},
                       json={"customerId": cust, "amount": "150.00",
                             "method": "BANK"})
    assert resp.status_code == 200, resp.text
    body = resp.json()["data"]
    assert body["amount"] == "150.00"
    assert body["allocated"] == "150.00"
    assert body["allocations"][0]["invoiceId"] == second
    over = client.post("/api/v1/payments",
                       headers={"Idempotency-Key": unique("key")},
                       json={"customerId": cust, "amount": "50.00",
                             "method": "BANK",
                             "allocations": [{"invoiceId": first,
                                              "amount": "9999999.00"}]})
    assert over.status_code == 422
    assert over.json()["error"]["code"] == "OVER_ALLOCATION"
    key = unique("key")
    one = client.post("/api/v1/payments",
                      headers={"Idempotency-Key": key},
                      json={"customerId": cust, "amount": "25.00",
                            "method": "BANK"}).json()["data"]
    two = client.post("/api/v1/payments",
                      headers={"Idempotency-Key": key},
                      json={"customerId": cust, "amount": "25.00",
                            "method": "BANK"}).json()["data"]
    assert one["id"] == two["id"]
    listed = client.get("/api/v1/payments",
                        params={"customerId": cust}).json()
    assert listed["meta"]["total"] >= 2


# ---------------------------------------------------------- plan switch ---

def test_plan_switch_preview_apply_and_interval_change():
    seed = asyncio.run(_seed())
    client = _client(seed["profile_id"])
    sid = str(seed["sub_id"])
    sub_before = client.get(f"/api/v1/subscriptions/{sid}").json()["data"]
    row_version = sub_before["rowVersion"]
    preview = client.post(f"/api/v1/subscriptions/{sid}/plan-change-previews",
                          json={"newPlanId": str(seed["plan_y_id"])}).json()["data"]
    assert preview["applied"] is False
    assert preview["intervalChanged"] is True
    applied = client.post(f"/api/v1/subscriptions/{sid}/plan-changes",
                          headers={"Idempotency-Key": unique("key")},
                          json={"newPlanId": str(seed["plan_y_id"]),
                                "expectedRowVersion": row_version}).json()["data"]
    assert applied["applied"] is True
    assert applied["invoiceId"]
    sub_after = client.get(f"/api/v1/subscriptions/{sid}").json()["data"]
    assert sub_after["planId"] == str(seed["plan_y_id"])
    assert sub_after["intervalMonths"] == 12
    assert sub_after["cadence"] == "yearly"


# --------------------------------------------------------------- exports ---

def test_invoice_exports_magics():
    seed = asyncio.run(_seed())
    client = _client(seed["profile_id"])
    iid = str(seed["invoice_id"])
    pdf = client.get(f"/api/v1/invoices/{iid}/export", params={"format": "pdf"})
    assert pdf.status_code == 200
    assert pdf.content[:5] == b"%PDF-"
    assert "invoice-" in pdf.headers["Content-Disposition"]
    assert pdf.headers["Cache-Control"] == "no-store"
    xlsx = client.get(f"/api/v1/invoices/{iid}/export", params={"format": "xlsx"})
    assert xlsx.status_code == 200
    assert xlsx.content[:2] == b"PK"
    doc = client.get(f"/api/v1/invoices/{iid}/export", params={"format": "doc"})
    assert doc.status_code == 200
    text = doc.content.decode("utf-8")
    assert "TAX INVOICE" in text
    bad = client.get(f"/api/v1/invoices/{iid}/export", params={"format": "png"})
    assert bad.status_code == 400


def test_invoice_and_subscription_reads():
    seed = asyncio.run(_seed())
    client = _client(seed["profile_id"])
    iid = str(seed["invoice_id"])
    inv = client.get(f"/api/v1/invoices/{iid}").json()["data"]
    assert inv["outstanding"] == inv["total"]
    assert inv["lines"]
    by_order = client.get("/api/v1/invoices",
                          params={"orderId": str(seed["order_id"])}).json()["data"]
    assert any(r["id"] == iid for r in by_order)
    subs = client.get("/api/v1/subscriptions",
                      params={"customerId": str(seed["customer_id"])}).json()["data"]
    assert any(s["id"] == str(seed["sub_id"]) for s in subs)
