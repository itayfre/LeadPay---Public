"""Endpoint tests for /api/v1/collecting/{building_id}/.

The endpoint returns one row per apartment in the building, sourced from
the new tables. We don't fake any auth here — conftest.py installs a
stub MANAGER user via dependency override, so the request runs as a
fully-authorized user.

Test isolation:
- The default db_session fixture wraps each test in a rolled-back outer
  transaction, but the FastAPI TestClient opens its own session through
  the production SessionLocal. So tests need to commit (so the request
  sees the data) and clean up after themselves (so the next test isn't
  contaminated). We delete what we created at teardown.
"""
from datetime import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models.apartment import Apartment
from app.models.apartment_period_debt import ApartmentPeriodDebt
from app.models.building import Building
from app.models.tenant import OwnershipType, Tenant
from app.models.transaction import Transaction, TransactionType
from app.models.transaction_allocation import TransactionAllocation


client = TestClient(app)


@pytest.fixture
def isolated_building():
    """Create a building + cleanup afterwards.

    Uses a real SessionLocal (not the savepoint-wrapped db_session) so the
    HTTP request can see the data. Tracks created IDs and deletes them
    at teardown.
    """
    session = SessionLocal()
    created_ids = {"apartments": [], "tenants": [], "buildings": [],
                   "period_debts": [], "transactions": [], "allocations": []}

    def _create_building(name_suffix="t") -> Building:
        import uuid
        b = Building(
            name=f"TEST_collecting_{uuid.uuid4().hex[:8]}",
            address=f"{uuid.uuid4().hex[:6]} st",
            city="Tel Aviv",
        )
        session.add(b)
        session.flush()
        created_ids["buildings"].append(b.id)
        return b

    def _create_apartment(building_id, number, expected_payment=None) -> Apartment:
        import uuid
        a = Apartment(
            building_id=building_id, number=number, floor=1,
            expected_payment=expected_payment,
        )
        session.add(a)
        session.flush()
        created_ids["apartments"].append(a.id)
        return a

    def _create_tenant(apartment_id, building_id, name, ownership_type=None, is_active=True) -> Tenant:
        t = Tenant(
            apartment_id=apartment_id, building_id=building_id, name=name,
            ownership_type=ownership_type, is_active=is_active,
        )
        session.add(t)
        session.flush()
        created_ids["tenants"].append(t.id)
        return t

    def _create_period_debt(apartment_id, year, month, expected, responsible_tenant_id=None) -> ApartmentPeriodDebt:
        pd = ApartmentPeriodDebt(
            apartment_id=apartment_id, year=year, month=month,
            expected_amount=expected, responsible_tenant_id=responsible_tenant_id,
        )
        session.add(pd)
        session.flush()
        created_ids["period_debts"].append(pd.id)
        return pd

    def _create_paid_allocation(period_debt_id, tenant_id, amount) -> TransactionAllocation:
        tx = Transaction(
            activity_date=datetime(2026, 1, 15), description="test",
            transaction_type=TransactionType.PAYMENT, credit_amount=Decimal(amount),
        )
        session.add(tx)
        session.flush()
        created_ids["transactions"].append(tx.id)
        ta = TransactionAllocation(
            transaction_id=tx.id, tenant_id=tenant_id, amount=Decimal(amount),
            apartment_period_debt_id=period_debt_id,
        )
        session.add(ta)
        session.flush()
        created_ids["allocations"].append(ta.id)
        return ta

    session.commit()

    yield {
        "session": session,
        "create_building": _create_building,
        "create_apartment": _create_apartment,
        "create_tenant": _create_tenant,
        "create_period_debt": _create_period_debt,
        "create_paid_allocation": _create_paid_allocation,
    }

    # Teardown: reverse-order delete to satisfy FK constraints.
    for tid in created_ids["allocations"]:
        session.execute(TransactionAllocation.__table__.delete().where(TransactionAllocation.id == tid))
    for tid in created_ids["transactions"]:
        session.execute(Transaction.__table__.delete().where(Transaction.id == tid))
    for pid in created_ids["period_debts"]:
        session.execute(ApartmentPeriodDebt.__table__.delete().where(ApartmentPeriodDebt.id == pid))
    for tid in created_ids["tenants"]:
        # null out fallback first to allow tenant delete
        session.execute(
            Apartment.__table__.update()
            .where(Apartment.fallback_owner_tenant_id == tid)
            .values(fallback_owner_tenant_id=None)
        )
        session.execute(Tenant.__table__.delete().where(Tenant.id == tid))
    for aid in created_ids["apartments"]:
        session.execute(Apartment.__table__.delete().where(Apartment.id == aid))
    for bid in created_ids["buildings"]:
        session.execute(Building.__table__.delete().where(Building.id == bid))
    session.commit()
    session.close()


def test_one_row_per_apartment(isolated_building):
    """The response has exactly N rows for N apartments."""
    b = isolated_building["create_building"]()
    apt1 = isolated_building["create_apartment"](b.id, 1)
    apt2 = isolated_building["create_apartment"](b.id, 2)
    apt3 = isolated_building["create_apartment"](b.id, 3)
    isolated_building["session"].commit()

    r = client.get(f"/api/v1/collecting/{b.id}/")
    assert r.status_code == 200
    body = r.json()
    assert body["building"]["id"] == str(b.id)
    assert len(body["rows"]) == 3
    apt_ids_in_response = {row["apartment_id"] for row in body["rows"]}
    assert apt_ids_in_response == {str(apt1.id), str(apt2.id), str(apt3.id)}


