"""
Tests for transaction_allocations (PR-2).

Verifies the dual-write invariant: every code path that mutates
`Transaction.matched_tenant_id` keeps `transaction_allocations` in sync,
and the row count of allocations matches the row count of matched
transactions for any building.

The tests follow the integration pattern from `test_statements.py` —
`TestClient(app)` against the configured DB. Service-level edge cases
(idempotency of upsert, sum validation tolerance) are tested directly
against `allocation_service` with a `Session` from the app's SessionLocal.
"""
import io
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import Apartment, Tenant, Transaction, TransactionAllocation, BankStatement, VendorMapping
from app.services import allocation_service


client = TestClient(app)


# ── Helpers (mirrors test_statements.py) ─────────────────────────────────────

def _make_bank_excel(rows: list[dict]) -> io.BytesIO:
    df = pd.DataFrame([
        {
            'תאריך פעילות': r['date'],
            'תאור פעולה': r['description'],
            'זכות': r.get('credit', ''),
            'חובה': r.get('debit', ''),
            'יתרה': r['balance'],
        }
        for r in rows
    ])
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)
    return buf


def _new_building() -> str:
    name = f"Test Building {uuid.uuid4().hex[:8]}"
    r = client.post("/api/v1/buildings/", json={
        "name": name, "address": "1 Test St", "city": "TLV"
    })
    assert r.status_code == 201, r.json()
    return r.json()["id"]


