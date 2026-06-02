"""Tests for the tenants xlsx parser.

The parser extracts apartment + tenant data from a per-building xlsx file that
the user maintains by hand. Sheet shape (Hebrew headers in row 1):

    דירה | קומה | סיווג | שם | טלפון | גובה תשלום
    (apt)  (floor) (class)  (name) (phone) (amount)

An "apartment block" is one owner (בעלים) row followed by zero or more renter
(שוכר) rows where דירה/קומה/גובה תשלום are blank.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest
from openpyxl import Workbook

from app.services.tenants_xlsx_parser import (
    OWNER_CLASS,
    RENTER_CLASS,
    ParsedApartment,
    ParsedTenant,
    _normalize_apartment_label,
    _normalize_floor_label,
    _normalize_phone,
    _parse_amount,
    parse_monthly_amounts,
    parse_tenants_xlsx,
)


# ───────────────────────────────────────────────────────────────────
# Helpers — build synthetic xlsx files in-memory for each test
# ───────────────────────────────────────────────────────────────────

HEADER_ROW = ("דירה", "קומה", "סיווג", "שם", "טלפון", "גובה תשלום")


def _make_xlsx(tmp_path: Path, rows: list[tuple]) -> Path:
    """Build a minimal xlsx with the standard header + given data rows."""
    wb = Workbook()
    ws = wb.active
    ws.append(HEADER_ROW)
    for row in rows:
        ws.append(row)
    path = tmp_path / "tenants.xlsx"
    wb.save(path)
    return path


# ───────────────────────────────────────────────────────────────────
# Constants
# ───────────────────────────────────────────────────────────────────

def test_class_constants_match_excel_vocab():
    # The owner/renter strings in the Excel are exactly these.
    assert OWNER_CLASS == "בעלים"
    assert RENTER_CLASS == "שוכר"


# ───────────────────────────────────────────────────────────────────
# Apartment / floor label normalization
# ───────────────────────────────────────────────────────────────────

class TestNormalizeApartmentLabel:
    def test_float_with_integer_value_drops_decimal(self):
        assert _normalize_apartment_label(1.0) == "1"

    def test_integer_becomes_string(self):
        assert _normalize_apartment_label(1) == "1"

    def test_text_label_preserved(self):
        assert _normalize_apartment_label("מסחר 0") == "מסחר 0"

    def test_float_with_decimal_kept(self):
        assert _normalize_apartment_label(1.5) == "1.5"

    def test_strips_whitespace(self):
        assert _normalize_apartment_label("  3  ") == "3"

    def test_empty_string_returns_none(self):
        assert _normalize_apartment_label("") is None

    def test_whitespace_only_returns_none(self):
        assert _normalize_apartment_label("   ") is None

    def test_none_returns_none(self):
        assert _normalize_apartment_label(None) is None


class TestNormalizeFloorLabel:
    """Same contract as apartment label."""

    def test_float_with_integer_value_drops_decimal(self):
        assert _normalize_floor_label(2.0) == "2"

    def test_text_label_preserved(self):
        assert _normalize_floor_label("קרקע") == "קרקע"

    def test_text_label_with_apostrophe_preserved(self):
        assert _normalize_floor_label("פנט' 6") == "פנט' 6"

    def test_none_returns_none(self):
        assert _normalize_floor_label(None) is None

    def test_empty_returns_none(self):
        assert _normalize_floor_label("") is None


# ───────────────────────────────────────────────────────────────────
# Phone normalization
# ───────────────────────────────────────────────────────────────────

class TestNormalizePhone:
    def test_float_zero_pads_to_ten_digits(self):
        # Excel strips leading zeros from numeric phones — must restore them.
        assert _normalize_phone(544445201.0) == "0544445201"

    def test_float_already_ten_digits_no_pad(self):
        # 0544445201 → typed in Excel as 544445201 (9 digits). Cover the
        # case where the float already has 10 digits (unusual but possible).
        assert _normalize_phone(1234567890.0) == "1234567890"

    def test_string_with_dashes_strips_separators(self):
        assert _normalize_phone("054-6766257") == "0546766257"

    def test_string_with_comma_separated_numbers_kept(self):
        # Two phones in one cell → preserve the comma-separator between them.
        assert _normalize_phone("0506246423, 0508584417") == "0506246423, 0508584417"

    def test_comma_separated_without_space(self):
        assert _normalize_phone("0506246423,0508584417") == "0506246423, 0508584417"

    def test_dashes_inside_each_of_comma_separated_numbers(self):
        assert _normalize_phone("054-622-3301, 050-1234567") == "0546223301, 0501234567"

    def test_none_returns_none(self):
        assert _normalize_phone(None) is None

    def test_empty_string_returns_none(self):
        assert _normalize_phone("") is None

    def test_whitespace_only_returns_none(self):
        assert _normalize_phone("   ") is None

    def test_int_padded(self):
        assert _normalize_phone(544445201) == "0544445201"


# ───────────────────────────────────────────────────────────────────
# Amount parsing
# ───────────────────────────────────────────────────────────────────

class TestParseAmount:
    def test_shekel_suffix_stripped(self):
        assert _parse_amount("461 ₪") == Decimal("461")

    def test_shekel_suffix_no_space(self):
        assert _parse_amount("461₪") == Decimal("461")

    def test_plain_string_number(self):
        assert _parse_amount("461") == Decimal("461")

    def test_int(self):
        assert _parse_amount(461) == Decimal("461")

    def test_float_with_decimal(self):
        assert _parse_amount(461.5) == Decimal("461.5")

    def test_none_returns_none(self):
        assert _parse_amount(None) is None

    def test_empty_string_returns_none(self):
        assert _parse_amount("") is None

    def test_whitespace_only_returns_none(self):
        assert _parse_amount("   ") is None


# ───────────────────────────────────────────────────────────────────
# Dataclass shapes
# ───────────────────────────────────────────────────────────────────

def test_parsed_tenant_round_trip():
    t = ParsedTenant(name="א", phone_raw="0501234567", classification=OWNER_CLASS)
    assert t.name == "א"
    assert t.phone_raw == "0501234567"
    assert t.classification == OWNER_CLASS


def test_parsed_apartment_default_renters_is_empty_list():
    apt = ParsedApartment(
        apartment_label="1",
        floor_label="1",
        monthly_amount=Decimal("461"),
        primary_tenant=ParsedTenant(
            name="א", phone_raw="0501234567", classification=OWNER_CLASS
        ),
    )
    assert apt.renters == []
    # Mutating one instance's renters must not leak to another (no shared default).
    apt.renters.append(
        ParsedTenant(name="ב", phone_raw=None, classification=RENTER_CLASS)
    )
    apt2 = ParsedApartment(
        apartment_label="2",
        floor_label="1",
        monthly_amount=Decimal("461"),
        primary_tenant=ParsedTenant(
            name="ג", phone_raw=None, classification=OWNER_CLASS
        ),
    )
    assert apt2.renters == []


# ───────────────────────────────────────────────────────────────────
# parse_tenants_xlsx — happy paths
# ───────────────────────────────────────────────────────────────────

class TestParseTenantsXlsx:
    def test_single_owner_no_renter(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [(1.0, 1.0, "בעלים", "ישראל ישראלי", "0501234567", "500 ₪")],
        )
        apts = parse_tenants_xlsx(path)

        assert len(apts) == 1
        apt = apts[0]
        assert apt == ParsedApartment(
            apartment_label="1",
            floor_label="1",
            monthly_amount=Decimal("500"),
            primary_tenant=ParsedTenant(
                name="ישראל ישראלי",
                phone_raw="0501234567",
                classification="בעלים",
            ),
            renters=[],
        )

    def test_owner_plus_one_renter(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [
                (2.0, 1.0, "בעלים", "אבי הבעלים", "0501111111", "461 ₪"),
                (None, None, "שוכר", "דני השוכר", "054-6766257", None),
            ],
        )
        apts = parse_tenants_xlsx(path)

        assert len(apts) == 1
        apt = apts[0]
        assert apt.apartment_label == "2"
        assert apt.floor_label == "1"
        assert apt.monthly_amount == Decimal("461")
        assert apt.primary_tenant.name == "אבי הבעלים"
        assert apt.primary_tenant.classification == "בעלים"
        assert len(apt.renters) == 1
        assert apt.renters[0] == ParsedTenant(
            name="דני השוכר",
            phone_raw="0546766257",
            classification="שוכר",
        )

    def test_owner_plus_two_renters(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [
                (3.0, 1.0, "בעלים", "בעלים אחד", "0500000001", "461 ₪"),
                (None, None, "שוכר", "שוכר א", "0500000002", None),
                (None, None, "שוכר", "שוכר ב", "0500000003", None),
            ],
        )
        apts = parse_tenants_xlsx(path)

        assert len(apts) == 1
        assert [r.name for r in apts[0].renters] == ["שוכר א", "שוכר ב"]
        assert all(r.classification == "שוכר" for r in apts[0].renters)

    def test_text_apartment_label(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [
                ("מסחר 0", "קרקע", "בעלים", "חברה בע\"מ", "0501234567", "640 ₪"),
                ("דירת גן 2", "קרקע", "בעלים", "תמיר פלג", 544445201.0, "461 ₪"),
            ],
        )
        apts = parse_tenants_xlsx(path)

        assert len(apts) == 2
        assert apts[0].apartment_label == "מסחר 0"
        assert apts[0].floor_label == "קרקע"
        assert apts[1].apartment_label == "דירת גן 2"
        assert apts[1].primary_tenant.phone_raw == "0544445201"

    def test_trailing_empty_rows_skipped(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [
                (1.0, 1.0, "בעלים", "בעלים יחיד", "0500000001", "461 ₪"),
                (None, None, None, None, None, None),
                (None, None, None, None, None, None),
                (None, None, None, None, None, None),
            ],
        )
        apts = parse_tenants_xlsx(path)
        assert len(apts) == 1
        assert apts[0].apartment_label == "1"

    def test_missing_payment_apartment_still_returned(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [(1.0, 1.0, "בעלים", "בעלים בלי תשלום", "0501234567", None)],
        )
        apts = parse_tenants_xlsx(path)
        assert len(apts) == 1
        assert apts[0].monthly_amount is None

    def test_phone_as_float_vs_string_vs_dashed(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [
                (1.0, 1.0, "בעלים", "א", 544445201.0, "100 ₪"),
                (2.0, 1.0, "בעלים", "ב", "0506246423, 0508584417", "100 ₪"),
                (3.0, 1.0, "בעלים", "ג", "054-6766257", "100 ₪"),
            ],
        )
        apts = parse_tenants_xlsx(path)
        assert apts[0].primary_tenant.phone_raw == "0544445201"
        assert apts[1].primary_tenant.phone_raw == "0506246423, 0508584417"
        assert apts[2].primary_tenant.phone_raw == "0546766257"

    def test_renter_phone_can_be_float_too(self, tmp_path: Path):
        # Real file row 25: renter with float phone.
        path = _make_xlsx(
            tmp_path,
            [
                (1.0, 1.0, "בעלים", "בעלים", "0501111111", "461 ₪"),
                (None, None, "שוכר", "שוכר", 507928844.0, None),
            ],
        )
        apts = parse_tenants_xlsx(path)
        assert apts[0].renters[0].phone_raw == "0507928844"

    def test_row_without_name_skipped(self, tmp_path: Path):
        # Renter row with no name → skip (corner case)
        path = _make_xlsx(
            tmp_path,
            [
                (1.0, 1.0, "בעלים", "בעלים", "0501111111", "461 ₪"),
                (None, None, "שוכר", None, "0501234567", None),
                (2.0, 1.0, "בעלים", "בעלים שני", "0502222222", "461 ₪"),
            ],
        )
        apts = parse_tenants_xlsx(path)
        assert len(apts) == 2
        assert apts[0].renters == []  # nameless renter dropped
        assert apts[1].apartment_label == "2"


# ───────────────────────────────────────────────────────────────────
# Malformed input
# ───────────────────────────────────────────────────────────────────

class TestMalformedInput:
    def test_renter_before_any_owner_raises(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [(None, None, "שוכר", "שוכר ללא בעלים", "0501234567", None)],
        )
        with pytest.raises(ValueError, match="Renter row before any owner row"):
            parse_tenants_xlsx(path)

    def test_apartment_set_but_classification_not_owner_raises(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [(1.0, 1.0, "שוכר", "שוכר עם מספר דירה", "0501234567", "461 ₪")],
        )
        with pytest.raises(ValueError):
            parse_tenants_xlsx(path)


# ───────────────────────────────────────────────────────────────────
# parse_monthly_amounts (convenience helper)
# ───────────────────────────────────────────────────────────────────

class TestParseMonthlyAmounts:
    def test_returns_apt_label_to_decimal(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [
                (1.0, 1.0, "בעלים", "א", "0500000001", "461 ₪"),
                (2.0, 1.0, "בעלים", "ב", "0500000002", "500 ₪"),
                ("מסחר 0", "קרקע", "בעלים", "ג", "0500000003", "640 ₪"),
            ],
        )
        amounts = parse_monthly_amounts(path)
        assert amounts == {
            "1": Decimal("461"),
            "2": Decimal("500"),
            "מסחר 0": Decimal("640"),
        }

    def test_skips_apartments_with_no_amount(self, tmp_path: Path):
        path = _make_xlsx(
            tmp_path,
            [
                (1.0, 1.0, "בעלים", "עם תשלום", "0500000001", "461 ₪"),
                (2.0, 1.0, "בעלים", "בלי תשלום", "0500000002", None),
            ],
        )
        amounts = parse_monthly_amounts(path)
        assert amounts == {"1": Decimal("461")}

    def test_renter_rows_dont_appear_in_result(self, tmp_path: Path):
        """The result is keyed by apartment, not by tenant — renters under an owner
        don't create extra entries."""
        path = _make_xlsx(
            tmp_path,
            [
                (1.0, 1.0, "בעלים", "בעלים", "0500000001", "461 ₪"),
                (None, None, "שוכר", "שוכר א", "0500000002", None),
                (None, None, "שוכר", "שוכר ב", "0500000003", None),
            ],
        )
        amounts = parse_monthly_amounts(path)
        assert len(amounts) == 1
        assert amounts["1"] == Decimal("461")