def test_unknown_building_returns_404(isolated_building):
    import uuid
    r = client.get(f"/api/v1/collecting/{uuid.uuid4()}/")
    assert r.status_code == 404


def test_apartment_with_no_debt_shows_zero_and_paid(isolated_building):
    b = isolated_building["create_building"]()
    apt = isolated_building["create_apartment"](b.id, 1)
    isolated_building["create_tenant"](apt.id, b.id, "Solo", is_active=True)
    isolated_building["session"].commit()

    r = client.get(f"/api/v1/collecting/{b.id}/")
    row = r.json()["rows"][0]
    assert row["total_balance"] == "0.00"
    assert row["monthly_expected"] == "0.00"
    assert row["status"] == "paid"
    assert row["responsible_label"] == "active"


def test_status_unpaid_when_active_tenant_owes_full(isolated_building):
    b = isolated_building["create_building"]()
    apt = isolated_building["create_apartment"](b.id, 1)
    t = isolated_building["create_tenant"](apt.id, b.id, "Active payer", is_active=True)
    isolated_building["create_period_debt"](apt.id, 2026, 1, Decimal("1500"), t.id)
    isolated_building["session"].commit()

    r = client.get(f"/api/v1/collecting/{b.id}/")
    row = r.json()["rows"][0]
    assert row["monthly_expected"] == "1500.00"
    assert row["monthly_paid"] == "0.00"
    assert row["total_balance"] == "1500.00"
    assert row["status"] == "unpaid"
    assert row["active_tenant"]["name"] == "Active payer"


def test_status_partial_when_some_paid(isolated_building):
    b = isolated_building["create_building"]()
    apt = isolated_building["create_apartment"](b.id, 1)
    t = isolated_building["create_tenant"](apt.id, b.id, "Active payer", is_active=True)
    pd = isolated_building["create_period_debt"](apt.id, 2026, 1, Decimal("1500"), t.id)
    isolated_building["create_paid_allocation"](pd.id, t.id, Decimal("500"))
    isolated_building["session"].commit()

    r = client.get(f"/api/v1/collecting/{b.id}/")
    row = r.json()["rows"][0]
    assert row["monthly_paid"] == "500.00"
    assert row["total_balance"] == "1000.00"
    assert row["status"] == "partial"


def test_status_owner_liable_when_no_active_tenant(isolated_building):
    """No active tenant + balance > 0 + fallback owner exists → owner_liable."""
    b = isolated_building["create_building"]()
    apt = isolated_building["create_apartment"](b.id, 1)
    owner = isolated_building["create_tenant"](
        apt.id, b.id, "Absentee owner",
        ownership_type=OwnershipType.LANDLORD, is_active=False,
    )
    apt.fallback_owner_tenant_id = owner.id
    isolated_building["create_period_debt"](apt.id, 2026, 1, Decimal("1500"), None)
    isolated_building["session"].commit()

    r = client.get(f"/api/v1/collecting/{b.id}/")
    row = r.json()["rows"][0]
    assert row["active_tenant"] is None
    assert row["fallback_owner"]["name"] == "Absentee owner"
    assert row["responsible_label"] == "owner_fallback"
    assert row["status"] == "owner_liable"


def test_apartment_tenants_contains_active_and_inactive(isolated_building):
    """The row's apartment_tenants array includes all tenants on the apt,
    with the active one flagged as primary_payer."""
    b = isolated_building["create_building"]()
    apt = isolated_building["create_apartment"](b.id, 1)
    inactive = isolated_building["create_tenant"](
        apt.id, b.id, "Former owner",
        ownership_type=OwnershipType.OWNER, is_active=False,
    )
    active = isolated_building["create_tenant"](
        apt.id, b.id, "Current renter",
        ownership_type=OwnershipType.RENTER, is_active=True,
    )
    isolated_building["session"].commit()

    r = client.get(f"/api/v1/collecting/{b.id}/")
    row = r.json()["rows"][0]
    assert len(row["apartment_tenants"]) == 2
    names = {t["name"] for t in row["apartment_tenants"]}
    assert names == {"Former owner", "Current renter"}

    # Active sorts first.
    assert row["apartment_tenants"][0]["name"] == "Current renter"
    assert row["apartment_tenants"][0]["is_primary_payer"] is True
    assert row["apartment_tenants"][0]["is_active"] is True
    assert row["apartment_tenants"][1]["name"] == "Former owner"
    assert row["apartment_tenants"][1]["is_primary_payer"] is False
    assert row["apartment_tenants"][1]["is_active"] is False


def test_rows_sorted_by_apartment_number(isolated_building):
    b = isolated_building["create_building"]()
    isolated_building["create_apartment"](b.id, 3)
    isolated_building["create_apartment"](b.id, 1)
    isolated_building["create_apartment"](b.id, 2)
    isolated_building["session"].commit()

    r = client.get(f"/api/v1/collecting/{b.id}/")
    numbers = [row["apartment_number"] for row in r.json()["rows"]]
    assert numbers == [1, 2, 3]
