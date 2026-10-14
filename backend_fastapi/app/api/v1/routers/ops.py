"""OPS domain router — alerts, notifications, sales reports, jobs, assistant.

One ``router`` with FULL literal paths (never mounted with a prefix, so the
paths you read here are the paths on the wire). Success bodies use
ApiResponse.of / PageResponse.of only; money stays Decimal to the wire.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, require_roles
from app.api.paging import page_size_or_default
from app.core.database import get_db
from app.core.exceptions import ApiException, ErrorCode
from app.core.response import ApiResponse, PageResponse
from app.core.security import Actor
from app.services import assistant_service, health_service, job_service, report_service
from app.services import report_exporter

router = APIRouter()


class NudgeRequest(BaseModel):
    message: str | None = None


class RunRequest(BaseModel):
    jobName: str


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    quoteId: UUID | None = None
    history: list[ChatTurn] | None = None


# ----------------------------------------------------------------- alerts ---


@router.get("/api/v1/alerts")
async def list_alerts(
    status: str = "OPEN",
    type: str | None = None,
    page: int | None = None,
    pageSize: int | None = None,
    sort: str | None = None,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
):
    page = max(0, page or 0)
    size = page_size_or_default(pageSize)
    items, total = await health_service.list_alerts(
        db, actor, status=status, alert_type=type, page=page, size=size, sort=sort)
    return PageResponse.of(items, page, size, total)


@router.post("/api/v1/alerts/{id}/nudges")
async def nudge_alert(
    id: UUID,
    payload: NudgeRequest | None = None,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict[str, Any]:
    notification = await health_service.nudge(
        db, actor, id, payload.message if payload else None)
    return ApiResponse.of(notification)


@router.post("/api/v1/alerts/sweeps")
async def run_sweep(
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("MANAGER", "FINANCE", "ADMIN")),
) -> dict[str, Any]:
    summary = await health_service.sweep_all(db)
    return ApiResponse.of({"open": summary["opened"], "resolved": summary["resolved"]})


# ---------------------------------------------------------- notifications ---


@router.get("/api/v1/notifications")
async def list_notifications(
    page: int | None = None,
    pageSize: int | None = None,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
):
    page = max(0, page or 0)
    size = page_size_or_default(pageSize)
    items, total, unread = await health_service.list_notifications(
        db, actor, page=page, size=size)
    return PageResponse.of(items, page, size, total, {"unread": unread})


@router.post("/api/v1/notifications/{id}/reads")
async def mark_notification_read(
    id: UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict[str, Any]:
    return ApiResponse.of(await health_service.mark_read(db, actor, id))


# ---------------------------------------------------------------- reports ---


@router.get("/api/v1/reports/sales")
async def sales_report(
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    ownerProfileId: UUID | None = None,
    teamId: UUID | None = None,
    customerId: UUID | None = None,
    stage: str | None = None,
    categoryId: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict[str, Any]:
    report = await report_service.sales_report(db, {
        "from": from_, "to": to, "ownerProfileId": ownerProfileId,
        "teamId": teamId, "customerId": customerId, "stage": stage,
        "categoryId": categoryId,
    }, actor)
    return ApiResponse.of(report)


@router.get("/api/v1/reports/sales/export")
async def export_sales_report(
    format: str,
    from_: date | None = Query(default=None, alias="from"),
    to: date | None = None,
    ownerProfileId: UUID | None = None,
    teamId: UUID | None = None,
    customerId: UUID | None = None,
    stage: str | None = None,
    categoryId: UUID | None = None,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
):
    report = await report_service.sales_report(db, {
        "from": from_, "to": to, "ownerProfileId": ownerProfileId,
        "teamId": teamId, "customerId": customerId, "stage": stage,
        "categoryId": categoryId,
    }, actor)
    stamp = re.sub(r"[^0-9]", "", report.get("generatedAt", ""))[:14] or "00000000000000"
    kind = (format or "").lower()
    if kind == "pdf":
        body = report_exporter.sales_pdf(report)
        media_type = "application/pdf"
        extension = "pdf"
    elif kind == "xlsx":
        body = report_exporter.sales_xlsx(report)
        media_type = ("application/vnd.openxmlformats-officedocument"
                      ".spreadsheetml.sheet")
        extension = "xlsx"
    else:
        # Deliberate deviation: Java serves genuine HSSF .xls, which has no
        # maintained Python twin. Rather than mislabel xlsx bytes as .xls,
        # refuse with the same VALIDATION_FAILED shape Java uses for bad input.
        raise ApiException(ErrorCode.VALIDATION_FAILED, "format must be pdf or xlsx.")
    return Response(
        content=body,
        media_type=media_type,
        headers={
            "Content-Disposition":
                f'attachment; filename="dealflow-sales-{stamp}.{extension}"',
            "Cache-Control": "no-store",
        },
    )


# -------------------------------------------------------------------- jobs ---


@router.post("/api/v1/internal/job-runs")
async def run_job(
    payload: RunRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
) -> dict[str, Any]:
    return ApiResponse.of(await job_service.run_job(db, payload.jobName, actor))


@router.get("/api/v1/internal/job-runs")
async def list_job_runs(
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_roles("FINANCE", "ADMIN")),
) -> dict[str, Any]:
    return ApiResponse.of(await job_service.recent_runs(db))


# --------------------------------------------------------------- assistant ---


@router.get("/api/v1/assistant/status")
async def assistant_status(
    actor: Actor = Depends(get_current_actor),
) -> dict[str, Any]:
    return ApiResponse.of(assistant_service.status(actor))


@router.post("/api/v1/assistant/chat")
async def assistant_chat(
    payload: ChatRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_current_actor),
) -> dict[str, Any]:
    answer = await assistant_service.chat(
        db, actor, payload.message, payload.quoteId,
        [t.model_dump() for t in payload.history] if payload.history else None,
    )
    return ApiResponse.of(answer)
