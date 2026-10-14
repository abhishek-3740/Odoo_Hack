"""Deal-health service — port of health/service/DealHealthService.

Finds deals and orders that need attention (time-based sweeps + nudge tasks)
and keeps the alert list honest: alerts are keyed on the condition, not the
moment of detection, so re-running a sweep refreshes instead of stacking.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Callable
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.engines import anomaly
from app.engines import shared_math as m
from app.models.approvals import ApprovalRequest
from app.models.auth import Profile
from app.models.billing import Invoice
from app.models.fulfillment import Backorder, StockLevel
from app.models.ops import Alert, Notification
from app.models.orders import OrderLine
from app.models.quotes import Quote, QuoteRevision
from app.services import audit_service, outbox_writer
from app.services.clock import business_today, now_utc

log = logging.getLogger("dealflow")

OPEN_STAGES = ("DRAFT", "REVIEW", "SENT", "UNDER_NEGOTIATION")

STALLED_AFTER_HOURS = 72
NUDGE_COOLDOWN_HOURS = 12

# Types a time-based sweep can auto-resolve. DISCOUNT_ANOMALY is resolved only
# by re-evaluating the quotation, never by a sweep that never looked at it.
SWEPT_TYPES = frozenset({
    "STALLED_QUOTE", "APPROVAL_OVERDUE", "DELIVERY_SLIPPAGE",
    "LOW_STOCK", "INVOICE_OVERDUE", "NO_APPROVER",
})

_ALERT_SORT_COLUMNS = {
    "lastSeenAt": Alert.last_seen_at,
    "firstSeenAt": Alert.first_seen_at,
}

_SEVERITY_RANK = {"INFO": 0, "WARNING": 1, "CRITICAL": 2}


# ------------------------------------------------------------ serialisers ---


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def alert_to_dict(alert: Alert) -> dict[str, Any]:
    return {
        "id": str(alert.id),
        "alertType": alert.alert_type,
        "severity": alert.severity,
        "status": alert.status,
        "title": alert.title,
        "reasons": alert.reasons or [],
        "quoteId": str(alert.quote_id) if alert.quote_id else None,
        "orderId": str(alert.order_id) if alert.order_id else None,
        "subscriptionId": str(alert.subscription_id) if alert.subscription_id else None,
        "invoiceId": str(alert.invoice_id) if alert.invoice_id else None,
        "variantId": str(alert.variant_id) if alert.variant_id else None,
        "ownerProfileId": str(alert.owner_profile_id) if alert.owner_profile_id else None,
        "firstSeenAt": _iso(alert.first_seen_at),
        "lastSeenAt": _iso(alert.last_seen_at),
        "resolvedAt": _iso(alert.resolved_at),
        "lastNudgedAt": _iso(alert.last_nudged_at),
        "nudgeCount": alert.nudge_count,
    }


def notification_to_dict(row: Notification) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "type": row.notification_type,
        "title": row.title,
        "body": row.body,
        "quoteId": str(row.quote_id) if row.quote_id else None,
        "orderId": str(row.order_id) if row.order_id else None,
        "invoiceId": str(row.invoice_id) if row.invoice_id else None,
        "alertId": str(row.alert_id) if row.alert_id else None,
        "readAt": _iso(row.read_at),
        "createdAt": _iso(row.created_at),
    }


def _require_internal(actor: Actor) -> None:
    if actor.is_customer:
        raise ApiException(ErrorCode.FORBIDDEN, "Alerts are internal.")


# ------------------------------------------------------------------ list ---


async def list_alerts(
    db: AsyncSession,
    actor: Actor,
    *,
    status: str = "OPEN",
    alert_type: str | None = None,
    page: int = 0,
    size: int = 25,
    sort: str = "lastSeenAt",
) -> tuple[list[dict[str, Any]], int]:
    _require_internal(actor)
    status_filter: str | None
    if status is None or status.upper() == "ALL":
        status_filter = None
    elif status.upper() in ("OPEN", "RESOLVED"):
        status_filter = status.upper()
    else:
        raise ApiException(ErrorCode.VALIDATION_FAILED, f"Unknown alert status '{status}'.")
    type_filter: str | None = None
    if alert_type:
        upper = alert_type.upper()
        if upper not in ("STALLED_QUOTE", "DISCOUNT_ANOMALY", "DELIVERY_SLIPPAGE",
                         "APPROVAL_OVERDUE", "NO_APPROVER", "LOW_STOCK",
                         "BACKORDER_OPEN", "INVOICE_OVERDUE"):
            raise ApiException(ErrorCode.VALIDATION_FAILED, f"Unknown alert type '{alert_type}'.")
        type_filter = upper

    owner = actor.profile_id if actor.role == "REP" else None
    team = actor.team_id if actor.role == "MANAGER" else None

    field, descending = _parse_alert_sort(sort)
    page = max(0, page)
    size = min(max(size, 1), 100) if size else 25

    stmt = select(Alert)
    count_stmt = select(func.count()).select_from(Alert)
    if status_filter is not None:
        stmt = stmt.where(Alert.status == status_filter)
        count_stmt = count_stmt.where(Alert.status == status_filter)
    if type_filter is not None:
        stmt = stmt.where(Alert.alert_type == type_filter)
        count_stmt = count_stmt.where(Alert.alert_type == type_filter)
    if owner is not None:
        stmt = stmt.where(Alert.owner_profile_id == owner)
        count_stmt = count_stmt.where(Alert.owner_profile_id == owner)
    if team is not None:
        # A manager sees their team's alerts plus un-teamed ones.
        stmt = stmt.where(or_(Alert.team_id.is_(None), Alert.team_id == team))
        count_stmt = count_stmt.where(or_(Alert.team_id.is_(None), Alert.team_id == team))

    stmt = _apply_alert_order(stmt, field, descending)
    stmt = stmt.offset(page * size).limit(size)
    total = (await db.execute(count_stmt)).scalar_one()
    rows = (await db.execute(stmt)).scalars().all()
    return [alert_to_dict(a) for a in rows], total


def _parse_alert_sort(sort: str | None) -> tuple[str, bool]:
    from app.api.paging import parse_sort

    return parse_sort(sort, {"lastSeenAt", "firstSeenAt", "severity"}, "lastSeenAt")


def _apply_alert_order(stmt, field: str, descending: bool):
    if field == "severity":
        # Severity is a label, not a rank: map to an explicit order, then
        # recency, mirroring the JPQL `order by severity desc, lastSeenAt desc`.
        from sqlalchemy import case

        rank = case(_SEVERITY_RANK, value=Alert.severity, else_=0)
        stmt = stmt.order_by(rank.desc(), Alert.last_seen_at.desc())
        if not descending:
            stmt = stmt.order_by(rank.asc(), Alert.last_seen_at.asc())
        return stmt
    column = _ALERT_SORT_COLUMNS[field]
    return stmt.order_by(column.desc() if descending else column.asc())


# ----------------------------------------------------------------- nudge ---


async def nudge(
    db: AsyncSession, actor: Actor, alert_id: UUID, message: str | None
) -> dict[str, Any]:
    _require_internal(actor)
    if message is not None and len(message) > 500:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "Follow-up message is too long.")
    alert = (await db.execute(select(Alert).where(Alert.id == alert_id))).scalars().first()
    if alert is None:
        raise ApiException.not_found(f"Alert {alert_id}")

    now = now_utc()
    cooldown = timedelta(hours=NUDGE_COOLDOWN_HOURS)
    if alert.last_nudged_at is not None and alert.last_nudged_at + cooldown >= now:
        raise ApiException(
            ErrorCode.RATE_LIMITED,
            "This alert was already followed up recently. Try again later.",
            {"lastNudgedAt": _iso(alert.last_nudged_at)},
        )

    recipient = alert.owner_profile_id
    kind = "NUDGE"
    if recipient is None or (actor.profile_id is not None and recipient == actor.profile_id):
        # Escalate: no owner, or the owner is the one asking. Send it to a
        # manager rather than to the person raising it.
        managers = (
            await db.execute(
                select(Profile.id)
                .where(Profile.role == "MANAGER", Profile.is_active.is_(True))
                .order_by(Profile.id)
            )
        ).scalars().all()
        other = [m for m in managers if m != actor.profile_id]
        recipient = other[0] if other else recipient
        kind = "ESCALATION"
    if recipient is None:
        raise ApiException(ErrorCode.NOT_FOUND, "There is nobody to notify about this alert.")

    dedupe_key = f"{kind}:{alert.id}:{int(now.timestamp() * 1000)}"
    row = Notification(
        recipient_profile_id=recipient,
        notification_type=kind,
        title=alert.title,
        body=message if message else alert.title,
        quote_id=alert.quote_id,
        order_id=alert.order_id,
        alert_id=alert.id,
        dedupe_key=dedupe_key,
    )
    db.add(row)
    alert.last_nudged_at = now
    alert.nudge_count = (alert.nudge_count or 0) + 1

    await audit_service.record(
        db, actor, f"ALERT_{kind}", "Alert", alert.id,
        quote_id=alert.quote_id,
        after={"recipientProfileId": str(recipient), "type": kind},
        reason=message,
    )
    await outbox_writer.publish(
        db, outbox_writer.ALERT_UPDATED, "Alert", alert.id, 0,
        {"type": kind, "alertType": alert.alert_type},
        outbox_writer.owner_scope(recipient),
    )
    await db.flush()
    return notification_to_dict(row)


# ----------------------------------------------------------------- sweeps ---


async def sweep_all(db: AsyncSession) -> dict[str, int]:
    now = now_utc()
    today = business_today()
    still_open: set[str] = set()
    touched = 0
    touched += await _sweep_stalled(db, now, still_open)
    touched += await _sweep_overdue_approvals(db, now, still_open)
    touched += await _sweep_delivery_slippage(db, today, now, still_open)
    touched += await _sweep_low_stock(db, now, still_open)
    touched += await _sweep_overdue_invoices(db, today, now, still_open)
    resolved = await _resolve_cleared(db, still_open, now)
    return {"opened": touched, "refreshed": touched, "resolved": resolved}


async def _sweep_stalled(db: AsyncSession, now: datetime, still_open: set[str]) -> int:
    cutoff = now - timedelta(hours=STALLED_AFTER_HOURS)
    rows = (
        await db.execute(
            select(Quote).where(
                Quote.stage.in_(OPEN_STAGES),
                Quote.awaiting_external_since.is_not(None),
                Quote.awaiting_external_since < cutoff,
            )
        )
    ).scalars().all()
    for quote in rows:
        # Elapsed time between instants: independent of where this runs.
        waiting = now - quote.awaiting_external_since
        hours = int(waiting.total_seconds() // 3600)
        key = f"STALLED_QUOTE:{quote.id}"
        still_open.add(key)
        reasons = [{
            "code": "NO_EXTERNAL_PROGRESS",
            "hoursWaiting": hours,
            "thresholdHours": STALLED_AFTER_HOURS,
            "since": quote.awaiting_external_since.isoformat(),
            "message": f"No customer response or approval decision for {hours} hours.",
        }]
        await _upsert(
            db,
            "STALLED_QUOTE",
            "CRITICAL" if hours > STALLED_AFTER_HOURS * 2 else "WARNING",
            key,
            f"{quote.reference} has had no progress for {hours} hours",
            reasons, now,
            lambda a: _decorate(a, quote_id=quote.id,
                                owner=quote.owner_profile_id, team=quote.team_id),
        )
    return len(rows)


async def _sweep_overdue_approvals(db: AsyncSession, now: datetime, still_open: set[str]) -> int:
    overdue = (
        await db.execute(
            select(ApprovalRequest).where(
                ApprovalRequest.status == "PENDING",
                ApprovalRequest.due_at.is_not(None),
                ApprovalRequest.due_at < now,
            )
        )
    ).scalars().all()
    for step in overdue:
        key = f"APPROVAL_OVERDUE:{step.id}"
        still_open.add(key)
        hours = int((now - step.due_at).total_seconds() // 3600)
        await _upsert(
            db, "APPROVAL_OVERDUE", "WARNING", key,
            f"Approval step {step.step} is {hours} hours overdue",
            [{"code": "APPROVAL_OVERDUE", "requiredRole": step.required_role,
              "hoursOverdue": hours,
              "message": "This step has been pending past its due time."}],
            now, lambda a: _decorate(a, quote_id=step.quote_id, team=step.team_id),
        )

    unassigned = 0
    pending = (
        await db.execute(
            select(ApprovalRequest).where(
                ApprovalRequest.status == "PENDING",
                ApprovalRequest.assignee_profile_id.is_(None),
            )
        )
    ).scalars().all()
    for step in pending:
        approver_conds = [
            Profile.role == step.required_role,
            Profile.is_active.is_(True),
            or_(Profile.unavailable_until.is_(None),
                Profile.unavailable_until < now),
        ]
        if step.team_id is not None:
            approver_conds.append(Profile.team_id == step.team_id)
        available = (
            await db.execute(select(Profile.id).where(*approver_conds))
        ).scalars().all()
        if available:
            continue
        key = f"NO_APPROVER:{step.id}"
        still_open.add(key)
        unassigned += 1
        await _upsert(
            db, "NO_APPROVER", "CRITICAL", key,
            f"No available {step.required_role.lower()} to approve step {step.step}",
            [{"code": "NO_AVAILABLE_APPROVER", "requiredRole": step.required_role,
              "message": "This quotation is blocked until an administrator reassigns "
                         "the step to a qualified backup."}],
            now, lambda a: _decorate(a, quote_id=step.quote_id, team=step.team_id),
        )
    return len(overdue) + unassigned


async def _sweep_delivery_slippage(
    db: AsyncSession, today, now: datetime, still_open: set[str]
) -> int:
    open_bo = (
        await db.execute(select(Backorder).where(Backorder.status == "OPEN"))
    ).scalars().all()
    flagged = 0
    for bo in open_bo:
        line = (
            await db.execute(select(OrderLine).where(OrderLine.id == bo.order_line_id))
        ).scalars().first()
        if line is None:
            continue
        past_promise = line.promised_date is not None and today > line.promised_date
        receipt_too_late = (
            bo.expected_date is not None and line.promised_date is not None
            and bo.expected_date > line.promised_date
        )
        if not past_promise and not receipt_too_late:
            continue
        key = f"DELIVERY_SLIPPAGE:{bo.id}"
        still_open.add(key)
        flagged += 1
        reasons: list[dict[str, Any]] = []
        if past_promise:
            qty = m.plain_quantity(bo.quantity)
            reasons.append({
                "code": "PAST_PROMISED_DATE",
                "promisedDate": line.promised_date.isoformat(),
                "outstandingQuantity": qty,
                "message": f"{qty} units are still unshipped past the promised date.",
            })
        if receipt_too_late:
            reasons.append({
                "code": "RESTOCK_AFTER_PROMISE",
                "expectedDate": bo.expected_date.isoformat(),
                "promisedDate": line.promised_date.isoformat(),
                "message": "Stock is not expected until after the promised date.",
            })
        if bo.expected_date is None:
            reasons.append({
                "code": "DELIVERY_DATE_UNCONFIRMED",
                "message": "Delivery date unconfirmed: no expected receipt is recorded "
                           "for this item.",
            })
        await _upsert(
            db, "DELIVERY_SLIPPAGE", "CRITICAL", key,
            f"Delivery slipping on {line.description}", reasons, now,
            lambda a: _decorate(a, order=bo.order_id, variant=bo.variant_id),
        )
    return flagged


async def _sweep_low_stock(db: AsyncSession, now: datetime, still_open: set[str]) -> int:
    low = (
        await db.execute(
            select(StockLevel).where(
                StockLevel.reorder_point > 0,
                (StockLevel.on_hand - StockLevel.reserved) <= StockLevel.reorder_point,
            )
        )
    ).scalars().all()
    for level in low:
        key = f"LOW_STOCK:{level.variant_id}:{level.warehouse_id}"
        still_open.add(key)
        available = (level.on_hand or Decimal(0)) - (level.reserved or Decimal(0))
        suggestion = max(Decimal(0), (level.target_qty or Decimal(0)) - available)
        await _upsert(
            db, "LOW_STOCK", "INFO", key,
            "Stock at or below its reorder point",
            [{"code": "BELOW_REORDER_POINT",
              "available": m.plain_quantity(available),
              "reorderPoint": m.plain_quantity(level.reorder_point),
              "suggestedOrderQuantity": m.plain_quantity(suggestion),
              "message": f"Available {m.plain_quantity(available)} is at or below "
                         f"the reorder point of {m.plain_quantity(level.reorder_point)}."}],
            now, lambda a: _decorate(a, variant=level.variant_id),
        )
    return len(low)


async def _sweep_overdue_invoices(
    db: AsyncSession, today, now: datetime, still_open: set[str]
) -> int:
    overdue = (
        await db.execute(
            select(Invoice).where(
                Invoice.due_date.is_not(None),
                Invoice.due_date < today,
                Invoice.status.in_(("ISSUED", "PARTIALLY_PAID")),
            )
        )
    ).scalars().all()
    for invoice in overdue:
        key = f"INVOICE_OVERDUE:{invoice.id}"
        still_open.add(key)
        days = (today - invoice.due_date).days
        outstanding = max(0, (invoice.total_minor or 0)
                          - (invoice.credited_minor or 0) - (invoice.paid_minor or 0))
        await _upsert(
            db, "INVOICE_OVERDUE",
            "CRITICAL" if days > 30 else "WARNING", key,
            f"Invoice {invoice.reference} is {days} days overdue",
            [{"code": "INVOICE_PAST_DUE",
              "dueDate": invoice.due_date.isoformat(),
              "outstandingMinor": outstanding,
              "message": f"{m.format_money(outstanding)} remains outstanding."}],
            now, lambda a: _decorate(a, invoice=invoice.id),
        )
    return len(overdue)


# ---------------------------------------------------------------- anomaly ---


async def evaluate_discount_anomaly(db: AsyncSession, quote: Quote):
    """Submission-time check of a quotation's discount vs the rep's history."""
    revision = None
    if quote.current_revision_id is not None:
        revision = (
            await db.execute(select(QuoteRevision).where(
                QuoteRevision.id == quote.current_revision_id))
        ).scalars().first()
    if revision is None or (revision.total_base_minor or 0) <= 0:
        return None
    current = (Decimal(revision.total_discount_minor or 0) * 100
               / Decimal(revision.total_base_minor)).quantize(
                   Decimal("0.0001"), rounding=ROUND_HALF_UP)

    # The rep's own finalised quotations, excluding this one so a deal never
    # contributes to the statistics judging it.
    rows = (
        await db.execute(
            select(QuoteRevision.total_discount_minor, QuoteRevision.total_base_minor)
            .join(Quote, Quote.id == QuoteRevision.quote_id)
            .where(
                Quote.owner_profile_id == quote.owner_profile_id,
                Quote.stage == "CONFIRMED",
                QuoteRevision.id == Quote.current_revision_id,
                QuoteRevision.total_base_minor > 0,
                Quote.id != quote.id,
            )
        )
    ).all()
    history = [
        (Decimal(d or 0) * 100 / Decimal(b)).quantize(
            Decimal("0.0001"), rounding=ROUND_HALF_UP)
        for d, b in rows
    ]
    verdict = anomaly.evaluate(current, history)
    now = now_utc()
    key = f"DISCOUNT_ANOMALY:{quote.id}"
    if verdict.anomalous:
        await _upsert(
            db, "DISCOUNT_ANOMALY", "WARNING", key,
            f"Unusual discount on {quote.reference}",
            [{"code": "DISCOUNT_OUTSIDE_REP_PATTERN",
              "currentPercent": format(verdict.current_percent, "f"),
              "meanPercent": format(verdict.mean_percent, "f"),
              "observations": verdict.observations,
              "message": verdict.explanation}],
            now,
            lambda a: _decorate(a, quote_id=quote.id,
                                owner=quote.owner_profile_id, team=quote.team_id),
        )
    else:
        existing = (
            await db.execute(select(Alert).where(Alert.dedupe_key == key))
        ).scalars().first()
        if existing is not None and existing.status == "OPEN":
            existing.status = "RESOLVED"
            existing.resolved_at = now
    return verdict


# ----------------------------------------------------------------- expiry ---


async def expire_quotes(db: AsyncSession) -> int:
    today = business_today()
    rows = (
        await db.execute(
            select(Quote).where(
                Quote.stage.in_(OPEN_STAGES),
                Quote.valid_until.is_not(None),
                Quote.valid_until < today,
            )
        )
    ).scalars().all()
    for quote in rows:
        quote.stage = "EXPIRED"
        await audit_service.record(
            db, None, "QUOTE_EXPIRED", "Quote", quote.id,
            quote_id=quote.id,
            after={"validUntil": str(quote.valid_until)},
        )
    return len(rows)


# ------------------------------------------------------------ notifications ---


async def list_notifications(
    db: AsyncSession, actor: Actor, *, page: int = 0, size: int = 25
) -> tuple[list[dict[str, Any]], int, int]:
    page = max(0, page)
    size = min(max(size, 1), 100) if size else 25
    base = Notification.recipient_profile_id == actor.profile_id
    total = (await db.execute(
        select(func.count()).select_from(Notification).where(base))).scalar_one()
    unread = (await db.execute(
        select(func.count()).select_from(Notification)
        .where(base, Notification.read_at.is_(None)))).scalar_one()
    rows = (await db.execute(
        select(Notification).where(base)
        .order_by(Notification.created_at.desc())
        .offset(page * size).limit(size))).scalars().all()
    return [notification_to_dict(n) for n in rows], total, unread


async def mark_read(
    db: AsyncSession, actor: Actor, notification_id: UUID
) -> dict[str, Any]:
    row = (
        await db.execute(select(Notification).where(
            Notification.id == notification_id,
            Notification.recipient_profile_id == actor.profile_id,
        ))
    ).scalars().first()
    if row is None:
        raise ApiException.not_found(f"Notification {notification_id}")
    if row.read_at is None:
        row.read_at = now_utc()
    await db.flush()
    return notification_to_dict(row)


# ---------------------------------------------------------------- helpers ---


def _decorate(
    alert: Alert, *,
    quote_id: UUID | None = None,
    order: UUID | None = None,
    invoice: UUID | None = None,
    variant: UUID | None = None,
    owner: UUID | None = None,
    team: UUID | None = None,
) -> None:
    if quote_id is not None:
        alert.quote_id = quote_id
    if order is not None:
        alert.order_id = order
    if invoice is not None:
        alert.invoice_id = invoice
    if variant is not None:
        alert.variant_id = variant
    if owner is not None:
        alert.owner_profile_id = owner
    if team is not None:
        alert.team_id = team


async def _upsert(
    db: AsyncSession,
    alert_type: str,
    severity: str,
    dedupe_key: str,
    title: str,
    reasons: list[dict[str, Any]],
    now: datetime,
    decorate: Callable[[Alert], None],
) -> Alert:
    alert = (
        await db.execute(select(Alert).where(Alert.dedupe_key == dedupe_key))
    ).scalars().first()
    if alert is None:
        alert = Alert(
            alert_type=alert_type, severity=severity, dedupe_key=dedupe_key,
            title=title, reasons=reasons, status="OPEN",
            first_seen_at=now, last_seen_at=now, nudge_count=0,
        )
        decorate(alert)
        db.add(alert)
        await db.flush()
        await outbox_writer.publish(
            db, outbox_writer.ALERT_UPDATED, "Alert", alert.id, 0,
            {"alertType": alert_type, "severity": severity},
            outbox_writer.owner_scope(alert.owner_profile_id)
            if alert.owner_profile_id is not None
            else outbox_writer.roles_scope("MANAGER", "FINANCE"),
        )
    else:
        alert.last_seen_at = now
        alert.title = title
        alert.reasons = reasons
        alert.severity = severity
        if alert.status == "RESOLVED":
            # Reopened: the condition came back.
            alert.status = "OPEN"
            alert.resolved_at = None
            alert.first_seen_at = now
        decorate(alert)
    return alert


async def _resolve_cleared(
    db: AsyncSession, still_open: set[str], now: datetime
) -> int:
    rows = (
        await db.execute(
            select(Alert).where(
                Alert.status == "OPEN",
                Alert.alert_type.in_(sorted(SWEPT_TYPES)),
            )
        )
    ).scalars().all()
    resolved = 0
    for alert in rows:
        if alert.dedupe_key in still_open:
            continue
        alert.status = "RESOLVED"
        alert.resolved_at = now
        resolved += 1
        await outbox_writer.publish(
            db, outbox_writer.ALERT_UPDATED, "Alert", alert.id, 0,
            {"status": "RESOLVED", "alertType": alert.alert_type},
            outbox_writer.owner_scope(alert.owner_profile_id)
            if alert.owner_profile_id is not None
            else outbox_writer.roles_scope("MANAGER"),
        )
    if resolved:
        log.debug("Resolved %d alerts whose conditions cleared", resolved)
    return resolved
