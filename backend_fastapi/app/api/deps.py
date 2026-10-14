"""Request dependencies — port of ActorArgumentResolver + @PreAuthorize guards.

get_current_actor resolves the DB Actor on EVERY request (deactivation is
immediate). Customer isolation returns 404, never 403 (anti-scraping).
"""

from __future__ import annotations

import uuid

from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import ApiException, ErrorCode
from app.core.security import Actor, resolve_actor, verify_token

_bearer = HTTPBearer(auto_error=False)


async def get_current_actor(
    request: Request,
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Actor:
    token = None
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    if not token:
        raise ApiException(ErrorCode.UNAUTHENTICATED, "Sign in to continue.")
    claims = verify_token(token)
    actor = await resolve_actor(db, claims)
    request.state.actor = actor
    return actor


def require_roles(*roles: str):
    """Dependency factory: actor.role must be one of roles, else 403."""

    async def guard(actor: Actor = Depends(get_current_actor)) -> Actor:
        if actor.role not in roles:
            raise ApiException(
                ErrorCode.FORBIDDEN, "You do not have access to this action."
            )
        return actor

    return guard


async def require_internal(actor: Actor = Depends(get_current_actor)) -> Actor:
    if actor.is_customer:
        raise ApiException(ErrorCode.FORBIDDEN, "Use the portal endpoints.")
    return actor


async def require_customer(actor: Actor = Depends(get_current_actor)) -> Actor:
    if not actor.is_customer:
        raise ApiException(ErrorCode.FORBIDDEN, "You do not have access to this action.")
    return actor


require_admin = require_roles("ADMIN")
require_finance = require_roles("FINANCE", "ADMIN")


def idempotency_key(
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> str:
    if not idempotency_key or not idempotency_key.strip():
        raise ApiException(
            ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
            "This operation requires an Idempotency-Key header.",
        )
    return idempotency_key.strip()


def scope_404() -> ApiException:
    """Out-of-scope reads masquerade as missing (portal isolation)."""
    return ApiException.not_found("That record does not exist.")


def actor_or_404(value: object | None) -> object:
    if value is None:
        raise scope_404()
    return value
