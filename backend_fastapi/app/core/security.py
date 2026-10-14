"""Multi-issuer JWT security — port of config/SecurityConfig jwtDecoder routing,
auth/service/{DemoTokenService,LocalAuthService} and
auth/service/ProfileJwtAuthenticationConverter.

Three token sources converge on one DB-resolved Actor:
  Supabase (HS256 shared secret XOR RS256/ES256 JWKS) | demo (dealflow-demo)
  | local (dealflow-local). Token role claims are never trusted.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

try:  # bcrypt is the direct backend; passlib stays available per spec
    import bcrypt as _bcrypt

    _has_bcrypt = True
except ImportError:  # pragma: no cover
    _bcrypt = None  # type: ignore[assignment]
    _has_bcrypt = False

from app.core.config import Settings, get_settings
from app.core.exceptions import ApiException, ErrorCode
from app.models.auth import Profile

log = logging.getLogger("dealflow")

DEMO_ISSUER = "dealflow-demo"
DEMO_AUDIENCE = "dealflow-demo"
DEMO_CLAIM = "dealflow_demo"
DEMO_TTL_SECONDS = 30 * 86400

LOCAL_ISSUER = "dealflow-local"
LOCAL_AUDIENCE = "dealflow-local"
LOCAL_CLAIM = "dealflow_local"
LOCAL_TTL_SECONDS = 7 * 86400

CLOCK_SKEW_SECONDS = 60

_jwks_clients: dict[str, jwt.PyJWKClient] = {}


@dataclass(frozen=True)
class Actor:
    profile_id: uuid.UUID | None
    auth_user_id: uuid.UUID | None
    email: str
    role: str
    team_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None

    @property
    def is_customer(self) -> bool:
        return self.role == "CUSTOMER"

    @property
    def is_admin(self) -> bool:
        return self.role == "ADMIN"

    @property
    def is_internal(self) -> bool:
        return self.role in ("REP", "MANAGER", "FINANCE", "ADMIN")

    @property
    def is_system(self) -> bool:
        return self.profile_id is None

    @staticmethod
    def system() -> "Actor":
        return Actor(None, None, "system@dealflow", "ADMIN", None, None)


def capabilities_for(role: str) -> list[str]:
    """UI hint map from MeController.capabilitiesFor. Endpoints re-enforce."""
    return {
        "REP": ["quotes:create", "quotes:edit-own", "quotes:submit", "quotes:share",
                "quotes:adopt", "recommendations:read", "reports:own", "alerts:own"],
        "MANAGER": ["quotes:read-team", "approvals:manager", "policy:read",
                    "reports:team", "alerts:team", "alerts:nudge"],
        "FINANCE": ["quotes:read-all", "approvals:finance", "allocations:override",
                    "stock:receive", "shipments:dispatch", "payments:record",
                    "refunds:record", "subscriptions:change", "reports:all",
                    "alerts:all", "jobs:run"],
        "ADMIN": ["admin:catalog", "admin:policy", "admin:warehouses", "admin:plans",
                  "admin:profiles", "approvals:reassign", "quotes:read-all",
                  "reports:all", "alerts:all", "jobs:run", "stock:receive",
                  "allocations:override"],
        "CUSTOMER": ["portal:quotes", "portal:negotiate", "portal:accept", "portal:invoices"],
    }.get(role, [])


# ------------------------------------------------------------- secrets ---


def _usable(secret: str | None) -> str | None:
    return secret if secret and len(secret) >= 32 else None


def demo_secret(settings: Settings | None = None) -> str | None:
    settings = settings or get_settings()
    return _usable(settings.demo_jwt_secret)


def local_signing_secret(settings: Settings | None = None) -> str | None:
    settings = settings or get_settings()
    return (
        _usable(settings.auth_local_jwt_secret)
        or _usable(settings.demo_jwt_secret)
        or _usable(settings.auth_jwt_secret)
    )


def require_demo_enabled(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    secret = demo_secret(settings)
    if not settings.demo_auth_enabled or secret is None:
        raise ApiException(ErrorCode.FORBIDDEN, "Demo authentication is disabled.")
    return secret


# ---------------------------------------------------------------- minting ---


def _now() -> datetime:
    return datetime.now(timezone.utc)


def mint_demo_token(
    auth_user_id: uuid.UUID, email: str, full_name: str | None,
    settings: Settings | None = None,
) -> str:
    secret = require_demo_enabled(settings)
    now = _now()
    return jwt.encode(
        {
            "sub": str(auth_user_id),
            "iss": DEMO_ISSUER,
            "aud": [DEMO_AUDIENCE],
            "iat": now,
            "exp": datetime.fromtimestamp(now.timestamp() + DEMO_TTL_SECONDS, timezone.utc),
            "email": email,
            "full_name": full_name or "",
            "role": "authenticated",
            DEMO_CLAIM: True,
        },
        secret,
        algorithm="HS256",
    )


def mint_local_token(profile: Profile, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    secret = local_signing_secret(settings)
    if secret is None:
        raise ApiException(ErrorCode.FORBIDDEN, "Password login is not configured.")
    now = _now()
    return jwt.encode(
        {
            "sub": str(profile.auth_user_id or profile.id),
            "iss": LOCAL_ISSUER,
            "aud": [LOCAL_AUDIENCE],
            "iat": now,
            "exp": datetime.fromtimestamp(now.timestamp() + LOCAL_TTL_SECONDS, timezone.utc),
            "email": profile.email,
            "full_name": profile.full_name or "",
            LOCAL_CLAIM: True,
        },
        secret,
        algorithm="HS256",
    )


# -------------------------------------------------------------- verifying ---


def _peek(token: str) -> dict:
    try:
        return jwt.decode(token, options={"verify_signature": False})
    except Exception as exc:
        raise ApiException(ErrorCode.UNAUTHENTICATED, "Sign in to continue.") from exc


def _verify_hs(token: str, secret: str, issuer: str, audience: list[str]) -> dict:
    try:
        return jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            issuer=issuer,
            audience=audience,
            leeway=CLOCK_SKEW_SECONDS,
            options={"require": ["exp", "iat", "iss", "sub"]},
        )
    except Exception as exc:
        raise ApiException(ErrorCode.UNAUTHENTICATED, "Sign in to continue.") from exc


def _verify_supabase(token: str, settings: Settings) -> dict:
    if settings.auth_jwk_set_uri:
        try:
            client = _jwks_clients.setdefault(
                settings.auth_jwk_set_uri, jwt.PyJWKClient(settings.auth_jwk_set_uri)
            )
            key = client.get_signing_key_from_jwt(token).key
        except Exception as exc:
            raise ApiException(ErrorCode.UNAUTHENTICATED, "Sign in to continue.") from exc
        options: dict = {"require": ["exp", "sub"]}
        decode_kwargs: dict = {
            "algorithms": ["RS256", "ES256"],
            "leeway": CLOCK_SKEW_SECONDS,
            "options": options,
        }
        if settings.auth_issuer_uri:
            decode_kwargs["issuer"] = settings.auth_issuer_uri
        if settings.auth_expected_audience:
            decode_kwargs["audience"] = settings.auth_expected_audience
        try:
            return jwt.decode(token, key, **decode_kwargs)
        except Exception as exc:
            raise ApiException(ErrorCode.UNAUTHENTICATED, "Sign in to continue.") from exc
    secret = _usable(settings.auth_jwt_secret)
    if secret is None:
        raise ApiException(ErrorCode.UNAUTHENTICATED, "Sign in to continue.")
    try:
        decode_kwargs = {
            "algorithms": ["HS256"],
            "leeway": CLOCK_SKEW_SECONDS,
            "options": {"require": ["exp", "sub"]},
        }
        if settings.auth_issuer_uri:
            decode_kwargs["issuer"] = settings.auth_issuer_uri
        if settings.auth_expected_audience:
            decode_kwargs["audience"] = settings.auth_expected_audience
        return jwt.decode(token, secret, **decode_kwargs)
    except Exception as exc:
        raise ApiException(ErrorCode.UNAUTHENTICATED, "Sign in to continue.") from exc


def verify_token(token: str, settings: Settings | None = None) -> dict:
    """Route by unverified (iss + marker claim), then fully validate."""
    settings = settings or get_settings()
    claims = _peek(token)
    if claims.get("iss") == DEMO_ISSUER and claims.get(DEMO_CLAIM) is True:
        secret = require_demo_enabled(settings)
        return _verify_hs(token, secret, DEMO_ISSUER, [DEMO_AUDIENCE])
    if claims.get("iss") == LOCAL_ISSUER and claims.get(LOCAL_CLAIM) is True:
        secret = local_signing_secret(settings)
        if secret is None:
            raise ApiException(ErrorCode.UNAUTHENTICATED, "Sign in to continue.")
        return _verify_hs(token, secret, LOCAL_ISSUER, [LOCAL_AUDIENCE])
    return _verify_supabase(token, settings)


# ------------------------------------------------------- actor resolution ---


def _claim_email(claims: dict) -> str | None:
    email = claims.get("email")
    if email:
        return str(email)
    meta = claims.get("user_metadata") or {}
    return meta.get("email")


async def resolve_actor(
    db: AsyncSession, claims: dict, settings: Settings | None = None
) -> Actor:
    """DB-resolved Actor on every request. Token role metadata ignored."""
    settings = settings or get_settings()
    try:
        sub = uuid.UUID(str(claims.get("sub")))
    except (ValueError, AttributeError, TypeError) as exc:
        raise ApiException(ErrorCode.UNAUTHENTICATED, "Sign in to continue.") from exc

    profile = (
        await db.execute(select(Profile).where(Profile.auth_user_id == sub))
    ).scalars().first()
    if profile is None:
        email = _claim_email(claims)
        if not settings.auth_auto_provision_rep or not email:
            raise ApiException(
                ErrorCode.PROFILE_NOT_PROVISIONED,
                "This account has no workspace profile yet.",
            )
        email = email.strip().lower()
        existing = (
            await db.execute(
                select(Profile).where(Profile.email == email)
            )
        ).scalars().first()
        if existing is not None:
            if existing.auth_user_id is not None and existing.auth_user_id != sub:
                log.warning("auth_user_id mismatch for %s", email)
                raise ApiException(
                    ErrorCode.PROFILE_NOT_PROVISIONED,
                    "This account has no workspace profile yet.",
                )
            existing.auth_user_id = sub
            profile = existing
        else:
            full_name = claims.get("full_name") or (claims.get("user_metadata") or {}).get(
                "full_name"
            )
            profile = Profile(
                auth_user_id=sub,
                email=email,
                full_name=full_name,
                role="REP",
                is_active=True,
            )
            db.add(profile)
        await db.flush()
    if not profile.is_active:
        raise ApiException(ErrorCode.PROFILE_INACTIVE, "This account is deactivated.")
    return Actor(
        profile_id=profile.id,
        auth_user_id=profile.auth_user_id,
        email=profile.email,
        role=profile.role,
        team_id=profile.team_id,
        customer_id=profile.customer_id,
    )


# --------------------------------------------------------------- passwords ---


def hash_password(plain: str) -> str:
    """BCrypt hash, interoperable with Spring's BCryptPasswordEncoder."""
    if not _has_bcrypt:  # pragma: no cover
        raise ApiException(ErrorCode.INTERNAL_ERROR, "Password hashing is unavailable.")
    return _bcrypt.hashpw(plain.encode("utf-8"), _bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    if not _has_bcrypt:  # pragma: no cover
        return False
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except ValueError:
        return False


def request_hash(body: object) -> str:
    import json

    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
