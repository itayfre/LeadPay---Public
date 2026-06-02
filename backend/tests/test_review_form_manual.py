"""Regression test for the AllocationDrawer load endpoint on manual payments.

Manual payments are recorded with `statement_id=None`. The
`/api/v1/statements/transactions/{id}/review-form` endpoint is used by the
AllocationDrawer (opened from the matrix paid-cell click in CollectionTab) to
load the transaction so the user can edit/split its allocations across
months. Before the fix, the endpoint required a parent BankStatement and
404'd with "Owning statement not found" for any manual payment.

This test exercises the path end-to-end: create a building + tenant, post a
manual payment, then GET the review-form and assert it returns the
transaction with the correct allocations and a derived building_id.
"""
import uuid
from typing import Optional

from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import Apartment, Tenant


client = TestClient(app)


def _new_building() -> str:
    name = f"Test Building {uuid.uuid4().hex[:8]}"
    r = client.post("/api/v1/buildings/", json={
        "name": name, "address": "1 Test St", "city": "TLV"
    })
    assert r.status_code == 201, r.json()
    return r.json()["id"]


def _new_tenant(building_id: str, full_name: str = "ידני דייר", apt_number: Optional[int] = None) -> str:
    import random
    db = SessionLocal()
    try:
        apt = Apartment(
            building_id=uuid.UUID(building_id),
            number=apt_number if apt_number is not None else random.randint(100, 9999),
            floor=1,
            expected_payment=500,
        )
        db.add(apt)
        db.flush()
        t = Tenant(
            apartment_id=apt.id,
            building_id=uuid.UUID(building_id),
            name=full_name.split(" ")[0],
            full_name=full_name,
        )
        db.add(t)
        db.commit()
        return str(t.id)
    finally:
        db.close()


def test_review_form_works_for_manual_payment():
    """Posting a manual payment then loading it via review-form must succeed."""
    building_id = _new_building()
    tenant_id = _new_tenant(building_id)

    # Record a manual payment — this creates a Transaction with statement_id=None
    r = client.post("/api/v1/payments/manual", json={
        "building_id": building_id,
        "tenant_id": tenant_id,
        "amount": 500,
        "month": 5,
        "year": 2026,
        "note": "test",
    })
    assert r.status_code == 200, r.json()
    transaction_id = r.json()["transaction_id"]

    # Load via review-form — this is what AllocationDrawer calls
    r = client.get(f"/api/v1/statements/transactions/{transaction_id}/review-form")
    assert r.status_code == 200, (
        f"Expected 200 but got {r.status_code}: {r.json()}\n"
        "Manual payments lack statement_id — the endpoint must derive building_id "
        "from the transaction's allocations instead of 404'ing."
    )

    body = r.json()
    assert body["building_id"] == building_id
    assert body["tx"]["id"] == transaction_id
    assert len(body["tx"]["allocations"]) >= 1
    # The allocation should be tied to our tenant for May 2026
    alloc = body["tx"]["allocations"][0]
    assert alloc["tenant_id"] == tenant_id
    assert alloc["period_month"] == 5
    assert alloc["period_year"] == 2026
    assert float(alloc["amount"]) == 500.0
    # The drawer also needs the building's tenant list
    assert any(t["tenant_id"] == tenant_id for t in body["all_tenants"])


def test_review_form_returns_404_when_truly_unresolvable():
    """A bogus transaction id still returns 404, not 500."""
    r = client.get(
        f"/api/v1/statements/transactions/{uuid.uuid4()}/review-form"
    )
    assert r.status_code == 404
