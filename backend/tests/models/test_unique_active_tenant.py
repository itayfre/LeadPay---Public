"""Test the single-active-tenant partial unique index introduced in Phase 6.

The migration is ``9d44eb8c0a2f_enforce_single_active_tenant_per_apt.py``.
We exercise it directly via the ORM: inserting two active tenants on the
same apartment must fail at commit time with IntegrityError.
"""
import pytest
from sqlalchemy.exc import IntegrityError

from app.models.tenant import OwnershipType
from tests.factories import make_apartment, make_tenant


def test_cannot_have_two_active_tenants_on_same_apartment(db_session):
    apt = make_apartment(db_session)
    make_tenant(db_session, apartment_id=apt.id, is_active=True,
                ownership_type=OwnershipType.OWNER)
    db_session.commit()

    # The factory flushes immediately after add(), so the constraint fires
    # inside the factory call rather than on the explicit commit below.
    with pytest.raises(IntegrityError):
        make_tenant(db_session, apartment_id=apt.id, is_active=True,
                    ownership_type=OwnershipType.RENTER)


def test_one_active_plus_many_inactive_is_fine(db_session):
    apt = make_apartment(db_session)
    make_tenant(db_session, apartment_id=apt.id, is_active=True,
                ownership_type=OwnershipType.OWNER)
    make_tenant(db_session, apartment_id=apt.id, is_active=False,
                ownership_type=OwnershipType.OWNER)
    make_tenant(db_session, apartment_id=apt.id, is_active=False,
                ownership_type=OwnershipType.RENTER)
    db_session.commit()  # no constraint violation


def test_two_apartments_can_each_have_one_active(db_session):
    """The index is partial (per apartment) — different apts are independent."""
    apt_a = make_apartment(db_session, number=101)
    apt_b = make_apartment(db_session, number=102)
    make_tenant(db_session, apartment_id=apt_a.id, is_active=True,
                ownership_type=OwnershipType.OWNER)
    make_tenant(db_session, apartment_id=apt_b.id, is_active=True,
                ownership_type=OwnershipType.OWNER)
    db_session.commit()
