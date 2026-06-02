"""Tests for app/services/special_charge_split.py.

Four split methods, all returning a list of per-apartment Decimal amounts
that sum exactly to the expected total (within rounding for `equal`).
"""
from decimal import Decimal

import pytest

from app.services.special_charge_split import (
    split_custom,
    split_equal,
    split_flat,
    split_weight,
)


# ─── split_equal ────────────────────────────────────────────────────────────

class TestSplitEqual:
    def test_clean_division(self):
        assert split_equal(Decimal("300"), n=3) == [
            Decimal("100.00"), Decimal("100.00"), Decimal("100.00"),
        ]

    def test_rounding_absorbed_by_last(self):
        """5000 / 3 = 1666.66...; last apt absorbs the rounding."""
        result = split_equal(Decimal("5000"), n=3)
        assert result == [Decimal("1666.67"), Decimal("1666.67"), Decimal("1666.66")]
        assert sum(result) == Decimal("5000.00")

    def test_single_apt(self):
        assert split_equal(Decimal("1500"), n=1) == [Decimal("1500.00")]

    def test_zero_apts_raises(self):
        with pytest.raises(ValueError):
            split_equal(Decimal("100"), n=0)

    def test_zero_amount_returns_all_zeros(self):
        assert split_equal(Decimal("0"), n=3) == [
            Decimal("0.00"), Decimal("0.00"), Decimal("0.00"),
        ]


# ─── split_flat ─────────────────────────────────────────────────────────────

class TestSplitFlat:
    def test_returns_same_amount_per_apt(self):
        assert split_flat(Decimal("200"), n=3) == [
            Decimal("200.00"), Decimal("200.00"), Decimal("200.00"),
        ]

    def test_zero_amount(self):
        assert split_flat(Decimal("0"), n=3) == [Decimal("0.00")] * 3

    def test_zero_apts_raises(self):
        with pytest.raises(ValueError):
            split_flat(Decimal("100"), n=0)


# ─── split_weight ───────────────────────────────────────────────────────────

class TestSplitWeight:
    def test_equal_weights_equals_equal_split(self):
        result = split_weight(Decimal("300"), weights=[Decimal("1"), Decimal("1"), Decimal("1")])
        assert result == [Decimal("100.00"), Decimal("100.00"), Decimal("100.00")]

    def test_proportional(self):
        # Total 600 split 2:3:1 (sum=6) → 200, 300, 100
        result = split_weight(Decimal("600"), weights=[Decimal("2"), Decimal("3"), Decimal("1")])
        assert sum(result) == Decimal("600.00")
        assert result == [Decimal("200.00"), Decimal("300.00"), Decimal("100.00")]

    def test_rounding_absorbed_by_last(self):
        # Total 1000 split with weights summing to 7; last absorbs.
        result = split_weight(Decimal("1000"), weights=[Decimal("2"), Decimal("2"), Decimal("3")])
        assert sum(result) == Decimal("1000.00")
        # Last should be slightly different to balance.

    def test_zero_total_weight_raises(self):
        with pytest.raises(ValueError):
            split_weight(Decimal("100"), weights=[Decimal("0"), Decimal("0")])

    def test_empty_weights_raises(self):
        with pytest.raises(ValueError):
            split_weight(Decimal("100"), weights=[])

    def test_negative_weight_raises(self):
        with pytest.raises(ValueError):
            split_weight(Decimal("100"), weights=[Decimal("1"), Decimal("-1"), Decimal("2")])


# ─── split_custom ───────────────────────────────────────────────────────────

class TestSplitCustom:
    def test_passes_through_valid_amounts(self):
        amounts = [Decimal("100"), Decimal("200"), Decimal("300")]
        assert split_custom(amounts) == [
            Decimal("100.00"), Decimal("200.00"), Decimal("300.00"),
        ]

    def test_empty_list_raises(self):
        with pytest.raises(ValueError):
            split_custom([])

    def test_negative_amount_raises(self):
        with pytest.raises(ValueError):
            split_custom([Decimal("100"), Decimal("-50")])

    def test_zero_amount_allowed(self):
        """A custom split CAN include zero amounts (e.g. an exempt apt)."""
        assert split_custom([Decimal("100"), Decimal("0"), Decimal("50")]) == [
            Decimal("100.00"), Decimal("0.00"), Decimal("50.00"),
        ]
