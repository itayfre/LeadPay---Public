"""Preflight: list apartments with no owner-role tenant (בעלים or משכיר).

An "owner-role" tenant is either a בעלים (owner who lives in the apartment)
or a משכיר (owner who rents it out). Apartments with neither role on file
will have NULL fallback_owner_tenant_id after backfill and will need a
manual owner assignment via the UI before debts can be chased.

Run: venv/bin/python -m scripts.preflight_owners
Always exits 0 (informational warning).
"""
from sqlalchemy import select

from app.database import SessionLocal
from app.models.apartment import Apartment
from app.models.tenant import OwnershipType, Tenant


def main() -> int:
    session = SessionLocal()
    try:
        owner_apt_ids = (
            select(Tenant.apartment_id)
            .where(Tenant.ownership_type.in_([OwnershipType.OWNER, OwnershipType.LANDLORD]))
            .distinct()
            .scalar_subquery()
        )
        stmt = select(Apartment.id, Apartment.number).where(
            Apartment.id.not_in(owner_apt_ids)
        )
        rows = session.execute(stmt).all()
        if rows:
            print(f"WARN: {len(rows)} apartments have no owner-role tenant (no בעלים or משכיר):")
            for apt_id, num in rows:
                print(f"  apartment_id={apt_id} number={num}")
        else:
            print("OK: every apartment has at least one owner-role tenant.")
        return 0  # warning, not failure
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
