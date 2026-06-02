"""Tests for the ApartmentPeriodDebt model.

Each test commits explicitly so unique- and check-constraint violations
surface as ``IntegrityError`` from the commit, not from later flush.
"""
import pytest
from sqlalchemy.exc import IntegrityError

from app.models.apartment_period_debt import ApartmentPeriodDebt
from tests.factories import make_apartment


def test_unique_apartment_year_month(db_session):
    """A (apartment, year, month) tuple must be unique."""
    apt = make_apartment(db_session)
    db_session.add(
        ApartmentPeriodDebt(
            apartment_id=apt.id, year=2026, month=1, expected_amount=1500
        )
    )
    db_session.commit()

    db_session.add(
        ApartmentPeriodDebt(
            apartment_id=apt.id, year=2026, month=1, expected_amount=1500
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_month_check_constraint_rejects_zero(db_session):
    apt = make_apartment(db_session)
    db_session.add(
        ApartmentPeriodDebt(
            apartment_id=apt.id, year=2026, month=0, expected_amount=1500
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_month_check_constraint_rejects_thirteen(db_session):
    apt = make_apartment(db_session)
    db_session.add(
        ApartmentPeriodDebt(
            apartment_id=apt.id, year=2026, month=13, expected_amount=1500
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_cascade_delete_when_apartment_deleted(db_session):
    """Deleting an apartment cascades to its period debts."""
    apt = make_apartment(db_session)
    pd = ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=1, expected_amount=1500
    )
    db_session.add(pd)
    db_session.commit()
    pd_id = pd.id

    db_session.delete(apt)
    db_session.commit()

    assert db_session.get(ApartmentPeriodDebt, pd_id) is None
