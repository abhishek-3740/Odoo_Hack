"""Integration-test helpers — sessions against dealflow_test (NOT the dev DB).

Router/flow tests override BOTH get_db (session to dealflow_test) and
get_current_actor (fake Actor). JWT verification itself is unit-tested in
test_security.py. Use unique_*() values so reruns never collide.
"""

from __future__ import annotations

import uuid
from contextlib import contextmanager

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.deps import get_current_actor
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import Actor


def _test_db_url() -> str:
    """Use the main connection settings, but point at the test database.

    Set DEALFLOW_TEST_DB_URL to override the whole URL (for CI or a shared
    PostgreSQL instance). The password is never hard-coded here.
    """
    explicit = get_settings().dealflow_test_db_url.strip()
    if explicit:
        return explicit
    configured = get_settings().sqlalchemy_url
    return (
        make_url(configured)
        .set(database="dealflow_test")
        .render_as_string(hide_password=False)
    )


TEST_DB_URL = _test_db_url()

# NullPool: starlette's TestClient runs each request on a fresh event loop,
# so pooled asyncpg connections outlive their loop ("Event loop is closed"
# on the next checkout). One connection per session avoids cross-loop reuse.
_test_engine = create_async_engine(
    TEST_DB_URL,
    poolclass=NullPool,
    connect_args={"server_settings": {"search_path": "dealflow, public"}},
)
TestSession = async_sessionmaker(_test_engine, expire_on_commit=False)


async def _get_test_db():
    session = TestSession()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


@contextmanager
def override_app_deps(app, actor: Actor):
    """Route all DB through dealflow_test and fix the current actor."""
    app.dependency_overrides[get_db] = _get_test_db
    app.dependency_overrides[get_current_actor] = lambda: actor
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_actor, None)


def unique(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def staff_actor(role: str = "ADMIN") -> Actor:
    return Actor(
        profile_id=uuid.uuid4(), auth_user_id=uuid.uuid4(),
        email=f"{unique('t')}@test.dev", role=role,
    )
