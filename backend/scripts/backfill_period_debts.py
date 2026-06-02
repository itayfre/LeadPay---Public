"""Generate one ApartmentPeriodDebt row per (apartment, year, month) from the
earliest tenant move_in_date through a given "as of" date.

Algorithm (per apartment):
  1. Determine the effective expected_amount:
        apartment.expected_payment ?? building.expected_monthly_payment
     If neither is set (or both are 0), skip the apartment entirely — we
     can't materialize a debt of unknown size.
  2. Determine the earliest move_in date: the minimum of (tenant.move_in_date
     for any tenant, falling back to building.default_move_in_date when
     tenant.move_in_date is NULL).
  3. For each month from earliest_move_in to as_of (inclusive), upsert a
     period-debt row with:
        expected_amount = the value from step 1
        responsible_tenant_id = the most recent tenant on the apt whose
            move_in_date is on/before the month's first day, preferring
            is_active=True; NULL if none qualify.

Idempotent via PostgreSQL ON CONFLICT DO NOTHING on (apartment_id, year, month).
Re-running with a later ``as_of`` only inserts the new months.

Run: /Users/frenkel/.venvs/leadpay/bin/python -m scripts.backfill_period_debts
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterator

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.apartment import Apartment
from app.models.apartment_period_debt import ApartmentPeriodDebt
from app.models.building import Building
from app.models.tenant import Tenant


def _months_inclusive(start: date, end: date) -> Iterator[tuple[int, int]]:
    """Yield (year, month) tuples from start to end, inclusive."""
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        yield (y, m)
        m += 1
        if m == 13:
            m = 1
            y += 1


def _earliest_move_in(
    session: Session, apt: Apartment, building: Building
) -> date | None:
    """Earliest among the apartment's tenants' effective move_in dates.

    For each tenant, effective = tenant.move_in_date or building.default_move_in_date.
    """
    tenant_move_ins: list[date] = []
    for t in session.scalars(
        select(Tenant).where(Tenant.apartment_id == apt.id)
    ).all():
        eff = t.move_in_date or building.default_move_in_date
        if eff is not None:
            tenant_move_ins.append(eff)
    if tenant_move_ins:
        return min(tenant_move_ins)
    return building.default_move_in_date


def _responsible_for_month(
    session: Session, apt_id, year: int, month: int
) -> "uuid.UUID | None":
    """Most recent tenant whose move_in_date ≤ month's first day. Prefers
    is_active=True; falls back to inactive ones if no active applies.
    """
    month_first = date(year, month, 1)
    return session.scalar(
        select(Tenant.id)
        .where(
            Tenant.apartment_id == apt_id,
            Tenant.move_in_date <= month_first,
        )
        .order_by(Tenant.is_active.desc(), Tenant.move_in_date.desc())
        .limit(1)
    )


def backfill(session: Session, as_of: date | None = None) -> dict[str, int]:
    """Materialize period debts up to ``as_of`` (default: today). Returns
    {"inserted": N} where N is the number of NEW rows created."""
    as_of = as_of or date.today()
    apts = session.scalars(select(Apartment)).all()

    total_inserted = 0
    for apt in apts:
        building = session.get(Building, apt.building_id)
        if building is None:
            # Orphaned apartment — leave alone.
            continue

        expected: Decimal | None = (
            apt.expected_payment or building.expected_monthly_payment
        )
        if expected is None or Decimal(expected) == 0:
            # No materializable amount.
            continue

        start = _earliest_move_in(session, apt, building)
        if start is None:
            continue

        for (y, m) in _months_inclusive(start, as_of):
            tenant_id = _responsible_for_month(session, apt.id, y, m)
            stmt = pg_insert(ApartmentPeriodDebt).values(
                apartment_id=apt.id,
                year=y,
                month=m,
                expected_amount=expected,
                responsible_tenant_id=tenant_id,
            ).on_conflict_do_nothing(
                index_elements=["apartment_id", "year", "month"]
            )
            res = session.execute(stmt)
            total_inserted += res.rowcount or 0

    session.commit()
    return {"inserted": total_inserted}


def main() -> int:
    session = SessionLocal()
    try:
        counts = backfill(session)
        print(f"Period-debt backfill complete: inserted={counts['inserted']}")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
