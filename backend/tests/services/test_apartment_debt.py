"""Tests for app/services/apartment_debt.py.

Two queries against the new tables:
- ``apartment_balance(session, apt_id) -> Decimal`` — total outstanding debt
  for the apartment as the difference between summed expected amounts and
  summed payments, clamped at 0.
- ``apartment_ledger(session, apt_id) -> list[LedgerRow]`` — one row per
  (year, month) with expected, paid, balance, and the responsible tenant id.
"""
from datetime import datetime
from decimal import Decimal

from app.models.apartment_period_debt import ApartmentPeriodDebt
from app.models.special_charge import SpecialCharge, SpecialChargeBatch, SplitMethod
from app.models.transaction import Transaction, TransactionType
from app.models.transaction_allocation import TransactionAllocation
from app.services.apartment_debt import apartment_balance, apartment_ledger
from tests.factories import make_apartment, make_building, make_tenant


def _make_payment_txn(session):
    """Minimal payment transaction so allocation FK is satisfied."""
    tx = Transaction(
        activity_date=datetime(2026, 1, 15),
        description="test",
        transaction_type=TransactionType.PAYMENT,
        credit_amount=Decimal("1500"),
    )
    session.add(tx)
    session.flush()
    return tx


def test_balance_zero_when_no_period_debts(db_session):
    apt = make_apartment(db_session)
    db_session.commit()
    assert apartment_balance(db_session, apt.id) == Decimal("0")


def test_balance_is_expected_minus_paid(db_session):
    """One period debt of 1500, paid 1500 → balance 0.
    One period debt of 1500, paid 0 → balance 1500.
    Total: 1500."""
    apt = make_apartment(db_session)
    t = make_tenant(db_session, apartment_id=apt.id, is_active=True)
    pd1 = ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=1, expected_amount=Decimal("1500"),
        responsible_tenant_id=t.id,
    )
    pd2 = ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=2, expected_amount=Decimal("1500"),
        responsible_tenant_id=t.id,
    )
    db_session.add_all([pd1, pd2])
    db_session.flush()

    tx = _make_payment_txn(db_session)
    db_session.add(TransactionAllocation(
        transaction_id=tx.id, tenant_id=t.id, amount=Decimal("1500"),
        apartment_period_debt_id=pd1.id,
    ))
    db_session.commit()

    assert apartment_balance(db_session, apt.id) == Decimal("1500.00")


def test_balance_is_never_negative(db_session):
    """Overpayment doesn't show as credit — balance is clamped at 0."""
    apt = make_apartment(db_session)
    t = make_tenant(db_session, apartment_id=apt.id, is_active=True)
    pd = ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=1, expected_amount=Decimal("1500"),
        responsible_tenant_id=t.id,
    )
    db_session.add(pd)
    db_session.flush()

    tx = _make_payment_txn(db_session)
    db_session.add(TransactionAllocation(
        transaction_id=tx.id, tenant_id=t.id, amount=Decimal("2000"),
        apartment_period_debt_id=pd.id,
    ))
    db_session.commit()

    assert apartment_balance(db_session, apt.id) == Decimal("0")


def test_balance_includes_special_charges(db_session):
    """Special charges add to expected; allocations to special_charges subtract."""
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    t = make_tenant(db_session, apartment_id=apt.id, is_active=True)
    batch = SpecialChargeBatch(
        building_id=b.id, title="lift",
        total_amount=Decimal("500"), split_method=SplitMethod.EQUAL,
    )
    db_session.add(batch)
    db_session.flush()
    sc = SpecialCharge(batch_id=batch.id, apartment_id=apt.id, amount=Decimal("500"))
    db_session.add(sc)
    db_session.flush()

    tx = _make_payment_txn(db_session)
    db_session.add(TransactionAllocation(
        transaction_id=tx.id, tenant_id=t.id, amount=Decimal("200"),
        special_charge_id=sc.id,
    ))
    db_session.commit()

    # No period debt, only special charge: expected 500, paid 200 → balance 300.
    assert apartment_balance(db_session, apt.id) == Decimal("300.00")


def test_ledger_empty_when_no_period_debts(db_session):
    apt = make_apartment(db_session)
    db_session.commit()
    assert apartment_ledger(db_session, apt.id) == []


def test_ledger_one_row_per_period_sorted_chronologically(db_session):
    apt = make_apartment(db_session)
    t = make_tenant(db_session, apartment_id=apt.id, is_active=True)
    # Insert out of order; ledger must still come back sorted.
    db_session.add(ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=3, expected_amount=Decimal("1500"),
        responsible_tenant_id=t.id,
    ))
    db_session.add(ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=1, expected_amount=Decimal("1500"),
        responsible_tenant_id=t.id,
    ))
    db_session.add(ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=2, expected_amount=Decimal("1500"),
        responsible_tenant_id=t.id,
    ))
    db_session.commit()

    rows = apartment_ledger(db_session, apt.id)
    assert [(r.year, r.month) for r in rows] == [(2026, 1), (2026, 2), (2026, 3)]


def test_ledger_row_shape(db_session):
    """Each LedgerRow has year, month, expected, paid, balance, responsible_tenant_id."""
    apt = make_apartment(db_session)
    t = make_tenant(db_session, apartment_id=apt.id, is_active=True)
    pd = ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=1, expected_amount=Decimal("1500"),
        responsible_tenant_id=t.id,
    )
    db_session.add(pd)
    db_session.flush()

    tx = _make_payment_txn(db_session)
    db_session.add(TransactionAllocation(
        transaction_id=tx.id, tenant_id=t.id, amount=Decimal("500"),
        apartment_period_debt_id=pd.id,
    ))
    db_session.commit()

    rows = apartment_ledger(db_session, apt.id)
    assert len(rows) == 1
    row = rows[0]
    assert row.year == 2026
    assert row.month == 1
    assert row.expected == Decimal("1500.00")
    assert row.paid == Decimal("500.00")
    assert row.balance == Decimal("1000.00")
    assert str(row.responsible_tenant_id) == str(t.id)


def test_ledger_balance_per_row_does_not_clamp_at_zero(db_session):
    """The ledger shows per-period overpayment as negative balance, even
    though the apartment_balance aggregate clamps at 0."""
    apt = make_apartment(db_session)
    t = make_tenant(db_session, apartment_id=apt.id, is_active=True)
    pd = ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=1, expected_amount=Decimal("1500"),
        responsible_tenant_id=t.id,
    )
    db_session.add(pd)
    db_session.flush()
    tx = _make_payment_txn(db_session)
    db_session.add(TransactionAllocation(
        transaction_id=tx.id, tenant_id=t.id, amount=Decimal("2000"),
        apartment_period_debt_id=pd.id,
    ))
    db_session.commit()

    rows = apartment_ledger(db_session, apt.id)
    assert rows[0].balance == Decimal("-500.00")
