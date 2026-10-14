"""AUTH + ADMIN domain verification — unit + integration (dealflow_test)."""

from __future__ import annotations

import asyncio
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.api.deps import get_current_actor
from app.api.v1.routers.auth import router
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import Actor
from app.main import create_app
from app.models.auth import Profile
from app.models.catalog import Customer
from app.services import auth_service
from tests.itutil import TestSession, unique

import tests.itutil as itutil

app = create_app()
app.include_router(router)
client = TestClient(app, raise_server_exceptions=False)

LOCAL_SECRET = "l" * 40
DEMO_SECRET = "d" * 40


@contextmanager
def auth_env(monkeypatch, demo_enabled: bool = True):
    monkeypatch.setenv("AUTH_LOCAL_JWT_SECRET", LOCAL_SECRET)
    monkeypatch.setenv("DEMO_JWT_SECRET", DEMO_SECRET)
    monkeypatch.setenv("DEMO_AUTH_ENABLED", "true" if demo_enabled else "false")
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


@contextmanager
def use_deps(actor: Actor | None = None):
    app.dependency_overrides[get_db] = itutil._get_test_db
    if actor is not None:
        app.dependency_overrides[get_current_actor] = lambda: actor
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_actor, None)


def _run(coro):
    return asyncio.run(coro)


async def _profile_by_email(email: str) -> Profile | None:
    async with TestSession() as db:
        res = await db.execute(select(Profile).where(func.lower(Profile.email) == email.lower()))
        return res.scalars().first()


async def _admin_actor() -> Actor:
    email = unique("admin") + "@test.dev"
    async with TestSession() as db:
        req = auth_service.__dict__  # noqa: F841 (keep linters quiet)
        from app.schemas.auth import InternalRegisterRequest

        await auth_service.register_internal(
            db,
            InternalRegisterRequest(email=email, password="password-1",
                                    fullName="Admin", role="ADMIN"),
        )
        await db.commit()
    profile = await _profile_by_email(email)
    assert profile is not None
    return Actor(profile.id, profile.auth_user_id, profile.email, "ADMIN",
                 profile.team_id, profile.customer_id)


def _register_payload(email: str) -> dict:
    return {"email": email, "password": "password-1", "fullName": "Buyer",
            "companyName": unique("co"), "phone": "999"}


# ------------------------------------------------------------------ options


def test_options_flags(monkeypatch):
    with auth_env(monkeypatch, demo_enabled=True):
        body = _run(auth_service.options())
        assert body == {"passwordLogin": True, "selfRegistration": True, "demoPersonas": True}
    with auth_env(monkeypatch, demo_enabled=False):
        with use_deps(Actor(uuid.uuid4(), uuid.uuid4(), "x@y.z", "ADMIN")):
            r = client.get("/api/v1/auth/options")
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["passwordLogin"] is True
        assert data["demoPersonas"] is False


# --------------------------------------------------------------- register


def test_register_customer_duplicate_and_role_ignored(monkeypatch):
    with auth_env(monkeypatch):
        actor = Actor(uuid.uuid4(), uuid.uuid4(), "anon@t.dev", "ADMIN")
        with use_deps(actor):
            email = unique("buyer") + "@test.dev"
            r = client.post("/api/v1/auth/register", json=_register_payload(email))
            assert r.status_code == 201, r.text
            data = r.json()["data"]
            assert data["role"] == "CUSTOMER"
            assert data["tokenType"] == "Bearer"
            assert data["expiresIn"] == 604800
            assert "portal:quotes" in data["capabilities"]
            assert data["sampleCurl"] is None

            r2 = client.post("/api/v1/auth/register", json=_register_payload(email))
            assert r2.status_code == 409
            assert r2.json()["error"]["code"] == "CONFLICTING_STATE"

            # Extra role field is ignored — signup never grants internal roles.
            sneaky = _register_payload(unique("sneak") + "@test.dev")
            sneaky["role"] = "ADMIN"
            r3 = client.post("/api/v1/auth/register", json=sneaky)
            assert r3.status_code == 201, r3.text
            assert r3.json()["data"]["role"] == "CUSTOMER"


def test_internal_register_roles(monkeypatch):
    with auth_env(monkeypatch):
        with use_deps(Actor(uuid.uuid4(), uuid.uuid4(), "a@t.dev", "ADMIN")):
            for role in ("REP", "MANAGER", "ADMIN"):
                email = unique("staff") + "@test.dev"
                r = client.post("/api/v1/auth/register-internal", json={
                    "email": email, "password": "password-1",
                    "fullName": f"Staff {role}", "role": role})
                assert r.status_code == 201, (role, r.text)
                data = r.json()["data"]
                assert data["role"] == role
                assert data["expiresIn"] == 604800


# -------------------------------------------------------------------- login


