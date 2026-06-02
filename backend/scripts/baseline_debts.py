"""Capture current per-apartment debt totals using the existing computation.

After migration, the new materialized totals must match (within rounding).
This snapshot is read by Phase 2's verify_migration.py.

Run: venv/bin/python -m scripts.baseline_debts
Writes: baseline_debts.json (in the CWD — run from leadpay/backend/)
"""
import json
from collections import defaultdict
from datetime import date

from sqlalchemy import select

from app.database import SessionLocal
from app.models import Apartment, Building, Tenant, Transaction, TransactionAllocation
from app.models.transaction import TransactionType
from app.routers.payments import _calculate_tenant_debt_from_map


def main() -> None:
    session = SessionLocal()
    try:
        today = date.today()
        per_apt: dict[str, float] = defaultdict(float)

        # Iterate every apartment so the snapshot covers the full set
        # (apartments with no active tenants get 0.0, matching what the system
        # would display).
        apartments = session.scalars(select(Apartment)).all()
        for apt in apartments:
            per_apt[str(apt.id)] = 0.0  # ensure key exists even if no active tenants

            building = session.get(Building, apt.building_id)
            if building is None:
                continue

            # Mirror payments.get_tenant_debts: only active tenants contribute
            # to the displayed debt.
            tenants = session.scalars(
                select(Tenant).where(
                    Tenant.apartment_id == apt.id,
                    Tenant.is_active.is_(True),
                )
            ).all()
            if not tenants:
                continue

            tenant_ids = [t.id for t in tenants]

            # Build {tenant_id: {(year, month): paid_amount}} from allocations,
            # exactly as get_tenant_debts does.
            alloc_rows = session.execute(
                select(TransactionAllocation, Transaction)
                .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
                .where(
                    TransactionAllocation.tenant_id.in_(tenant_ids),
                    Transaction.transaction_type == TransactionType.PAYMENT,
                )
            ).all()

            paid_by_tenant: dict[str, dict[tuple[int, int], float]] = defaultdict(
                lambda: defaultdict(float)
            )
            for alloc, txn in alloc_rows:
                if alloc.period_month is not None and alloc.period_year is not None:
                    key = (alloc.period_year, alloc.period_month)
                else:
                    act_date = txn.activity_date
                    if hasattr(act_date, "date"):
                        act_date = act_date.date()
                    key = (act_date.year, act_date.month)
                paid_by_tenant[str(alloc.tenant_id)][key] += float(alloc.amount)

            for t in tenants:
                debt = _calculate_tenant_debt_from_map(
                    t,
                    apt,
                    building,
                    dict(paid_by_tenant.get(str(t.id), {})),
                    today.month,
                    today.year,
                )
                per_apt[str(apt.id)] += float(debt)

        # Round per-apartment totals to cents (computation may accumulate
        # small float noise across tenants).
        out = {k: round(v, 2) for k, v in per_apt.items()}

        with open("baseline_debts.json", "w") as f:
            json.dump(out, f, indent=2, sort_keys=True)
        print(f"Wrote baseline_debts.json with {len(out)} apartments")
    finally:
        session.close()


if __name__ == "__main__":
    main()
