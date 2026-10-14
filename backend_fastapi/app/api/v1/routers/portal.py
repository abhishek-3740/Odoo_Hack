"""Customer portal router — port of portal/controller/{PortalController,
PortalAccountController,PortalRecommendationController}.java.

CUSTOMER-only; every path is a FULL literal. Success payloads go through
ApiResponse.of; the invoice export returns raw document bytes.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, idempotency_key, require_customer
from app.core.database import get_db
from app.core.response import ApiResponse
from app.core.security import Actor
from app.schemas.portal import (
    AcceptanceRequest,
    AccountUpdateRequest,
    ChangePasswordRequest,
    PortalRequest,
    PreferencesRequest,
    QuoteRequest,
    RecommendationRequest,
)
from app.services import (
    idempotency_service,
    portal_account_service,
    portal_quote_request_service,
    portal_recommendation_service,
    portal_service,
)

router = APIRouter()


@router.get("/api/v1/portal/quotes")
async def list_quotes(
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
) -> dict:
    return ApiResponse.of(await portal_service.list_quotes(db, actor))


@router.post("/api/v1/portal/quote-requests", status_code=201)
async def request_quote(
    request: QuoteRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
    key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    body = request.model_dump(mode="json")
    if not key or not key.strip():
        return ApiResponse.of(await portal_quote_request_service.submit(db, actor, request))

    async def _handler() -> tuple[int, dict, uuid.UUID | None]:
        detail = await portal_quote_request_service.submit(db, actor, request)
        return 201, detail, uuid.UUID(detail["id"])

    _status, data, _entity, _replayed = await idempotency_service.execute(
        db, actor, "portal-quote-request", key.strip(), body, _handler
    )
    return ApiResponse.of(data)


@router.get("/api/v1/portal/quotes/{quote_id}")
async def get_quote(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
) -> dict:
    return ApiResponse.of(await portal_service.get_quote(db, actor, quote_id))


@router.post("/api/v1/portal/quotes/{quote_id}/requests")
async def submit_request(
    quote_id: uuid.UUID,
    request: PortalRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
    key: str = Depends(idempotency_key),
) -> dict:
    body = request.model_dump(mode="json")

    async def _handler() -> tuple[int, dict, uuid.UUID | None]:
        detail = await portal_service.submit_request(db, actor, quote_id, request)
        return 200, detail, uuid.UUID(detail["revisionId"])

    _status, data, _entity, _replayed = await idempotency_service.execute(
        db, actor, f"portal-request:{quote_id}", key, body, _handler
    )
    return ApiResponse.of(data)


@router.post("/api/v1/portal/quotes/{quote_id}/acceptances")
async def accept(
    quote_id: uuid.UUID,
    request: AcceptanceRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
    key: str = Depends(idempotency_key),
) -> dict:
    body = request.model_dump(mode="json")

    async def _handler() -> tuple[int, dict, uuid.UUID | None]:
        result = await portal_service.accept(db, actor, quote_id, request)
        return 200, result, uuid.UUID(result["revisionId"])

    _status, data, _entity, _replayed = await idempotency_service.execute(
        db, actor, f"portal-accept:{quote_id}", key, body, _handler
    )
    return ApiResponse.of(data)


@router.get("/api/v1/portal/invoices")
async def list_invoices(
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
) -> dict:
    return ApiResponse.of(await portal_service.list_invoices(db, actor))


@router.get("/api/v1/portal/invoices/{invoice_id}")
async def get_invoice(
    invoice_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
) -> dict:
    return ApiResponse.of(await portal_service.get_invoice(db, actor, invoice_id))


@router.get("/api/v1/portal/invoices/{invoice_id}/export")
async def export_invoice(
    invoice_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
    format: str = Query(default="pdf"),
) -> Response:
    invoice = await portal_service.get_invoice(db, actor, invoice_id)
    payload, media_type, extension = await portal_service.export_invoice(
        db, actor, invoice_id, format
    )
    reference = invoice.get("reference") or str(invoice.get("id"))
    return Response(
        content=payload,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="invoice-{reference}.{extension}"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


@router.get("/api/v1/portal/account")
async def get_account(
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
) -> dict:
    return ApiResponse.of(await portal_account_service.get(db, actor))


@router.patch("/api/v1/portal/account")
async def update_account(
    request: AccountUpdateRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
) -> dict:
    return ApiResponse.of(await portal_account_service.update(db, actor, request))


@router.put("/api/v1/portal/account/preferences")
async def update_preferences(
    request: PreferencesRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
) -> dict:
    return ApiResponse.of(
        await portal_account_service.update_preferences(db, actor, request.preferences)
    )


@router.post("/api/v1/portal/account/password")
async def change_password(
    request: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
) -> dict:
    await portal_account_service.change_password(
        db, actor, request.currentPassword, request.newPassword
    )
    return ApiResponse.of({"changed": True})


@router.get("/api/v1/portal/quotes/{quote_id}/recommendations")
async def get_recommendations(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
) -> dict:
    return ApiResponse.of(
        await portal_recommendation_service.recommend(db, actor, quote_id)
    )


@router.post("/api/v1/portal/quotes/{quote_id}/recommendation-requests")
async def request_recommendation(
    quote_id: uuid.UUID,
    request: RecommendationRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_customer),
    key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    if not key or not key.strip():
        return ApiResponse.of(
            await portal_recommendation_service.request_offer(db, actor, quote_id, request)
        )
    body = request.model_dump(mode="json")

    async def _handler() -> tuple[int, dict, uuid.UUID | None]:
        detail = await portal_recommendation_service.request_offer(
            db, actor, quote_id, request
        )
        return 200, detail, uuid.UUID(detail["revisionId"])

    _status, data, _entity, _replayed = await idempotency_service.execute(
        db, actor, f"portal-recommendation:{quote_id}", key.strip(), body, _handler
    )
    return ApiResponse.of(data)


# Re-export for tests that resolve the actor directly.
_ = get_current_actor
