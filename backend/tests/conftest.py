"""
Shared pytest configuration.

Provides:
- HARD GUARD: refuses to run pytest if DATABASE_URL points at the production
  Supabase project. Production data is sacred — tests must never touch it.
- Session-scoped autouse `reset_schema` fixture: drops + recreates the public
  schema and runs all Alembic migrations once per pytest invocation, so every
  run starts from a known clean state on the dev DB.
- Default MANAGER auth stub (session-scoped, autouse).
- `as_role` fixture that temporarily swaps the stub to another role within a single test.
"""
import os
import uuid

from dotenv import load_dotenv

# Load backend/.env BEFORE importing the app so the guard can read DATABASE_URL.
load_dotenv()

# ── HARD GUARD: never run tests against the production Supabase project. ─────
_PROD_PROJECT_REF = "your-prod-project-ref"
_db_url = os.environ.get("DATABASE_URL", "")
if _PROD_PROJECT_REF in _db_url:
    raise RuntimeError(
        "REFUSING to run pytest against the production database.\n"
        f"DATABASE_URL points at the prod project ({_PROD_PROJECT_REF}).\n"
        "Point backend/.env at the leadpay-dev Supabase project before running pytest."
    )

import pytest  # noqa: E402  — must come after guard so a failed guard doesn't import pytest plugins
from sqlalchemy import text
from alembic import command
from alembic.config import Config

from app.database import SessionLocal, engine
from app.main import app
from app.dependencies.auth import get_current_user
from app.models.user import User, UserRole, UserStatus


# ── Session-scoped DB reset: one drop+recreate+migrate per pytest run. ───────
@pytest.fixture(scope="session", autouse=True)
def reset_schema():
    """Drop + recreate the public schema and run migrations once per pytest session."""
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    yield
    # Intentionally leave the schema in place after the run so failed-test
    # state can be inspected in the dev DB.


def _user_with_role(role: UserRole) -> User:
    return User(
        id=uuid.UUID("00000000-0000-0000-0000-000000000001"),
        email="test@leadpay.local",
        full_name=f"Test {role.value}",
        role=role,
        status=UserStatus.ACTIVE,
    )


_MANAGER_USER = _user_with_role(UserRole.MANAGER)


def _stub_current_user() -> User:
    return _MANAGER_USER


@pytest.fixture(autouse=True, scope="session")
def override_auth():
    app.dependency_overrides[get_current_user] = _stub_current_user
    yield
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture
def as_role():
    """
    Use within a test to temporarily flip the stub user's role:

        def test_workers_blocked(as_role):
            with as_role(UserRole.WORKER):
                r = client.delete(...)
                assert r.status_code == 403
    """
    from contextlib import contextmanager

    @contextmanager
    def _swap(role: UserRole):
        original = app.dependency_overrides[get_current_user]
        app.dependency_overrides[get_current_user] = lambda: _user_with_role(role)
        try:
            yield
        finally:
            app.dependency_overrides[get_current_user] = original

    return _swap


@pytest.fixture
def db_session():
    """Function-scoped SQLAlchemy session wrapped in a connection-level
    transaction that's rolled back at teardown.

    Uses the SAVEPOINT pattern so tests calling ``session.commit()`` still
    behave correctly: the commit only finalizes the inner savepoint, not the
    outer transaction. IntegrityError on commit (unique/check constraint)
    still surfaces. Between tests, nothing the test wrote leaks into the DB.
    """
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    connection = engine.connect()
    outer_trans = connection.begin()
    session = Session(bind=connection)

    nested = connection.begin_nested()

    @event.listens_for(session, "after_transaction_end")
    def _restart_savepoint(sess, trans):
        nonlocal nested
        if trans.nested and not trans._parent.nested:
            nested = connection.begin_nested()

    try:
        yield session
    finally:
        session.close()
        if outer_trans.is_active:
            outer_trans.rollback()
        connection.close()
