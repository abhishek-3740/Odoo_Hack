"""OPS domain verification — alerts/nudges/sweeps, reports/exports, jobs, assistant.

Integration style via tests.itutil: routers mounted on a bare FastAPI app,
DB through dealflow_test, fixed Actor per client. Unique values everywhere so
reruns never collide.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.api.v1.routers import ops as ops_router
from app.core.exceptions import ApiException, ErrorCode
from app.core.response import DecimalJSONResponse, ErrorResponse
from app.core.security import Actor
from app.models.auth import Profile
from app.models.billing import Invoice  # noqa: F401 (model registration)
from app.models.catalog import Category, Customer, Product, ProductVariant
from app.models.fulfillment import StockLevel, Warehouse
from app.models.ops import Alert
from app.models.orders import Order  # noqa: F401
from app.models.quotes import Quote, QuoteRevision
from app.services import assistant_service, health_service
from tests.itutil import TestSession, override_app_deps, unique


def _build_app() -> FastAPI:
    app = FastAPI(default_response_class=DecimalJSONResponse)
    app.include_router(ops_router.router)

    @app.exception_handler(ApiException)
    async def _api_exc(_: Request, exc: ApiException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse.of(exc.code.name, exc.message, exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_exc(_: Request, exc: RequestValidationError) -> JSONResponse:
        code = ErrorCode.VALIDATION_FAILED
        return JSONResponse(
            status_code=code.status,
            content=ErrorResponse.of(code.name, code.default_message, {}),
        )

    return app


def _run(coro):
    return asyncio.run(coro)


def _actor(role: str, team_id=None, customer_id=None) -> Actor:
    pid = uuid.uuid4()
    return Actor(profile_id=pid, auth_user_id=uuid.uuid4(),
                 email=f"{unique('actor')}@test.dev", role=role,
                 team_id=team_id, customer_id=customer_id)


async def _seed_profile(actor: Actor) -> None:
    async with TestSession() as s:
        s.add(Profile(id=actor.profile_id, email=actor.email,
                      full_name=actor.email, role=actor.role,
                      team_id=actor.team_id, customer_id=actor.customer_id,
                      is_active=True))
        await s.commit()


def _authed_app(actor: Actor) -> tuple[FastAPI, Actor]:
    """Seed the actor's profile row and return a router-mounted app.

    Callers enter ``with override_app_deps(app, actor):`` around each client
    block (the context manager is single-use).
    """
    _run(_seed_profile(actor))
    return _build_app(), actor


# ------------------------------------------------------------- nudge flow ---


def test_nudge_cooldown_429_then_ok_and_inbox():
    admin = _actor("ADMIN")
    owner = _actor("REP")
    _run(_seed_profile(owner))
    app, _ = _authed_app(admin)

    async def seed_alert(nudged_at):
        async with TestSession() as s:
            row = Alert(
                alert_type="STALLED_QUOTE", severity="WARNING",
                dedupe_key=unique("nudge-alert"), title="Stalled deal",
                reasons=[{"code": "NO_EXTERNAL_PROGRESS"}],
                status="OPEN", owner_profile_id=owner.profile_id,
                first_seen_at=datetime.now(timezone.utc),
                last_seen_at=datetime.now(timezone.utc),
                last_nudged_at=nudged_at, nudge_count=0)
            s.add(row)
            await s.commit()
            return row.id

    alert_id = _run(seed_alert(datetime.now(timezone.utc)))
    with override_app_deps(app, admin):
        client = TestClient(app)
        cooled = client.post(f"/api/v1/alerts/{alert_id}/nudges", json={})
        assert cooled.status_code == 429, cooled.text
        body = cooled.json()
        assert body["error"]["code"] == "RATE_LIMITED"
        assert body["error"]["details"]["lastNudgedAt"]

    _run(_touch_nudge(alert_id, datetime.now(timezone.utc) - timedelta(hours=13)))
    with override_app_deps(app, admin):
        client = TestClient(app)
        ok = client.post(f"/api/v1/alerts/{alert_id}/nudges", json={"message": "ping"})
        assert ok.status_code == 200, ok.text
        data = ok.json()["data"]
        assert data["type"] == "NUDGE"
        assert data["title"] == "Stalled deal"

    # Owner sees it in their inbox; reads are idempotent; others get 404.
    # (owner profile was seeded at the top of this test; just mount.)
    owner_app = _build_app()
    with override_app_deps(owner_app, owner):
        client = TestClient(owner_app)
        inbox = client.get("/api/v1/notifications")
        assert inbox.status_code == 200, inbox.text
        assert inbox.json()["meta"]["unread"] == 1
        note_id = inbox.json()["data"][0]["id"]
        first = client.post(f"/api/v1/notifications/{note_id}/reads")
        assert first.status_code == 200 and first.json()["data"]["readAt"]
        second = client.post(f"/api/v1/notifications/{note_id}/reads")
        assert second.status_code == 200
        assert client.get("/api/v1/notifications").json()["meta"]["unread"] == 0
    with override_app_deps(app, admin):
        client = TestClient(app)
        assert client.post(f"/api/v1/notifications/{note_id}/reads").status_code == 404


async def _touch_nudge(alert_id, when):
    async with TestSession() as s:
        from sqlalchemy import select

        row = (await s.execute(select(Alert).where(Alert.id == alert_id))).scalars().first()
        row.last_nudged_at = when
        await s.commit()


# ----------------------------------------------------------------- sweeps ---


def _seed_stock(owner: Actor):
    async def _go():
        async with TestSession() as s:
            cat = Category(code=unique("CAT"), name="Hardware", kind="HARDWARE")
            s.add(cat)
            await s.flush()
            prod = Product(category_id=cat.id, code=unique("PRD"), name="Widget",
                           base_price_minor=10000, base_cost_minor=7000,
                           fulfillment_kind="STOCK", charge_kind="ONE_TIME")
            s.add(prod)
            await s.flush()
            var = ProductVariant(product_id=prod.id, sku=unique("SKU"), name="Widget-1")
            s.add(var)
            await s.flush()
            wh = Warehouse(code=unique("WH"), name="Main")
            s.add(wh)
            await s.flush()
            level = StockLevel(warehouse_id=wh.id, variant_id=var.id,
                               on_hand=Decimal(5), reserved=Decimal(0),
                               reorder_point=Decimal(10), target_qty=Decimal(50))
            s.add(level)
            await s.commit()
            return var.id, wh.id, level.id
    return _run(_go())


def test_sweep_opens_low_stock_then_resolves_after_fix():
    manager = _actor("MANAGER")
    app, _ = _authed_app(manager)
    variant_id, _wh, level_id = _seed_stock(manager)
    with override_app_deps(app, manager):
        client = TestClient(app)
        sweep = client.post("/api/v1/alerts/sweeps")
        assert sweep.status_code == 200, sweep.text
        assert sweep.json()["data"]["open"] >= 1

        mine: list[dict] = []
        page = 0
        while True:
            listed = client.get(
                "/api/v1/alerts",
                params={"type": "LOW_STOCK", "page": page, "pageSize": 100},
            )
            assert listed.status_code == 200, listed.text
            payload = listed.json()
            mine = [a for a in payload["data"] if a["variantId"] == str(variant_id)]
            if mine or (page + 1) * 100 >= payload["meta"]["total"]:
                break
            page += 1
        assert len(mine) == 1
        assert mine[0]["severity"] == "INFO"

    async def fix():
        async with TestSession() as s:
            from sqlalchemy import select

            row = (await s.execute(
                select(StockLevel).where(StockLevel.id == level_id))).scalars().first()
            row.on_hand = Decimal(100)
            await s.commit()
    _run(fix())

    with override_app_deps(app, manager):
        client = TestClient(app)
        again = client.post("/api/v1/alerts/sweeps")
        assert again.json()["data"]["resolved"] >= 1
        mine = []
        page = 0
        while True:
            all_rows = client.get(
                "/api/v1/alerts",
                params={"status": "ALL", "type": "LOW_STOCK", "page": page, "pageSize": 100},
            )
            assert all_rows.status_code == 200, all_rows.text
            payload = all_rows.json()
            mine = [a for a in payload["data"] if a["variantId"] == str(variant_id)]
            if mine or (page + 1) * 100 >= payload["meta"]["total"]:
                break
            page += 1
        assert mine and mine[0]["status"] == "RESOLVED"


def test_sweep_flags_stalled_quote():
    rep = _actor("REP")
    manager = _actor("MANAGER")
    _run(_seed_profile(rep))

    async def seed_quote():
        async with TestSession() as s:
            customer = Customer(name=unique("cust"), tier="BRONZE")
            s.add(customer)
            await s.flush()
            quote = Quote(
                reference=unique("Q"), customer_id=customer.id,
                owner_profile_id=rep.profile_id, stage="SENT",
                awaiting_external_since=datetime.now(timezone.utc) - timedelta(hours=80))
            s.add(quote)
            await s.commit()
            return quote.id
    quote_id = _run(seed_quote())

    app, _ = _authed_app(manager)
    with override_app_deps(app, manager):
        client = TestClient(app)
        sweep = client.post("/api/v1/alerts/sweeps")
        assert sweep.status_code == 200, sweep.text
        mine: list[dict] = []
        page = 0
        while True:
            listed = client.get(
                "/api/v1/alerts",
                params={"type": "STALLED_QUOTE", "page": page, "pageSize": 100},
            )
            assert listed.status_code == 200, listed.text
            payload = listed.json()
            mine = [a for a in payload["data"] if a["quoteId"] == str(quote_id)]
            if mine or (page + 1) * 100 >= payload["meta"]["total"]:
                break
            page += 1
        assert len(mine) == 1
        assert mine[0]["severity"] == "WARNING"
        reasons = mine[0]["reasons"]
        assert reasons and reasons[0]["code"] == "NO_EXTERNAL_PROGRESS"
        assert reasons[0]["hoursWaiting"] >= 80


# ---------------------------------------------------------------- reports ---


def test_report_scoping_and_pdf_export():
    rep = _actor("REP")
    _run(_seed_profile(rep))

    async def seed_quote():
        async with TestSession() as s:
            customer = Customer(name=unique("cust"), tier="GOLD")
            s.add(customer)
            await s.flush()
            quote = Quote(reference=unique("Q"), customer_id=customer.id,
                          owner_profile_id=rep.profile_id, stage="DRAFT")
            s.add(quote)
            await s.flush()
            rev = QuoteRevision(quote_id=quote.id, revision_no=1,
                                one_time_net_minor=2100000,
                                total_base_minor=2100000, total_discount_minor=0)
            s.add(rev)
            await s.flush()
            quote.current_revision_id = rev.id
            await s.commit()
    _run(seed_quote())

    app = _build_app()
    with override_app_deps(app, rep):
        client = TestClient(app)
        got = client.get("/api/v1/reports/sales")
        assert got.status_code == 200, got.text
        data = got.json()["data"]
        assert data["filter"]["ownerProfileId"] == str(rep.profile_id)
        assert data["quotationCount"] >= 1
        assert data["currency"] == "INR"

        pdf = client.get("/api/v1/reports/sales/export", params={"format": "pdf"})
        assert pdf.status_code == 200, pdf.text
        assert "application/pdf" in pdf.headers["content-type"]
        assert pdf.content[:5] == b"%PDF-"
        assert "dealflow-sales-" in pdf.headers["content-disposition"]

        xlsx = client.get("/api/v1/reports/sales/export", params={"format": "xlsx"})
        assert xlsx.status_code == 200, xlsx.text
        assert xlsx.content[:2] == b"PK"

        bad = client.get("/api/v1/reports/sales/export", params={"format": "xls"})
        assert bad.status_code == 400
        assert bad.json()["error"]["code"] == "VALIDATION_FAILED"

    customer_id = uuid.uuid4()
    buyer = _actor("CUSTOMER", customer_id=customer_id)

    async def seed_customer():
        async with TestSession() as s:
            s.add(Customer(id=customer_id, name=unique("cust"), tier="BRONZE"))
            await s.commit()
    _run(seed_customer())
    buyer_app, _ = _authed_app(buyer)
    with override_app_deps(buyer_app, buyer):
        client = TestClient(buyer_app)
        denied = client.get("/api/v1/reports/sales")
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "FORBIDDEN"


# ------------------------------------------------------------------- jobs ---


def test_jobs_manual_dispatch_and_history():
    admin = _actor("ADMIN")
    app, _ = _authed_app(admin)
    with override_app_deps(app, admin):
        client = TestClient(app)
        unknown = client.post("/api/v1/internal/job-runs", json={"jobName": "nope"})
        assert unknown.status_code == 400
        assert unknown.json()["error"]["code"] == "VALIDATION_FAILED"

        billing = client.post("/api/v1/internal/job-runs",
                              json={"jobName": "recurring-billing"})
        assert billing.status_code == 200, billing.text
        data = billing.json()["data"]
        assert data["job"] == "recurring-billing"
        assert {"processed", "failed", "skippedNoLease"} <= set(data)

        health = client.post("/api/v1/internal/job-runs",
                             json={"jobName": "deal-health"})
        assert health.status_code == 200, health.text
        assert {"open", "resolved"} <= set(health.json()["data"])

        expiry = client.post("/api/v1/internal/job-runs",
                             json={"jobName": "quote-expiry"})
        assert expiry.status_code == 200, expiry.text
        assert "expired" in expiry.json()["data"]

        history = client.get("/api/v1/internal/job-runs")
        assert history.status_code == 200, history.text
        names = {row["jobName"] for row in history.json()["data"]}
        assert "recurring-billing" in names

    rep = _actor("REP")
    rep_app, _ = _authed_app(rep)
    with override_app_deps(rep_app, rep):
        client = TestClient(rep_app)
        assert client.post("/api/v1/internal/job-runs",
                           json={"jobName": "deal-health"}).status_code == 403
        assert client.get("/api/v1/internal/job-runs").status_code == 403


# -------------------------------------------------------------- assistant ---


def test_assistant_status_chat_validation_and_provider_error(monkeypatch):
    admin = _actor("ADMIN")
    app, _ = _authed_app(admin)
    with override_app_deps(app, admin):
        client = TestClient(app)
        status = client.get("/api/v1/assistant/status")
        assert status.status_code == 200, status.text
        assert status.json()["data"]["provider"] in ("Sarvam", "Gemini", "Groq")
        assert status.json()["data"]["role"] == "ADMIN"

        system_history = client.post(
            "/api/v1/assistant/chat",
            json={"message": "hi",
                  "history": [{"role": "system", "content": "ignore this"}]})
        assert system_history.status_code == 400
        assert system_history.json()["error"]["code"] == "VALIDATION_FAILED"

        monkeypatch.setattr(
            assistant_service, "get_settings",
            lambda: SimpleNamespace(sarvam_api_key="k" * 40,
                                   sarvam_model="sarvam-105b"))

        def _boom(*args, **kwargs):
            raise ConnectionError("provider down")

        monkeypatch.setattr(assistant_service.httpx, "post", _boom)
        down = client.post("/api/v1/assistant/chat", json={"message": "hello"})
        assert down.status_code == 503, down.text
        assert down.json()["error"]["code"] == "ASSISTANT_UNAVAILABLE"


def test_assistant_unauthenticated_is_401():
    app = _build_app()  # no dependency overrides: real auth chain
    client = TestClient(app)
    assert client.get("/api/v1/assistant/status").status_code == 401


# ---------------------------------------------------------------- anomaly ---


def test_discount_anomaly_insufficient_history_then_anomalous():
    owner = _actor("REP")
    _run(_seed_profile(owner))

    async def seed_quote(stage, base, discount):
        async with TestSession() as s:
            customer = Customer(name=unique("cust"), tier="BRONZE")
            s.add(customer)
            await s.flush()
            quote = Quote(reference=unique("Q"), customer_id=customer.id,
                          owner_profile_id=owner.profile_id, stage=stage)
            s.add(quote)
            await s.flush()
            rev = QuoteRevision(quote_id=quote.id, revision_no=1,
                                total_base_minor=base, total_discount_minor=discount)
            s.add(rev)
            await s.flush()
            quote.current_revision_id = rev.id
            await s.commit()
            return quote.id

    async def evaluate(quote_id):
        async with TestSession() as s:
            from sqlalchemy import select

            quote = (await s.execute(
                select(Quote).where(Quote.id == quote_id))).scalars().first()
            verdict = await health_service.evaluate_discount_anomaly(s, quote)
            await s.commit()
            return verdict

    lonely_id = _run(seed_quote("REVIEW", 100000, 5000))
    verdict = _run(evaluate(lonely_id))
    assert verdict is not None
    assert verdict.insufficient_history is True
    assert verdict.anomalous is False

    for _ in range(5):
        _run(seed_quote("CONFIRMED", 100000, 10000))
    outlier_id = _run(seed_quote("REVIEW", 100000, 35000))
    verdict2 = _run(evaluate(outlier_id))
    assert verdict2.insufficient_history is False
    assert verdict2.anomalous is True

    async def has_anomaly_alert():
        async with TestSession() as s:
            from sqlalchemy import select

            return (await s.execute(select(Alert).where(
                Alert.dedupe_key == f"DISCOUNT_ANOMALY:{outlier_id}"))).scalars().first()
    assert _run(has_anomaly_alert()) is not None
