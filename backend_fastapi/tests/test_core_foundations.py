"""Step A verification — core foundations contract tests (no DB, no Docker)."""

from __future__ import annotations

import json
from decimal import Decimal

from fastapi import Query
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.config import _to_asyncpg_url
from app.core.exceptions import ApiException, ErrorCode
from app.core.response import (
    ApiResponse,
    DecimalJSONResponse,
    DecimalStr,
    PageResponse,
    decimal_to_json_str,
    dumps,
)
from app.main import app


@app.get("/_test/boom")
async def _boom() -> None:
    raise ApiException(ErrorCode.STALE_QUOTE_VERSION)


@app.get("/_test/decimal")
async def _decimal() -> DecimalJSONResponse:
    return DecimalJSONResponse(
        {"amount": Decimal("21000.00"), "qty": Decimal("1.500"), "big": Decimal("4.000")}
    )


class _MoneyModel(BaseModel):
    amount: DecimalStr
    qty: DecimalStr


@app.get("/_test/decimal-model")
async def _decimal_model() -> _MoneyModel:
    return _MoneyModel(amount=Decimal("21000.00"), qty=Decimal("1.500"))


@app.get("/_test/validated")
async def _validated(q: int = Query(...)) -> dict:
    return {"q": q}


client = TestClient(app, raise_server_exceptions=False)


def test_health_probe() -> None:
    r = client.get("/actuator/health")
    assert r.status_code == 200
    assert r.json() == {"status": "UP"}


def test_api_exception_envelope() -> None:
    r = client.get("/_test/boom", headers={"X-Request-Id": "trace-1"})
    assert r.status_code == 409
    body = r.json()
    assert body["error"]["code"] == "STALE_QUOTE_VERSION"
    assert body["error"]["message"] == ErrorCode.STALE_QUOTE_VERSION.default_message
    assert body["requestId"] == "trace-1"
    assert r.headers["X-Request-Id"] == "trace-1"


def test_request_id_generated_and_sanitised() -> None:
    r = client.get("/actuator/health")
    assert r.headers["X-Request-Id"]  # generated uuid
    assert r.json() == {"status": "UP"}
    evil = "ab<script>alert(1)</script>" + "x" * 100
    r2 = client.get("/actuator/health", headers={"X-Request-Id": evil})
    echoed = r2.headers["X-Request-Id"]
    assert "<" not in echoed and ">" not in echoed
    assert len(echoed) <= 64


def test_decimal_serializes_as_string() -> None:
    r = client.get("/_test/decimal")
    assert r.status_code == 200
    raw = r.text
    assert '"21000.00"' in raw  # money scale-2 kept verbatim
    assert '"1.5"' in raw  # qty scale>2 stripped
    assert '"4"' in raw
    assert "21000.0," not in raw and ": 21000" not in raw  # never a float/number
    body = json.loads(raw)
    assert body["amount"] == "21000.00"


def test_decimal_model_path_uses_plain_quantity() -> None:
    # Normal response-model path (pydantic JSON mode) must also strip
    # scale>2 exactly like the Jackson module.
    r = client.get("/_test/decimal-model")
    assert r.status_code == 200
    assert r.json() == {"amount": "21000.00", "qty": "1.5"}


def test_decimal_helper_mirrors_plain_quantity() -> None:
    assert decimal_to_json_str(Decimal("21000.00")) == "21000.00"
    assert decimal_to_json_str(Decimal("4.000")) == "4"
    assert decimal_to_json_str(Decimal("1.500")) == "1.5"
    assert decimal_to_json_str(Decimal("0.00")) == "0.00"
    assert json.loads(dumps({"m": Decimal("9600.00")}))["m"] == "9600.00"


def test_validation_error_envelope() -> None:
    r = client.get("/_test/validated", params={"q": "not-an-int"})
    body = r.json()
    assert body["error"]["code"] == "VALIDATION_FAILED"
    assert body["error"]["message"] == ErrorCode.VALIDATION_FAILED.default_message
    assert "fields" in body["error"]["details"]
    assert body["requestId"]
    # Java parity: VALIDATION_FAILED is HTTP 400 (task text said 422; enum wins).
    assert r.status_code == ErrorCode.VALIDATION_FAILED.status == 400


def test_envelope_helpers() -> None:
    ok = ApiResponse.of({"a": 1})
    assert set(ok) == {"data", "meta"}
    assert set(ok["meta"]) == {"requestId", "evaluatedAt"}
    page = PageResponse.of([1, 2], page=0, size=20, total=100)
    assert page["data"] == [1, 2]
    assert page["meta"]["page"] == 0
    assert page["meta"]["size"] == 20
    assert page["meta"]["total"] == 100
    assert page["meta"]["requestId"]


def test_error_code_status_parity() -> None:
    assert ErrorCode.UNAUTHENTICATED.status == 401
    assert ErrorCode.PROFILE_INACTIVE.status == 403
    assert ErrorCode.NOT_FOUND.status == 404
    assert ErrorCode.INSUFFICIENT_STOCK.status == 409
    assert ErrorCode.ZERO_NET_LINE.status == 422
    assert ErrorCode.ASSISTANT_RATE_LIMITED.status == 429
    assert ErrorCode.INTERNAL_ERROR.status == 500
    assert ErrorCode.ASSISTANT_UNAVAILABLE.status == 503
    assert len(ErrorCode) == 46


def test_jdbc_url_conversion() -> None:
    assert (
        _to_asyncpg_url("jdbc:postgresql://127.0.0.1:5432/demo")
        == "postgresql+asyncpg://127.0.0.1:5432/demo"
    )
    assert (
        _to_asyncpg_url("postgresql+asyncpg://x/y") == "postgresql+asyncpg://x/y"
    )


def test_unhandled_exception_hidden() -> None:
    @app.get("/_test/crash")
    async def _crash() -> None:
        raise RuntimeError("secret stack detail")

    r = client.get("/_test/crash")
    assert r.status_code == 500
    body = r.json()
    assert body["error"]["code"] == "INTERNAL_ERROR"
    assert "secret" not in body["error"]["message"]


def test_request_id_survives_dependency_failure() -> None:
    from app.core.database import get_db as _get_db

    async def _boom():
        raise ConnectionRefusedError("db down")
        yield  # pragma: no cover

    app.dependency_overrides[_get_db] = _boom
    try:
        r = client.get("/actuator/health", headers={"X-Request-Id": "dep-fail-1"})
        # health needs no db; force the failing path via a db-backed route
        r = client.get("/api/v1/public/catalog", headers={"X-Request-Id": "dep-fail-1"})
        assert r.status_code == 500
        assert r.json()["requestId"] == "dep-fail-1"
        assert r.headers["X-Request-Id"] == "dep-fail-1"
    finally:
        app.dependency_overrides.pop(_get_db, None)
