"""Endpoint tests for /api/v1/special-charges/.

The endpoint creates a SpecialChargeBatch + N SpecialCharge rows in a
single transaction, computing per-apartment amounts via the split-method
functions and resolving responsible_tenant_id from each apartment.
"""
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.apartment import Apartment
from app.models.building import Building
from app.models.special_charge import SpecialCharge, SpecialChargeBatch
from app.models.tenant import OwnershipType, Tenant


client = TestClient(app)


@pytest.fixture
def env():
    """Build a building + 3 apartments + active tenants. Cleans up at teardown."""
    session = SessionLocal()
    created = {"buildings": [], "apartments": [], "tenants": [],
               "batches": [], "charges": []}

    import uuid as _uuid
    b = Building(
        name=f"TEST_SC_{_uuid.uuid4().hex[:8]}",
        address=f"{_uuid.uuid4().hex[:6]} st",
        city="Tel Aviv",
    )
    session.add(b)
    session.flush()
    created["buildings"].append(b.id)

    apts: list[Apartment] = []
    tenants: list[Tenant] = []
    for i in (1, 2, 3):
        a = Apartment(building_id=b.id, number=i, floor=1, weight=Decimal(str(i)))
        session.add(a)
        session.flush()
        created["apartments"].append(a.id)
        t = Tenant(
            apartment_id=a.id, building_id=b.id,
            name=f"Tenant {i}", is_active=True,
            ownership_type=OwnershipType.OWNER,
        )
        session.add(t)
        session.flush()
        created["tenants"].append(t.id)
        apts.append(a)
        tenants.append(t)

    session.commit()

    yield {
        "session": session,
        "building": b,
        "apartments": apts,
        "tenants": tenants,
        "track_batch": created["batches"].append,
    }

    # Teardown
    for bid in created["batches"]:
        # cascade deletes charges; do it explicitly to be safe
        session.execute(
            SpecialCharge.__table__.delete().where(SpecialCharge.batch_id == bid)
        )
        session.execute(
            SpecialChargeBatch.__table__.delete().where(SpecialChargeBatch.id == bid)
        )
    for tid in created["tenants"]:
        session.execute(
            Apartment.__table__.update()
            .where(Apartment.fallback_owner_tenant_id == tid)
            .values(fallback_owner_tenant_id=None)
        )
        session.execute(Tenant.__table__.delete().where(Tenant.id == tid))
    for aid in created["apartments"]:
        session.execute(Apartment.__table__.delete().where(Apartment.id == aid))
    for bid in created["buildings"]:
        session.execute(Building.__table__.delete().where(Building.id == bid))
    session.commit()
    session.close()


def test_create_equal_split(env):
    b = env["building"]
    apt_ids = [str(a.id) for a in env["apartments"]]

    r = client.post("/api/v1/special-charges/", json={
        "building_id": str(b.id),
        "title": "Lift repair Q1",
        "description": "Following the breakdown on Jan 15",
        "total_amount": "3000",
        "split_method": "equal",
        "apartment_ids": apt_ids,
    })
    assert r.status_code == 201, r.text
    body = r.json()
    env["track_batch"](body["id"])

    assert body["title"] == "Lift repair Q1"
    assert body["split_method"] == "equal"
    assert len(body["charges"]) == 3
    amounts = sorted(c["amount"] for c in body["charges"])
    assert amounts == ["1000.00", "1000.00", "1000.00"]


def test_create_custom_split(env):
    b = env["building"]
    apt_ids = [str(a.id) for a in env["apartments"]]
    r = client.post("/api/v1/special-charges/", json={
        "building_id": str(b.id),
        "title": "Custom split",
        "total_amount": "1000",
        "split_method": "custom",
        "apartment_ids": apt_ids,
        "custom_amounts": ["100", "300", "600"],
    })
    assert r.status_code == 201, r.text
    body = r.json()
    env["track_batch"](body["id"])
    amounts = {c["apartment_id"]: c["amount"] for c in body["charges"]}
    assert amounts[apt_ids[0]] == "100.00"
    assert amounts[apt_ids[1]] == "300.00"
    assert amounts[apt_ids[2]] == "600.00"


