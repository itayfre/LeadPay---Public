"""Tests for the new fallback_owner_tenant_id field on PATCH /api/v1/tenants/apartments/{id}.

The endpoint already supported expected_payment; we added fallback_owner_tenant_id.
"""
import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.apartment import Apartment
from app.models.building import Building
from app.models.tenant import OwnershipType, Tenant


client = TestClient(app)


@pytest.fixture
def env():
    session = SessionLocal()
    import uuid as _uuid
    b = Building(
        name=f"TEST_PATCHFB_{_uuid.uuid4().hex[:8]}",
        address=f"{_uuid.uuid4().hex[:6]} st",
        city="Tel Aviv",
    )
    session.add(b)
    session.flush()

    apt1 = Apartment(building_id=b.id, number=1, floor=1)
    apt2 = Apartment(building_id=b.id, number=2, floor=1)
    session.add_all([apt1, apt2])
    session.flush()

    # tenant on apt1
    tenant_on_apt1 = Tenant(
        apartment_id=apt1.id, building_id=b.id, name="Owner on apt1",
        ownership_type=OwnershipType.OWNER, is_active=True,
    )
    # tenant on apt2 — used to verify cross-apt validation
    tenant_on_apt2 = Tenant(
        apartment_id=apt2.id, building_id=b.id, name="Other tenant",
        ownership_type=OwnershipType.OWNER, is_active=True,
    )
    session.add_all([tenant_on_apt1, tenant_on_apt2])
    session.commit()

    yield {
        "session": session, "building": b,
        "apt1": apt1, "apt2": apt2,
        "tenant_on_apt1": tenant_on_apt1, "tenant_on_apt2": tenant_on_apt2,
    }

    # Teardown
    session.execute(
        Apartment.__table__.update().where(Apartment.id.in_([apt1.id, apt2.id]))
        .values(fallback_owner_tenant_id=None)
    )
    session.execute(Tenant.__table__.delete().where(Tenant.id.in_([tenant_on_apt1.id, tenant_on_apt2.id])))
    session.execute(Apartment.__table__.delete().where(Apartment.id.in_([apt1.id, apt2.id])))
    session.execute(Building.__table__.delete().where(Building.id == b.id))
    session.commit()
    session.close()


def test_set_fallback_owner(env):
    apt1 = env["apt1"]
    tenant = env["tenant_on_apt1"]
    r = client.patch(
        f"/api/v1/tenants/apartments/{apt1.id}",
        json={"fallback_owner_tenant_id": str(tenant.id)},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fallback_owner_tenant_id"] == str(tenant.id)

    env["session"].refresh(apt1)
    assert apt1.fallback_owner_tenant_id == tenant.id


def test_clear_fallback_owner(env):
    apt1 = env["apt1"]
    apt1.fallback_owner_tenant_id = env["tenant_on_apt1"].id
    env["session"].commit()

    r = client.patch(
        f"/api/v1/tenants/apartments/{apt1.id}",
        json={"fallback_owner_tenant_id": None},
    )
    assert r.status_code == 200, r.text
    assert r.json()["fallback_owner_tenant_id"] is None
    env["session"].refresh(apt1)
    assert apt1.fallback_owner_tenant_id is None


def test_cannot_assign_tenant_from_different_apt(env):
    """Picking a tenant that belongs to a DIFFERENT apartment should 400."""
    apt1 = env["apt1"]
    other = env["tenant_on_apt2"]
    r = client.patch(
        f"/api/v1/tenants/apartments/{apt1.id}",
        json={"fallback_owner_tenant_id": str(other.id)},
    )
    assert r.status_code == 400
    assert "belongs to apartment" in r.json()["detail"]


def test_unknown_tenant_404(env):
    import uuid as _uuid
    apt1 = env["apt1"]
    r = client.patch(
        f"/api/v1/tenants/apartments/{apt1.id}",
        json={"fallback_owner_tenant_id": str(_uuid.uuid4())},
    )
    assert r.status_code == 404


def test_omit_field_does_not_change_existing(env):
    """If the request doesn't include fallback_owner_tenant_id, leave it alone."""
    apt1 = env["apt1"]
    apt1.fallback_owner_tenant_id = env["tenant_on_apt1"].id
    env["session"].commit()

    r = client.patch(
        f"/api/v1/tenants/apartments/{apt1.id}",
        json={"expected_payment": 1500},  # only expected_payment, no owner field
    )
    assert r.status_code == 200
    env["session"].refresh(apt1)
    assert apt1.fallback_owner_tenant_id == env["tenant_on_apt1"].id
    assert float(apt1.expected_payment) == 1500.0
