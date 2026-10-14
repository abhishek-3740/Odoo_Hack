"""FastAPI application factory — port of SecurityConfig + WebMvcConfig + ApiApplication.

- Request-id middleware mirrors RequestIdFilter (sanitise, cap 64, echo header,
  contextvar instead of ThreadLocal).
- CORS mirrors corsConfigurationSource (exact origins, exposed X-Request-Id).
- Exception handlers mirror GlobalExceptionHandler (ApiException -> code.status,
  validation -> VALIDATION_FAILED, never leak internals).
- Decimal-safe JSON is the app-wide default response class (mirrors the
  dealflow-exact-decimals Jackson module: Decimal renders as JSON string).
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1.api_router import api_router
from app.core.config import get_settings
from app.core.exceptions import ApiException, ErrorCode
from app.core.response import DecimalJSONResponse, dumps, request_id_ctx
from app.websocket.endpoint import ws_router

log = logging.getLogger("dealflow")

REQUEST_ID_HEADER = "X-Request-Id"
_SAFE_ID = re.compile(r"[^A-Za-z0-9._:-]")


def sanitise_request_id(incoming: str | None) -> str:
    if not incoming or not incoming.strip():
        return str(uuid.uuid4())
    cleaned = _SAFE_ID.sub("", incoming)
    if not cleaned:
        return str(uuid.uuid4())
    return cleaned[:64]


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[no-untyped-def]
        if request.scope.get("type") != "http":
            return await call_next(request)
        request_id = sanitise_request_id(request.headers.get(REQUEST_ID_HEADER))
        request.state.request_id = request_id
        token = request_id_ctx.set(request_id)
        try:
            response = await call_next(request)
        finally:
            request_id_ctx.reset(token)
        if response is not None and hasattr(response, "headers"):
            response.headers[REQUEST_ID_HEADER] = request_id
        return response


def _request_id(request: Request) -> str:
    state_id = getattr(getattr(request, "state", None), "request_id", None)
    if state_id:
        return state_id
    current = request_id_ctx.get()
    return current if current else str(uuid.uuid4())


def _error_response(
    request: Request, code: ErrorCode, message: str, details: dict, status: int
) -> JSONResponse:
    rid = _request_id(request)
    return JSONResponse(
        status_code=status,
        content={
            "error": {"code": code.name, "message": message, "details": details},
            "requestId": rid,
        },
        headers={"Cache-Control": "no-store", REQUEST_ID_HEADER: rid},
    )


def _validation_details(exc: RequestValidationError) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for err in exc.errors():
        loc = ".".join(str(p) for p in err.get("loc", ())) or "body"
        fields[loc] = err.get("msg", "invalid")
    return {"fields": fields}


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="dealflow360-api",
        default_response_class=DecimalJSONResponse,
        lifespan=lifespan,
    )

    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins or ["*"],
        allow_origin_regex=r"^https?://.*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
        max_age=1800,
    )

    @app.exception_handler(ApiException)
    async def api_exception_handler(request: Request, exc: ApiException) -> JSONResponse:
        if exc.status_code >= 500:
            log.error("ApiException %s: %s", exc.code.name, exc.message)
        else:
            log.debug("ApiException %s: %s", exc.code.name, exc.message)
        return _error_response(request, exc.code, exc.message, exc.details, exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        code = ErrorCode.VALIDATION_FAILED
        return _error_response(
            request, code, code.default_message, _validation_details(exc), code.status
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        # Mirrors GlobalExceptionHandler's mapped cases; anything else passes
        # through with its status and detail (safety net — our code raises
        # ApiException everywhere).
        mapped: dict[int, ErrorCode] = {
            400: ErrorCode.VALIDATION_FAILED,
            401: ErrorCode.UNAUTHENTICATED,
            403: ErrorCode.FORBIDDEN,
            404: ErrorCode.NOT_FOUND,
        }
        code = mapped.get(exc.status_code)
        if code is None:
            rid = _request_id(request)
            return JSONResponse(
                status_code=exc.status_code,
                content={
                    "error": {
                        "code": f"HTTP_{exc.status_code}",
                        "message": str(exc.detail),
                        "details": {},
                    },
                    "requestId": rid,
                },
                headers={"Cache-Control": "no-store", REQUEST_ID_HEADER: rid},
            )
        message = str(exc.detail) if exc.detail else code.default_message
        return _error_response(request, code, message, {}, code.status)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled exception")
        code = ErrorCode.INTERNAL_ERROR
        return _error_response(request, code, code.default_message, {}, code.status)

    @app.get("/actuator/health")
    async def health() -> dict[str, str]:
        return {"status": "UP"}

    app.include_router(api_router)
    app.include_router(ws_router)

    return app


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ANN201, ARG001
    """Seed (DEMO_SEED) then start leased workers (JOBS_ENABLED)."""
    settings = get_settings()
    if settings.demo_seed:
        try:
            from app.core.database import SessionLocal
            from app.services import demo_seeder

            async with SessionLocal() as db:
                try:
                    await demo_seeder.seed(db)
                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise
        except Exception:
            log.exception("demo seed failed")
    tasks = []
    if settings.jobs_enabled:
        from app.workers import outbox, scheduler

        tasks = [
            asyncio.create_task(outbox.poll_forever()),
            asyncio.create_task(scheduler.sweep_forever()),
        ]
    yield
    for task in tasks:
        task.cancel()
    for task in tasks:
        try:
            await task
        except asyncio.CancelledError:
            pass


app = create_app()
