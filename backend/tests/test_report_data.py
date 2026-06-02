"""
Unit tests for report_data pure-logic helpers.
No DB required for these tests — they exercise date/period math only.
"""
import datetime as dt
import pytest

from app.services.report_data import (
    _build_period,
    _period_label,
    _last_day_of_month,
    _col_key_for_period,
)


# ─── _last_day_of_month ───────────────────────────────────────────────────────

def test_last_day_jan():
    assert _last_day_of_month(dt.date(2026, 1, 15)) == dt.date(2026, 1, 31)

def test_last_day_feb_non_leap():
    assert _last_day_of_month(dt.date(2026, 2, 1)) == dt.date(2026, 2, 28)

def test_last_day_feb_leap():
    assert _last_day_of_month(dt.date(2024, 2, 1)) == dt.date(2024, 2, 29)

def test_last_day_dec():
    assert _last_day_of_month(dt.date(2026, 12, 1)) == dt.date(2026, 12, 31)


# ─── _period_label ────────────────────────────────────────────────────────────

def test_period_label_single_month():
    label = _period_label(dt.date(2026, 1, 1), dt.date(2026, 1, 31))
    assert label == "ינואר 2026"

def test_period_label_q1():
    label = _period_label(dt.date(2026, 1, 1), dt.date(2026, 3, 31))
    assert label == "רבעון א 2026"

def test_period_label_q2():
    label = _period_label(dt.date(2026, 4, 1), dt.date(2026, 6, 30))
    assert label == "רבעון ב 2026"

def test_period_label_q3():
    label = _period_label(dt.date(2026, 7, 1), dt.date(2026, 9, 30))
    assert label == "רבעון ג 2026"

def test_period_label_q4():
    label = _period_label(dt.date(2026, 10, 1), dt.date(2026, 12, 31))
    assert label == "רבעון ד 2026"

def test_period_label_full_year():
    label = _period_label(dt.date(2026, 1, 1), dt.date(2026, 12, 31))
    assert label == "2026"

def test_period_label_custom_unaligned():
    label = _period_label(dt.date(2026, 1, 15), dt.date(2026, 3, 20))
    assert label == "15.01.2026 – 20.03.2026"

def test_period_label_custom_6_months_not_year():
    label = _period_label(dt.date(2026, 2, 1), dt.date(2026, 7, 31))
    # Not a standard quarter/year — falls back to date range
    assert "2026" in label


# ─── _build_period columns ────────────────────────────────────────────────────

def test_build_period_3_months_monthly_columns():
    period = _build_period(dt.date(2026, 1, 1), dt.date(2026, 3, 31))
    assert period["granularity"] == "month"
    assert [c["label"] for c in period["columns"]] == ["ינואר", "פברואר", "מרץ"]
    assert [c["key"] for c in period["columns"]] == ["2026-01", "2026-02", "2026-03"]

def test_build_period_6_months_still_monthly():
    period = _build_period(dt.date(2026, 1, 1), dt.date(2026, 6, 30))
    assert period["granularity"] == "month"
    assert len(period["columns"]) == 6

def test_build_period_7_months_switches_to_quarterly():
    period = _build_period(dt.date(2026, 1, 1), dt.date(2026, 7, 31))
    assert period["granularity"] == "quarter"

def test_build_period_full_year_4_quarter_columns():
    period = _build_period(dt.date(2026, 1, 1), dt.date(2026, 12, 31))
    assert period["granularity"] == "quarter"
    assert len(period["columns"]) == 4
    assert [c["label"] for c in period["columns"]] == [
        "רבעון א", "רבעון ב", "רבעון ג", "רבעון ד"
    ]

def test_build_period_unaligned_snaps_columns_to_months():
    # Custom range mid-month — columns still month-aligned
    period = _build_period(dt.date(2026, 1, 15), dt.date(2026, 3, 20))
    assert period["granularity"] == "month"
    assert len(period["columns"]) == 3
    assert period["label"] == "15.01.2026 – 20.03.2026"

def test_build_period_label_and_granularity_full_year():
    period = _build_period(dt.date(2026, 1, 1), dt.date(2026, 12, 31))
    assert period["label"] == "2026"

def test_build_period_from_to_strings():
    period = _build_period(dt.date(2026, 1, 1), dt.date(2026, 3, 31))
    assert period["from"] == "2026-01"
    assert period["to"] == "2026-03"


# ─── _col_key_for_period ──────────────────────────────────────────────────────

def test_col_key_monthly():
    assert _col_key_for_period(2026, 1, "month") == "2026-01"
    assert _col_key_for_period(2026, 12, "month") == "2026-12"

def test_col_key_quarterly_q1():
    assert _col_key_for_period(2026, 1, "quarter") == "2026-Q1"
    assert _col_key_for_period(2026, 3, "quarter") == "2026-Q1"

def test_col_key_quarterly_q2():
    assert _col_key_for_period(2026, 4, "quarter") == "2026-Q2"
    assert _col_key_for_period(2026, 6, "quarter") == "2026-Q2"

def test_col_key_quarterly_q4():
    assert _col_key_for_period(2026, 10, "quarter") == "2026-Q4"
    assert _col_key_for_period(2026, 12, "quarter") == "2026-Q4"
