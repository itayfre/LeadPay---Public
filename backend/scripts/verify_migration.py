"""Compare new materialized debt totals against ``baseline_debts.json``.

After Phase-2 backfill has run on a target DB, every apartment's debt — as
computed from the new tables — must match the pre-migration baseline within
a small rounding tolerance. Any larger drift means the backfill is wrong;
the operator should halt and investigate before proceeding.

The new computation:
    apt_debt = SUM(apd.expected_amount) - SUM(allocation.amount via apd link)
                                        - SUM(special_charges) +
                                        - SUM(allocation.amount via sc link)
    clamped at 0 per apartment so the apt is never "in credit" from this query.

The baseline JSON was captured by the legacy debt code in
``payments.py::_calculate_tenant_debt_from_map``. Both implementations use
the same input data (expected_amount, allocations, transaction.activity_date)
so they must agree.

Run: /Users/frenkel/.venvs/leadpay/bin/python -m scripts.verify_migration
Exits 0 if every apartment matches within tolerance; 1 otherwise.
"""
from __future__ import annotations

import json
from decimal import Decimal
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import SessionLocal


# Per-apartment tolerance, in ILS. The baseline is rounded to 2 dp; the
# new query also rounds to 2 dp. Anything beyond 0.01 is a real bug.
TOLERANCE = Decimal("0.01")

DEFAULT_BASELINE_PATH = (
    Path(__file__).resolve().parent.parent / "baseline_debts.json"
)


_NEW_TOTALS_SQL = text(
    """
    WITH
    apt_expected AS (
      SELECT apartment_id, COALESCE(SUM(expected_amount), 0)::numeric AS expected
      FROM apartment_period_debts
      GROUP BY apartment_id
    ),
    apt_paid AS (
      SELECT apd.apartment_id, COALESCE(SUM(ta.amount), 0)::numeric AS paid
      FROM transaction_allocations ta
      JOIN apartment_period_debts apd
        ON apd.id = ta.apartment_period_debt_id
      GROUP BY apd.apartment_id
    ),
    apt_special_expected AS (
      SELECT apartment_id, COALESCE(SUM(amount), 0)::numeric AS expected
      FROM special_charges
      GROUP BY apartment_id
    ),
    apt_special_paid AS (
      SELECT sc.apartment_id, COALESCE(SUM(ta.amount), 0)::numeric AS paid
      FROM transaction_allocations ta
      JOIN special_charges sc ON sc.id = ta.special_charge_id
      GROUP BY sc.apartment_id
    )
    SELECT
      a.id::text AS apartment_id,
      GREATEST(
        0::numeric,
        ROUND(
          COALESCE(ae.expected, 0) - COALESCE(ap.paid, 0)
          + COALESCE(ase.expected, 0) - COALESCE(asp.paid, 0),
          2
        )
      ) AS new_debt
    FROM apartments a
    LEFT JOIN apt_expected         ae  ON ae.apartment_id  = a.id
    LEFT JOIN apt_paid             ap  ON ap.apartment_id  = a.id
    LEFT JOIN apt_special_expected ase ON ase.apartment_id = a.id
    LEFT JOIN apt_special_paid     asp ON asp.apartment_id = a.id
    """
)


def compute_new_totals(session: Session) -> dict[str, Decimal]:
    """Return {apartment_id_str: total_debt_decimal} from the new tables."""
    return {
        row.apartment_id: Decimal(str(row.new_debt))
        for row in session.execute(_NEW_TOTALS_SQL)
    }


def load_baseline(path: Path) -> dict[str, Decimal]:
    """Load the baseline JSON (keys: apt UUID strings, values: floats)."""
    with path.open() as f:
        data = json.load(f)
    return {k: Decimal(str(v)) for k, v in data.items()}


def diff(
    baseline: dict[str, Decimal],
    actual: dict[str, Decimal],
    tolerance: Decimal = TOLERANCE,
) -> list[tuple[str, Decimal, Decimal, Decimal]]:
    """Return list of (apt_id, baseline_val, actual_val, delta) for apartments
    that differ by more than ``tolerance``. delta = actual - baseline."""
    diffs: list[tuple[str, Decimal, Decimal, Decimal]] = []
    all_keys = set(baseline) | set(actual)
    for key in sorted(all_keys):
        base = baseline.get(key, Decimal("0"))
        new = actual.get(key, Decimal("0"))
        delta = new - base
        if abs(delta) > tolerance:
            diffs.append((key, base, new, delta))
    return diffs


def main() -> int:
    session = SessionLocal()
    try:
        baseline = load_baseline(DEFAULT_BASELINE_PATH)
        actual = compute_new_totals(session)

        diffs = diff(baseline, actual)
        if diffs:
            print(f"FAIL: {len(diffs)} apartments differ from baseline > {TOLERANCE}:")
            for apt_id, base, new, delta in diffs[:20]:
                print(f"  {apt_id}  baseline={base}  new={new}  delta={delta:+}")
            if len(diffs) > 20:
                print(f"  ... and {len(diffs) - 20} more")
            return 1
        print(
            f"OK: all {len(baseline)} baseline apartments match new totals "
            f"within ±{TOLERANCE}"
        )
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
