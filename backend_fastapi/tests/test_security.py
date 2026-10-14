"""Step D verification — JWT routing, actor resolution, guards, idempotency."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import jwt
import pytest

from app.api import deps as deps_module
from app.core.config import Settings
from app.core.exceptions import ApiException, ErrorCode
from app.core.security import (
    Actor,
    capabilities_for,
    hash_password,
    local_signing_secret,
    mint_demo_token,
    mint_local_token,
    require_demo_enabled,
    resolve_actor,
    verify_password,
    verify_token,
)
from app.models.auth import Profile
from app.services import idempotency_service as idem

SECRET = "s" * 40


def _settings(**overrides) -> Settings:
    base = dict(
        DEMO_AUTH_ENABLED=True,
        DEMO_JWT_SECRET=SECRET,
        AUTH_JWT_SECRET=SECRET,
        AUTH_ISSUER_URI="http://127.0.0.1:54321/auth/v1",
        AUTH_EXPECTED_AUDIENCE="authenticated",
        AUTH_AUTO_PROVISION_REP=True,
    )
    base.update(overrides)
    return Settings(**base)


# ------------------------------------------------------------------ tokens


def test_demo_token_round_trip_exact_claims():
    s = _settings()
    sub = uuid.uuid4()
    token = mint_demo_token(sub, "admin@dealflow.demo", "Demo Admin", s)
    raw = jwt.decode(token, options={"verify_signature": False})
    assert raw["iss"] == "dealflow-demo"
    assert raw["aud"] == ["dealflow-demo"]
    assert raw["dealflow_demo"] is True
    assert raw["sub"] == str(sub)
    assert raw["exp"] - raw["iat"] == 30 * 86400
    assert verify_token(token, s)["sub"] == str(sub)


def test_demo_disabled_refuses_mint_and_verify():
    s = _settings(DEMO_AUTH_ENABLED=False)
    with pytest.raises(ApiException) as exc:
        mint_demo_token(uuid.uuid4(), "a@b.c", "X", s)
    assert exc.value.code == ErrorCode.FORBIDDEN
    # A token minted while enabled must not verify once disabled.
    token = mint_demo_token(uuid.uuid4(), "a@b.c", "X", _settings())
    with pytest.raises(ApiException) as exc2:
        verify_token(token, s)
    assert exc2.value.code in (ErrorCode.FORBIDDEN, ErrorCode.UNAUTHENTICATED)


def test_local_token_round_trip_and_secret_chain():
    s = _settings(AUTH_LOCAL_JWT_SECRET="")
    assert local_signing_secret(s) == SECRET  # falls back to demo secret
    profile = Profile(
        auth_user_id=uuid.uuid4(), email="buyer@co.test",
        full_name="Buyer", role="CUSTOMER",
    )
    token = mint_local_token(profile, s)
    raw = jwt.decode(token, options={"verify_signature": False})
    assert raw["iss"] == "dealflow-local"
    assert raw["dealflow_local"] is True
    assert raw["exp"] - raw["iat"] == 7 * 86400
    assert verify_token(token, s)["email"] == "buyer@co.test"


def test_supabase_hs256_and_tampered_token_rejected():
    s = _settings()
    now = datetime.now(timezone.utc)
    token = jwt.encode(
        {"sub": str(uuid.uuid4()), "iss": s.auth_issuer_uri,
         "aud": "authenticated", "iat": now, "exp": now + timedelta(hours=1),
         "email": "rep@co.test"},
        SECRET, algorithm="HS256",
    )
    assert verify_token(token, s)["email"] == "rep@co.test"
    with pytest.raises(ApiException) as exc:
        verify_token(token[:-4] + "AAAA", s)
    assert exc.value.code == ErrorCode.UNAUTHENTICATED


def test_password_hash_round_trip():
    hashed = hash_password("correct-horse-8")
    assert verify_password("correct-horse-8", hashed) is True
    assert verify_password("wrong", hashed) is False


# ---------------------------------------------------------- actor resolve


def _db_with(first_results: list):
    from unittest.mock import MagicMock

    db = AsyncMock()
    calls = {"n": 0}

    async def _execute(*args, **kwargs):
        result = MagicMock()
        value = first_results[calls["n"]] if calls["n"] < len(first_results) else None
        calls["n"] += 1
        result.scalars.return_value.first.return_value = value
        return result

    db.execute.side_effect = _execute
    from unittest.mock import MagicMock as _SyncMock

    db.add = _SyncMock()
    return db


async def _resolve(db, claims, settings):
    return await resolve_actor(db, claims, settings)


def test_inactive_profile_revoked_immediately():
    s = _settings()
    profile = Profile(auth_user_id=uuid.uuid4(), email="x@y.z", role="REP")
    profile.is_active = False
    db = _db_with([profile])
    with pytest.raises(ApiException) as exc:
        _run(_resolve(db, {"sub": str(profile.auth_user_id)}, s))
    assert exc.value.code == ErrorCode.PROFILE_INACTIVE


def test_unprovisioned_rejected_when_auto_provision_off():
    s = _settings(AUTH_AUTO_PROVISION_REP=False)
    db = _db_with([None])
    with pytest.raises(ApiException) as exc:
        _run(_resolve(db, {"sub": str(uuid.uuid4())}, s))
    assert exc.value.code == ErrorCode.PROFILE_NOT_PROVISIONED


def test_auto_provision_creates_rep_and_binds_email_row():
    s = _settings()
    sub = uuid.uuid4()
    db = _db_with([None, None])  # by-auth: none; by-email: none -> create
    actor = _run(_resolve(db, {"sub": str(sub), "email": "New@Co.test"}, s))
    assert actor.role == "REP"
    created = db.add.call_args[0][0]
    assert created.email == "new@co.test"  # lowercased
    assert created.auth_user_id == sub


def _run(coro):
    import asyncio

    return asyncio.run(coro)


# ------------------------------------------------------------------ guards


def test_require_roles_and_customer_isolation_helpers():
    import asyncio

    async def check():
        guard = deps_module.require_roles("ADMIN", "FINANCE")
        with pytest.raises(ApiException) as exc:
            await guard(actor=Actor(uuid.uuid4(), uuid.uuid4(), "r@c.t", "REP"))
        assert exc.value.code == ErrorCode.FORBIDDEN
        admin = Actor(uuid.uuid4(), uuid.uuid4(), "a@c.t", "ADMIN")
        assert await guard(actor=admin) is admin
        with pytest.raises(ApiException) as exc2:
            deps_module.idempotency_key(None)
        assert exc2.value.code == ErrorCode.IDEMPOTENCY_KEY_REQUIRED

    asyncio.run(check())


def test_capabilities_spot_check():
    assert "approvals:finance" in capabilities_for("FINANCE")
    assert capabilities_for("CUSTOMER") == [
        "portal:quotes", "portal:negotiate", "portal:accept", "portal:invoices",
    ]


# -------------------------------------------------------------- idempotency


class _Mappings:
    def __init__(self, row):
        self._row = row

    def first(self):
        return self._row


class _ExecResult:
    def __init__(self, row):
        self._row = row

    def mappings(self):
        return _Mappings(self._row)


def _idem_db(row, executed=None):
    db = AsyncMock()

    async def _execute(sql, params=None):
        (executed if executed is not None else []).append(str(sql)[:60])
        return _ExecResult(row)

    db.execute.side_effect = _execute
    return db


def test_idempotency_replay_and_reuse_and_in_progress():
    import asyncio

    async def check():
        actor = Actor(uuid.uuid4(), uuid.uuid4(), "r@c.t", "REP")
        body = {"a": 1}
        digest = __import__("app.core.security", fromlist=["request_hash"]).request_hash(body)

        # COMPLETED same hash -> Replay
        db = _idem_db({"id": uuid.uuid4(), "status": "COMPLETED", "request_hash": digest,
                       "response_status": 201, "response_body": '{"ok": true}',
                       "updated_at": datetime.now(timezone.utc), "inserted": False})
        with pytest.raises(idem.Replay) as rp:
            await idem.claim(db, actor, "op", "k1", body)
        assert rp.value.status == 201
        assert rp.value.body == {"ok": True}

        # COMPLETED different hash -> REUSED
        db2 = _idem_db({"id": uuid.uuid4(), "status": "COMPLETED", "request_hash": "other",
                        "response_status": 200, "response_body": "{}",
                        "updated_at": datetime.now(timezone.utc), "inserted": False})
        with pytest.raises(ApiException) as exc:
            await idem.claim(db2, actor, "op", "k1", {"different": True})
        assert exc.value.code == ErrorCode.IDEMPOTENCY_KEY_REUSED

        # IN_PROGRESS fresh -> 409
        db3 = _idem_db({"id": uuid.uuid4(), "status": "IN_PROGRESS", "request_hash": digest,
                        "response_status": None, "response_body": None,
                        "updated_at": datetime.now(timezone.utc), "inserted": False})
        with pytest.raises(ApiException) as exc3:
            await idem.claim(db3, actor, "op", "k1", body)
        assert exc3.value.code == ErrorCode.IDEMPOTENT_REQUEST_IN_PROGRESS

        # IN_PROGRESS stale -> takeover returns claim id
        stale = datetime.now(timezone.utc) - timedelta(minutes=30)
        db4 = _idem_db({"id": uuid.uuid4(), "status": "IN_PROGRESS", "request_hash": digest,
                        "response_status": None, "response_body": None,
                        "updated_at": stale, "inserted": False})
        assert await idem.claim(db4, actor, "op", "k1", body)

        # Fresh insert -> claim id
        db5 = _idem_db({"id": uuid.uuid4(), "status": "IN_PROGRESS", "request_hash": digest,
                        "response_status": None, "response_body": None,
                        "updated_at": datetime.now(timezone.utc), "inserted": True})
        assert await idem.claim(db5, actor, "op", "k1", body)

    asyncio.run(check())
