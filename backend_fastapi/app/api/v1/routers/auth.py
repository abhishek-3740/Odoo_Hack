"""Auth + admin router — public sign-in/registration, demo personas,
/me and ADMIN user administration. Full literal paths in decorators."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_actor, require_roles, scope_404
from app.core.config import get_settings
from app.core.database import get_db
from app.core.exceptions import ApiException
from app.core.response import ApiResponse, PageResponse
from app.core.security import Actor
from app.schemas.auth import (
    DelegationRequest,
    DemoTokenRequest,
    InternalRegisterRequest,
    LoginRequest,
    ProfileUpdateRequest,
    ProvisionRequest,
    RegisterRequest,
    TeamRequest,
)
from app.services import auth_service

router = APIRouter()


def _demo_gate() -> None:
    from app.core.security import require_demo_enabled

    try:
        require_demo_enabled(get_settings())
    except ApiException:
        raise scope_404()


@router.get("/api/v1/auth/options")
async def auth_options() -> dict:
    return ApiResponse.of(await auth_service.options())


@router.post("/api/v1/auth/register", status_code=status.HTTP_201_CREATED)
async def auth_register(req: RegisterRequest, db: AsyncSession = Depends(get_db)) -> dict:
    return ApiResponse.of(await auth_service.register(db, req))


@router.post("/api/v1/auth/register-internal", status_code=status.HTTP_201_CREATED)
async def auth_register_internal(
    req: InternalRegisterRequest, db: AsyncSession = Depends(get_db)
) -> dict:
    return ApiResponse.of(await auth_service.register_internal(db, req))


@router.get("/api/v1/auth/teams")
async def auth_teams(db: AsyncSession = Depends(get_db)) -> dict:
    return ApiResponse.of(await auth_service.list_teams(db))


@router.post("/api/v1/auth/login")
async def auth_login(req: LoginRequest, db: AsyncSession = Depends(get_db)) -> dict:
    return ApiResponse.of(await auth_service.login(db, req.email, req.password))


@router.get("/api/v1/auth/demo-accounts")
async def demo_accounts(db: AsyncSession = Depends(get_db)) -> dict:
    _demo_gate()
    try:
        accounts = await auth_service.demo_accounts(db)
    except ApiException as exc:
        if exc.code.name == "FORBIDDEN":
            raise scope_404()
        raise
    return ApiResponse.of(accounts)


@router.post("/api/v1/auth/demo-token")
async def demo_token(
    req: DemoTokenRequest | None = None, db: AsyncSession = Depends(get_db)
) -> dict:
    _demo_gate()
    email = req.email if req else None
    role = req.role if req else None
    try:
        token = await auth_service.authenticate_demo(db, email, role)
    except ApiException as exc:
        if exc.code.name == "FORBIDDEN":
            raise scope_404()
        raise
    return ApiResponse.of(token)


@router.get("/api/v1/me")
async def me(
    actor: Actor = Depends(get_current_actor), db: AsyncSession = Depends(get_db)
) -> dict:
    return ApiResponse.of(await auth_service.me(db, actor))


@router.get("/api/v1/admin/profiles")
async def admin_list_profiles(
    role: str | None = None,
    page: int | None = None,
    pageSize: int | None = None,
    sort: str | None = None,
    actor: Actor = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    items, page_index, size, total = await auth_service.list_profiles(
        db, actor, role, page, pageSize, sort
    )
    return PageResponse.of(items, page_index, size, total)


@router.post("/api/v1/admin/profiles", status_code=status.HTTP_201_CREATED)
async def admin_provision_profile(
    req: ProvisionRequest,
    actor: Actor = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return ApiResponse.of(await auth_service.provision_profile(db, actor, req))


@router.patch("/api/v1/admin/profiles/{id}")
async def admin_patch_profile(
    id: uuid.UUID,
    req: ProfileUpdateRequest,
    actor: Actor = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return ApiResponse.of(await auth_service.patch_profile(db, actor, id, req))


@router.get("/api/v1/admin/delegations")
async def admin_list_delegations(
    actor: Actor = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return ApiResponse.of(await auth_service.list_delegations(db, actor))


@router.post("/api/v1/admin/delegations", status_code=status.HTTP_201_CREATED)
async def admin_create_delegation(
    req: DelegationRequest,
    actor: Actor = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return ApiResponse.of(await auth_service.create_delegation(db, actor, req))


@router.get("/api/v1/admin/teams")
async def admin_list_teams(
    actor: Actor = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return ApiResponse.of(await auth_service.list_admin_teams(db, actor))


@router.post("/api/v1/admin/teams", status_code=status.HTTP_201_CREATED)
async def admin_create_team(
    req: TeamRequest,
    actor: Actor = Depends(require_roles("ADMIN")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return ApiResponse.of(await auth_service.create_team(db, actor, req))
