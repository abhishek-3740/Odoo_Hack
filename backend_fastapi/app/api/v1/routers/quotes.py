"""Quotes + approvals + escalations + staff recommendations router.

Staff-only: CUSTOMER identities get 403 "Use the portal endpoints." (except
the single approval GET, which masquerades as 404 like other foreign reads).
Sub-resources are nouns for things that happen to a quotation.

Envelopes come from ApiResponse.of/PageResponse.of; they are sent via
DecimalJSONResponse explicitly because FastAPI pre-serializes bare-dict
returns with jsonable_encoder (Decimal -> float), which would undo the
exact-decimals wire contract.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, idempotency_key, require_internal
from app.api.paging import page_size_or_default, parse_sort
from app.core.database import get_db
from app.core.exceptions import ApiException, ErrorCode
from app.core.response import ApiResponse, DecimalJSONResponse, PageResponse
from app.core.security import Actor
from app.schemas.quotes import (
    AdoptRevisionRequest,
    ApplyRequest,
    CancelQuoteRequest,
    CreateQuoteRequest,
    DecisionRequest,
    DismissRequest,
    EscalationCreate,
    EscalationResolve,
    QuoteDraftRequest,
    ReassignRequest,
    ReplyRequest,
    SubmitQuoteRequest,
)
from app.services import approval_service, escalation_service, quote_service
from app.services import recommendations_service

router = APIRouter()

_QUOTE_SORTS = {"createdAt", "updatedAt", "lastActivityAt", "stage"}
_APPROVAL_SORTS = {"createdAt", "dueAt", "step"}


def ok(data: object) -> DecimalJSONResponse:
    return DecimalJSONResponse(content=ApiResponse.of(data))


def created(data: object) -> DecimalJSONResponse:
    return DecimalJSONResponse(status_code=201, content=ApiResponse.of(data))


def paged(items: list, page: int, size: int, total: int) -> DecimalJSONResponse:
    return DecimalJSONResponse(content=PageResponse.of(items, page, size, total))


def _raise_if_error(status: int, body: object) -> None:
    if isinstance(body, dict) and "error" in body:
        err = body["error"] or {}
        try:
            code = ErrorCode[str(err.get("code", "INTERNAL_ERROR"))]
        except KeyError:
            code = ErrorCode.INTERNAL_ERROR
        raise ApiException(code, str(err.get("message", "")), dict(err.get("details") or {}))


# ------------------------------------------------------------------ quotes ---


@router.get("/api/v1/quotes")
async def list_quotes(
    stage: str | None = Query(default=None),
    customerId: uuid.UUID | None = Query(default=None),
    ownerProfileId: uuid.UUID | None = Query(default=None),
    page: int = Query(default=0),
    pageSize: int = Query(default=25),
    sort: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    field, descending = parse_sort(sort, _QUOTE_SORTS, "updatedAt")
    size = page_size_or_default(pageSize)
    items, total = await quote_service.list_quotes(
        db, actor, stage=stage, customer_id=customerId,
        owner_profile_id=ownerProfileId, page=page,
        size=size, sort_field=field, descending=descending,
    )
    return paged(items, max(page, 0), size, total)


@router.post("/api/v1/quotes", status_code=201)
async def create_quote(
    request: CreateQuoteRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await quote_service.create(db, actor, request)
    await db.commit()
    return created(data)


@router.get("/api/v1/quotes/{quote_id}")
async def get_quote(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    return ok(await quote_service.get(db, actor, quote_id))


@router.post("/api/v1/quotes/{quote_id}/evaluations")
async def evaluate_quote(
    quote_id: uuid.UUID,
    request: QuoteDraftRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    return ok(await quote_service.evaluate_preview(db, actor, quote_id, request))


@router.post("/api/v1/quotes/{quote_id}/revisions")
async def save_revision(
    quote_id: uuid.UUID,
    request: QuoteDraftRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await quote_service.save_draft(db, actor, quote_id, request)
    await db.commit()
    return ok(data)


@router.get("/api/v1/quotes/{quote_id}/revisions")
async def list_revisions(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    return ok(await quote_service.revision_list(db, actor, quote_id))


@router.get("/api/v1/quotes/{quote_id}/revisions/{revision_id}")
async def get_revision(
    quote_id: uuid.UUID,
    revision_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    return ok(await quote_service.get_revision(db, actor, quote_id, revision_id))


@router.post("/api/v1/quotes/{quote_id}/submissions")
async def submit_quote(
    quote_id: uuid.UUID,
    request: SubmitQuoteRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await quote_service.submit(db, actor, quote_id, request)
    await db.commit()
    return ok(data)


@router.post("/api/v1/quotes/{quote_id}/shares")
async def share_quote(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await quote_service.share(db, actor, quote_id)
    await db.commit()
    return ok(data)


@router.post("/api/v1/quotes/{quote_id}/adoptions")
async def adopt_revision(
    quote_id: uuid.UUID,
    request: AdoptRevisionRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await quote_service.adopt(db, actor, quote_id, request)
    await db.commit()
    return ok(data)


@router.post("/api/v1/quotes/{quote_id}/cancellations")
async def cancel_quote(
    quote_id: uuid.UUID,
    request: CancelQuoteRequest | None = None,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    body = request or CancelQuoteRequest()
    data = await quote_service.cancel(db, actor, quote_id, body)
    await db.commit()
    return ok(data)


@router.get("/api/v1/quotes/{quote_id}/history")
async def quote_history(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    return ok(await quote_service.history(db, actor, quote_id))


# ------------------------------------------------------- negotiation desk ---


@router.get("/api/v1/quotes/{quote_id}/requests")
async def list_requests(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    return ok(await escalation_service.list_negotiations(db, actor, quote_id))


@router.post("/api/v1/quotes/{quote_id}/requests/{request_id}/responses")
async def reply_request(
    quote_id: uuid.UUID,
    request_id: uuid.UUID,
    request: ReplyRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await escalation_service.reply_negotiation(db, actor, quote_id, request_id, request)
    await db.commit()
    return ok(data)


# ------------------------------------------------------------ escalations ---


@router.get("/api/v1/escalations")
async def list_escalations(
    quoteId: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    return ok(await escalation_service.list_escalations(db, actor, quoteId))


@router.post("/api/v1/escalations")
async def create_escalation(
    request: EscalationCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await escalation_service.create_escalation(db, actor, request)
    await db.commit()
    return ok(data)


@router.post("/api/v1/escalations/{escalation_id}/resolutions")
async def resolve_escalation(
    escalation_id: uuid.UUID,
    request: EscalationResolve,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await escalation_service.resolve_escalation(db, actor, escalation_id, request)
    await db.commit()
    return ok(data)


# -------------------------------------------------------------- approvals ---


@router.get("/api/v1/approval-requests")
async def approval_queue(
    status: str = Query(default="PENDING"),
    page: int = Query(default=0),
    pageSize: int = Query(default=25),
    sort: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    field, descending = parse_sort(sort, _APPROVAL_SORTS, "createdAt")
    size = page_size_or_default(pageSize)
    items, total = await approval_service.queue(
        db, actor, status=status, page=page,
        size=size, sort_field=field, descending=descending,
    )
    return paged(items, max(page, 0), size, total)


@router.get("/api/v1/approval-requests/{step_id}")
async def get_approval(
    step_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
):
    return ok(await approval_service.get_item(db, actor, step_id))


@router.post("/api/v1/approval-requests/{step_id}/decisions")
async def decide_approval(
    step_id: uuid.UUID,
    request: DecisionRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
    key: str = Depends(idempotency_key),
):
    status, body = await approval_service.decide(db, actor, step_id, request, key)
    await db.commit()
    _raise_if_error(status, body)
    return ok(body)


@router.post("/api/v1/approval-requests/{step_id}/reassignments")
async def reassign_approval(
    step_id: uuid.UUID,
    request: ReassignRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await approval_service.reassign(db, actor, step_id, request)
    await db.commit()
    return ok(data)


# -------------------------------------------------------- recommendations ---


@router.get("/api/v1/quotes/{quote_id}/recommendations")
async def get_recommendations(
    quote_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    return ok(await recommendations_service.recommend(db, actor, quote_id))


@router.post("/api/v1/quotes/{quote_id}/recommendation-applications")
async def apply_recommendation(
    quote_id: uuid.UUID,
    request: ApplyRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await recommendations_service.apply(db, actor, quote_id, request)
    await db.commit()
    return ok(data)


@router.post("/api/v1/quotes/{quote_id}/recommendation-dismissals")
async def dismiss_recommendation(
    quote_id: uuid.UUID,
    request: DismissRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_internal),
):
    data = await recommendations_service.dismiss(db, actor, quote_id, request.variantId)
    await db.commit()
    return ok(data)
