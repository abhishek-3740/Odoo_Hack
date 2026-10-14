"""Leased jobs — ports JobLeaseService, RecurringBillingJob and the manual
side of ScheduledJobs/JobController.

A database-backed lease stops two sweeps doing redundant work; it is not the
correctness guarantee (unique charge keys and idempotent writes are). A lease
expires on its own, so a job that dies holding one never blocks the next run.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor
from app.models.billing import Subscription
from app.models.ops import JobLease, JobRun
from app.services import audit_service
from app.services.clock import business_today, now_utc

log = logging.getLogger("dealflow")

RECURRING_BILLING_JOB = "recurring-billing"
DEAL_HEALTH_JOB = "deal-health"
QUOTE_EXPIRY_JOB = "quote-expiry"

LEASE_SECONDS = 120
BILLING_BATCH_SIZE = 25

# Unique to this process, so a lease can be renewed only by its holder.
HOLDER = "api-" + uuid.uuid4().hex[:8]

_ACQUIRE_SQL = """
insert into dealflow.job_leases (job_name, lease_until, holder, updated_at)
values (:job_name, :lease_until, :holder, :now)
on conflict (job_name) do update
    set lease_until = excluded.lease_until,
        holder = excluded.holder,
        updated_at = excluded.updated_at
  where dealflow.job_leases.lease_until < :now
     or dealflow.job_leases.holder = :holder
"""

_RELEASE_SQL = """
update dealflow.job_leases
   set lease_until = :now
 where job_name = :job_name and holder = :holder
"""


def holder() -> str:
    return HOLDER


async def try_acquire(db: AsyncSession, job_name: str, seconds: int) -> bool:
    """Take the lease if free, expired, or already ours. Commits with caller."""
    now = now_utc()
    result = await db.execute(
        text(_ACQUIRE_SQL),
        {"job_name": job_name, "lease_until": now + timedelta(seconds=seconds),
         "holder": HOLDER, "now": now},
    )
    return (result.rowcount or 0) > 0


async def release(db: AsyncSession, job_name: str) -> None:
    await db.execute(
        text(_RELEASE_SQL),
        {"now": now_utc(), "job_name": job_name, "holder": HOLDER},
    )


async def run_recurring_billing(
    db: AsyncSession, trigger: str = "MANUAL"
) -> dict[str, Any]:
    if not await try_acquire(db, RECURRING_BILLING_JOB, LEASE_SECONDS):
        log.debug("Recurring billing already running elsewhere; skipping")
        return {"jobRunId": None, "processed": 0, "failed": 0, "skippedNoLease": True}
    today = business_today()
    run = JobRun(job_name=RECURRING_BILLING_JOB, business_date=today,
                 status="RUNNING", trigger_kind=trigger, started_at=now_utc())
    db.add(run)
    await db.flush()

    processed, failed = 0, 0
    try:
        due = (await db.execute(
            select(Subscription.id)
            .where(Subscription.next_bill_at.is_not(None),
                   Subscription.next_bill_at <= today,
                   Subscription.status.in_(("ACTIVE", "CANCEL_AT_PERIOD_END")))
            .order_by(Subscription.next_bill_at.asc())
            .limit(BILLING_BATCH_SIZE)
        )).scalars().all()
        for subscription_id in due:
            try:
                # Each subscription is its own transaction: one bad row fails
                # alone, the rest of the batch still bills.
                async with db.begin_nested():
                    await _charge_one(db, subscription_id, today)
                processed += 1
            except Exception as exc:
                failed += 1
                log.error("Recurring charge failed for subscription %s",
                          subscription_id, exc_info=exc)
        _finish(run, failed, processed,
                "Nothing due" if not due else f"{processed} charged, {failed} failed")
    except Exception as exc:
        _finish(run, failed + 1, processed, str(exc) or "Recurring billing sweep failed")
        log.error("Recurring billing sweep failed", exc_info=exc)
    finally:
        await db.flush()
        await release(db, RECURRING_BILLING_JOB)
    return {"jobRunId": str(run.id), "processed": processed,
            "failed": failed, "skippedNoLease": False}


async def _charge_one(db: AsyncSession, subscription_id: UUID, today) -> None:
    try:
        from app.services import billing_service
    except ImportError as exc:
        raise RuntimeError(f"Billing service is unavailable: {exc}") from exc
    charge = getattr(billing_service, "charge_next_period", None)
    if charge is None:
        raise RuntimeError("Billing service has no charge_next_period.")
    subscription = (
        await db.execute(
            select(Subscription).where(Subscription.id == subscription_id)
            .with_for_update())
    ).scalars().first()
    if subscription is None or subscription.next_bill_at is None \
            or subscription.next_bill_at > today \
            or subscription.status not in ("ACTIVE", "CANCEL_AT_PERIOD_END"):
        return
    await charge(db, subscription, Actor.system())


def _finish(run: JobRun, failed: int, processed: int, message: str | None) -> None:
    run.status = "SUCCESS" if failed == 0 else "FAILED"
    run.processed_count = processed
    run.failure_count = failed
    run.message = message
    run.finished_at = now_utc()


async def run_deal_health(db: AsyncSession) -> dict[str, int]:
    from app.services import health_service

    return await health_service.sweep_all(db)


async def run_quote_expiry(db: AsyncSession) -> int:
    from app.services import health_service

    return await health_service.expire_quotes(db)


async def run_job(db: AsyncSession, job_name: str, actor: Actor) -> dict[str, Any]:
    """Manual dispatcher: runs the same implementation the scheduler runs."""
    if job_name == RECURRING_BILLING_JOB:
        summary = await run_recurring_billing(db, "MANUAL")
        outcome = {"job": RECURRING_BILLING_JOB, "processed": summary["processed"],
                   "failed": summary["failed"],
                   "skippedNoLease": summary["skippedNoLease"]}
    elif job_name == DEAL_HEALTH_JOB:
        summary = await run_deal_health(db)
        outcome = {"job": DEAL_HEALTH_JOB, "open": summary["opened"],
                   "resolved": summary["resolved"]}
    elif job_name == QUOTE_EXPIRY_JOB:
        outcome = {"job": QUOTE_EXPIRY_JOB, "expired": await run_quote_expiry(db)}
    else:
        raise ApiException(
            ErrorCode.VALIDATION_FAILED,
            "Unknown job. Use recurring-billing, deal-health or quote-expiry.")
    await audit_service.record(
        db, actor, "JOB_RUN_MANUAL", "Job", None,
        after={"jobName": job_name},
    )
    return outcome


async def recent_runs(db: AsyncSession, limit: int = 50) -> list[dict[str, Any]]:
    rows = (await db.execute(
        select(JobRun).order_by(JobRun.started_at.desc()).limit(limit))).scalars().all()
    return [{
        "id": str(run.id),
        "jobName": run.job_name,
        "status": run.status,
        "trigger": run.trigger_kind,
        "businessDate": str(run.business_date),
        "startedAt": run.started_at.isoformat() if run.started_at else None,
        "finishedAt": str(run.finished_at),
        "processed": run.processed_count,
        "failed": run.failure_count,
        "message": str(run.message),
    } for run in rows]


async def get_lease(db: AsyncSession, job_name: str) -> JobLease | None:
    return (await db.execute(
        select(JobLease).where(JobLease.job_name == job_name))).scalars().first()
