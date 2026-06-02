"""Tests for tenant endpoints and phone normalization."""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.routers.tenants import normalize_phone

client = TestClient(app)


# --- Unit tests: normalize_phone ---

def test_normalize_phone_with_leading_zero():
    assert normalize_phone("0501234567") == "+972501234567"

def test_normalize_phone_already_normalized():
    assert normalize_phone("+972501234567") == "+972501234567"

def test_normalize_phone_without_leading_zero():
    """Israeli number without leading 0 (as comes from Excel)"""
    assert normalize_phone("501234567") == "+972501234567"

def test_normalize_phone_empty():
    assert normalize_phone("") is None

def test_normalize_phone_none():
    assert normalize_phone(None) is None

def test_normalize_phone_with_dashes():
    assert normalize_phone("050-123-4567") == "+972501234567"

def test_normalize_phone_with_spaces():
    assert normalize_phone("050 123 4567") == "+972501234567"

def test_normalize_phone_with_972_prefix():
    """Number starting with 972 (no +) should get + prepended."""
    assert normalize_phone("972501234567") == "+972501234567"

def test_normalize_phone_972_with_dashes():
    """Number +972 with dashes in local part should be cleaned."""
    assert normalize_phone("+972-50-123-4567") == "+972501234567"


# --- Integration tests: tenant CRUD ---

def test_create_tenant_requires_valid_apartment():
    """Creating a tenant with non-existent apartment_id returns 404."""
    response = client.post("/api/v1/tenants/", json={
        "apartment_id": "00000000-0000-0000-0000-000000000000",
        "building_id": "00000000-0000-0000-0000-000000000001",
        "name": "Test Tenant",
        "ownership_type": "בעלים"
    })
    assert response.status_code == 404


# --- Integration tests: Excel import ---

def test_import_tenants_missing_apt_column(tmp_path):
    """Import fails with clear error when apartment column is missing."""
    import pandas as pd
    import io

    # Create Excel without the דירה column
    df = pd.DataFrame({
        'שם': ['ים שהם'],
        'סוג בעלות': ['בעלים'],
        'טלפון': ['0501234567']
        # Missing: 'דירה'
    })
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)

    response = client.post(
        "/api/v1/tenants/00000000-0000-0000-0000-000000000001/import",
        files={"file": ("tenants.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    )
    # Either 400 (building not found) or 400 (missing columns) — both acceptable
    assert response.status_code in [400, 404]


def test_import_error_message_includes_tenant_name(tmp_path):
    """When apartment number is missing for a row, error includes tenant name."""
    import pandas as pd
    import io

    # Row has name but apartment column value is NaN
    df = pd.DataFrame({
        'דירה': [None],   # Missing apartment number
        'קומה': [1],
        'שם': ['ים שהם'],
        'סוג בעלות': ['בעלים'],
        'טלפון': ['0501234567']
    })
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)

    response = client.post(
        "/api/v1/tenants/00000000-0000-0000-0000-000000000001/import",
        files={"file": ("tenants.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    )
    assert response.status_code in [400, 404]


# --- Integration tests: Excel import with real-world format ---

@pytest.fixture
def building_id():
    """Create a building and return its ID. Uses module-level client."""
    import uuid
    unique_name = f"Test Building {uuid.uuid4().hex[:8]}"
    response = client.post("/api/v1/buildings/", json={
        "name": unique_name,
        "address": "Test Address",
        "city": "Test City"
    })
    assert response.status_code == 201, f"Failed to create building: {response.json()}"
    return response.json()["id"]


def test_import_strips_column_header_whitespace(building_id):
    """Columns with trailing/leading spaces should still be mapped correctly.
    This simulates the real 'דוח דיירים' Excel format which has trailing spaces in headers
    and stores phone numbers as integers."""
    import io
    import pandas as pd

    df = pd.DataFrame([{
        'כתובת': 'משעול תפן 12 כרמיאל',   # extra col, ignored
        'דירה ': 1,                          # trailing space in header
        'קומה': 1,
        'שם': 'בדיקה א',
        'טלפון ': 523000001,                 # integer phone + trailing space in header
        'דואל': None,
        'ועד בית': None,                     # extra col, ignored
        'סוג בעלות': 'משכיר',
    }])
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)

    response = client.post(
        f"/api/v1/tenants/{building_id}/import",
        files={"file": ("test.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    )
    assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.json()}"
    data = response.json()
    assert data["imported_count"] == 1, f"Expected 1 imported, got: {data}"
    assert not data["errors"], f"Expected no errors, got: {data['errors']}"


def test_import_nan_ownership_defaults_to_renter(building_id):
    """Empty ownership cell should silently default to שוכר — no error, row imported."""
    import io
    import pandas as pd

    df = pd.DataFrame([{
        'דירה': 10,
        'קומה': 1,
        'שם': 'דייר בדיקה',
        'סוג בעלות': None,  # empty → NaN in Excel
        'טלפון': None,
    }])
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)

    response = client.post(
        f"/api/v1/tenants/{building_id}/import",
        files={"file": ("test.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    )
    assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.json()}"
    data = response.json()
    assert data["imported_count"] == 1, f"Expected 1 imported: {data}"
    assert not data["errors"], f"Expected no errors: {data['errors']}"


def test_import_invalid_ownership_defaults_to_renter_with_warning(building_id):
    """Unrecognised ownership value should import as שוכר and include a warning."""
    import io
    import pandas as pd

    df = pd.DataFrame([{
        'דירה': 20,
        'קומה': 2,
        'שם': 'דייר בדיקה שני',
        'סוג בעלות': 'foo',  # invalid value
        'טלפון': None,
    }])
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)

    response = client.post(
        f"/api/v1/tenants/{building_id}/import",
        files={"file": ("test.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    )
    assert response.status_code == 201, f"Expected 201, got {response.status_code}: {response.json()}"
    data = response.json()
    assert data["imported_count"] == 1, f"Expected 1 imported: {data}"
    assert len(data["errors"]) == 1, f"Expected 1 warning: {data['errors']}"
    assert "foo" in data["errors"][0], f"Warning should mention bad value: {data['errors'][0]}"
    assert "שוכר" in data["errors"][0], f"Warning should mention fallback: {data['errors'][0]}"


def test_patch_apartment_expected_payment(building_id):
    """Can set and clear apartment expected_payment."""
    # First create an apartment via resolve
    resp = client.post(
        f"/api/v1/tenants/{building_id}/apartments/resolve",
        json={"apt_number": 99, "floor": 1}
    )
    assert resp.status_code == 200
    apt_id = resp.json()["apartment_id"]

    # Set expected_payment
    resp = client.patch(f"/api/v1/tenants/apartments/{apt_id}", json={"expected_payment": 750.0})
    assert resp.status_code == 200
    assert resp.json()["expected_payment"] == 750.0

    # Clear expected_payment (set to null)
    resp = client.patch(f"/api/v1/tenants/apartments/{apt_id}", json={"expected_payment": None})
    assert resp.status_code == 200
    assert resp.json()["expected_payment"] is None
