"""Tests for scripts/backfill_period_debts.py.

For each apartment, generate one ApartmentPeriodDebt row per month from the
apartment's earliest tenant move_in_date to a given "as of" date. Expected
amount is captured at generation time. responsible_tenant_id is whoever was
the active payer for that specific month.
"""
from datetime import date
from decimal import Decimal

from app.models.apartment_period_debt import ApartmentPeriodDebt
from app.models.tenant import OwnershipType
from scripts.backfill_period_debts import backfill
from tests.factories import make_apartment, make_building, make_tenant


def test_generates_one_row_per_month_from_move_in_to_as_of(db_session):
    """Apt with one tenant moved in Jan 2026; as_of = Mar 2026 → 3 rows."""
    b = make_building(db_session, expected_monthly_payment=Decimal("1500"))
    apt = make_apartment(db_session, building_id=b.id)
    make_tenant(
        db_session,
        apartment_id=apt.id,
        is_active=True,
        ownership_type=OwnershipType.OWNER,
        move_in_date=date(2026, 1, 1),
    )
    db_session.commit()

    backfill(db_session, as_of=date(2026, 3, 15))

    rows = (
        db_session.query(ApartmentPeriodDebt)
        .filter_by(apartment_id=apt.id)
        .all()
    )
    assert {(r.year, r.month) for r in rows} == {(2026, 1), (2026, 2), (2026, 3)}
    assert all(r.expected_amount == Decimal("1500") for r in rows)


def test_uses_apartment_expected_payment_when_set(db_session):
    """apartment.expected_payment overrides building.expected_monthly_payment."""
    b = make_building(db_session, expected_monthly_payment=Decimal("1500"))
    apt = make_apartment(
        db_session, building_id=b.id, expected_payment=Decimal("1700")
    )
    make_tenant(
        db_session,
        apartment_id=apt.id,
        is_active=True,
        move_in_date=date(2026, 1, 1),
    )
    db_session.commit()

    backfill(db_session, as_of=date(2026, 1, 31))

    row = db_session.query(ApartmentPeriodDebt).filter_by(apartment_id=apt.id).one()
    assert row.expected_amount == Decimal("1700")


def test_uses_building_default_move_in_when_tenant_has_none(db_session):
    """When the tenant's move_in_date is NULL, fall back to
    building.default_move_in_date."""
    b = make_building(
        db_session,
        expected_monthly_payment=Decimal("1500"),
        default_move_in_date=date(2026, 2, 1),
    )
    apt = make_apartment(db_session, building_id=b.id)
    make_tenant(
        db_session,
        apartment_id=apt.id,
        is_active=True,
        move_in_date=None,
    )
    db_session.commit()

    backfill(db_session, as_of=date(2026, 3, 15))

    rows = (
        db_session.query(ApartmentPeriodDebt).filter_by(apartment_id=apt.id).all()
    )
    assert {(r.year, r.month) for r in rows} == {(2026, 2), (2026, 3)}


def test_skips_apartment_with_zero_expected(db_session):
    """If neither apartment nor building has a non-zero expected_payment,
    no rows are generated (we can't materialize an unknown amount)."""
    b = make_building(db_session, expected_monthly_payment=None)
    apt = make_apartment(db_session, building_id=b.id, expected_payment=None)
    make_tenant(
        db_session,
        apartment_id=apt.id,
        is_active=True,
        move_in_date=date(2026, 1, 1),
    )
    db_session.commit()

    backfill(db_session, as_of=date(2026, 3, 15))

    rows = db_session.query(ApartmentPeriodDebt).filter_by(apartment_id=apt.id).all()
    assert rows == []


def test_responsible_tenant_reflects_history(db_session):
    """Historical accuracy: responsible_tenant_id for a period reflects who
    was the active payer THEN, not who's active now.

    Setup: an (eventually-deactivated) owner moved in Jan 2025; an active
    renter moved in Jan 2026.

    Expectation:
        2025 months → owner (the only tenant present then)
        2026 months → renter (newly arrived and active)
    """
    b = make_building(db_session, expected_monthly_payment=Decimal("1500"))
    apt = make_apartment(db_session, building_id=b.id)
    former_owner = make_tenant(
        db_session,
        apartment_id=apt.id,
        is_active=False,
        ownership_type=OwnershipType.OWNER,
        move_in_date=date(2025, 1, 1),
    )
    renter = make_tenant(
        db_session,
        apartment_id=apt.id,
        is_active=True,
        ownership_type=OwnershipType.RENTER,
        move_in_date=date(2026, 1, 1),
    )
    db_session.commit()

    backfill(db_session, as_of=date(2026, 2, 15))

    rows = (
        db_session.query(ApartmentPeriodDebt)
        .filter_by(apartment_id=apt.id)
        .all()
    )
    by_period = {(r.year, r.month): r.responsible_tenant_id for r in rows}

    # The renter only became responsible from their move-in month onward.
    assert by_period[(2025, 1)] == former_owner.id
    assert by_period[(2025, 12)] == former_owner.id
    assert by_period[(2026, 1)] == renter.id
    assert by_period[(2026, 2)] == renter.id


def test_responsible_tenant_prefers_active_when_overlapping(db_session):
    """When two tenants both qualify for a period (both moved in on/before
    the period start), the active one is preferred."""
    b = make_building(db_session, expected_monthly_payment=Decimal("1500"))
    apt = make_apartment(db_session, building_id=b.id)
    make_tenant(
        db_session,
        apartment_id=apt.id,
        is_active=False,
        ownership_type=OwnershipType.OWNER,
        move_in_date=date(2026, 1, 1),
    )
    active_owner = make_tenant(
        db_session,
        apartment_id=apt.id,
        is_active=True,
        ownership_type=OwnershipType.OWNER,
        move_in_date=date(2026, 1, 1),
    )
    db_session.commit()

    backfill(db_session, as_of=date(2026, 1, 31))

    row = (
        db_session.query(ApartmentPeriodDebt).filter_by(apartment_id=apt.id).one()
    )
    assert row.responsible_tenant_id == active_owner.id


def test_idempotent(db_session):
    """Re-running backfill must not duplicate rows."""
    b = make_building(db_session, expected_monthly_payment=Decimal("1500"))
    apt = make_apartment(db_session, building_id=b.id)
    make_tenant(
        db_session,
        apartment_id=apt.id,
        is_active=True,
        move_in_date=date(2026, 1, 1),
    )
    db_session.commit()

    backfill(db_session, as_of=date(2026, 2, 15))
    backfill(db_session, as_of=date(2026, 2, 15))

    count = (
        db_session.query(ApartmentPeriodDebt).filter_by(apartment_id=apt.id).count()
    )
    assert count == 2


def test_returns_inserted_count(db_session):
    b = make_building(db_session, expected_monthly_payment=Decimal("1500"))
    apt = make_apartment(db_session, building_id=b.id)
    make_tenant(
        db_session,
        apartment_id=apt.id,
        is_active=True,
        move_in_date=date(2026, 1, 1),
    )
    db_session.commit()

    counts = backfill(db_session, as_of=date(2026, 3, 31))
    assert counts["inserted"] == 3

    # Second call: nothing new.
    counts2 = backfill(db_session, as_of=date(2026, 3, 31))
    assert counts2["inserted"] == 0
