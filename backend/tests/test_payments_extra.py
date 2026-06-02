"""
Stage 1 acceptance tests — the three new/patched payments endpoints.

Covers:
- bulk-summary: now returns `total_expected`
- portfolio-trend: returns N entries (oldest → newest)
- summary-stats: returns the full KPI/trend/expenses/aging/worst-payers shape

Tests follow the pattern in test_allocations.py — TestClient against the
configured DB, direct ORM inserts for fixtures.
"""
from __future__ import annotations

import random
import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional

from fastapi.testclient import TestClient

from app.main import app
from app.database import SessionLocal
from app.models import (
    Apartment,
    BankStatement,
    Tenant,
    Transaction,
    TransactionAllocation,
    TransactionType,
)


client = TestClient(app)


# ── Fixtures ────────────────────────────────────────────────────────────────

def _new_building(expected: float = 200.0) -> str:
    name = f"Test Building {uuid.uuid4().hex[:8]}"
    r = client.post(
        "/api/v1/buildings/",
        json={"name": name, "address": "1 Test St", "city": "TLV",
              "expected_monthly_payment": expected},
    )
    assert r.status_code == 201, r.json()
    return r.json()["id"]


def _new_apt_tenant(
    building_id: str, expected_payment: Optional[float] = None
) -> tuple[str, str]:
    db = SessionLocal()
    try:
        apt = Apartment(
            building_id=uuid.UUID(building_id),
            number=random.randint(100, 9999),
            floor=1,
            expected_payment=Decimal(str(expected_payment)) if expected_payment else None,
        )
        db.add(apt)
        db.flush()
        t = Tenant(
            apartment_id=apt.id,
            building_id=uuid.UUID(building_id),
            name="Test",
            full_name="Test Tenant",
            move_in_date=date(2025, 1, 1),
        )
        db.add(t)
        db.commit()
        return str(apt.id), str(t.id)
    finally:
        db.close()


def _allocate_payment(
    building_id: str,
    tenant_id: str,
    amount: float,
    period_year: int,
    period_month: int,
    activity_date: Optional[datetime] = None,
) -> None:
    """Create a BankStatement + Transaction + TransactionAllocation directly."""
    db = SessionLocal()
    try:
        stmt = BankStatement(
            building_id=uuid.UUID(building_id),
            period_month=period_month,
            period_year=period_year,
            original_filename=f"stmt_{uuid.uuid4().hex[:6]}.xlsx",
        )
        db.add(stmt)
        db.flush()

        tx = Transaction(
            statement_id=stmt.id,
            activity_date=activity_date or datetime(period_year, period_month, 5),
            description="Test payment",
            credit_amount=Decimal(str(amount)),
            transaction_type=TransactionType.PAYMENT,
            matched_tenant_id=uuid.UUID(tenant_id),
            is_confirmed=True,
        )
        db.add(tx)
        db.flush()

        # Go through the service so apartment_period_debt_id is populated
        # (Phase 6b cutover — readers join on APD).
        from app.services.allocation_service import upsert_single_tenant_allocation
        upsert_single_tenant_allocation(
            db=db,
            transaction=tx,
            tenant_id=uuid.UUID(tenant_id),
            amount=Decimal(str(amount)),
            period_month=period_month,
            period_year=period_year,
        )
        db.commit()
    finally:
        db.close()


# ── Tests ───────────────────────────────────────────────────────────────────

def test_bulk_summary_returns_total_expected():
    """Acceptance: every row contains a numeric `total_expected` field."""
    bid = _new_building(expected=300.0)
    _new_apt_tenant(bid)  # active tenant with default expected = 300
    _new_apt_tenant(bid, expected_payment=500.0)  # apartment override
    # Expected total = 300 (default) + 500 (override) = 800

    now = datetime.now()
    r = client.get(
        f"/api/v1/payments/bulk-summary?month={now.month}&year={now.year}"
    )
    assert r.status_code == 200, r.json()
    rows = r.json()
    assert any(row["building_id"] == bid for row in rows), "new building missing from response"
    target = next(row for row in rows if row["building_id"] == bid)
    assert "total_expected" in target
    assert target["total_expected"] == 800.0


