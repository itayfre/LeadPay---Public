"""Tests for the global transactions list/create endpoints (GET/POST /api/v1/transactions/)."""
import uuid
from datetime import datetime, date, timedelta
from decimal import Decimal
from typing import Optional

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import (
    Apartment,
    Tenant,
    Transaction,
    BankStatement,
    TransactionType,
    MatchMethod,
)
from app.dependencies.auth import get_current_user
from app.models.user import UserRole


client = TestClient(app)


# ── Fixtures / helpers ───────────────────────────────────────────────────────

def _new_building(name: Optional[str] = None) -> str:
    name = name or f"Test Building {uuid.uuid4().hex[:8]}"
    r = client.post("/api/v1/buildings/", json={
        "name": name, "address": "1 Test St", "city": "TLV"
    })
    assert r.status_code == 201, r.json()
    return r.json()["id"]


def _new_tenant(building_id: str, full_name: str = "דני לוי") -> str:
    import random
    db = SessionLocal()
    try:
        apt = Apartment(
            building_id=uuid.UUID(building_id),
            number=random.randint(100, 9999),
            floor=1,
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


def _seed_transaction(
    building_id: str,
    *,
    when: Optional[datetime] = None,
    description: str = "העברה",
    credit: Optional[float] = 1000.0,
    debit: Optional[float] = None,
    matched_tenant_id: Optional[str] = None,
    is_confirmed: bool = False,
    is_manual: bool = False,
    transaction_type: TransactionType = TransactionType.PAYMENT,
    payer_name: Optional[str] = None,
) -> str:
    """Insert one transaction (with an auto-created bank statement for that building)."""
    db = SessionLocal()
    try:
        stmt = BankStatement(
            building_id=uuid.UUID(building_id),
            period_month=(when or datetime.utcnow()).month,
            period_year=(when or datetime.utcnow()).year,
            original_filename=f"seed-{uuid.uuid4().hex[:6]}.xlsx",
        )
        db.add(stmt)
        db.flush()
        txn = Transaction(
            statement_id=stmt.id,
            activity_date=when or datetime.utcnow(),
            description=description,
            payer_name=payer_name,
            credit_amount=Decimal(str(credit)) if credit is not None else None,
            debit_amount=Decimal(str(debit)) if debit is not None else None,
            transaction_type=transaction_type,
            matched_tenant_id=uuid.UUID(matched_tenant_id) if matched_tenant_id else None,
            match_confidence=0.8 if matched_tenant_id else None,
            match_method=MatchMethod.FUZZY if matched_tenant_id else None,
            is_confirmed=is_confirmed,
            is_manual=is_manual,
        )
        db.add(txn)
        db.commit()
        return str(txn.id)
    finally:
        db.close()


# ── GET /api/v1/transactions/ ────────────────────────────────────────────────

def test_list_returns_pagination_envelope():
    b = _new_building()
    _seed_transaction(b)
    r = client.get("/api/v1/transactions/")
    assert r.status_code == 200
    data = r.json()
    assert set(data.keys()) >= {"items", "total", "page", "page_size"}
    assert data["page"] == 1
    assert data["page_size"] == 50


def test_list_filters_by_building():
    b1 = _new_building("B1")
    b2 = _new_building("B2")
    _seed_transaction(b1, description="in-b1")
    _seed_transaction(b2, description="in-b2")

    r = client.get(f"/api/v1/transactions/?building_id={b1}")
    assert r.status_code == 200
    descs = [i["description"] for i in r.json()["items"]]
    assert "in-b1" in descs
    assert "in-b2" not in descs


def test_list_filters_by_direction():
    b = _new_building()
    _seed_transaction(b, description="incoming", credit=500.0, debit=None)
    _seed_transaction(b, description="outgoing", credit=None, debit=200.0)

    credit_only = client.get(f"/api/v1/transactions/?building_id={b}&direction=credit").json()
    descs = [i["description"] for i in credit_only["items"]]
    assert "incoming" in descs and "outgoing" not in descs

    debit_only = client.get(f"/api/v1/transactions/?building_id={b}&direction=debit").json()
    descs = [i["description"] for i in debit_only["items"]]
    assert "outgoing" in descs and "incoming" not in descs


def test_list_filters_by_match_status():
    b = _new_building()
    tenant_id = _new_tenant(b)
    _seed_transaction(b, description="confirmed-row", matched_tenant_id=tenant_id, is_confirmed=True)
    _seed_transaction(b, description="auto-row", matched_tenant_id=tenant_id, is_confirmed=False)
    _seed_transaction(b, description="unmatched-row", matched_tenant_id=None)

    confirmed = client.get(f"/api/v1/transactions/?building_id={b}&match_status=confirmed").json()
    descs = [i["description"] for i in confirmed["items"]]
    assert "confirmed-row" in descs and "auto-row" not in descs and "unmatched-row" not in descs

    unmatched = client.get(f"/api/v1/transactions/?building_id={b}&match_status=unmatched").json()
    descs = [i["description"] for i in unmatched["items"]]
    assert "unmatched-row" in descs and "confirmed-row" not in descs


def test_split_transaction_is_treated_as_resolved_not_unmatched():
    """A multi-tenant split has matched_tenant_id=NULL but is_confirmed=True.
    It must NOT appear under match_status=unmatched, but must appear under
    match_status=split and surface allocation labels in the response."""
    b = _new_building()
    t1 = _new_tenant(b, full_name="גיא מן")
    t2 = _new_tenant(b, full_name="שרה כהן")

    # Seed a transaction that simulates a saved split: confirmed, no FK, two allocations
    db = SessionLocal()
    try:
        from app.models.transaction_allocation import TransactionAllocation
        statement = BankStatement(
            building_id=uuid.UUID(b),
            original_filename="upload.xlsx",
            period_month=1,
            period_year=2026,
        )
        db.add(statement)
        db.flush()
        tx = Transaction(
            statement_id=statement.id,
            activity_date=datetime.utcnow(),
            description="הפקדת שיק מפוצלת",
            credit_amount=Decimal("4000"),
            transaction_type=TransactionType.PAYMENT,
            matched_tenant_id=None,
            is_confirmed=True,
            match_method=MatchMethod.MANUAL,
            match_confidence=1.0,
        )
        db.add(tx)
        db.flush()
        db.add(TransactionAllocation(
            transaction_id=tx.id, tenant_id=uuid.UUID(t1), amount=Decimal("2500"),
        ))
        db.add(TransactionAllocation(
            transaction_id=tx.id, tenant_id=uuid.UUID(t2), amount=Decimal("1500"),
        ))
        db.commit()
        tx_id = str(tx.id)
    finally:
        db.close()

    # unmatched filter must NOT include the split row (the previous bug)
    unmatched = client.get(f"/api/v1/transactions/?building_id={b}&match_status=unmatched").json()
    assert tx_id not in [i["id"] for i in unmatched["items"]]

    # split filter MUST include it
    splits = client.get(f"/api/v1/transactions/?building_id={b}&match_status=split").json()
    items = [i for i in splits["items"] if i["id"] == tx_id]
    assert len(items) == 1
    row = items[0]
    assert row["is_confirmed"] is True
    assert row["matched_tenant_id"] is None
    assert row["allocations_summary"]["count"] == 2
    # Allocation labels should expose both tenant names so the UI can render "גיא + שרה"
    assert set(row["allocations_summary"]["labels"]) == {"גיא", "שרה"}


def test_list_filters_by_date_range():
    b = _new_building()
    today = datetime.utcnow()
    _seed_transaction(b, when=today - timedelta(days=120), description="too-old")
    _seed_transaction(b, when=today - timedelta(days=10), description="recent")

    cutoff = (today - timedelta(days=30)).date().isoformat()
    r = client.get(f"/api/v1/transactions/?building_id={b}&date_from={cutoff}")
    descs = [i["description"] for i in r.json()["items"]]
    assert "recent" in descs and "too-old" not in descs


def test_list_filters_by_amount_range():
    b = _new_building()
    _seed_transaction(b, description="small", credit=50.0)
    _seed_transaction(b, description="big", credit=5000.0)

    r = client.get(f"/api/v1/transactions/?building_id={b}&amount_min=1000")
    descs = [i["description"] for i in r.json()["items"]]
    assert "big" in descs and "small" not in descs


def test_list_text_search_matches_description_and_payer():
    b = _new_building()
    _seed_transaction(b, description="העברה רגילה", payer_name="פלוני אלמוני")
    _seed_transaction(b, description="חיוב חשמל", payer_name="חברת חשמל")

    r = client.get(f"/api/v1/transactions/?building_id={b}&q=חשמל")
    descs = [i["description"] for i in r.json()["items"]]
    assert "חיוב חשמל" in descs
    assert "העברה רגילה" not in descs


def test_list_sort_by_amount_desc():
    b = _new_building()
    _seed_transaction(b, description="cheap", credit=100.0)
    _seed_transaction(b, description="pricey", credit=9999.0)

    r = client.get(f"/api/v1/transactions/?building_id={b}&sort=-amount")
    items = r.json()["items"]
    # First item should be the pricey one
    assert items[0]["description"] == "pricey"


def test_list_pagination():
    b = _new_building()
    for i in range(7):
        _seed_transaction(b, description=f"row-{i}")

    page1 = client.get(f"/api/v1/transactions/?building_id={b}&page_size=3&page=1").json()
    page2 = client.get(f"/api/v1/transactions/?building_id={b}&page_size=3&page=2").json()
    assert page1["total"] == 7
    assert len(page1["items"]) == 3
    assert len(page2["items"]) == 3
    ids_p1 = {i["id"] for i in page1["items"]}
    ids_p2 = {i["id"] for i in page2["items"]}
    assert ids_p1.isdisjoint(ids_p2)


def test_list_joins_building_and_tenant_names():
    b = _new_building("Joined Building")
    tenant_id = _new_tenant(b, full_name="אבי כהן")
    _seed_transaction(b, description="r", matched_tenant_id=tenant_id, is_confirmed=True)

    r = client.get(f"/api/v1/transactions/?building_id={b}").json()
    row = r["items"][0]
    assert row["building_name"] == "Joined Building"
    assert row["matched_tenant_name"] == "אבי"  # `name` field, not full_name


def test_list_requires_auth(as_role):
    # No body assertion needed — just confirm a viewer can list.
    b = _new_building()
    _seed_transaction(b)
    with as_role(UserRole.VIEWER):
        r = client.get("/api/v1/transactions/")
        assert r.status_code == 200


# ── POST /api/v1/transactions/ ───────────────────────────────────────────────

def test_create_manual_transaction_minimal():
    b = _new_building()
    r = client.post("/api/v1/transactions/", json={
        "building_id": b,
        "activity_date": "2026-05-10",
        "description": "תשלום מזומן",
        "credit_amount": "750.00",
        "transaction_type": "payment",
    })
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body["is_manual"] is True
    assert body["credit_amount"] == 750.0
    assert body["building_id"] == b


def test_create_requires_building():
    r = client.post("/api/v1/transactions/", json={
        "activity_date": "2026-05-10",
        "description": "missing-building",
        "credit_amount": "100",
    })
    assert r.status_code == 422  # pydantic missing field


def test_create_rejects_unknown_building():
    r = client.post("/api/v1/transactions/", json={
        "building_id": str(uuid.uuid4()),
        "activity_date": "2026-05-10",
        "description": "no-such-building",
        "credit_amount": "100",
    })
    assert r.status_code == 404


def test_create_rejects_both_credit_and_debit():
    b = _new_building()
    r = client.post("/api/v1/transactions/", json={
        "building_id": b,
        "activity_date": "2026-05-10",
        "description": "both amounts",
        "credit_amount": "100",
        "debit_amount": "50",
    })
    assert r.status_code == 422


def test_create_with_tenant_allocation_sets_matched_tenant():
    b = _new_building()
    tenant_id = _new_tenant(b, full_name="רון פלוני")
    r = client.post("/api/v1/transactions/", json={
        "building_id": b,
        "activity_date": "2026-05-10",
        "description": "תשלום ידני עם הקצאה",
        "credit_amount": "1200.00",
        "allocations": [
            {"tenant_id": tenant_id, "amount": "1200.00"}
        ],
    })
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body["matched_tenant_id"] == tenant_id
    assert body["allocations_summary"]["count"] == 1


def test_created_manual_transaction_appears_in_list():
    b = _new_building()
    r = client.post("/api/v1/transactions/", json={
        "building_id": b,
        "activity_date": "2026-05-10",
        "description": "manual-row-appears",
        "credit_amount": "300",
    })
    assert r.status_code == 201

    listing = client.get(f"/api/v1/transactions/?building_id={b}&source=manual").json()
    descs = [i["description"] for i in listing["items"]]
    assert "manual-row-appears" in descs
