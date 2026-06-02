"""Tests for scripts/backfill_owner_fallback.py.

The backfill picks the most-recent owner-role tenant per apartment and stores
its id on ``apartment.fallback_owner_tenant_id``. "Owner-role" means either
``OwnershipType.OWNER`` (בעלים — owner-occupier) or ``OwnershipType.LANDLORD``
(משכיר — absentee landlord).
"""
from app.models.tenant import OwnershipType
from scripts.backfill_owner_fallback import backfill
from tests.factories import make_apartment, make_building, make_tenant


def test_picks_baalim_when_only_owner_occupier_exists(db_session):
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    owner = make_tenant(db_session, apartment_id=apt.id, ownership_type=OwnershipType.OWNER)
    db_session.commit()

    backfill(db_session)
    db_session.refresh(apt)
    assert apt.fallback_owner_tenant_id == owner.id


def test_picks_landlord_when_no_baalim(db_session):
    """משכיר (absentee landlord) is also an owner-role; must be selected."""
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    landlord = make_tenant(
        db_session, apartment_id=apt.id, ownership_type=OwnershipType.LANDLORD
    )
    make_tenant(db_session, apartment_id=apt.id, ownership_type=OwnershipType.RENTER)
    db_session.commit()

    backfill(db_session)
    db_session.refresh(apt)
    assert apt.fallback_owner_tenant_id == landlord.id


def test_prefers_baalim_over_landlord_when_both_exist(db_session):
    """If both an owner-occupier AND a landlord are on file (rare/legacy),
    prefer the בעלים since they're the active payer too."""
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    landlord = make_tenant(
        db_session, apartment_id=apt.id, ownership_type=OwnershipType.LANDLORD
    )
    owner = make_tenant(db_session, apartment_id=apt.id, ownership_type=OwnershipType.OWNER)
    db_session.commit()

    backfill(db_session)
    db_session.refresh(apt)
    assert apt.fallback_owner_tenant_id == owner.id
    assert apt.fallback_owner_tenant_id != landlord.id


def test_skips_apartment_with_only_renter(db_session):
    """No owner-role tenant → fallback stays NULL."""
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    make_tenant(db_session, apartment_id=apt.id, ownership_type=OwnershipType.RENTER)
    db_session.commit()

    backfill(db_session)
    db_session.refresh(apt)
    assert apt.fallback_owner_tenant_id is None


def test_idempotent(db_session):
    """Running the backfill twice produces the same result."""
    b = make_building(db_session)
    apt = make_apartment(db_session, building_id=b.id)
    owner = make_tenant(db_session, apartment_id=apt.id, ownership_type=OwnershipType.OWNER)
    db_session.commit()

    backfill(db_session)
    backfill(db_session)
    db_session.refresh(apt)
    assert apt.fallback_owner_tenant_id == owner.id


def test_returns_counts(db_session):
    b = make_building(db_session)
    apt1 = make_apartment(db_session, building_id=b.id)
    apt2 = make_apartment(db_session, building_id=b.id)
    make_tenant(db_session, apartment_id=apt1.id, ownership_type=OwnershipType.OWNER)
    make_tenant(db_session, apartment_id=apt2.id, ownership_type=OwnershipType.RENTER)
    db_session.commit()

    counts = backfill(db_session)
    assert counts == {"updated": 1, "skipped_no_owner": 1}
