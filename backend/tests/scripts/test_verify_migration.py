"""Tests for scripts/verify_migration.py.

The verifier's logic is in three pieces:
- ``load_baseline`` reads the JSON.
- ``compute_new_totals`` runs SQL against the new tables.
- ``diff`` does the per-apartment compare with tolerance.

We unit-test ``diff`` directly. The other two are exercised end-to-end on
prod when the operator runs the verifier after applying backfill.
"""
from decimal import Decimal

from scripts.verify_migration import diff


def test_no_diffs_when_totals_match_exactly():
    baseline = {"a": Decimal("1500.00"), "b": Decimal("0.00")}
    actual = {"a": Decimal("1500.00"), "b": Decimal("0.00")}
    assert diff(baseline, actual) == []


def test_no_diffs_within_tolerance():
    """1 cent off is within the default ±0.01 tolerance."""
    baseline = {"a": Decimal("1500.00")}
    actual = {"a": Decimal("1500.01")}
    assert diff(baseline, actual) == []


def test_diff_when_exceeds_tolerance():
    baseline = {"a": Decimal("1500.00")}
    actual = {"a": Decimal("1500.02")}
    result = diff(baseline, actual)
    assert len(result) == 1
    apt_id, base, new, delta = result[0]
    assert apt_id == "a"
    assert base == Decimal("1500.00")
    assert new == Decimal("1500.02")
    assert delta == Decimal("0.02")


def test_missing_apartment_in_actual_treated_as_zero():
    """If the new totals don't include an apartment that's in the baseline,
    treat its new value as 0 and surface the drift."""
    baseline = {"a": Decimal("1500.00")}
    actual: dict = {}
    result = diff(baseline, actual)
    assert len(result) == 1
    assert result[0][0] == "a"
    assert result[0][2] == Decimal("0")
    assert result[0][3] == Decimal("-1500.00")


def test_extra_apartment_in_actual_treated_as_baseline_zero():
    """An apartment that exists only in actual (e.g., new since baseline)
    surfaces as +delta from a baseline of 0."""
    baseline: dict = {}
    actual = {"b": Decimal("250.00")}
    result = diff(baseline, actual)
    assert len(result) == 1
    assert result[0][0] == "b"
    assert result[0][3] == Decimal("250.00")


def test_custom_tolerance():
    """Tolerance can be widened (e.g. for known-fuzzy comparisons)."""
    baseline = {"a": Decimal("100.00")}
    actual = {"a": Decimal("101.00")}
    # Default tolerance (0.01): 1.00 drift surfaces.
    assert len(diff(baseline, actual)) == 1
    # With tolerance 1.00: 1.00 drift is on the boundary → not surfaced
    # (the diff function uses `> tolerance`, not `>=`).
    assert len(diff(baseline, actual, tolerance=Decimal("1.00"))) == 0
    # With tolerance 0.99: 1.00 drift exceeds → surfaced.
    assert len(diff(baseline, actual, tolerance=Decimal("0.99"))) == 1


def test_results_sorted_by_apartment_id():
    """Output is deterministic — sorted by apartment id for diff-friendly stdout."""
    baseline = {"zzz": Decimal("100"), "aaa": Decimal("200"), "mmm": Decimal("300")}
    actual = {"zzz": Decimal("0"), "aaa": Decimal("0"), "mmm": Decimal("0")}
    result = diff(baseline, actual)
    apt_ids = [r[0] for r in result]
    assert apt_ids == ["aaa", "mmm", "zzz"]
