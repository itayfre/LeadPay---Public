"""Tests for the apartment-period-debt resolution helper in allocation_service."""
import uuid
from decimal import Decimal

from app.models.apartment_period_debt import ApartmentPeriodDebt
from app.services.allocation_service import _resolve_or_create_apd_id
from tests.factories import make_apartment, make_building, make_tenant


def test_returns_existing_apd_for_apartment_period(db_session):
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    t = make_tenant(db_session, apartment_id=apt.id)
    apd = ApartmentPeriodDebt(
        apartment_id=apt.id, year=2026, month=3, expected_amount=Decimal("1500")
    )
    db_session.add(apd)
    db_session.flush()

    result = _resolve_or_create_apd_id(db_session, t.id, year=2026, month=3)
    assert result == apd.id


def test_creates_apd_when_missing(db_session):
    b = make_building(db_session, expected_monthly_payment=Decimal("1200"))
    apt = make_apartment(db_session, building_id=b.id, expected_payment=Decimal("1700"))
    t = make_tenant(db_session, apartment_id=apt.id)

    result = _resolve_or_create_apd_id(db_session, t.id, year=2027, month=8)
    assert result is not None

    created = db_session.get(ApartmentPeriodDebt, result)
    assert created.apartment_id == apt.id
    assert created.year == 2027
    assert created.month == 8
    assert created.expected_amount == Decimal("1700")  # apt > building default
    assert created.responsible_tenant_id == t.id


def test_falls_back_to_building_default_when_apt_has_no_expected(db_session):
    b = make_building(db_session, expected_monthly_payment=Decimal("1000"))
    apt = make_apartment(db_session, building_id=b.id, expected_payment=None)
    t = make_tenant(db_session, apartment_id=apt.id)

    apd_id = _resolve_or_create_apd_id(db_session, t.id, year=2027, month=9)
    created = db_session.get(ApartmentPeriodDebt, apd_id)
    assert created.expected_amount == Decimal("1000")


def test_explicit_zero_on_apt_does_not_fall_back_to_building(db_session):
    """Decimal('0') on apartment is intentional (free apt), not 'missing' —
    don't promote to building default. Guards against a future simplification
    to `apt.expected_payment or building.expected_monthly_payment`."""
    b = make_building(db_session, expected_monthly_payment=Decimal("1500"))
    apt = make_apartment(db_session, building_id=b.id, expected_payment=Decimal("0"))
    t = make_tenant(db_session, apartment_id=apt.id)

    apd_id = _resolve_or_create_apd_id(db_session, t.id, year=2027, month=10)
    created = db_session.get(ApartmentPeriodDebt, apd_id)
    assert created.expected_amount == Decimal("0")


def test_returns_none_when_no_apartment_resolvable(db_session):
    """Tenant lookup fails (random UUID) → returns None. Caller writes the
    allocation with apartment_period_debt_id=NULL."""
    result = _resolve_or_create_apd_id(db_session, uuid.uuid4(), year=2027, month=1)
    assert result is None


def test_upsert_single_tenant_sets_apd_id(db_session):
    """The writer must dual-write apd id alongside legacy period fields."""
    from datetime import datetime
    from app.models.transaction import Transaction, TransactionType
    from app.services.allocation_service import upsert_single_tenant_allocation

    b = make_building(db_session, expected_monthly_payment=Decimal("1500"))
    apt = make_apartment(db_session, building_id=b.id, expected_payment=Decimal("1500"))
    t = make_tenant(db_session, apartment_id=apt.id)

    txn = Transaction(
        activity_date=datetime(2026, 4, 15),
        description="x",
        transaction_type=TransactionType.PAYMENT,
        credit_amount=Decimal("1500"),
    )
    db_session.add(txn)
    db_session.flush()

    alloc = upsert_single_tenant_allocation(
        db=db_session,
        transaction=txn,
        tenant_id=t.id,
        period_month=4,
        period_year=2026,
    )
    # APD pointer is set (legacy period_year/period_month columns removed in C2)
    assert alloc.apartment_period_debt_id is not None

    # The APD it points at must match the apt + period
    from app.models.apartment_period_debt import ApartmentPeriodDebt
    apd = db_session.get(ApartmentPeriodDebt, alloc.apartment_period_debt_id)
    assert apd.apartment_id == apt.id
    assert (apd.year, apd.month) == (2026, 4)


def test_set_split_allocations_sets_apd_for_tenant_rows(db_session):
    """Splits with tenant_id get apd; the per-tenant rows share an APD when
    they target the same (apartment, period)."""
    from datetime import datetime
    from app.models.transaction import Transaction, TransactionType
    from app.services.allocation_service import set_split_allocations

    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id, expected_payment=Decimal("1000"))
    t1 = make_tenant(db_session, apartment_id=apt.id, name="A")
    t2 = make_tenant(db_session, apartment_id=apt.id, name="B", is_active=False)

    txn = Transaction(
        activity_date=datetime(2026, 5, 10),
        description="x",
        transaction_type=TransactionType.PAYMENT,
        credit_amount=Decimal("1000"),
    )
    db_session.add(txn)
    db_session.flush()

    rows = set_split_allocations(
        db=db_session,
        transaction=txn,
        allocations=[
            {"tenant_id": t1.id, "amount": Decimal("600"), "period_year": 2026, "period_month": 5},
            {"tenant_id": t2.id, "amount": Decimal("400"), "period_year": 2026, "period_month": 5},
        ],
    )
    assert all(r.apartment_period_debt_id is not None for r in rows)
    # Both rows point at the same APD (same apartment, same period)
    assert rows[0].apartment_period_debt_id == rows[1].apartment_period_debt_id


def test_set_split_allocations_label_row_has_no_apd(db_session):
    """Label-only allocation (expense) has apartment_period_debt_id NULL."""
    from datetime import datetime
    from app.models.transaction import Transaction, TransactionType
    from app.services.allocation_service import set_split_allocations

    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    t = make_tenant(db_session, apartment_id=apt.id)
    txn = Transaction(
        activity_date=datetime(2026, 5, 10),
        description="x",
        transaction_type=TransactionType.PAYMENT,
        credit_amount=Decimal("1000"),
    )
    db_session.add(txn)
    db_session.flush()

    rows = set_split_allocations(
        db=db_session,
        transaction=txn,
        allocations=[
            {"tenant_id": t.id, "amount": Decimal("700"), "period_year": 2026, "period_month": 5},
            {"label": "החזר ביטוח", "amount": Decimal("300"), "period_year": 2026, "period_month": 5},
        ],
    )
    tenant_row = next(r for r in rows if r.tenant_id is not None)
    label_row = next(r for r in rows if r.label is not None)
    assert tenant_row.apartment_period_debt_id is not None
    assert label_row.apartment_period_debt_id is None
