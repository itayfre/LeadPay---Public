"""Tests for the new debt/charge pointer columns on TransactionAllocation.

Phase 1 only adds the columns (nullable). Backfill (Phase 2) populates them
on existing rows; the XOR check constraint comes later in Phase 6.
"""
from decimal import Decimal

from app.models.apartment_period_debt import ApartmentPeriodDebt
from app.models.special_charge import SpecialCharge, SpecialChargeBatch, SplitMethod
from app.models.transaction import Transaction, TransactionType
from app.models.transaction_allocation import TransactionAllocation
from tests.factories import make_apartment, make_building, make_tenant


def test_allocation_has_new_pointer_columns():
    """Schema-level check that the two new columns exist."""
    cols = {c.name for c in TransactionAllocation.__table__.columns}
    assert "apartment_period_debt_id" in cols
    assert "special_charge_id" in cols


def _make_transaction(session):
    """Minimal Transaction row so allocation FK is satisfied."""
    from datetime import datetime
    txn = Transaction(
        activity_date=datetime(2026, 1, 15),
        description="test payment",
        transaction_type=TransactionType.PAYMENT,
        credit_amount=Decimal("1500"),
    )
    session.add(txn)
    session.flush()
    return txn


def test_allocation_can_point_at_apartment_period_debt(db_session):
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    t = make_tenant(db_session, apartment_id=apt.id)
    pd = ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=1, expected_amount=Decimal("1500")
    )
    db_session.add(pd)
    db_session.flush()

    txn = _make_transaction(db_session)
    alloc = TransactionAllocation(
        transaction_id=txn.id,
        tenant_id=t.id,
        amount=Decimal("1500"),
        apartment_period_debt_id=pd.id,
    )
    db_session.add(alloc)
    db_session.commit()

    db_session.refresh(alloc)
    assert alloc.apartment_period_debt_id == pd.id
    assert alloc.special_charge_id is None


def test_allocation_can_point_at_special_charge(db_session):
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    t = make_tenant(db_session, apartment_id=apt.id)
    batch = SpecialChargeBatch(
        building_id=b.id,
        title="lift",
        total_amount=Decimal("500"),
        split_method=SplitMethod.EQUAL,
    )
    db_session.add(batch)
    db_session.flush()
    sc = SpecialCharge(batch_id=batch.id, apartment_id=apt.id, amount=Decimal("500"))
    db_session.add(sc)
    db_session.flush()

    txn = _make_transaction(db_session)
    alloc = TransactionAllocation(
        transaction_id=txn.id,
        tenant_id=t.id,
        amount=Decimal("500"),
        special_charge_id=sc.id,
    )
    db_session.add(alloc)
    db_session.commit()

    db_session.refresh(alloc)
    assert alloc.special_charge_id == sc.id
    assert alloc.apartment_period_debt_id is None


