"""Minimal model factories for use in ORM-level tests.

Each factory inserts a row with sensible defaults for non-nullable columns
and returns the persisted instance (after `session.flush()` so the PK is
populated, but NOT after `session.commit()` — tests control commit boundaries
to verify constraint enforcement).
"""
from __future__ import annotations

import random
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.apartment import Apartment
from app.models.building import Building
from app.models.tenant import OwnershipType, Tenant


def _unique_int(min_val: int = 1, max_val: int = 1_000_000) -> int:
    """Return a fresh integer unlikely to collide with another factory call."""
    return random.randint(min_val, max_val)


def make_building(session: Session, **kwargs: Any) -> Building:
    """Create + flush a Building. All non-nullable columns get sensible defaults."""
    suffix = uuid.uuid4().hex[:6]
    defaults: dict[str, Any] = {
        "name": f"Building {suffix}",
        "address": f"{_unique_int()} Test St",
        "city": "Tel Aviv",
    }
    defaults.update(kwargs)
    b = Building(**defaults)
    session.add(b)
    session.flush()
    return b


def make_apartment(
    session: Session,
    *,
    building_id: uuid.UUID | None = None,
    number: int | None = None,
    floor: int | None = None,
    **kwargs: Any,
) -> Apartment:
    """Create + flush an Apartment. Auto-creates a Building if none provided."""
    if building_id is None:
        building_id = make_building(session).id
    defaults: dict[str, Any] = {
        "building_id": building_id,
        "number": number if number is not None else _unique_int(),
        "floor": floor if floor is not None else 1,
    }
    defaults.update(kwargs)
    apt = Apartment(**defaults)
    session.add(apt)
    session.flush()
    return apt


def make_tenant(
    session: Session,
    *,
    apartment_id: uuid.UUID | None = None,
    name: str | None = None,
    ownership_type: OwnershipType | None = None,
    **kwargs: Any,
) -> Tenant:
    """Create + flush a Tenant. Auto-creates apartment + building if needed."""
    if apartment_id is None:
        apt = make_apartment(session)
        apartment_id = apt.id
        building_id = apt.building_id
    else:
        building_id = session.scalar(
            select(Apartment.building_id).where(Apartment.id == apartment_id)
        )
    defaults: dict[str, Any] = {
        "apartment_id": apartment_id,
        "building_id": building_id,
        "name": name or f"Tenant {uuid.uuid4().hex[:6]}",
    }
    if ownership_type is not None:
        defaults["ownership_type"] = ownership_type
    defaults.update(kwargs)
    t = Tenant(**defaults)
    session.add(t)
    session.flush()
    return t
