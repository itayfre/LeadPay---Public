"""Tests for the SpecialChargeBatch and SpecialCharge models.

A *batch* is one extraordinary expense (lift repair, holiday cleaning, etc.)
spread across one or more apartments. Each per-apartment slice is a
SpecialCharge row.
"""
from decimal import Decimal

from app.models.special_charge import SpecialCharge, SpecialChargeBatch, SplitMethod
from tests.factories import make_apartment, make_building


def test_create_batch_with_two_charges(db_session):
    b = make_building(db_session)
    apt1 = make_apartment(db_session, building_id=b.id)
    apt2 = make_apartment(db_session, building_id=b.id)

    batch = SpecialChargeBatch(
        building_id=b.id,
        title="תיקון מעלית Q1",
        description="תיקון בעקבות התקלה ב-15 לינואר. חשבונית XYZ Ltd.",
        total_amount=Decimal("5000"),
        split_method=SplitMethod.EQUAL,
    )
    db_session.add(batch)
    db_session.flush()

    for apt in (apt1, apt2):
        db_session.add(
            SpecialCharge(batch_id=batch.id, apartment_id=apt.id, amount=Decimal("2500"))
        )
    db_session.commit()

    db_session.refresh(batch)
    assert len(batch.charges) == 2
    assert batch.charges[0].batch is batch
    assert {c.apartment_id for c in batch.charges} == {apt1.id, apt2.id}


def test_split_method_enum_round_trip(db_session):
    """All four SplitMethod values persist and read back correctly."""
    b = make_building(db_session)
    expected = []
    for sm in (SplitMethod.EQUAL, SplitMethod.CUSTOM, SplitMethod.WEIGHT, SplitMethod.FLAT):
        batch = SpecialChargeBatch(
            building_id=b.id,
            title=f"batch {sm.value}",
            total_amount=Decimal("100"),
            split_method=sm,
        )
        db_session.add(batch)
        expected.append((batch, sm))
    db_session.commit()

    for batch, sm in expected:
        db_session.refresh(batch)
        assert batch.split_method == sm


def test_cascade_delete_removes_charges(db_session):
    """Deleting a batch deletes all its charges (delete-orphan)."""
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    batch = SpecialChargeBatch(
        building_id=b.id,
        title="t",
        total_amount=Decimal("100"),
        split_method=SplitMethod.EQUAL,
    )
    db_session.add(batch)
    db_session.flush()
    sc = SpecialCharge(batch_id=batch.id, apartment_id=apt.id, amount=Decimal("100"))
    db_session.add(sc)
    db_session.commit()
    sc_id = sc.id

    db_session.delete(batch)
    db_session.commit()

    assert db_session.get(SpecialCharge, sc_id) is None


def test_description_and_notes_nullable(db_session):
    """description (batch) and notes (charge) are both nullable."""
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    batch = SpecialChargeBatch(
        building_id=b.id,
        title="no description",
        total_amount=Decimal("100"),
        split_method=SplitMethod.FLAT,
    )
    db_session.add(batch)
    db_session.flush()
    db_session.add(
        SpecialCharge(batch_id=batch.id, apartment_id=apt.id, amount=Decimal("100"))
    )
    db_session.commit()

    db_session.refresh(batch)
    assert batch.description is None
    assert batch.charges[0].notes is None
    assert batch.charges[0].responsible_tenant_id is None
