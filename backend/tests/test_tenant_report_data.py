import datetime as dt

from app.services.tenant_report_data import (
    _period_label,
    _period_months,
    _compute_summary,
)


def test_period_label_full_quarter():
    assert _period_label(dt.date(2026, 1, 1), dt.date(2026, 3, 31)) == "רבעון א 2026"


def test_period_label_single_month():
    assert _period_label(dt.date(2026, 4, 1), dt.date(2026, 4, 30)) == "אפריל 2026"


def test_period_months_inclusive_range():
    months = _period_months(dt.date(2026, 1, 1), dt.date(2026, 3, 31))
    assert months == [(2026, 1), (2026, 2), (2026, 3)]


def test_period_months_excludes_pre_move_in():
    months = _period_months(
        dt.date(2026, 1, 1), dt.date(2026, 3, 31),
        move_in_date=dt.date(2026, 2, 15),
    )
    # February is included once move_in_date falls within the month.
    assert months == [(2026, 2), (2026, 3)]


def test_compute_summary_period_debt_clamped_at_zero():
    s = _compute_summary(period_expected=500, period_paid=800, lifetime_debt=0, tx_count=2)
    assert s["period_debt"] == 0
    assert s["period_paid"] == 800
    assert s["period_expected"] == 500
    assert s["transaction_count"] == 2


def test_compute_summary_lifetime_debt_passed_through():
    s = _compute_summary(period_expected=300, period_paid=0, lifetime_debt=1200, tx_count=0)
    assert s["period_debt"] == 300
    assert s["lifetime_debt"] == 1200
