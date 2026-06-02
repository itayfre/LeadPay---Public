"""Pure split-method functions for one-off (special) charges.

Each function takes a total (or per-apt amount) and returns a list of
per-apartment :class:`Decimal` amounts. The result list is what the caller
inserts into ``special_charges`` rows. No DB access here.

All amounts are quantized to 2 decimal places (the agora). Rounding for
:func:`split_equal` and :func:`split_weight` is absorbed by the last
apartment so the sum equals the input total exactly.
"""
from __future__ import annotations

from decimal import Decimal


_TWO_PLACES = Decimal("0.01")
_ZERO = Decimal("0.00")


def _q(d: Decimal) -> Decimal:
    """Quantize to 2 decimals (ROUND_HALF_EVEN, Python's default)."""
    return d.quantize(_TWO_PLACES)


def split_equal(total: Decimal, n: int) -> list[Decimal]:
    """Split ``total`` equally across ``n`` apartments.

    Each apartment gets ``floor(total / n, 2)`` decimals; the last apartment
    absorbs any rounding so the sum equals ``total`` exactly. For 5000 / 3,
    that yields ``[1666.67, 1666.67, 1666.66]``.
    """
    if n < 1:
        raise ValueError("split_equal requires n >= 1")
    if total < 0:
        raise ValueError("split_equal requires a non-negative total")

    per = _q(Decimal(total) / Decimal(n))
    amounts = [per] * (n - 1)
    last = _q(Decimal(total) - per * (n - 1))
    amounts.append(last)
    return amounts


def split_flat(amount_per_apt: Decimal, n: int) -> list[Decimal]:
    """Every apartment gets the same fixed ``amount_per_apt``.

    Useful when "total" isn't really a total — it's a per-apartment fee
    (e.g. 200 ILS each for a holiday upkeep). The batch's ``total_amount``
    column then becomes informational rather than authoritative.
    """
    if n < 1:
        raise ValueError("split_flat requires n >= 1")
    if amount_per_apt < 0:
        raise ValueError("split_flat requires a non-negative amount")
    return [_q(Decimal(amount_per_apt))] * n


def split_weight(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """Split ``total`` proportionally to the given per-apartment weights.

    ``weights`` are arbitrary non-negative numbers (e.g. apartment size in m²,
    percentage points, or any custom number). Sum must be positive. Last
    apartment absorbs rounding so the result sums to ``total`` exactly.
    """
    if not weights:
        raise ValueError("split_weight requires at least one weight")
    if any(w < 0 for w in weights):
        raise ValueError("split_weight requires non-negative weights")
    if total < 0:
        raise ValueError("split_weight requires a non-negative total")
    total_weight = sum(weights, start=Decimal("0"))
    if total_weight == 0:
        raise ValueError("split_weight requires a positive sum of weights")

    n = len(weights)
    amounts: list[Decimal] = []
    for i, w in enumerate(weights):
        if i == n - 1:
            # Last apt: whatever's left over after the others took their shares.
            amounts.append(_q(Decimal(total) - sum(amounts, start=Decimal("0"))))
        else:
            share = _q(Decimal(total) * Decimal(w) / Decimal(total_weight))
            amounts.append(share)
    return amounts


def split_custom(per_apt_amounts: list[Decimal]) -> list[Decimal]:
    """Pass-through: caller supplied the exact per-apt amounts.

    Validates non-empty and non-negative; quantizes to 2 dp.
    """
    if not per_apt_amounts:
        raise ValueError("split_custom requires at least one amount")
    if any(a < 0 for a in per_apt_amounts):
        raise ValueError("split_custom requires non-negative amounts")
    return [_q(Decimal(a)) for a in per_apt_amounts]
