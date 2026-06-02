"""Endpoint tests for /api/v1/imports/monthly-amounts/.

The endpoint accepts a multipart xlsx upload. We construct synthetic xlsx
files in tmp_path (via openpyxl) and POST them via the TestClient.
"""
from decimal import Decimal
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.database import SessionLocal
from app.main import app
from app.models.apartment import Apartment
from app.models.apartment_period_debt import ApartmentPeriodDebt
from app.models.building import Building


client = TestClient(app)


def _make_xlsx_bytes(rows: list[tuple]) -> bytes:
    """Build a tenants xlsx file matching the parser's expected shape and
    return its bytes.

    Headers (row 1): דירה, קומה, סיווג, שם, טלפון, גובה תשלום
    """
    wb = Workbook()
    ws = wb.active
    ws.append(['דירה', 'קומה', 'סיווג', 'שם', 'טלפון', 'גובה תשלום'])
    for row in rows:
        ws.append(list(row))
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture
def env():
    """Set up a building + 3 apartments + their starting expected_payments.
    Cleans up at teardown."""
    session = SessionLocal()
    import uuid as _uuid
    created = {"apartments": [], "buildings": [], "period_debts": []}

    b = Building(
        name=f"TEST_IMPORT_{_uuid.uuid4().hex[:8]}",
        address=f"{_uuid.uuid4().hex[:6]} st",
        city="Tel Aviv",
    )
    session.add(b)
    session.flush()
    created["buildings"].append(b.id)

    apts = []
    for i in (1, 2, 3):
        a = Apartment(
            building_id=b.id, number=i, floor=1,
            expected_payment=Decimal("100"),
        )
        session.add(a)
        session.flush()
        created["apartments"].append(a.id)
        apts.append(a)
    session.commit()

    yield {
        "session": session,
        "building": b,
        "apartments": apts,
        "created": created,
    }

    # Teardown
    for pd_id in created["period_debts"]:
        session.execute(
            ApartmentPeriodDebt.__table__.delete().where(ApartmentPeriodDebt.id == pd_id)
        )
    session.execute(
        ApartmentPeriodDebt.__table__.delete().where(
            ApartmentPeriodDebt.apartment_id.in_(created["apartments"])
        )
    )
    for aid in created["apartments"]:
        session.execute(Apartment.__table__.delete().where(Apartment.id == aid))
    for bid in created["buildings"]:
        session.execute(Building.__table__.delete().where(Building.id == bid))
    session.commit()
    session.close()


