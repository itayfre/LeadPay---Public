"""Preflight: assert single active tenant per apartment.

Run: python3 -m scripts.preflight_active_tenants
Exits 1 if any apartment violates the invariant.
"""
from sqlalchemy import select, func

from app.database import SessionLocal
from app.models.tenant import Tenant


def main() -> int:
    session = SessionLocal()
    try:
        stmt = (
            select(Tenant.apartment_id, func.count().label("n"))
            .where(Tenant.is_active.is_(True))
            .group_by(Tenant.apartment_id)
            .having(func.count() > 1)
        )
        violators = session.execute(stmt).all()
        if violators:
            print(f"FAIL: {len(violators)} apartments have multiple active tenants:")
            for apt_id, n in violators:
                print(f"  apartment_id={apt_id} active_count={n}")
            return 1
        print("OK: every apartment has at most one active tenant.")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
