"""Backfill ``apartment.fallback_owner_tenant_id`` from owner-role tenants.

For each apartment, pick the legally-liable owner — בעלים (owner-occupier)
when present, else משכיר (absentee landlord) — and store its id on the
apartment. If neither role exists, the apartment is skipped (the column
stays NULL; the UI can prompt for manual assignment later).

Idempotent: re-running produces the same result.

Run: /Users/frenkel/.venvs/leadpay/bin/python -m scripts.backfill_owner_fallback
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.apartment import Apartment
from app.models.tenant import OwnershipType, Tenant


OWNER_ROLES = (OwnershipType.OWNER, OwnershipType.LANDLORD)  # בעלים, משכיר


def backfill(session: Session) -> dict[str, int]:
    """Update fallback_owner_tenant_id on every apartment that has an owner-role
    tenant. Returns counts of updated vs skipped (no owner) apartments.
    """
    counts = {"updated": 0, "skipped_no_owner": 0}
    apts = session.scalars(select(Apartment)).all()
    for apt in apts:
        # Prefer בעלים over משכיר (owner-occupier is the active payer too).
        # Within a role, prefer is_active=True; ties broken by id for determinism.
        owner = session.scalars(
            select(Tenant)
            .where(
                Tenant.apartment_id == apt.id,
                Tenant.ownership_type.in_(OWNER_ROLES),
            )
            .order_by(
                (Tenant.ownership_type == OwnershipType.OWNER).desc(),
                Tenant.is_active.desc(),
                Tenant.id,
            )
            .limit(1)
        ).first()
        if owner is None:
            counts["skipped_no_owner"] += 1
            continue
        apt.fallback_owner_tenant_id = owner.id
        counts["updated"] += 1
    session.commit()
    return counts


def main() -> int:
    session = SessionLocal()
    try:
        counts = backfill(session)
        print(
            f"Backfill complete: updated={counts['updated']} "
            f"skipped_no_owner={counts['skipped_no_owner']}"
        )
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