def test_portfolio_trend_returns_n_months():
    """Acceptance: response length matches `months` param; entries ordered oldest→newest."""
    r = client.get("/api/v1/payments/portfolio-trend?months=13")
    assert r.status_code == 200, r.json()
    body = r.json()
    assert len(body) == 13
    # Strictly ascending periods (YYYY-MM string comparison works).
    periods = [entry["period"] for entry in body]
    assert periods == sorted(periods)
    # Each entry has the expected shape.
    for entry in body:
        assert "month" in entry and "year" in entry
        assert "portfolio_collected" in entry
        assert "portfolio_expected" in entry
        assert isinstance(entry["buildings"], list)


def test_portfolio_trend_rejects_out_of_range():
    """Acceptance: months > 36 or < 1 returns 422."""
    r = client.get("/api/v1/payments/portfolio-trend?months=0")
    assert r.status_code == 422
    r = client.get("/api/v1/payments/portfolio-trend?months=37")
    assert r.status_code == 422


def test_portfolio_trend_includes_payment():
    """A confirmed payment in the period should show up in portfolio_collected."""
    bid = _new_building(expected=200.0)
    _, tid = _new_apt_tenant(bid)

    now = datetime.now()
    _allocate_payment(bid, tid, 200.0, now.year, now.month)

    r = client.get("/api/v1/payments/portfolio-trend?months=2")
    assert r.status_code == 200
    body = r.json()
    current = next(
        e for e in body if e["year"] == now.year and e["month"] == now.month
    )
    bldg = next((b for b in current["buildings"] if b["building_id"] == bid), None)
    assert bldg is not None
    assert bldg["collected"] >= 200.0
    assert bldg["expected"] >= 200.0


def test_summary_stats_basic_shape():
    """Acceptance: top-level keys + nested KPI keys present, trend length matches range."""
    bid = _new_building(expected=200.0)
    _, tid = _new_apt_tenant(bid)
    now = datetime.now()
    _allocate_payment(bid, tid, 200.0, now.year, now.month)

    from_p = f"{now.year:04d}-{now.month:02d}"
    to_p = from_p
    r = client.get(
        f"/api/v1/payments/{bid}/summary-stats?from={from_p}&to={to_p}"
    )
    assert r.status_code == 200, r.json()
    body = r.json()

    # Top-level keys
    for key in ("kpis", "trend", "expenses_by_category", "debt_aging", "worst_payers"):
        assert key in body, f"missing top-level key {key!r}"

    # KPI keys
    for key in ("avg_collection_rate", "open_ar", "avg_days_to_pay", "income", "expenses"):
        assert key in body["kpis"], f"missing KPI {key!r}"

    # Trend length == 1 month range = 1 entry
    assert len(body["trend"]) == 1
    assert body["trend"][0]["period"] == from_p

    # debt_aging keys
    for k in ("0-7", "8-30", "31-60", "60+", "unpaid"):
        assert k in body["debt_aging"]


def test_summary_stats_rejects_bad_range():
    """from > to should 422."""
    bid = _new_building()
    r = client.get(
        f"/api/v1/payments/{bid}/summary-stats?from=2026-06&to=2026-01"
    )
    assert r.status_code == 422


def test_summary_stats_rejects_oversized_range():
    """range > 24 months should 422."""
    bid = _new_building()
    r = client.get(
        f"/api/v1/payments/{bid}/summary-stats?from=2020-01&to=2026-01"
    )
    assert r.status_code == 422


# ── Overpayment surplus / soft-cover tests ──────────────────────────────────

def _new_apt_tenant_with_move_in(
    building_id: str,
    move_in: date,
    expected_payment: Optional[float] = None,
) -> tuple[str, str]:
    db = SessionLocal()
    try:
        apt = Apartment(
            building_id=uuid.UUID(building_id),
            number=random.randint(100, 9999),
            floor=1,
            expected_payment=Decimal(str(expected_payment)) if expected_payment else None,
        )
        db.add(apt)
        db.flush()
        t = Tenant(
            apartment_id=apt.id,
            building_id=uuid.UUID(building_id),
            name="Overpay",
            full_name="Overpay Tenant",
            move_in_date=move_in,
        )
        db.add(t)
        db.commit()
        return str(apt.id), str(t.id)
    finally:
        db.close()


