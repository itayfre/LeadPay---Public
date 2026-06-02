"""Print which database the current DATABASE_URL points at.

Use this BEFORE running the preflight scripts against prod, to confirm you've
overridden the env correctly. Prints the Supabase project ref (the host
subdomain) and the row counts of a few canary tables.

Run:  /Users/frenkel/.venvs/leadpay/bin/python -m scripts.which_db
"""
import os
import re

from sqlalchemy import text

from app.database import SessionLocal, DATABASE_URL


def _project_ref() -> str:
    """Extract the Supabase project ref from either direct or pooler URLs.

    Direct: postgresql://postgres:pw@db.<REF>.supabase.co:5432/...
    Pooler: postgresql://postgres.<REF>:pw@aws-0-region.pooler.supabase.com:.../...
    """
    if not DATABASE_URL:
        return "<no DATABASE_URL>"
    # Pooler form first: "postgres.<ref>:" appears in the userinfo.
    m = re.search(r"postgres\.([a-z0-9]+):", DATABASE_URL)
    if m:
        return m.group(1)
    # Direct form: "@db.<ref>.supabase.co" appears in the host.
    m = re.search(r"@db\.([a-z0-9]+)\.supabase\.co", DATABASE_URL)
    if m:
        return m.group(1)
    return "<unrecognized URL shape>"


def main() -> int:
    ref = _project_ref()
    print(f"DATABASE_URL Supabase project ref: {ref}")
    if ref == "your-prod-project-ref":
        print("→ PROD project (live customer data, read-only operations only)")
    elif ref == "<no DATABASE_URL>" or ref.startswith("<"):
        print("→ env not set — point DATABASE_URL at a Supabase URL first")
        return 1
    else:
        print("→ non-prod project (dev/test). Safe for read+write.")

    session = SessionLocal()
    try:
        for table in ("buildings", "apartments", "tenants", "transaction_allocations"):
            n = session.execute(text(f"SELECT count(*) FROM {table}")).scalar()
            print(f"  {table}: {n:>8} rows")
    finally:
        session.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