def _new_tenant(building_id: str, full_name: str = "דני לוי", apt_number: Optional[int] = None) -> str:
    """Create a single apartment + tenant in the building (direct DB insert).

    Direct insert keeps the test focused on the allocation behavior — going
    through the HTTP layer for setup adds auth wiring overhead that's
    unrelated to what we're testing.
    """
    import random
    db = SessionLocal()
    try:
        apt = Apartment(
            building_id=uuid.UUID(building_id),
            number=apt_number if apt_number is not None else random.randint(100, 9999),
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


def _upload(building_id: str, buf: io.BytesIO) -> dict:
    buf.seek(0)
    r = client.post(
        f"/api/v1/statements/{building_id}/upload",
        files={"file": ("stmt.xlsx", buf,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        data={"period_month": 1, "period_year": 2026},
    )
    assert r.status_code == 201, r.json()
    return r.json()


def _allocations_for(transaction_id: str) -> list[TransactionAllocation]:
    db = SessionLocal()
    try:
        return (
            db.query(TransactionAllocation)
            .filter(TransactionAllocation.transaction_id == transaction_id)
            .all()
        )
    finally:
        db.close()


# ── Integration tests through the API ────────────────────────────────────────

def test_auto_match_creates_allocation():
    """When the engine auto-matches a payment, an allocation row is created
    pointing at the matched tenant for the full credit amount."""
    building_id = _new_building()
    tenant_id = _new_tenant(building_id, full_name="דני לוי")

    excel = _make_bank_excel([
        {"date": datetime(2026, 1, 15),
         "description": "העברה - דני לוי",
         "credit": 1500.0,
         "balance": 10000.0},
    ])
    _upload(building_id, excel)

    # Find the transaction that was just inserted
    db = SessionLocal()
    try:
        txn = db.query(Transaction).filter(
            Transaction.matched_tenant_id == uuid.UUID(tenant_id)
        ).first()
        assert txn is not None, "Transaction should be auto-matched to the tenant"

        allocs = _allocations_for(str(txn.id))
        assert len(allocs) == 1, f"Expected 1 allocation, got {len(allocs)}"
        assert str(allocs[0].tenant_id) == tenant_id
        assert Decimal(allocs[0].amount) == Decimal("1500.00")
    finally:
        db.close()


def test_manual_match_creates_allocation():
    """POST .../match/{tenant_id} writes an allocation alongside matched_tenant_id."""
    building_id = _new_building()
    tenant_id = _new_tenant(building_id, full_name="פלוני אלמוני")

    # Upload a row that won't auto-match (different name)
    excel = _make_bank_excel([
        {"date": datetime(2026, 2, 5),
         "description": "העברה - שם שונה לגמרי",
         "credit": 800.0,
         "balance": 5000.0},
    ])
    _upload(building_id, excel)

    db = SessionLocal()
    try:
        txn = db.query(Transaction).filter(
            Transaction.credit_amount == Decimal("800.00"),
            Transaction.matched_tenant_id.is_(None),
        ).first()
        assert txn is not None, "Transaction should be unmatched after upload"
    finally:
        db.close()

    r = client.post(
        f"/api/v1/statements/transactions/{txn.id}/match/{tenant_id}"
    )
    assert r.status_code == 200, r.json()

    allocs = _allocations_for(str(txn.id))
    assert len(allocs) == 1
    assert str(allocs[0].tenant_id) == tenant_id
    assert Decimal(allocs[0].amount) == Decimal("800.00")


def test_unmatch_clears_allocation():
    """POST .../unmatch removes the allocation alongside clearing matched_tenant_id."""
    building_id = _new_building()
    tenant_id = _new_tenant(building_id, full_name="דני לוי")

    excel = _make_bank_excel([
        {"date": datetime(2026, 3, 10),
         "description": "העברה - דני לוי",
         "credit": 1500.0,
         "balance": 10000.0},
    ])
    _upload(building_id, excel)

    db = SessionLocal()
    try:
        txn = db.query(Transaction).filter(
            Transaction.matched_tenant_id == uuid.UUID(tenant_id)
        ).first()
        assert txn is not None
        txn_id = str(txn.id)
    finally:
        db.close()

    assert len(_allocations_for(txn_id)) == 1, "Pre-condition: allocation exists"

    r = client.post(f"/api/v1/statements/transactions/{txn_id}/unmatch")
    assert r.status_code == 200

    assert len(_allocations_for(txn_id)) == 0, "Allocations cleared after unmatch"


def test_delete_transaction_cascades_allocations():
    """DELETE .../transactions/{id} removes the allocation via FK cascade."""
    building_id = _new_building()
    tenant_id = _new_tenant(building_id, full_name="דני לוי")

    excel = _make_bank_excel([
        {"date": datetime(2026, 4, 1),
         "description": "העברה - דני לוי",
         "credit": 1500.0,
         "balance": 10000.0},
    ])
    _upload(building_id, excel)

    db = SessionLocal()
    try:
        txn = db.query(Transaction).filter(
            Transaction.matched_tenant_id == uuid.UUID(tenant_id)
        ).first()
        assert txn is not None
        txn_id = str(txn.id)
    finally:
        db.close()

    assert len(_allocations_for(txn_id)) == 1

    r = client.delete(f"/api/v1/statements/transactions/{txn_id}")
    assert r.status_code == 204

    assert len(_allocations_for(txn_id)) == 0, "Allocation should cascade-delete"


# ── Service-level unit tests ─────────────────────────────────────────────────

def test_upsert_is_idempotent():
    """Calling upsert twice with the same tenant produces exactly one allocation,
    not two — so re-confirming an existing match doesn't accumulate rows."""
    building_id = _new_building()
    tenant_id = _new_tenant(building_id, full_name="דני לוי")

    excel = _make_bank_excel([
        {"date": datetime(2026, 5, 1),
         "description": "העברה - דני לוי",
         "credit": 1500.0,
         "balance": 10000.0},
    ])
    _upload(building_id, excel)

    db = SessionLocal()
    try:
        txn = db.query(Transaction).filter(
            Transaction.matched_tenant_id == uuid.UUID(tenant_id)
        ).first()
        # First upsert was during upload; call it again manually
        allocation_service.upsert_single_tenant_allocation(
            db=db, transaction=txn, tenant_id=uuid.UUID(tenant_id)
        )
        db.commit()

        allocs = _allocations_for(str(txn.id))
        assert len(allocs) == 1, "Upsert must replace, not accumulate"
    finally:
        db.close()


def test_validate_sum_matches_amount_within_tolerance():
    """Service-level validation accepts allocations that sum to the headline
    amount within ±0.01 (1 agora)."""
    txn = Transaction(
        id=uuid.uuid4(),
        activity_date=datetime(2026, 6, 1),
        description="test",
        credit_amount=Decimal("1000.00"),
    )

    # Exact match
    assert allocation_service.validate_sum_matches_amount(
        txn, [{"amount": Decimal("400.00")}, {"amount": Decimal("600.00")}]
    )
    # Off by 0.005 — should still pass under default 0.01 tolerance
    assert allocation_service.validate_sum_matches_amount(
        txn, [{"amount": Decimal("400.005")}, {"amount": Decimal("599.995")}]
    )
    # Off by 0.05 — should fail
    assert not allocation_service.validate_sum_matches_amount(
        txn, [{"amount": Decimal("400.00")}, {"amount": Decimal("600.05")}]
    )


def test_review_endpoint_excludes_label_only_confirmed_from_unmatched():
    """A confirmed non-tenant labeled allocation (matched_tenant_id IS NULL,
    is_confirmed=True, one label-only allocation) MUST NOT appear in the
    `unmatched` bucket of the review endpoint — otherwise the user can
    accidentally assign it to a tenant from the upload-review modal,
    overwriting their label allocation (the "double match" bug).

    It SHOULD appear in `matched` so the user sees the result of their action.
    """
    building_id = _new_building()

    excel = _make_bank_excel([
        {"date": datetime(2026, 7, 5),
         "description": "בזק החב' הישראלית",   # non-tenant payer name
         "credit": 454.32,
         "balance": 10000.0},
    ])
    upload_res = _upload(building_id, excel)
    statement_id = upload_res["statement_id"]

    # Find the transaction id
    db = SessionLocal()
    try:
        txn = (
            db.query(Transaction)
            .filter(Transaction.statement_id == uuid.UUID(statement_id))
            .first()
        )
        assert txn is not None
        transaction_id = str(txn.id)
    finally:
        db.close()

    # Apply a label-only (non-tenant) allocation via the same endpoint the
    # AllocationDrawer "non-tenant" mode uses.
    r = client.post(
        f"/api/v1/statements/transactions/{transaction_id}/allocations",
        json={"allocations": [{"label": "החזר חשמל", "amount": 454.32}]},
    )
    assert r.status_code == 200, r.json()

    review = client.get(f"/api/v1/statements/{statement_id}/review").json()

    unmatched_ids = {t["id"] for t in review["unmatched"]}
    matched_ids = {t["id"] for t in review["matched"]}

    assert transaction_id not in unmatched_ids, (
        "Confirmed label-only allocation must NOT appear in `unmatched` — "
        "doing so lets the user double-match it from the review modal."
    )
    assert transaction_id in matched_ids, (
        "Confirmed label-only allocation should be surfaced in `matched` so "
        "the user gets visible feedback after labeling."
    )

    # The surfaced row should expose the label so the UI can render it.
    matched_row = next(t for t in review["matched"] if t["id"] == transaction_id)
    allocs = matched_row.get("allocations") or []
    assert any(a.get("label") == "החזר חשמל" for a in allocs)


def test_review_endpoint_excludes_confirmed_split_from_unmatched():
    """A confirmed multi-tenant split (matched_tenant_id IS NULL by PR-3
    invariant, is_confirmed=True, 2+ tenant allocations) must not appear in
    `unmatched` — same double-match risk as the label-only case."""
    building_id = _new_building()
    t1 = _new_tenant(building_id, full_name="דני לוי")
    t2 = _new_tenant(building_id, full_name="רונית כהן")

    excel = _make_bank_excel([
        {"date": datetime(2026, 7, 5),
         "description": "תשלום משותף",
         "credit": 1000.0,
         "balance": 10000.0},
    ])
    upload_res = _upload(building_id, excel)
    statement_id = upload_res["statement_id"]

    db = SessionLocal()
    try:
        txn = db.query(Transaction).filter(
            Transaction.statement_id == uuid.UUID(statement_id)
        ).first()
        transaction_id = str(txn.id)
    finally:
        db.close()

    r = client.post(
        f"/api/v1/statements/transactions/{transaction_id}/allocations",
        json={"allocations": [
            {"tenant_id": t1, "amount": 600.0},
            {"tenant_id": t2, "amount": 400.0},
        ]},
    )
    assert r.status_code == 200, r.json()

    review = client.get(f"/api/v1/statements/{statement_id}/review").json()
    unmatched_ids = {t["id"] for t in review["unmatched"]}
    matched_ids = {t["id"] for t in review["matched"]}

    assert transaction_id not in unmatched_ids
    assert transaction_id in matched_ids


def test_review_endpoint_returns_allocations():
    """getStatementReview includes allocations[] on matched rows so PR-3 can
    render splits without an additional API call."""
    building_id = _new_building()
    tenant_id = _new_tenant(building_id, full_name="דני לוי")

    excel = _make_bank_excel([
        {"date": datetime(2026, 7, 12),
         "description": "העברה - דני לוי",
         "credit": 1500.0,
         "balance": 10000.0},
    ])
    upload_res = _upload(building_id, excel)
    statement_id = upload_res["statement_id"]

    r = client.get(f"/api/v1/statements/{statement_id}/review")
    assert r.status_code == 200, r.json()

    matched = r.json()["matched"]
    assert len(matched) >= 1
    row = matched[0]
    assert "allocations" in row
    assert isinstance(row["allocations"], list)
    assert len(row["allocations"]) == 1
    alloc = row["allocations"][0]
    assert alloc["tenant_id"] == tenant_id
    assert alloc["amount"] == 1500.0


# ── PR-3: set_split_allocations service tests ────────────────────────────────

def _bare_transaction(credit: float = 2000.0) -> tuple[Transaction, SessionLocal]:
    """Create a minimal (unmatched) transaction directly in the DB and return it
    along with an open session. Caller must close the session."""
    building_id = _new_building()
    db = SessionLocal()
    stmt = BankStatement(
        building_id=uuid.UUID(building_id),
        period_month=3,
        period_year=2026,
        original_filename="test.xlsx",
    )
    db.add(stmt)
    db.flush()

    from app.models import TransactionType as TT
    txn = Transaction(
        statement_id=stmt.id,
        activity_date=datetime(2026, 3, 1),
        description="test split",
        credit_amount=Decimal(str(credit)),
        transaction_type=TT.PAYMENT,
    )
    db.add(txn)
    db.commit()
    db.refresh(txn)
    return txn, db


def test_set_split_allocations_two_tenants():
    """set_split_allocations for 2 tenants creates 2 rows and sets
    matched_tenant_id = NULL (multiple allocations → no single match)."""
    building_id = _new_building()
    t1 = _new_tenant(building_id, full_name="אבי כהן")
    t2 = _new_tenant(building_id, full_name="דנה לוי")

    txn, db = _bare_transaction(credit=2000.0)
    try:
        created = allocation_service.set_split_allocations(
            db=db,
            transaction=txn,
            allocations=[
                {"tenant_id": uuid.UUID(t1), "amount": Decimal("1200.00")},
                {"tenant_id": uuid.UUID(t2), "amount": Decimal("800.00")},
            ],
        )
        db.commit()
        db.refresh(txn)

        assert len(created) == 2
        amounts = {str(a.tenant_id): float(a.amount) for a in created}
        assert amounts[t1] == 1200.0
        assert amounts[t2] == 800.0
        # PR-3 invariant: multiple allocations → matched_tenant_id is NULL
        assert txn.matched_tenant_id is None
    finally:
        db.close()


def test_set_split_allocations_single_tenant_sets_matched_tenant_id():
    """A single full-amount tenant allocation should still set matched_tenant_id."""
    building_id = _new_building()
    t1 = _new_tenant(building_id, full_name="אבי כהן")

    txn, db = _bare_transaction(credit=1500.0)
    try:
        allocation_service.set_split_allocations(
            db=db,
            transaction=txn,
            allocations=[{"tenant_id": uuid.UUID(t1), "amount": Decimal("1500.00")}],
        )
        db.commit()
        db.refresh(txn)

        assert str(txn.matched_tenant_id) == t1
    finally:
        db.close()


def test_set_split_allocations_multi_month():
    """One tenant, three billing periods: creates 3 rows, matched_tenant_id = NULL."""
    building_id = _new_building()
    t1 = _new_tenant(building_id, full_name="שרה מזרחי")

    txn, db = _bare_transaction(credit=3000.0)
    try:
        created = allocation_service.set_split_allocations(
            db=db,
            transaction=txn,
            allocations=[
                {"tenant_id": uuid.UUID(t1), "amount": Decimal("1000.00"), "period_month": 1, "period_year": 2026},
                {"tenant_id": uuid.UUID(t1), "amount": Decimal("1000.00"), "period_month": 2, "period_year": 2026},
                {"tenant_id": uuid.UUID(t1), "amount": Decimal("1000.00"), "period_month": 3, "period_year": 2026},
            ],
        )
        db.commit()
        db.refresh(txn)

        assert len(created) == 3
        # Periods are stored on the joined ApartmentPeriodDebt row (Phase 6b).
        periods = [
            (a.apartment_period_debt.month, a.apartment_period_debt.year)
            for a in created
        ]
        assert (1, 2026) in periods
        assert (2, 2026) in periods
        assert (3, 2026) in periods
        # Multiple allocations even for same tenant → matched_tenant_id NULL
        assert txn.matched_tenant_id is None
    finally:
        db.close()


def test_set_split_allocations_non_tenant_label():
    """A label-only (non-tenant) allocation is saved and matched_tenant_id = NULL."""
    txn, db = _bare_transaction(credit=500.0)
    try:
        created = allocation_service.set_split_allocations(
            db=db,
            transaction=txn,
            allocations=[{"label": "החזר ביטוח", "amount": Decimal("500.00")}],
        )
        db.commit()
        db.refresh(txn)

        assert len(created) == 1
        assert created[0].tenant_id is None
        assert created[0].label == "החזר ביטוח"
        assert txn.matched_tenant_id is None
    finally:
        db.close()


def test_set_split_allocations_rejects_sum_mismatch():
    """set_split_allocations raises ValueError when allocation sum ≠ headline."""
    txn, db = _bare_transaction(credit=2000.0)
    try:
        with pytest.raises(ValueError, match="does not match"):
            allocation_service.set_split_allocations(
                db=db,
                transaction=txn,
                allocations=[
                    {"label": "תשלום", "amount": Decimal("1500.00")},
                ],
            )
    finally:
        db.close()


def test_set_split_allocations_rejects_missing_target():
    """An allocation with neither tenant_id nor label must be rejected."""
    txn, db = _bare_transaction(credit=1000.0)
    try:
        with pytest.raises(ValueError, match="tenant_id or label"):
            allocation_service.set_split_allocations(
                db=db,
                transaction=txn,
                allocations=[{"amount": Decimal("1000.00")}],
            )
    finally:
        db.close()


def test_set_allocations_endpoint_split():
    """POST /transactions/{id}/allocations with 2 tenants returns 200 and the
    payment-status endpoint reflects the split amounts per tenant."""
    building_id = _new_building()
    t1 = _new_tenant(building_id, full_name="אבי כהן")
    t2 = _new_tenant(building_id, full_name="דנה לוי")

    excel = _make_bank_excel([
        {"date": datetime(2026, 3, 5),
         "description": "העברה - מישהו אחר",
         "credit": 2000.0,
         "balance": 30000.0},
    ])
    upload_res = _upload(building_id, excel)
    statement_id = upload_res["statement_id"]

    # Get the unmatched transaction (scoped to this statement to avoid cross-test contamination)
    db = SessionLocal()
    try:
        txn = db.query(Transaction).filter(
            Transaction.statement_id == statement_id,
            Transaction.credit_amount == Decimal("2000.00"),
        ).first()
        assert txn is not None, "Transaction should exist after upload"
        txn_id = str(txn.id)
    finally:
        db.close()

    # Set split allocations via API
    r = client.post(
        f"/api/v1/statements/transactions/{txn_id}/allocations",
        json={"allocations": [
            {"tenant_id": t1, "amount": 1200.0, "period_month": 3, "period_year": 2026},
            {"tenant_id": t2, "amount": 800.0, "period_month": 3, "period_year": 2026},
        ]},
    )
    assert r.status_code == 200, r.json()
    rows = r.json()
    assert len(rows) == 2

    # Verify payment status reflects the split
    r2 = client.get(f"/api/v1/payments/{building_id}/status?month=3&year=2026")
    assert r2.status_code == 200, r2.json()
    tenants_status = {t["tenant_id"]: t for t in r2.json()["tenants"]}

    assert tenants_status[t1]["paid_amount"] == pytest.approx(1200.0, abs=0.01)
    assert tenants_status[t2]["paid_amount"] == pytest.approx(800.0, abs=0.01)


# ── PR-4: Expense classification tests ───────────────────────────────────────

def _get_transactions_for_building(building_id: str) -> list[Transaction]:
    db = SessionLocal()
    try:
        from app.models import BankStatement as BS
        stmt_ids = [s.id for s in db.query(BS).filter(BS.building_id == uuid.UUID(building_id)).all()]
        return db.query(Transaction).filter(Transaction.statement_id.in_(stmt_ids)).all()
    finally:
        db.close()


def _get_expense_allocations(building_id: str) -> list[TransactionAllocation]:
    db = SessionLocal()
    try:
        from app.models import BankStatement as BS
        stmt_ids = [s.id for s in db.query(BS).filter(BS.building_id == uuid.UUID(building_id)).all()]
        txn_ids = [
            t.id for t in db.query(Transaction)
            .filter(Transaction.statement_id.in_(stmt_ids))
            .all()
        ]
        return (
            db.query(TransactionAllocation)
            .filter(
                TransactionAllocation.transaction_id.in_(txn_ids),
                TransactionAllocation.tenant_id == None,
                TransactionAllocation.category != None,
            )
            .all()
        )
    finally:
        db.close()


def _get_vendor_mappings(building_id: str) -> list[VendorMapping]:
    db = SessionLocal()
    try:
        return db.query(VendorMapping).filter(
            VendorMapping.building_id == uuid.UUID(building_id)
        ).all()
    finally:
        db.close()


class TestExpenseClassification:
    """
    PR-4: Upload debit rows → expense allocations with correct categories.
    Manual categorize endpoints: remember=True/False.
    Categorize then un-categorize round-trip.
    """

    def test_upload_debit_rows_classified(self):
        """
        Debit rows with known vendors should auto-create expense allocations.
        """
        building_id = _new_building()
        buf = _make_bank_excel([
            # Known vendor (חברת חשמל → routine_maintenance)
            {'date': '01/01/2026', 'description': 'חברת חשמל ינואר 2026', 'debit': 2400, 'balance': 50000},
            # Known vendor (שינדלר → technical_maintenance)
            {'date': '05/01/2026', 'description': 'שינדלר מעליות שירות', 'debit': 950, 'balance': 49050},
            # Unknown vendor — no allocation should be created
            {'date': '10/01/2026', 'description': 'העברה בנקאית לא ידועה', 'debit': 500, 'balance': 48550},
        ])
        _upload(building_id, buf)

        allocs = _get_expense_allocations(building_id)
        categories = {a.category for a in allocs}

        assert 'routine_maintenance' in categories, "חשמל should map to routine_maintenance"
        assert 'technical_maintenance' in categories, "שינדלר should map to technical_maintenance"
        # The unknown vendor should NOT produce an allocation
        assert len(allocs) == 2, f"Expected 2 expense allocations, got {len(allocs)}"

    def test_manual_categorize_with_remember_creates_mapping(self):
        """
        POST /transactions/{id}/categorize with remember=True should create a VendorMapping.
        """
        building_id = _new_building()
        buf = _make_bank_excel([
            {'date': '01/01/2026', 'description': 'ספק לא ידוע מיוחד', 'debit': 1000, 'balance': 50000},
        ])
        _upload(building_id, buf)

        txns = _get_transactions_for_building(building_id)
        debit_txn = next(
            (t for t in txns if t.debit_amount and t.debit_amount > 0), None
        )
        assert debit_txn is not None, "Expected a debit transaction"

        r = client.post(
            f"/api/v1/transactions/{debit_txn.id}/categorize",
            json={"vendor_label": "ספק מיוחד", "category": "administrative", "remember": True},
        )
        assert r.status_code == 200, r.json()
        assert r.json()["category"] == "administrative"

        mappings = _get_vendor_mappings(building_id)
        assert len(mappings) == 1
        assert mappings[0].keyword == "ספק מיוחד"
        assert mappings[0].category == "administrative"

    def test_manual_categorize_without_remember_no_mapping(self):
        """
        POST /transactions/{id}/categorize with remember=False must NOT create a VendorMapping.
        """
        building_id = _new_building()
        buf = _make_bank_excel([
            {'date': '01/01/2026', 'description': 'ספק ללא זיכרון', 'debit': 800, 'balance': 50000},
        ])
        _upload(building_id, buf)

        txns = _get_transactions_for_building(building_id)
        debit_txn = next((t for t in txns if t.debit_amount and t.debit_amount > 0), None)
        assert debit_txn is not None

        r = client.post(
            f"/api/v1/transactions/{debit_txn.id}/categorize",
            json={"vendor_label": "ספק ללא זיכרון", "category": "extraordinary", "remember": False},
        )
        assert r.status_code == 200, r.json()

        mappings = _get_vendor_mappings(building_id)
        assert len(mappings) == 0, "remember=False must not create a VendorMapping"

    def test_remember_mapping_picked_up_on_next_upload(self):
        """
        A saved VendorMapping should auto-classify the same vendor on the next upload.
        """
        building_id = _new_building()
        # First upload: unknown vendor → uncategorized
        buf1 = _make_bank_excel([
            {'date': '01/01/2026', 'description': 'חברת ניהול מיוחדת', 'debit': 500, 'balance': 50000},
        ])
        _upload(building_id, buf1)

        txns = _get_transactions_for_building(building_id)
        debit_txn = next((t for t in txns if t.debit_amount and t.debit_amount > 0), None)
        assert debit_txn is not None

        # Manually categorize with remember=True
        r = client.post(
            f"/api/v1/transactions/{debit_txn.id}/categorize",
            json={"vendor_label": "חברת ניהול מיוחדת", "category": "administrative", "remember": True},
        )
        assert r.status_code == 200

        # Second upload: same vendor → should auto-classify
        buf2 = _make_bank_excel([
            {'date': '01/02/2026', 'description': 'חברת ניהול מיוחדת פברואר', 'debit': 500, 'balance': 49500},
        ])
        _upload(building_id, buf2)

        allocs = _get_expense_allocations(building_id)
        # Both transactions should now be categorised
        admin_allocs = [a for a in allocs if a.category == 'administrative']
        assert len(admin_allocs) >= 2, (
            f"Expected at least 2 administrative allocations after learned mapping, got {len(admin_allocs)}"
        )

    def test_categorize_then_uncategorize_round_trip(self):
        """
        POST categorize then DELETE categorize returns the row to uncategorized state.
        """
        building_id = _new_building()
        buf = _make_bank_excel([
            {'date': '01/01/2026', 'description': 'הוצאה שתוסר', 'debit': 700, 'balance': 50000},
        ])
        _upload(building_id, buf)

        txns = _get_transactions_for_building(building_id)
        debit_txn = next((t for t in txns if t.debit_amount and t.debit_amount > 0), None)
        assert debit_txn is not None

        # Categorize
        r = client.post(
            f"/api/v1/transactions/{debit_txn.id}/categorize",
            json={"vendor_label": "הוצאה זמנית", "category": "extraordinary", "remember": False},
        )
        assert r.status_code == 200
        alloc_id = r.json()["allocation_id"]
        assert alloc_id

        # Verify allocation exists
        db = SessionLocal()
        try:
            alloc = db.query(TransactionAllocation).filter(
                TransactionAllocation.id == uuid.UUID(alloc_id)
            ).first()
            assert alloc is not None
        finally:
            db.close()

        # Uncategorize
        r2 = client.delete(f"/api/v1/transactions/{debit_txn.id}/categorize")
        assert r2.status_code == 204

        # Verify allocation gone
        db = SessionLocal()
        try:
            alloc_after = db.query(TransactionAllocation).filter(
                TransactionAllocation.id == uuid.UUID(alloc_id)
            ).first()
            assert alloc_after is None, "Allocation should be deleted after uncategorize"
        finally:
            db.close()
