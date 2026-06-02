"""
Unit tests for app/services/vendor_classifier.py.

Tests the pure classify() function with:
- Static default rules (confidence 0.8)
- User-defined VendorMapping rules (confidence 1.0, beat static defaults)
- Longest-keyword-wins tie-breaking
- No false positives: "שמים" must NOT match "מים"
- Returns None for unrecognised descriptions
"""
import uuid
import pytest
from app.services.vendor_classifier import classify
from app.models.vendor_mapping import VendorMapping


def _mapping(keyword: str, vendor_label: str, category: str) -> VendorMapping:
    """Build an in-memory VendorMapping (not persisted)."""
    m = VendorMapping()
    m.id = uuid.uuid4()
    m.building_id = uuid.uuid4()
    m.keyword = keyword
    m.vendor_label = vendor_label
    m.category = category
    return m


# ── Static default rules ──────────────────────────────────────────────────────

def test_electric_company_long():
    result = classify("חברת החשמל תשלום ינואר 2026", [])
    assert result is not None
    assert result["category"] == "routine_maintenance"
    assert result["confidence"] == 0.8
    assert "חשמל" in result["vendor_label"]


def test_electric_company_short():
    result = classify("חברת חשמל 01/2026", [])
    assert result is not None
    assert result["category"] == "routine_maintenance"


def test_elevator_shingler():
    result = classify("שינדלר מעליות תשלום חודשי", [])
    assert result is not None
    assert result["category"] == "technical_maintenance"


def test_elevator_otis():
    result = classify("אוטיס מעלית שירות", [])
    assert result is not None
    assert result["category"] == "technical_maintenance"


def test_insurance():
    result = classify("ביטוח מבנה תשלום רבעוני", [])
    assert result is not None
    assert result["category"] == "administrative"


def test_cleaning():
    result = classify("שירותי ניקיון ינואר 2026", [])
    assert result is not None
    assert result["category"] == "routine_maintenance"


def test_waterproofing_extraordinary():
    result = classify("עבודות איטום גג", [])
    assert result is not None
    assert result["category"] == "extraordinary"


def test_no_match_returns_none():
    result = classify("העברה בנקאית לא ידועה", [])
    assert result is None


def test_no_false_positive_water_in_sky():
    """'שמים' must NOT match the 'מים' water keyword — token boundary check."""
    result = classify("שמים טובים", [])
    assert result is None


def test_no_false_positive_partial_word():
    """'ניקיונות' should NOT match 'ניקיון' — only exact token matching."""
    result = classify("ניקיונות רחוב כללי", [])
    # 'ניקיונות' is a different token from 'ניקיון'
    assert result is None


# ── User-defined mappings override static defaults ────────────────────────────

def test_user_mapping_beats_static():
    mappings = [_mapping("חשמל", "ספק חשמל מיוחד", "extraordinary")]
    result = classify("חברת חשמל ינואר", mappings)
    assert result is not None
    assert result["confidence"] == 1.0
    assert result["category"] == "extraordinary"
    assert result["vendor_label"] == "ספק חשמל מיוחד"


def test_user_mapping_longest_wins():
    """When two user rules match, the longer keyword should win."""
    mappings = [
        _mapping("ביטוח", "ביטוח כללי", "administrative"),
        _mapping("ביטוח מבנה", "ביטוח המבנה הספציפי", "extraordinary"),
    ]
    result = classify("ביטוח מבנה תשלום", mappings)
    assert result is not None
    assert result["vendor_label"] == "ביטוח המבנה הספציפי"
    assert result["category"] == "extraordinary"


def test_user_mapping_no_match_falls_through_to_static():
    mappings = [_mapping("קפה", "בית קפה", "administrative")]
    result = classify("חברת חשמל ינואר 2026", mappings)
    assert result is not None
    assert result["confidence"] == 0.8  # fell through to static
    assert result["category"] == "routine_maintenance"


def test_empty_description_returns_none():
    result = classify("", [])
    assert result is None


def test_multi_token_keyword_match():
    """A multi-word user keyword must have ALL tokens present."""
    mappings = [_mapping("חברת החשמל", "חשמל ישראל", "routine_maintenance")]
    # Both tokens 'חברת' and 'החשמל' present → match
    assert classify("חברת החשמל 2026", mappings) is not None
    # Only 'חברת' present, 'החשמל' missing → no match from this rule
    result_partial = classify("חברת ניקיון", mappings)
    # May match static 'ניקיון' rule but NOT the user mapping
    if result_partial:
        assert result_partial["confidence"] != 1.0 or result_partial["vendor_label"] != "חשמל ישראל"
