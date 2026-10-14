"""Leased scheduler — port of jobs/service/ScheduledJobs (60s sweeps)."""

from __future__ import annotations

import asyncio
import logging

from app.core.database import SessionLocal
from app.services import health_service, job_service

log = logging.getLogger("dealflow")

SWEEP_INTERVAL_SECONDS = 60.0


async def sweep_forever() -> None:
    from app.core.config import get_settings

    await asyncio.sleep(20)  # stagger like the Java initial delays
    while True:
        try:
            if get_settings().jobs_enabled:
                async with SessionLocal() as db:
                    try:
                        await job_service.run_recurring_billing(db, "SCHEDULED")
                        await db.commit()
                    except Exception:
                        await db.rollback()
                        log.exception("billing sweep failed")
                async with SessionLocal() as db:
                    try:
                        if await job_service.try_acquire(db, "deal-health", 110):
                            try:
                                await health_service.sweep_all(db)
                            finally:
                                await job_service.release(db, "deal-health")
                        await db.commit()
                    except Exception:
                        await db.rollback()
                        log.exception("health sweep failed")
                async with SessionLocal() as db:
                    try:
                        if await job_service.try_acquire(db, "quote-expiry", 110):
                            try:
                                await health_service.expire_quotes(db)
                            finally:
                                await job_service.release(db, "quote-expiry")
                        await db.commit()
                    except Exception:
                        await db.rollback()
                        log.exception("expiry sweep failed")
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("scheduler sweep failed")
        await asyncio.sleep(SWEEP_INTERVAL_SECONDS)