def test_dry_run_returns_preview_without_writes(env):
    """dry_run=true returns the preview; doesn't change expected_payment."""
    xlsx = _make_xlsx_bytes([
        (1.0, 1.0, 'בעלים', 'A', '0500000001', '500 ₪'),
        (2.0, 1.0, 'בעלים', 'B', '0500000002', '500 ₪'),
        (3.0, 1.0, 'בעלים', 'C', '0500000003', '100 ₪'),  # unchanged
    ])
    r = client.post(
        '/api/v1/imports/monthly-amounts/',
        data={'building_id': str(env['building'].id), 'dry_run': 'true', 'scope': 'future_only'},
        files={'file': ('test.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['dry_run'] is True
    assert body['matched_count'] == 3
    assert body['unmatched_count'] == 0
    assert body['update_count'] == 2  # apts 1 and 2 change; apt 3 stays
    statuses = {row['apartment_number']: row['status'] for row in body['rows']}
    assert statuses == {1: 'update', 2: 'update', 3: 'unchanged'}

    # No DB writes.
    env['session'].refresh(env['apartments'][0])
    assert env['apartments'][0].expected_payment == Decimal('100')


def test_unmatched_text_apartments(env):
    """Excel labels like 'מסחר 0' that aren't integer-parseable show as unmatched."""
    xlsx = _make_xlsx_bytes([
        (1.0, 1.0, 'בעלים', 'A', '0500000001', '500 ₪'),
        ('מסחר 0', 'קרקע', 'בעלים', 'Commercial', '0500000099', '900 ₪'),
    ])
    r = client.post(
        '/api/v1/imports/monthly-amounts/',
        data={'building_id': str(env['building'].id), 'dry_run': 'true', 'scope': 'future_only'},
        files={'file': ('test.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
    )
    body = r.json()
    assert body['matched_count'] == 1
    assert body['unmatched_count'] == 1
    unmatched = next(row for row in body['rows'] if row['status'] == 'unmatched')
    assert unmatched['apt_label'] == 'מסחר 0'
    assert unmatched['apartment_id'] is None


def test_future_only_updates_expected_payment(env):
    """future_only updates apartment.expected_payment but NOT existing
    period_debts."""
    # Pre-seed a period debt that should NOT be touched.
    apt1 = env['apartments'][0]
    pd = ApartmentPeriodDebt(
        apartment_id=apt1.id, year=2026, month=4,
        expected_amount=Decimal('100'),
    )
    env['session'].add(pd)
    env['session'].commit()
    env['created']['period_debts'].append(pd.id)

    xlsx = _make_xlsx_bytes([
        (1.0, 1.0, 'בעלים', 'A', '0500000001', '500 ₪'),
    ])
    r = client.post(
        '/api/v1/imports/monthly-amounts/',
        data={'building_id': str(env['building'].id), 'dry_run': 'false', 'scope': 'future_only'},
        files={'file': ('test.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body['apartments_updated'] == 1
    assert body['period_debts_updated'] == 0

    env['session'].refresh(apt1)
    env['session'].refresh(pd)
    assert apt1.expected_payment == Decimal('500')
    assert pd.expected_amount == Decimal('100')  # untouched


def test_all_unpaid_rewrites_unpaid_period_debts(env):
    """all_unpaid rewrites every period_debt that has no allocation."""
    apt1 = env['apartments'][0]
    pd1 = ApartmentPeriodDebt(
        apartment_id=apt1.id, year=2026, month=3,
        expected_amount=Decimal('100'),
    )
    pd2 = ApartmentPeriodDebt(
        apartment_id=apt1.id, year=2026, month=4,
        expected_amount=Decimal('100'),
    )
    env['session'].add_all([pd1, pd2])
    env['session'].commit()
    env['created']['period_debts'].extend([pd1.id, pd2.id])

    xlsx = _make_xlsx_bytes([
        (1.0, 1.0, 'בעלים', 'A', '0500000001', '500 ₪'),
    ])
    r = client.post(
        '/api/v1/imports/monthly-amounts/',
        data={'building_id': str(env['building'].id), 'dry_run': 'false', 'scope': 'all_unpaid'},
        files={'file': ('test.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
    )
    body = r.json()
    assert body['apartments_updated'] == 1
    assert body['period_debts_updated'] == 2

    env['session'].refresh(pd1)
    env['session'].refresh(pd2)
    assert pd1.expected_amount == Decimal('500')
    assert pd2.expected_amount == Decimal('500')


def test_rejects_non_xlsx_file(env):
    r = client.post(
        '/api/v1/imports/monthly-amounts/',
        data={'building_id': str(env['building'].id), 'dry_run': 'true', 'scope': 'future_only'},
        files={'file': ('test.txt', b'not an xlsx', 'text/plain')},
    )
    assert r.status_code == 400
    assert 'Excel' in r.json()['detail']


def test_unknown_building_404(env):
    import uuid as _uuid
    xlsx = _make_xlsx_bytes([
        (1.0, 1.0, 'בעלים', 'A', '0500000001', '500 ₪'),
    ])
    r = client.post(
        '/api/v1/imports/monthly-amounts/',
        data={'building_id': str(_uuid.uuid4()), 'dry_run': 'true', 'scope': 'future_only'},
        files={'file': ('test.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
    )
    assert r.status_code == 404


def test_invalid_scope_rejected(env):
    xlsx = _make_xlsx_bytes([
        (1.0, 1.0, 'בעלים', 'A', '0500000001', '500 ₪'),
    ])
    r = client.post(
        '/api/v1/imports/monthly-amounts/',
        data={'building_id': str(env['building'].id), 'dry_run': 'false', 'scope': 'invalid_scope'},
        files={'file': ('test.xlsx', xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
    )
    assert r.status_code == 400
    assert 'Unknown scope' in r.json()['detail']