def test_login_ok_wrong_password_uppercased_email(monkeypatch):
    with auth_env(monkeypatch):
        with use_deps(Actor(uuid.uuid4(), uuid.uuid4(), "a@t.dev", "ADMIN")):
            email = unique("login") + "@test.dev"
            assert client.post("/api/v1/auth/register", json=_register_payload(email)).status_code == 201

            r = client.post("/api/v1/auth/login", json={"email": email, "password": "password-1"})
            assert r.status_code == 200, r.text
            assert r.json()["data"]["email"] == email

            bad = client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-pass-1"})
            assert bad.status_code == 401
            assert bad.json()["error"]["code"] == "UNAUTHENTICATED"

            upper = client.post("/api/v1/auth/login", json={"email": email.upper(), "password": "password-1"})
            assert upper.status_code == 200, upper.text


def test_login_unknown_is_401(monkeypatch):
    with auth_env(monkeypatch):
        with use_deps(Actor(uuid.uuid4(), uuid.uuid4(), "a@t.dev", "ADMIN")):
            r = client.post("/api/v1/auth/login",
                            json={"email": unique("ghost") + "@test.dev", "password": "password-1"})
            assert r.status_code == 401
            assert r.json()["error"]["message"] == "Invalid email or password."


# --------------------------------------------------------------------- demo


def test_demo_token_by_role_and_email(monkeypatch):
    with auth_env(monkeypatch):
        with use_deps(Actor(uuid.uuid4(), uuid.uuid4(), "a@t.dev", "ADMIN")):
            r = client.post("/api/v1/auth/demo-token", json={"role": "ADMIN"})
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            assert data["email"] == "admin@dealflow.demo"
            assert data["role"] == "ADMIN"
            assert data["expiresIn"] == 2592000
            assert "admin:catalog" in data["capabilities"]
            assert "Bearer" in data["sampleCurl"]

            r2 = client.post("/api/v1/auth/demo-token", json={"email": "rep.a@dealflow.demo"})
            assert r2.status_code == 200
            assert r2.json()["data"]["role"] == "REP"


def test_demo_token_unknown_is_400(monkeypatch):
    with auth_env(monkeypatch):
        with use_deps(Actor(uuid.uuid4(), uuid.uuid4(), "a@t.dev", "ADMIN")):
            r = client.post("/api/v1/auth/demo-token",
                            json={"email": "nope@unknown.dev", "role": "NOPE"})
            assert r.status_code == 400
            body = r.json()
            assert body["error"]["code"] == "VALIDATION_FAILED"
            assert "Choose a known demo email or role" in body["error"]["message"]


def test_demo_endpoints_disabled_are_404(monkeypatch):
    with auth_env(monkeypatch, demo_enabled=False):
        with use_deps(Actor(uuid.uuid4(), uuid.uuid4(), "a@t.dev", "ADMIN")):
            assert client.get("/api/v1/auth/demo-accounts").status_code == 404
            r = client.post("/api/v1/auth/demo-token", json={"role": "ADMIN"})
            assert r.status_code == 404
            assert r.json()["error"]["code"] == "NOT_FOUND"


def test_demo_accounts_shape(monkeypatch):
    with auth_env(monkeypatch):
        with use_deps(Actor(uuid.uuid4(), uuid.uuid4(), "a@t.dev", "ADMIN")):
            r = client.get("/api/v1/auth/demo-accounts")
            assert r.status_code == 200, r.text
            accounts = r.json()["data"]
            assert len(accounts) == 8
            by_email = {a["email"]: a for a in accounts}
            admin = by_email["admin@dealflow.demo"]
            assert admin["authUserId"] == "00000000-0000-4000-8000-000000000001"
            assert admin["token"] and admin["curlExample"]
            assert by_email["alpha@customer.demo"]["customerName"] == "Alpha Traders"


# ----------------------------------------------------------------------- me


def test_me_shape_local_and_demo(monkeypatch):
    with auth_env(monkeypatch):
        admin = _run(_admin_actor())
        with use_deps(admin):
            r = client.get("/api/v1/me")
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            assert data["profileId"] == str(admin.profile_id)
            assert data["email"] == admin.email
            assert data["role"] == "ADMIN"
            assert data["authProvider"] == "LOCAL"
            assert data["internal"] is True
            assert "admin:catalog" in data["capabilities"]

        # Real JWT path for a demo persona (no actor override).
        with use_deps():
            tok = client.post("/api/v1/auth/demo-token", json={"role": "ADMIN"})
            assert tok.status_code == 200
            access = tok.json()["data"]["accessToken"]
            m = client.get("/api/v1/me", headers={"Authorization": f"Bearer {access}"})
            assert m.status_code == 200, m.text
            assert m.json()["data"]["authProvider"] == "DEMO"


# -------------------------------------------------------------------- admin


