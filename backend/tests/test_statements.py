"""Tests for Excel statement upload deduplication (fallback by date+amount+description)."""
import io
import uuid
from datetime import datetime

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _make_bank_excel(rows: list[dict]) -> io.BytesIO:
    """
    Build a minimal bank-statement Excel that the parser accepts.

    Each row dict has:
        date        datetime  — activity date
        description str       — Hebrew bank text (e.g. 'העברה - דני לוי')
        credit      float     — incoming amount (must be > 0 so parser marks as 'payment')
        balance     float     — account balance after transaction

    The אסמכתא (reference) column is intentionally omitted so the parser
    sets reference_number = '' for every row, exercising the fallback dedup path.
    """
    df = pd.DataFrame([
        {
            'תאריך פעילות': r['date'],
            'תאור פעולה': r['description'],
            'זכות': r['credit'],
            'יתרה': r['balance'],
        }
        for r in rows
    ])
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)
    return buf


def _new_building() -> str:
    """Create a unique building and return its ID."""
    name = f"Test Building {uuid.uuid4().hex[:8]}"
    r = client.post("/api/v1/buildings/", json={
        "name": name, "address": "1 Test St", "city": "TLV"
    })
    assert r.status_code == 201, r.json()
    return r.json()["id"]


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


# ---------------------------------------------------------------------------
# Test 1: same file re-uploaded → rows without ref_num are skipped
# ---------------------------------------------------------------------------

def test_dedup_fallback_skips_on_reupload():
    """Rows with no reference_number are skipped on re-upload by date+amount+description."""
    building_id = _new_building()
    rows = [
        {"date": datetime(2026, 1, 15), "description": "העברה - דני לוי",
         "credit": 1500.0, "balance": 10000.0},
    ]
    excel = _make_bank_excel(rows)

    r1 = _upload(building_id, excel)
    assert r1["skipped_duplicates"] == 0, "First upload should insert, not skip"

    r2 = _upload(building_id, excel)
    assert r2["skipped_duplicates"] == 1, "Second upload should skip the duplicate row"


# ---------------------------------------------------------------------------
# Test 2: same row uploaded to a DIFFERENT building → NOT skipped
# ---------------------------------------------------------------------------

def test_dedup_fallback_different_building_not_skipped():
    """Same row (no ref_num) uploaded to a different building is NOT skipped."""
    building_a = _new_building()
    building_b = _new_building()

    rows = [
        {"date": datetime(2026, 1, 20), "description": "העברה - משה כהן",
         "credit": 2000.0, "balance": 5000.0},
    ]
    excel = _make_bank_excel(rows)

    _upload(building_a, excel)

    r = _upload(building_b, excel)
    assert r["skipped_duplicates"] == 0, \
        "Row in a different building should not be considered a duplicate"


# ---------------------------------------------------------------------------
# Test 3: same date + description but DIFFERENT amount → NOT skipped
# ---------------------------------------------------------------------------

def test_dedup_fallback_different_amount_not_skipped():
    """Row with same date+description but different credit_amount is NOT skipped."""
    building_id = _new_building()

    row_a = [{"date": datetime(2026, 1, 10), "description": "העברה - רות ברק",
              "credit": 1000.0, "balance": 8000.0}]
    row_b = [{"date": datetime(2026, 1, 10), "description": "העברה - רות ברק",
              "credit": 1200.0, "balance": 8000.0}]

    _upload(building_id, _make_bank_excel(row_a))

    r = _upload(building_id, _make_bank_excel(row_b))
    assert r["skipped_duplicates"] == 0, \
        "Row with a different amount should not be considered a duplicate"
