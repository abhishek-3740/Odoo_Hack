"""Auth domain service — port of LocalAuthService + DemoTokenService
+ MeController/ ProfileAdminController business rules."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import ApiException, ErrorCode
from app.core.security import (
    Actor,
    capabilities_for,
    hash_password,
    local_signing_secret,
    mint_demo_token,
    mint_local_token,
    verify_password,
)
from app.models.auth import ApprovalDelegation, Profile, Team
from app.models.catalog import Customer
from app.schemas.auth import (
    DelegationRequest,
    InternalRegisterRequest,
    ProfileUpdateRequest,
    ProvisionRequest,
    RegisterRequest,
    TeamRequest,
)
from app.services import audit_service
from app.services.clock import now_utc

LOCAL_EXPIRES_IN = 604800
DEMO_EXPIRES_IN = 2592000

VALID_ROLES = {"REP", "MANAGER", "FINANCE", "ADMIN", "CUSTOMER"}
INTERNAL_ROLES = {"REP", "MANAGER", "FINANCE", "ADMIN"}
APPROVER_ROLES = {"MANAGER", "FINANCE"}


@dataclass(frozen=True)
class _Spec:
    email: str
    full_name: str
    role: str
    description: str
    auth_user_id: uuid.UUID
    team_name: str | None
    customer_name: str | None
    capabilities: list[str]


SPECS: list[_Spec] = [
    _Spec("admin@dealflow.demo", "Demo Admin", "ADMIN",
          "System Administrator with full permissions across master catalog, governance policies, user management, approval reassignment, reports, and jobs",
          uuid.UUID("00000000-0000-4000-8000-000000000001"), None, None,
          ["admin:catalog", "admin:policy", "admin:warehouses", "admin:plans", "admin:profiles",
           "approvals:reassign", "quotes:read-all", "reports:all", "alerts:all", "jobs:run"]),
    _Spec("rep.a@dealflow.demo", "Rep A (Sales)", "REP",
          "Commercial Sales Representative for Alpha Traders, Beta Systems, and Delta Logistics",
          uuid.UUID("00000000-0000-4000-8000-000000000002"), "Sales East", None,
          ["quotes:create", "quotes:edit-own", "quotes:submit", "quotes:share", "quotes:adopt",
           "recommendations:read", "reports:own", "alerts:own"]),
    _Spec("rep.b@dealflow.demo", "Rep B (Sales)", "REP",
          "Commercial Sales Representative for Gamma Retail and Epsilon Labs",
          uuid.UUID("00000000-0000-4000-8000-000000000003"), "Sales East", None,
          ["quotes:create", "quotes:edit-own", "quotes:submit", "quotes:share", "quotes:adopt",
           "recommendations:read", "reports:own", "alerts:own"]),
    _Spec("manager.a@dealflow.demo", "Manager A", "MANAGER",
          "Sales Manager reviewing Step 1 discount approvals, team velocity, and margin compliance",
          uuid.UUID("00000000-0000-4000-8000-000000000004"), "Sales East", None,
          ["quotes:read-team", "approvals:manager", "policy:read", "reports:team", "alerts:team", "alerts:nudge"]),
    _Spec("manager.backup@dealflow.demo", "Backup Manager", "MANAGER",
          "Delegated approver covering Manager A approval queue during leave windows (E07)",
          uuid.UUID("00000000-0000-4000-8000-000000000005"), "Sales East", None,
          ["quotes:read-team", "approvals:manager", "policy:read", "reports:team", "alerts:team"]),
    _Spec("finance@dealflow.demo", "Finance Ops", "FINANCE",
          "Finance Controller approving Step 2 high-concession deals, recording payments, and dispatching shipments",
          uuid.UUID("00000000-0000-4000-8000-000000000006"), None, None,
          ["quotes:read-all", "approvals:finance", "allocations:override", "stock:receive",
           "shipments:dispatch", "payments:record", "refunds:record", "subscriptions:change", "reports:all"]),
    _Spec("alpha@customer.demo", "Alpha Buyer", "CUSTOMER",
          "Client buyer contact for Alpha Traders (Bronze Tier) with access to proposal counter-negotiation and acceptance",
          uuid.UUID("00000000-0000-4000-8000-000000000007"), None, "Alpha Traders",
          ["portal:quotes", "portal:negotiate", "portal:accept", "portal:invoices"]),
    _Spec("beta@customer.demo", "Beta Buyer", "CUSTOMER",
          "Client buyer contact for Beta Systems (Gold Tier) with access to proposal counter-negotiation and acceptance",
          uuid.UUID("00000000-0000-4000-8000-000000000008"), None, "Beta Systems",
          ["portal:quotes", "portal:negotiate", "portal:accept", "portal:invoices"]),
]


def _settings(settings=None):
    return settings or get_settings()


def _parse_role(value: str | None) -> str:
    try:
        upper = (value or "").strip().upper()
    except AttributeError:
        upper = ""
    if upper not in VALID_ROLES:
        raise ApiException(ErrorCode.VALIDATION_FAILED, f'Unknown role "{value}".')
    return upper


def is_demo_persona(email: str | None) -> bool:
    if not email or not email.strip():
        return False
    search = email.strip()
    return any(s.email.lower() == search.lower() for s in SPECS)


def _demo_curl(token: str) -> str:
    return f'curl -X GET http://localhost:8080/api/v1/me -H "Authorization: Bearer {token}"'


def _local_token_response(profile: Profile, settings=None) -> dict:
    token = mint_local_token(profile, _settings(settings))
    return {
        "email": profile.email,
        "fullName": profile.full_name,
        "role": profile.role,
        "tokenType": "Bearer",
        "accessToken": token,
        "expiresIn": LOCAL_EXPIRES_IN,
        "capabilities": capabilities_for(profile.role),
        "sampleCurl": None,
    }


def _profile_response(profile: Profile) -> dict:
    return {
        "id": str(profile.id),
        "authUserId": str(profile.auth_user_id) if profile.auth_user_id else None,
        "email": profile.email,
        "fullName": profile.full_name,
        "role": profile.role,
        "teamId": str(profile.team_id) if profile.team_id else None,
        "customerId": str(profile.customer_id) if profile.customer_id else None,
        "active": bool(profile.is_active),
        "unavailableUntil": profile.unavailable_until,
        "bound": profile.auth_user_id is not None,
    }


def _delegation_response(delegation: ApprovalDelegation, now=None) -> dict:
    moment = now or now_utc()
    active = delegation.valid_from <= moment <= delegation.valid_until
    return {
        "id": str(delegation.id),
        "approverRole": delegation.approver_role,
        "teamId": str(delegation.team_id) if delegation.team_id else None,
        "delegateProfileId": str(delegation.delegate_profile_id),
        "validFrom": delegation.valid_from,
        "validUntil": delegation.valid_until,
        "reason": delegation.reason,
        "activeNow": bool(active),
    }


async def _find_profile_by_email(db: AsyncSession, email: str) -> Profile | None:
    lowered = (email or "").strip().lower()
    res = await db.execute(select(Profile).where(func.lower(Profile.email) == lowered))
    return res.scalars().first()


async def _require_team(db: AsyncSession, team_id: uuid.UUID) -> Team:
    team = await db.get(Team, team_id)
    if team is None:
        raise ApiException.not_found(f"Team {team_id}")
    return team


async def _require_customer(db: AsyncSession, customer_id: uuid.UUID) -> Customer:
    customer = await db.get(Customer, customer_id)
    if customer is None:
        raise ApiException.not_found(f"Customer {customer_id}")
    return customer


def _validate_binding_role(role: str, customer_id: uuid.UUID | None) -> None:
    if role == "CUSTOMER":
        if customer_id is None:
            raise ApiException(ErrorCode.VALIDATION_FAILED, "A customer profile needs a customerId.")
    elif customer_id is not None:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "Only a CUSTOMER profile may be bound to a customer.")


async def options(settings=None) -> dict:
    s = _settings(settings)
    enabled = local_signing_secret(s) is not None
    return {"passwordLogin": enabled, "selfRegistration": enabled, "demoPersonas": bool(s.demo_auth_enabled)}


async def list_teams(db: AsyncSession, settings=None) -> list[dict]:
    res = await db.execute(select(Team))
    teams = list(res.scalars().all())
    if not teams:
        created = Team(name="Sales East")
        db.add(created)
        await db.flush()
        teams = [created]
    return [{"id": str(t.id), "name": t.name} for t in teams]


def _require_local_enabled(settings=None) -> None:
    if local_signing_secret(_settings(settings)) is None:
        raise ApiException(
            ErrorCode.FORBIDDEN,
            "Email/password sign-in is not configured on this server. "
            "Set AUTH_LOCAL_JWT_SECRET (at least 32 bytes).",
        )


def _blank_to_none(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    return value.strip()


async def register(db: AsyncSession, req: RegisterRequest, settings=None) -> dict:
    s = _settings(settings)
    _require_local_enabled(s)
    email = req.email.strip().lower()
    if await _find_profile_by_email(db, email) is not None:
        raise ApiException(ErrorCode.CONFLICTING_STATE,
                           f"An account already exists for {email}. Sign in instead.")
    customer = Customer(
        name=req.company_name.strip(),
        tier="BRONZE",
        currency="INR",
        contact_email=email,
        contact_phone=_blank_to_none(req.phone),
    )
    rep_res = await db.execute(
        select(Profile).where(Profile.role == "REP", Profile.is_active.is_(True)).order_by(Profile.created_at.asc()).limit(1)
    )
    rep = rep_res.scalars().first()
    if rep is not None:
        customer.owner_rep_profile_id = rep.id
    db.add(customer)
    await db.flush()
    profile = Profile(
        auth_user_id=uuid.uuid4(),
        email=email,
        full_name=req.full_name.strip(),
        role="CUSTOMER",
        customer_id=customer.id,
        is_active=True,
        password_hash=hash_password(req.password),
        phone=_blank_to_none(req.phone),
    )
    db.add(profile)
    await db.flush()
    actor = Actor(profile.id, profile.auth_user_id, profile.email, profile.role, None, profile.customer_id)
    await audit_service.record(db, actor, "CUSTOMER_REGISTERED", "Profile", profile.id,
                               after={"email": email, "customerId": str(customer.id), "customerName": customer.name})
    return _local_token_response(profile, s)


async def register_internal(db: AsyncSession, req: InternalRegisterRequest, settings=None) -> dict:
    s = _settings(settings)
    _require_local_enabled(s)
    email = req.email.strip().lower()
    if await _find_profile_by_email(db, email) is not None:
        raise ApiException(ErrorCode.CONFLICTING_STATE,
                           f"An account already exists for {email}. Sign in instead.")
    role = _parse_role(req.role)
    if role not in INTERNAL_ROLES:
        raise ApiException(ErrorCode.VALIDATION_FAILED,
                           "Staff registration requires an internal role (ADMIN, REP, MANAGER, or FINANCE).")
    team_id = req.team_id
    if team_id is None and req.team_name is not None and req.team_name.strip():
        name = req.team_name.strip()
        res = await db.execute(select(Team).where(Team.name == name))
        team = res.scalars().first()
        if team is None:
            team = Team(name=name)
            db.add(team)
            await db.flush()
        team_id = team.id
    if team_id is None and role in ("REP", "MANAGER"):
        res = await db.execute(select(Team).where(Team.name == "Sales East"))
        team = res.scalars().first()
        if team is None:
            all_res = await db.execute(select(Team).limit(1))
            team = all_res.scalars().first()
        if team is None:
            team = Team(name="Sales East")
            db.add(team)
            await db.flush()
        team_id = team.id
    if team_id is not None:
        await _require_team(db, team_id)
    profile = Profile(
        auth_user_id=uuid.uuid4(),
        email=email,
        full_name=req.full_name.strip(),
        role=role,
        team_id=None if role in ("ADMIN", "FINANCE") else team_id,
        is_active=True,
        password_hash=hash_password(req.password),
        phone=_blank_to_none(req.phone),
    )
    db.add(profile)
    await db.flush()
    actor = Actor(profile.id, profile.auth_user_id, profile.email, profile.role, profile.team_id, None)
    await audit_service.record(db, actor, "STAFF_REGISTERED", "Profile", profile.id,
                               after={"email": email, "role": role,
                                      "teamId": str(team_id) if team_id else "none"})
    return _local_token_response(profile, s)


async def login(db: AsyncSession, email: str, password: str | None, settings=None) -> dict:
    s = _settings(settings)
    profile = await _find_profile_by_email(db, email or "")
    if profile is not None and profile.password_hash:
        _require_local_enabled(s)
        if profile is None or password is None or not verify_password(password, profile.password_hash):
            raise ApiException(ErrorCode.UNAUTHENTICATED, "Invalid email or password.")
        if not profile.is_active:
            raise ApiException(ErrorCode.PROFILE_INACTIVE, "This account is deactivated.")
        return _local_token_response(profile, s)
    if s.demo_auth_enabled and is_demo_persona(email or ""):
        return await authenticate_demo(db, (email or "").strip(), None, settings=s)
    raise ApiException(ErrorCode.UNAUTHENTICATED, "Invalid email or password.")


async def ensure_demo_profiles(db: AsyncSession, settings=None) -> None:
    from app.core.security import require_demo_enabled as _require_demo

    s = _settings(settings)
    _require_demo(s)
    res = await db.execute(select(Team).where(Team.name == "Sales East"))
    default_team = res.scalars().first()
    if default_team is None:
        default_team = Team(name="Sales East")
        db.add(default_team)
        await db.flush()
    alpha_res = await db.execute(select(Customer).where(func.lower(Customer.name) == "alpha traders"))
    alpha = alpha_res.scalars().first()
    if alpha is None:
        alpha = Customer(name="Alpha Traders", tier="BRONZE", currency="INR")
        db.add(alpha)
        await db.flush()
    beta_res = await db.execute(select(Customer).where(func.lower(Customer.name) == "beta systems"))
    beta = beta_res.scalars().first()
    if beta is None:
        beta = Customer(name="Beta Systems", tier="GOLD", currency="INR")
        db.add(beta)
        await db.flush()
    for spec in SPECS:
        existing = await _find_profile_by_email(db, spec.email)
        if existing is None:
            profile = Profile(
                auth_user_id=spec.auth_user_id,
                email=spec.email,
                full_name=spec.full_name,
                role=spec.role,
                is_active=True,
            )
            if spec.team_name is not None:
                profile.team_id = default_team.id
            if spec.customer_name == "Alpha Traders":
                profile.customer_id = alpha.id
            elif spec.customer_name == "Beta Systems":
                profile.customer_id = beta.id
            db.add(profile)
            await db.flush()
        elif existing.auth_user_id is None:
            existing.auth_user_id = spec.auth_user_id
            await db.flush()


async def authenticate_demo(db: AsyncSession, email: str | None, role: str | None, settings=None) -> dict:
    from app.core.security import require_demo_enabled as _require_demo

    s = _settings(settings)
    _require_demo(s)
    matched: _Spec | None = None
    if email is not None and email.strip():
        search = email.strip().lower()
        matched = next((sp for sp in SPECS if sp.email.lower() == search), None)
    if matched is None and role is not None and role.strip():
        search_role = role.strip().upper()
        matched = next((sp for sp in SPECS if sp.role.upper() == search_role), None)
    if matched is None:
        raise ApiException(ErrorCode.VALIDATION_FAILED,
                           "Choose a known demo email or role. This endpoint is not a Supabase password login.")
    await ensure_demo_profiles(db, settings=s)
    token = mint_demo_token(matched.auth_user_id, matched.email, matched.full_name, s)
    return {
        "email": matched.email,
        "fullName": matched.full_name,
        "role": matched.role,
        "tokenType": "Bearer",
        "accessToken": token,
        "expiresIn": DEMO_EXPIRES_IN,
        "capabilities": list(matched.capabilities),
        "sampleCurl": _demo_curl(token),
    }


async def demo_accounts(db: AsyncSession, settings=None) -> list[dict]:
    from app.core.security import require_demo_enabled as _require_demo

    s = _settings(settings)
    _require_demo(s)
    await ensure_demo_profiles(db, settings=s)
    accounts = []
    for spec in SPECS:
        token = mint_demo_token(spec.auth_user_id, spec.email, spec.full_name, s)
        accounts.append({
            "email": spec.email,
            "fullName": spec.full_name,
            "role": spec.role,
            "description": spec.description,
            "authUserId": str(spec.auth_user_id),
            "teamName": spec.team_name,
            "customerName": spec.customer_name,
            "capabilities": list(spec.capabilities),
            "token": token,
            "curlExample": _demo_curl(token),
        })
    return accounts


async def me(db: AsyncSession, actor: Actor, settings=None) -> dict:
    s = _settings(settings)
    profile = None
    if actor.profile_id is not None:
        profile = await db.get(Profile, actor.profile_id)
    customer = None
    if actor.customer_id is not None:
        customer = await db.get(Customer, actor.customer_id)
    if profile is not None and profile.password_hash:
        provider = "LOCAL"
    elif is_demo_persona(actor.email):
        provider = "DEMO"
    else:
        provider = "SUPABASE"
    return {
        "profileId": str(actor.profile_id) if actor.profile_id else None,
        "email": actor.email,
        "fullName": profile.full_name if profile else None,
        "phone": profile.phone if profile else None,
        "role": actor.role,
        "teamId": str(actor.team_id) if actor.team_id else None,
        "customerId": str(actor.customer_id) if actor.customer_id else None,
        "customerName": customer.name if customer else None,
        "customerTier": customer.tier if customer else None,
        "internal": actor.is_internal,
        "authProvider": provider,
        "capabilities": capabilities_for(actor.role),
    }


async def list_profiles(
    db: AsyncSession,
    actor: Actor,
    role: str | None,
    page: int | None,
    page_size: int | None,
    sort: str | None,
    settings=None,
) -> tuple[list[dict], int, int, int]:
    from app.api.paging import SORT_COLUMNS, page_size_or_default, parse_sort

    role_filter: str | None = None
    if role is not None and role.strip():
        role_filter = _parse_role(role)
    field, descending = parse_sort(sort, {"email", "createdAt", "role"}, "email")
    column = SORT_COLUMNS.get(field, field)
    page_index = page if page is not None and page >= 0 else 0
    size = page_size_or_default(page_size)
    query = select(Profile)
    count_query = select(func.count()).select_from(Profile)
    if role_filter is not None:
        query = query.where(Profile.role == role_filter)
        count_query = count_query.where(Profile.role == role_filter)
    order_col = getattr(Profile, column, Profile.email)
    query = query.order_by(order_col.desc() if descending else order_col.asc())
    query = query.offset(page_index * size).limit(size)
    total = (await db.execute(count_query)).scalar_one()
    rows = (await db.execute(query)).scalars().all()
    return ([_profile_response(p) for p in rows], page_index, size, int(total))


async def provision_profile(db: AsyncSession, actor: Actor, req: ProvisionRequest, settings=None) -> dict:
    email = req.email.strip().lower()
    if await _find_profile_by_email(db, email) is not None:
        raise ApiException(ErrorCode.CONFLICTING_STATE, f"A profile for {req.email} already exists.")
    role = _parse_role(req.role)
    _validate_binding_role(role, req.customer_id)
    if req.team_id is not None:
        await _require_team(db, req.team_id)
    if req.customer_id is not None:
        await _require_customer(db, req.customer_id)
    profile = Profile(
        auth_user_id=None,
        email=email,
        full_name=req.full_name,
        role=role,
        team_id=req.team_id,
        customer_id=req.customer_id,
        is_active=True,
    )
    db.add(profile)
    await db.flush()
    await audit_service.record(db, actor, "PROFILE_PROVISIONED", "Profile", profile.id,
                               after={"email": profile.email, "role": role,
                                      "customerId": str(req.customer_id) if req.customer_id else None})
    return _profile_response(profile)


async def patch_profile(
    db: AsyncSession, actor: Actor, profile_id: uuid.UUID, req: ProfileUpdateRequest, settings=None
) -> dict:
    profile = await db.get(Profile, profile_id)
    if profile is None:
        raise ApiException.not_found(f"Profile {profile_id}")
    role_before = profile.role
    role = _parse_role(req.role) if req.role is not None else profile.role
    if req.customer_id is not None:
        customer_id = req.customer_id
    elif role == "CUSTOMER":
        customer_id = profile.customer_id
    else:
        customer_id = None
    team_id = req.team_id if req.team_id is not None else profile.team_id
    _validate_binding_role(role, customer_id)
    if team_id is not None:
        await _require_team(db, team_id)
    if customer_id is not None:
        await _require_customer(db, customer_id)
    if profile.id == actor.profile_id and (
        role != "ADMIN" or (req.active is not None and not req.active)
    ):
        raise ApiException(ErrorCode.CONFLICTING_STATE,
                           "An administrator cannot demote or deactivate their own account.")
    profile.role = role
    profile.customer_id = customer_id if role == "CUSTOMER" else None
    profile.team_id = None if role == "CUSTOMER" else team_id
    if req.active is not None:
        profile.is_active = bool(req.active)
    if req.full_name is not None:
        profile.full_name = req.full_name
    profile.unavailable_until = req.unavailable_until
    await db.flush()
    await audit_service.record(db, actor, "PROFILE_UPDATED", "Profile", profile.id,
                               before={"role": role_before},
                               after={"role": profile.role, "active": bool(profile.is_active),
                                      "unavailableUntil": str(profile.unavailable_until)})
    return _profile_response(profile)


async def list_delegations(db: AsyncSession, actor: Actor, settings=None) -> list[dict]:
    now = now_utc()
    res = await db.execute(select(ApprovalDelegation))
    return [_delegation_response(d, now) for d in res.scalars().all()]


async def create_delegation(db: AsyncSession, actor: Actor, req: DelegationRequest, settings=None) -> dict:
    role = _parse_role(req.approver_role)
    if role not in APPROVER_ROLES:
        raise ApiException(ErrorCode.VALIDATION_FAILED, "approverRole must be MANAGER or FINANCE.")
    delegate = await db.get(Profile, req.delegate_profile_id)
    if delegate is None:
        raise ApiException.not_found(f"Profile {req.delegate_profile_id}")
    if delegate.role != role:
        raise ApiException(ErrorCode.APPROVER_NOT_QUALIFIED,
                           f"A delegate must already hold the {role.lower()} role.")
    if not (req.valid_until > req.valid_from):
        raise ApiException(ErrorCode.VALIDATION_FAILED, "validUntil must be after validFrom.")
    if req.team_id is not None:
        await _require_team(db, req.team_id)
    if actor.profile_id is None:
        raise ApiException(ErrorCode.FORBIDDEN, "You do not have access to this action.")
    delegation = ApprovalDelegation(
        approver_role=role,
        team_id=req.team_id,
        delegate_profile_id=delegate.id,
        valid_from=req.valid_from,
        valid_until=req.valid_until,
        reason=req.reason,
        created_by_profile_id=actor.profile_id,
    )
    db.add(delegation)
    await db.flush()
    await audit_service.record(db, actor, "DELEGATION_CREATED", "ApprovalDelegation", delegation.id,
                               after={"role": role, "delegate": delegate.email}, reason=req.reason)
    return _delegation_response(delegation, now_utc())


async def list_admin_teams(db: AsyncSession, actor: Actor, settings=None) -> list[dict]:
    res = await db.execute(select(Team))
    return [{"id": str(t.id), "name": t.name} for t in res.scalars().all()]


async def create_team(db: AsyncSession, actor: Actor, req: TeamRequest, settings=None) -> dict:
    existing = await db.execute(select(Team).where(Team.name == req.name))
    if existing.scalars().first() is not None:
        raise ApiException(ErrorCode.CONFLICTING_STATE, "That team already exists.")
    team = Team(name=req.name)
    db.add(team)
    await db.flush()
    await audit_service.record(db, actor, "TEAM_CREATED", "Team", team.id, after={"name": team.name})
    return {"id": str(team.id), "name": team.name}
