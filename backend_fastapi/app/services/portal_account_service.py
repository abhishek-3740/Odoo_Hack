"""Portal account service — port of portal/service/PortalAccountService.java.

The customer's own profile and settings, bound to the caller; nothing here
takes an id from the request.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor, hash_password, verify_password
from app.models.auth import Profile
from app.models.catalog import Customer
from app.schemas import portal as dto
from app.schemas.portal import AccountUpdateRequest
from app.services import audit_service

PREFERENCE_KEYS = frozenset(
    {
        "emailNotifications",
        "dealUpdates",
        "invoiceReminders",
        "marketingUpdates",
        "compactTables",
        "defaultLanding",
        "showPricesWithTax",
    }
)


def _trim_to_null(value: str) -> str | None:
    trimmed = value.strip()
    return trimmed or None


async def _load_profile(db: AsyncSession, actor: Actor) -> Profile:
    if not actor.is_customer or actor.customer_id is None:
        raise ApiException.forbidden("This area is for customer accounts.")
    profile = (
        await db.execute(select(Profile).where(Profile.id == actor.profile_id))
    ).scalars().first()
    if profile is None:
        raise ApiException.not_found("Your profile")
    return profile


async def _load_customer(db: AsyncSession, profile: Profile) -> Customer:
    customer = (
        await db.execute(select(Customer).where(Customer.id == profile.customer_id))
    ).scalars().first()
    if customer is None:
        raise ApiException.not_found("Your organisation")
    return customer


def _provider_for(profile: Profile) -> str:
    if profile.password_hash:
        return "LOCAL"
    if (profile.email or "").lower().endswith("@dealflow.demo"):
        return "DEMO"
    return "SUPABASE"


def _preferences_of(profile: Profile) -> dict[str, Any]:
    prefs = profile.preferences
    if isinstance(prefs, dict):
        return dict(prefs)
    return {}


async def _to_response(
    db: AsyncSession, profile: Profile
) -> dict[str, Any]:
    customer = await _load_customer(db, profile)
    manager = None
    if customer.owner_rep_profile_id is not None:
        manager = (
            await db.execute(
                select(Profile).where(Profile.id == customer.owner_rep_profile_id)
            )
        ).scalars().first()
    provider = _provider_for(profile)
    return dto.account_response(
        profile, customer, manager, provider, _preferences_of(profile)
    )


async def get(db: AsyncSession, actor: Actor) -> dict[str, Any]:
    return await _to_response(db, await _load_profile(db, actor))


async def update(
    db: AsyncSession, actor: Actor, request: AccountUpdateRequest
) -> dict[str, Any]:
    profile = await _load_profile(db, actor)
    customer = await _load_customer(db, profile)
    before = {
        "fullName": str(profile.full_name),
        "phone": str(profile.phone),
        "billingAddress": str(customer.billing_address),
    }
    if request.fullName is not None:
        profile.full_name = _trim_to_null(request.fullName)
    if request.phone is not None:
        profile.phone = _trim_to_null(request.phone)
    if request.contactEmail is not None:
        customer.contact_email = _trim_to_null(request.contactEmail)
    if request.contactPhone is not None:
        customer.contact_phone = _trim_to_null(request.contactPhone)
    if request.billingAddress is not None:
        customer.billing_address = _trim_to_null(request.billingAddress)
    await audit_service.record(
        db, actor, "PORTAL_ACCOUNT_UPDATED", "Profile", profile.id,
        before=before,
        after={
            "fullName": str(profile.full_name),
            "phone": str(profile.phone),
            "billingAddress": str(customer.billing_address),
        },
    )
    await db.flush()
    return await _to_response(db, profile)


async def update_preferences(
    db: AsyncSession, actor: Actor, preferences: dict[str, Any]
) -> dict[str, Any]:
    profile = await _load_profile(db, actor)
    accepted = _preferences_of(profile)
    for key, value in (preferences or {}).items():
        if key not in PREFERENCE_KEYS:
            continue
        if isinstance(value, (bool, int, float)) or (
            isinstance(value, str) and len(value) <= 100
        ):
            accepted[key] = value
        else:
            raise ApiException(
                ErrorCode.VALIDATION_FAILED,
                f'Preference "{key}" must be a boolean, number or short text.',
            )
    profile.preferences = accepted
    await db.flush()
    return await _to_response(db, profile)


async def change_password(
    db: AsyncSession, actor: Actor, current_password: str, new_password: str
) -> None:
    profile = await _load_profile(db, actor)
    if not profile.password_hash:
        raise ApiException(
            ErrorCode.CONFLICTING_STATE,
            "This account signs in through an external identity provider; "
            "its password is managed there.",
        )
    if not verify_password(current_password, profile.password_hash):
        raise ApiException(
            ErrorCode.VALIDATION_FAILED, "The current password is incorrect."
        )
    profile.password_hash = hash_password(new_password)
    await audit_service.record(
        db, actor, "PASSWORD_CHANGED", "Profile", profile.id
    )
    await db.flush()
