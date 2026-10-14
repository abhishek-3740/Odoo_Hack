"""Business clock — port of shared/time/BusinessClock."""

from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

from app.core.config import Settings, get_settings


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def billing_zone(settings: Settings | None = None) -> ZoneInfo:
    settings = settings or get_settings()
    return ZoneInfo(settings.billing_timezone)


def business_today(settings: Settings | None = None) -> date:
    settings = settings or get_settings()
    override = (settings.demo_business_date or "").strip()
    if override and settings.demo_mode:
        return date.fromisoformat(override)
    return datetime.now(timezone.utc).astimezone(billing_zone(settings)).date()
