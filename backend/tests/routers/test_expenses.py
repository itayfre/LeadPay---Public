"""Tests for the /api/v1/expenses/* router family.

Focus: the bulk-categorize endpoint extension (Task 8 of statement-flow-revamp).
The endpoint now accepts vendor_label/notes/remember and CREATES allocations
when missing, in addition to updating existing ones.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import (
    BankStatement,
    ExpenseCategory,
    Transaction,
    TransactionAllocation,
    TransactionType,
    VendorMapping,
)


client = TestClient(app)


def _new_building() -> str:
    name = f"Test Building {uuid.uuid4().hex[:8]}"
    r = client.post(
        "/api/v1/buildings/",
        json={"name": name, "address": "1 Test St", "city": "TLV"},
    )
    assert r.status_code == 201, r.json()
    return r.json()["id"]


def _make_category(building_id: str, name: str | None = None) -> str:
    name = name or f"Cat {uuid.uuid4().hex[:6]}"
    db = SessionLocal()
    try:
        cat = ExpenseCategory(
            building_id=uuid.UUID(building_id),
            name=name,
            color="#FF8800",
            is_default=False,
            is_active=True,
        )
        db.add(cat)
        db.commit()
        return str(cat.id)
    finally:
        db.close()


def _seed_debit_txns(
    building_id: str,
    descriptions: list[str],
    with_allocation_label: str | None = None,
) -> list[str]:
    """Create a statement + N debit transactions. Optionally pre-create an
    expense allocation (tenant_id=NULL, label=...) for each."""
    db = SessionLocal()
    try:
        stmt = BankStatement(
            building_id=uuid.UUID(building_id),
            period_month=3,
            period_year=2026,
            original_filename="bulk-test.xlsx",
        )
        db.add(stmt)
        db.flush()

        txn_ids: list[str] = []
        for desc in descriptions:
            txn = Transaction(
                statement_id=stmt.id,
                activity_date=datetime(2026, 3, 15),
                description=desc,
                debit_amount=Decimal("250.00"),
                transaction_type=TransactionType.TRANSFER,
            )
            db.add(txn)
            db.flush()
            txn_ids.append(str(txn.id))
            if with_allocation_label is not None:
                alloc = TransactionAllocation(
                    transaction_id=txn.id,
                    tenant_id=None,
                    label=with_allocation_label,
                    amount=Decimal("250.00"),
                )
                db.add(alloc)
        db.commit()
        return txn_ids
    finally:
        db.close()


def test_bulk_categorize_creates_allocations_with_vendor_label():
    """Bulk-categorize uncategorized rows: creates allocations + sets vendor label + category.

    Also asserts a VendorMapping is upserted per distinct description when
    remember=True.
    """
    building_id = _new_building()
    cat_name = f"חשמל-{uuid.uuid4().hex[:6]}"
    category_id = _make_category(building_id, name=cat_name)
    txn_ids = _seed_debit_txns(
        building_id,
        descriptions=["העברה - חברת חשמל", "העברה - חברת חשמל"],
        with_allocation_label=None,  # no pre-existing allocation
    )

    r = client.post(
        f"/api/v1/expenses/{building_id}/bulk-categorize",
        json={
            "transaction_ids": txn_ids,
            "category_id": category_id,
            "vendor_label": "חברת חשמל",
            "notes": "תשלום חודשי",
            "remember": True,
        },
    )
    assert r.status_code == 200, r.json()
    assert r.json() == {"updated": 2}

    db = SessionLocal()
    try:
        allocs = (
            db.query(TransactionAllocation)
            .filter(
                TransactionAllocation.transaction_id.in_(
                    [uuid.UUID(t) for t in txn_ids]
                ),
                TransactionAllocation.tenant_id.is_(None),
            )
            .all()
        )
        assert len(allocs) == 2, "Both txns should have an expense allocation now"
        for a in allocs:
            assert a.label == "חברת חשמל"
            assert str(a.category_id) == category_id
            assert a.notes == "תשלום חודשי"
            assert a.amount == Decimal("250.00")

        # VendorMapping upserted (one per distinct description; both rows share
        # the same description here so we get a single mapping)
        mappings = (
            db.query(VendorMapping)
            .filter(VendorMapping.building_id == uuid.UUID(building_id))
            .all()
        )
        assert len(mappings) == 1
        m = mappings[0]
        assert m.vendor_label == "חברת חשמל"
        assert m.category == cat_name
    finally:
        db.close()


def test_bulk_categorize_preserves_existing_when_vendor_label_omitted():
    """Backward-compat: existing callers passing only transaction_ids + category_id still work."""
    building_id = _new_building()
    category_id = _make_category(building_id, name=f"גינון-{uuid.uuid4().hex[:6]}")
    txn_ids = _seed_debit_txns(
        building_id,
        descriptions=["העברה - גנן א", "העברה - גנן ב"],
        with_allocation_label="ספק כללי",
    )

    r = client.post(
        f"/api/v1/expenses/{building_id}/bulk-categorize",
        json={
            "transaction_ids": txn_ids,
            "category_id": category_id,
        },
    )
    assert r.status_code == 200, r.json()
    assert r.json() == {"updated": 2}

    db = SessionLocal()
    try:
        allocs = (
            db.query(TransactionAllocation)
            .filter(
                TransactionAllocation.transaction_id.in_(
                    [uuid.UUID(t) for t in txn_ids]
                ),
                TransactionAllocation.tenant_id.is_(None),
            )
            .all()
        )
        assert len(allocs) == 2
        for a in allocs:
            # Existing label preserved
            assert a.label == "ספק כללי"
            # Category updated
            assert str(a.category_id) == category_id

        # No remember=True → no VendorMapping persisted
        mappings = (
            db.query(VendorMapping)
            .filter(VendorMapping.building_id == uuid.UUID(building_id))
            .all()
        )
        assert mappings == []
    finally:
        db.close()