def test_total_debt_nets_overpayment_surplus():
    """
    Tenant expected 270/month, moved in Jan 2026. Pays 1,100 allocated to May 2026.
    Status endpoint should report total_debt = max(0, 5*270 - 1100) = 250.
    Pre-fix this would have been 4*270 = 1080 (sum of Jan-Apr deficits).
    """
    bid = _new_building(expected=270.0)
    _, tid = _new_apt_tenant_with_move_in(bid, date(2026, 1, 1), expected_payment=270.0)
    _allocate_payment(bid, tid, 1100.0, 2026, 5)

    r = client.get(f"/api/v1/payments/{bid}/status?month=5&year=2026")
    assert r.status_code == 200, r.json()
    body = r.json()
    target = next(t for t in body["tenants"] if t["tenant_id"] == tid)
    assert target["total_debt"] == 250.0, f"expected 250.0, got {target['total_debt']}"


def test_total_debt_zero_when_overpayment_covers_everything():
    """1,400 payment fully covers 5*270=1,350 expected; total_debt clamps to 0."""
    bid = _new_building(expected=270.0)
    _, tid = _new_apt_tenant_with_move_in(bid, date(2026, 1, 1), expected_payment=270.0)
    _allocate_payment(bid, tid, 1400.0, 2026, 5)

    r = client.get(f"/api/v1/payments/{bid}/status?month=5&year=2026")
    assert r.status_code == 200, r.json()
    target = next(t for t in r.json()["tenants"] if t["tenant_id"] == tid)
    assert target["total_debt"] == 0.0


def test_tenant_history_full_soft_cover_from_overpayment():
    """
    Pay 1,100 in May (surplus 830). Jan/Feb/Mar are fully soft-covered, Apr
    partially (20 applied of 270 needed). May stays the source (no badge).
    Per-month status fields are not flipped.
    """
    bid = _new_building(expected=270.0)
    _, tid = _new_apt_tenant_with_move_in(bid, date(2026, 1, 1), expected_payment=270.0)
    _allocate_payment(bid, tid, 1100.0, 2026, 5)

    r = client.get(f"/api/v1/payments/tenant/{tid}/history")
    assert r.status_code == 200, r.json()
    months = {m["period"]: m for m in r.json()["months"]}

    for p in ("01/2026", "02/2026", "03/2026"):
        m = months[p]
        assert m["status"] == "unpaid", f"{p}: status should stay 'unpaid', got {m['status']}"
        assert m["soft_covered_by"] is not None and len(m["soft_covered_by"]) == 1
        assert m["soft_covered_fully"] is True
        assert m["soft_covered_by"][0]["source_period"] == "05/2026"
        assert m["soft_covered_by"][0]["applied"] == 270.0

    apr = months["04/2026"]
    assert apr["status"] == "unpaid"
    assert apr["soft_covered_by"] is not None
    assert apr["soft_covered_fully"] is False
    assert apr["soft_covered_by"][0]["applied"] == 20.0

    may = months["05/2026"]
    assert may["status"] == "paid"
    assert may["difference"] == 830.0
    assert not may.get("soft_covered_by")


def test_tenant_history_partial_soft_cover_stops_when_pool_empty():
    """
    Pay 700 in Apr (surplus 430). Jan fully covered (270), Feb partial (160),
    Mar gets nothing. Apr is the source.
    """
    bid = _new_building(expected=270.0)
    _, tid = _new_apt_tenant_with_move_in(bid, date(2026, 1, 1), expected_payment=270.0)
    _allocate_payment(bid, tid, 700.0, 2026, 4)

    r = client.get(f"/api/v1/payments/tenant/{tid}/history")
    assert r.status_code == 200, r.json()
    months = {m["period"]: m for m in r.json()["months"]}

    jan = months["01/2026"]
    assert jan["soft_covered_fully"] is True
    assert jan["soft_covered_by"][0]["applied"] == 270.0

    feb = months["02/2026"]
    assert feb["soft_covered_fully"] is False
    assert feb["soft_covered_by"][0]["applied"] == 160.0

    mar = months["03/2026"]
    assert not mar.get("soft_covered_by")

    apr = months["04/2026"]
    assert apr["difference"] == 430.0
    assert not apr.get("soft_covered_by")
