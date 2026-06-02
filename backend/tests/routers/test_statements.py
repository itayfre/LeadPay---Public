"""Tests for the /api/v1/statements/* router family.

Covers the contract that every transaction-bearing endpoint must surface
`extended_description` so the frontend (Task 4-6) can render the Leumi-style
"תאור מורחב" column inline with the bank description.
"""
import uuid
from datetime import datetime

from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app
from app.models import BankStatement, Transaction, TransactionType


client = TestClient(app)


def _new_building() -> str:
    name = f"Test Building {uuid.uuid4().hex[:8]}"
    r = client.post("/api/v1/buildings/", json={
        "name": name, "address": "1 Test St", "city": "TLV"
    })
    assert r.status_code == 201, r.json()
    return r.json()["id"]


def _seed_statement_with_extended_desc(
    building_id: str,
    extended: str,
) -> tuple[str, str]:
    """Create a statement + one transaction with the given extended_description.

    Returns (statement_id, transaction_id).
    """
    db = SessionLocal()
    try:
        stmt = BankStatement(
            building_id=uuid.UUID(building_id),
            period_month=3,
            period_year=2026,
            original_filename="test.xlsx",
        )
        db.add(stmt)
        db.flush()

        txn = Transaction(
            statement_id=stmt.id,
            activity_date=datetime(2026, 3, 15),
            description="העברה - דני לוי",
            extended_description=extended,
            credit_amount=1500,
            transaction_type=TransactionType.PAYMENT,
        )
        db.add(txn)
        db.commit()
        return str(stmt.id), str(txn.id)
    finally:
        db.close()


def test_review_returns_extended_description():
    """The statement review payload must expose extended_description for the txn.

    The transaction is a credit (payment) with no matched tenant, so it lands
    in the `unmatched` bucket. Whichever bucket it lands in, the field must be
    present.
    """
    building_id = _new_building()
    extended = "תשלום שכ\"ד דירה 4 — מרץ 2026"
    statement_id, transaction_id = _seed_statement_with_extended_desc(
        building_id, extended,
    )

    r = client.get(f"/api/v1/statements/{statement_id}/review")
    assert r.status_code == 200, r.json()
    body = r.json()

    # Find our transaction across all three buckets.
    all_rows = body.get("matched", []) + body.get("unmatched", []) + body.get("expenses", [])
    row = next((x for x in all_rows if x["id"] == transaction_id), None)
    assert row is not None, (
        f"Transaction {transaction_id} not found in any bucket of /review response"
    )
    assert "extended_description" in row, (
        "Review payload row is missing the `extended_description` key — "
        "every transaction dict must include it (matched / unmatched / expenses)."
    )
    assert row["extended_description"] == extended


def test_review_form_returns_extended_description():
    """The single-transaction review-form endpoint must also surface the field."""
    building_id = _new_building()
    extended = "פרטים נוספים מהבנק"
    _, transaction_id = _seed_statement_with_extended_desc(building_id, extended)

    r = client.get(f"/api/v1/statements/transactions/{transaction_id}/review-form")
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["tx"].get("extended_description") == extended


def test_statement_transactions_returns_extended_description():
    """The /transactions sub-endpoint must surface the field on each row."""
    building_id = _new_building()
    extended = "extended payload"
    statement_id, transaction_id = _seed_statement_with_extended_desc(
        building_id, extended,
    )

    r = client.get(f"/api/v1/statements/{statement_id}/transactions")
    assert r.status_code == 200, r.json()
    body = r.json()
    row = next((x for x in body["transactions"] if x["id"] == transaction_id), None)
    assert row is not None
    assert row.get("extended_description") == extended


def test_global_transactions_list_returns_extended_description():
    """The cross-building /api/v1/transactions/ list endpoint must surface it too."""
    building_id = _new_building()
    extended = "global list extended"
    _, transaction_id = _seed_statement_with_extended_desc(building_id, extended)

    r = client.get(
        "/api/v1/transactions/",
        params={"building_id": building_id, "page_size": 200},
    )
    assert r.status_code == 200, r.json()
    body = r.json()
    row = next((x for x in body["items"] if x["id"] == transaction_id), None)
    assert row is not None
    assert row.get("extended_description") == extended
