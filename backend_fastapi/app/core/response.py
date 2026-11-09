"""Success/error envelopes — port of shared/web/{ApiResponse,PageResponse,ErrorResponse}.

Contract:
  success: {"data": ..., "meta": {"requestId": ..., "evaluatedAt": ...}}
  paginated: {"data": [...], "meta": {"page","size","total","requestId","evaluatedAt"}}
  error: {"error": {"code","message","details"}, "requestId": ...}

All Decimal values serialize as JSON strings (never floats), mirroring the
JacksonConfig dealflow-exact-decimals module which renders BigDecimal via
Money.plainQuantity: scale<=2 keeps trailing zeros ("21000.00" untouched),
scale>2 strips them (4.000 -> "4").
"""

from __future__ import annotations

import json
from contextvars import ContextVar
from datetime import datetime, timezone
from decimal import Decimal
from typing import Annotated, Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, PlainSerializer

from fastapi.responses import JSONResponse

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

T = TypeVar("T")


def current_request_id() -> str:
    return request_id_ctx.get()


def decimal_to_json_str(value: Decimal) -> str:
    """Mirror of Money.plainQuantity: keep scale<=2 verbatim, strip beyond."""
    if value.as_tuple().exponent >= -2:
        return format(value, "f")
    normalized = value.normalize()
    # normalize() may yield Exponent notation (e.g. 2.1E+4); force plain.
    return format(normalized, "f")


def _default(o: Any) -> Any:
    if isinstance(o, Decimal):
        return decimal_to_json_str(o)
    if isinstance(o, datetime):
        return o.isoformat()
    if isinstance(o, BaseModel):
        return o.model_dump(mode="json")
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def dumps(obj: Any) -> str:
    return json.dumps(obj, default=_default, ensure_ascii=False)


def loads(s: str) -> Any:
    return json.loads(s)


def stringify(obj: Any) -> Any:
    """Recursively render Decimals (plainQuantity) and datetimes (ISO) so that
    bare-dict route returns survive FastAPI's jsonable_encoder — which would
    otherwise demote Decimals to floats — with the exact-decimals contract
    intact. Mirrors the Jackson dealflow-exact-decimals module globally."""
    if isinstance(obj, Decimal):
        return decimal_to_json_str(obj)
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, BaseModel):
        return stringify(obj.model_dump(mode="json"))
    if isinstance(obj, dict):
        return {key: stringify(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [stringify(value) for value in obj]
    return obj


class DecimalJSONResponse(JSONResponse):
    """App-wide default response class: renders via dumps() so any Decimal
    reaching the wire becomes a JSON string, never a float."""

    def render(self, content: Any) -> bytes:
        return dumps(content).encode("utf-8")


# Annotated Decimal for response schemas: renders via plainQuantity in JSON
# mode (so "1.500" -> "1.5" exactly like JacksonConfig), stays Decimal in
# Python mode so services keep doing exact math on model fields.
DecimalStr = Annotated[
    Decimal,
    PlainSerializer(decimal_to_json_str, return_type=str, when_used="json"),
]


def _base_meta() -> dict[str, Any]:
    return {
        "requestId": current_request_id(),
        "evaluatedAt": datetime.now(timezone.utc).isoformat(),
    }


class ApiResponse(BaseModel, Generic[T]):
    model_config = ConfigDict(from_attributes=True)

    data: T | None = None
    meta: dict[str, Any] = {}

    @classmethod
    def of(cls, data: T, extra_meta: dict[str, Any] | None = None) -> dict[str, Any]:
        meta = _base_meta()
        if extra_meta:
            meta.update(extra_meta)
        return {"data": stringify(data), "meta": meta}


class PageResponse(BaseModel, Generic[T]):
    model_config = ConfigDict(from_attributes=True)

    data: list[T] = []
    meta: dict[str, Any] = {}

    @classmethod
    def of(
        cls,
        items: list[T],
        page: int,
        size: int,
        total: int,
        extra_meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        meta: dict[str, Any] = {
            "page": page,
            "size": size,
            "total": total,
            "requestId": current_request_id(),
            "evaluatedAt": datetime.now(timezone.utc).isoformat(),
        }
        if extra_meta:
            meta.update(extra_meta)
        return {"data": [stringify(item) for item in items], "meta": meta}


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = {}


class ErrorResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    error: ErrorBody
    requestId: str

    @classmethod
    def of(
        cls, code: str, message: str, details: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        return {
            "error": {"code": code, "message": message, "details": stringify(details or {})},
            "requestId": current_request_id(),
        }