def test_admin_provision_patch_and_self_demotion_guard(monkeypatch):
    with auth_env(monkeypatch):
        admin = _run(_admin_actor())
        # A customer org to bind portal profiles to.
        with use_deps(admin):
            buyer_email = unique("org") + "@test.dev"
            assert client.post("/api/v1/auth/register",
                               json=_register_payload(buyer_email)).status_code == 201
        buyer = _run(_profile_by_email(buyer_email))
        assert buyer is not None and buyer.customer_id is not None
        customer_id = str(buyer.customer_id)

        with use_deps(admin):
            # CUSTOMER without binding -> 400.
            r = client.post("/api/v1/admin/profiles", json={
                "email": unique("nobind") + "@test.dev", "role": "CUSTOMER"})
            assert r.status_code == 400

            # Non-CUSTOMER with customerId -> 400.
            r = client.post("/api/v1/admin/profiles", json={
                "email": unique("rep") + "@test.dev", "role": "REP", "customerId": customer_id})
            assert r.status_code == 400

            # Valid provision.
            email = unique("portal") + "@test.dev"
            r = client.post("/api/v1/admin/profiles", json={
                "email": email.upper(), "fullName": "Portal User",
                "role": "CUSTOMER", "customerId": customer_id})
            assert r.status_code == 201, r.text
            created = r.json()["data"]
            assert created["email"] == email  # lowercased
            assert created["customerId"] == customer_id
            assert created["bound"] is False
            pid = created["id"]

            # Duplicate -> 409.
            dup = client.post("/api/v1/admin/profiles", json={
                "email": email, "role": "CUSTOMER", "customerId": customer_id})
            assert dup.status_code == 409

            # Patch fullName.
            p = client.patch(f"/api/v1/admin/profiles/{pid}", json={"fullName": "Renamed"})
            assert p.status_code == 200
            assert p.json()["data"]["fullName"] == "Renamed"

            # Self-demotion and self-deactivation are refused.
            demote = client.patch(f"/api/v1/admin/profiles/{admin.profile_id}",
                                  json={"role": "REP"})
            assert demote.status_code == 409
            assert demote.json()["error"]["code"] == "CONFLICTING_STATE"
            deactivate = client.patch(f"/api/v1/admin/profiles/{admin.profile_id}",
                                      json={"active": False})
            assert deactivate.status_code == 409

            # List with role filter + sort.
            listed = client.get("/api/v1/admin/profiles",
                                params={"role": "CUSTOMER", "sort": "email,asc"})
            assert listed.status_code == 200
            body = listed.json()
            assert body["meta"]["total"] >= 1
            assert all(row["role"] == "CUSTOMER" for row in body["data"])


def test_admin_guard_forbids_non_admin(monkeypatch):
    with auth_env(monkeypatch):
        rep = Actor(uuid.uuid4(), uuid.uuid4(), unique("rep") + "@t.dev", "REP")
        with use_deps(rep):
            r = client.get("/api/v1/admin/profiles")
            assert r.status_code == 403


# -------------------------------------------------------------- delegations


def test_delegations_create_list_and_unqualified(monkeypatch):
    with auth_env(monkeypatch):
        admin = _run(_admin_actor())

        async def _make(role: str) -> Profile:
            email = unique(role.lower()) + "@test.dev"
            async with TestSession() as db:
                from app.schemas.auth import InternalRegisterRequest

                await auth_service.register_internal(
                    db, InternalRegisterRequest(email=email, password="password-1",
                                                fullName=role, role=role))
                await db.commit()
            profile = await _profile_by_email(email)
            assert profile is not None
            return profile

        manager = _run(_make("MANAGER"))
        rep = _run(_make("REP"))
        now = datetime.now(timezone.utc)
        payload = {"approverRole": "MANAGER", "delegateProfileId": str(manager.id),
                   "validFrom": (now - timedelta(days=1)).isoformat(),
                   "validUntil": (now + timedelta(days=1)).isoformat(),
                   "reason": "cover for leave"}
        with use_deps(admin):
            r = client.post("/api/v1/admin/delegations", json=payload)
            assert r.status_code == 201, r.text
            assert r.json()["data"]["activeNow"] is True

            bad = client.post("/api/v1/admin/delegations", json={
                **payload, "delegateProfileId": str(rep.id)})
            assert bad.status_code == 403
            assert bad.json()["error"]["code"] == "APPROVER_NOT_QUALIFIED"

            listed = client.get("/api/v1/admin/delegations")
            assert listed.status_code == 200
            assert len(listed.json()["data"]) >= 1


# -------------------------------------------------------------------- teams


def test_admin_teams_create_duplicate(monkeypatch):
    with auth_env(monkeypatch):
        admin = _run(_admin_actor())
        with use_deps(admin):
            name = unique("Team")
            r = client.post("/api/v1/admin/teams", json={"name": name})
            assert r.status_code == 201, r.text
            dup = client.post("/api/v1/admin/teams", json={"name": name})
            assert dup.status_code == 409
            assert dup.json()["error"]["code"] == "CONFLICTING_STATE"

            public = client.get("/api/v1/auth/teams")
            assert public.status_code == 200
            assert any(t["name"] == name for t in public.json()["data"])