def test_create_weight_split(env):
    """Apartments have weights 1, 2, 3 (set in env fixture). Total 600 splits
    1:2:3 → 100, 200, 300."""
    b = env["building"]
    apt_ids = [str(a.id) for a in env["apartments"]]
    r = client.post("/api/v1/special-charges/", json={
        "building_id": str(b.id),
        "title": "Weighted split",
        "total_amount": "600",
        "split_method": "weight",
        "apartment_ids": apt_ids,
    })
    assert r.status_code == 201, r.text
    body = r.json()
    env["track_batch"](body["id"])
    amounts = {c["apartment_id"]: c["amount"] for c in body["charges"]}
    assert amounts[apt_ids[0]] == "100.00"
    assert amounts[apt_ids[1]] == "200.00"
    assert amounts[apt_ids[2]] == "300.00"


def test_create_flat_per_apt(env):
    b = env["building"]
    apt_ids = [str(a.id) for a in env["apartments"]]
    r = client.post("/api/v1/special-charges/", json={
        "building_id": str(b.id),
        "title": "Flat fee",
        "total_amount": "200",  # treated as per-apt amount in flat mode
        "split_method": "flat",
        "apartment_ids": apt_ids,
    })
    assert r.status_code == 201, r.text
    body = r.json()
    env["track_batch"](body["id"])
    for c in body["charges"]:
        assert c["amount"] == "200.00"


def test_custom_amounts_required_for_custom(env):
    b = env["building"]
    r = client.post("/api/v1/special-charges/", json={
        "building_id": str(b.id),
        "title": "missing",
        "total_amount": "100",
        "split_method": "custom",
        "apartment_ids": [str(env["apartments"][0].id)],
    })
    assert r.status_code == 400
    assert "custom_amounts is required" in r.json()["detail"]


def test_custom_amounts_length_must_match(env):
    b = env["building"]
    r = client.post("/api/v1/special-charges/", json={
        "building_id": str(b.id),
        "title": "wrong length",
        "total_amount": "100",
        "split_method": "custom",
        "apartment_ids": [str(env["apartments"][0].id), str(env["apartments"][1].id)],
        "custom_amounts": ["50"],
    })
    assert r.status_code == 400
    assert "must equal apartment_ids length" in r.json()["detail"]


def test_unknown_apartment_id_rejected(env):
    b = env["building"]
    import uuid as _uuid
    r = client.post("/api/v1/special-charges/", json={
        "building_id": str(b.id),
        "title": "bad apt",
        "total_amount": "100",
        "split_method": "equal",
        "apartment_ids": [str(_uuid.uuid4())],
    })
    assert r.status_code == 400
    assert "Unknown apartment_id" in r.json()["detail"]


def test_responsible_tenant_resolved_from_active(env):
    """A charge's responsible_tenant_id is the apt's active tenant."""
    b = env["building"]
    apt_ids = [str(env["apartments"][0].id)]
    r = client.post("/api/v1/special-charges/", json={
        "building_id": str(b.id),
        "title": "ownership test",
        "total_amount": "100",
        "split_method": "equal",
        "apartment_ids": apt_ids,
    })
    assert r.status_code == 201
    body = r.json()
    env["track_batch"](body["id"])
    assert body["charges"][0]["responsible_tenant_id"] == str(env["tenants"][0].id)


def test_list_and_get(env):
    b = env["building"]
    r = client.post("/api/v1/special-charges/", json={
        "building_id": str(b.id),
        "title": "First",
        "total_amount": "100",
        "split_method": "equal",
        "apartment_ids": [str(env["apartments"][0].id)],
    })
    assert r.status_code == 201
    env["track_batch"](r.json()["id"])

    # List
    r = client.get(f"/api/v1/special-charges/?building_id={b.id}")
    assert r.status_code == 200
    listed = r.json()
    assert any(item["title"] == "First" for item in listed)

    # Get one
    one = next(item for item in listed if item["title"] == "First")
    r = client.get(f"/api/v1/special-charges/{one['id']}/")
    assert r.status_code == 200
    assert r.json()["title"] == "First"


def test_unknown_batch_404(env):
    import uuid as _uuid
    r = client.get(f"/api/v1/special-charges/{_uuid.uuid4()}/")
    assert r.status_code == 404
