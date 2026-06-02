"""Special-charge endpoints: create a one-off charge across apartments,
list batches for a building, and read a batch's per-apartment breakdown.

POST body shape (see :class:`SpecialChargeBatchCreate`):

    {
      "building_id": "uuid",
      "title": "תיקון מעלית Q1",
      "description": "Optional long-form context",
      "total_amount": "5000.00",
      "split_method": "equal" | "custom" | "weight" | "flat",
      "apartment_ids": ["uuid", ...],
      "due_date": "2026-06-30" or null,
      "custom_amounts": ["1500", "2000", "1500"]  -- only for split_method=custom
                                                     (length must match apartment_ids)
    }

The endpoint resolves each apartment's responsible_tenant_id automatically:
the active tenant if any, else the fallback_owner.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies.auth import (
    assert_tenant_building_access,
    require_viewer_or_tenant,
    require_worker_plus,
)
from ..models.apartment import Apartment
from ..models.building import Building
from ..models.special_charge import SpecialCharge, SpecialChargeBatch, SplitMethod
from ..models.tenant import Tenant
from ..models.user import User
from ..services.special_charge_split import (
    split_custom,
    split_equal,
    split_flat,
    split_weight,
)


router = APIRouter(
    prefix="/api/v1/special-charges",
    tags=["special-charges"],
)


# ─── Pydantic schemas ───────────────────────────────────────────────────────

class SpecialChargeBatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    building_id: UUID
    title: str = Field(min_length=1, max_length=500)
    description: Optional[str] = None
    total_amount: Decimal = Field(ge=0, decimal_places=2)
    split_method: SplitMethod
    apartment_ids: list[UUID] = Field(min_length=1)
    due_date: Optional[str] = None  # ISO date "YYYY-MM-DD"; parsed below
    custom_amounts: Optional[list[Decimal]] = None  # required when split_method=custom


class SpecialChargeOut(BaseModel):
    id: UUID
    apartment_id: UUID
    amount: Decimal
    responsible_tenant_id: Optional[UUID] = None
    notes: Optional[str] = None


class SpecialChargeBatchOut(BaseModel):
    id: UUID
    building_id: UUID
    title: str
    description: Optional[str]
    total_amount: Decimal
    split_method: SplitMethod
    due_date: Optional[str]
    created_at: str
    charges: list[SpecialChargeOut]


# ─── Helpers ────────────────────────────────────────────────────────────────

def _resolve_responsible_tenant_id(
    db: Session, apartment: Apartment
) -> Optional[UUID]:
    """Active tenant if any; else apartment.fallback_owner_tenant_id; else None."""
    active = db.scalar(
        select(Tenant.id).where(
            Tenant.apartment_id == apartment.id,
            Tenant.is_active.is_(True),
        ).limit(1)
    )
    if active is not None:
        return active
    return apartment.fallback_owner_tenant_id


def _compute_amounts(
    payload: SpecialChargeBatchCreate, apartments: list[Apartment]
) -> list[Decimal]:
    """Return per-apartment amounts in the same order as ``apartments``."""
    n = len(apartments)
    if payload.split_method == SplitMethod.EQUAL:
        return split_equal(payload.total_amount, n)

    if payload.split_method == SplitMethod.FLAT:
        # `total_amount` is treated as the per-apartment amount here.
        return split_flat(payload.total_amount, n)

    if payload.split_method == SplitMethod.CUSTOM:
        if payload.custom_amounts is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="custom_amounts is required when split_method='custom'",
            )
        if len(payload.custom_amounts) != n:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"custom_amounts length ({len(payload.custom_amounts)}) "
                    f"must equal apartment_ids length ({n})"
                ),
            )
        return split_custom(payload.custom_amounts)

    if payload.split_method == SplitMethod.WEIGHT:
        weights = [
            Decimal(a.weight) if a.weight is not None else Decimal("0")
            for a in apartments
        ]
        if all(w == 0 for w in weights):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "split_method='weight' requires at least one apartment to have a "
                    "non-zero weight set; configure weights on the apartment settings "
                    "page first or pick a different split method."
                ),
            )
        return split_weight(payload.total_amount, weights)

    raise HTTPException(  # pragma: no cover
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unknown split_method: {payload.split_method!r}",
    )


def _serialize_batch(batch: SpecialChargeBatch) -> dict:
    return {
        "id": str(batch.id),
        "building_id": str(batch.building_id),
        "title": batch.title,
        "description": batch.description,
        "total_amount": str(batch.total_amount),
        "split_method": batch.split_method.value,
        "due_date": batch.due_date.isoformat() if batch.due_date else None,
        "created_at": batch.created_at.isoformat(),
        "charges": [
            {
                "id": str(c.id),
                "apartment_id": str(c.apartment_id),
                "amount": str(c.amount),
                "responsible_tenant_id": (
                    str(c.responsible_tenant_id) if c.responsible_tenant_id else None
                ),
                "notes": c.notes,
            }
            for c in batch.charges
        ],
    }


# ─── Endpoints ──────────────────────────────────────────────────────────────


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_special_charge_batch(
    payload: SpecialChargeBatchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_worker_plus),
):
    """Create a batch + one SpecialCharge row per apartment, in one transaction.

    Responsible tenant per row is resolved automatically from the apartment's
    active tenant (or fallback owner). Returns the created batch with charges.
    """
    assert_tenant_building_access(current_user, payload.building_id)

    building = db.get(Building, payload.building_id)
    if building is None:
        raise HTTPException(status_code=404, detail="Building not found")

    # Load all apartments in the order the caller passed them — the
    # custom_amounts (and weights) are positional.
    apt_lookup = {
        a.id: a for a in db.scalars(
            select(Apartment).where(Apartment.id.in_(payload.apartment_ids))
        ).all()
    }
    missing = [aid for aid in payload.apartment_ids if aid not in apt_lookup]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown apartment_id(s): {[str(m) for m in missing]}",
        )
    apartments = [apt_lookup[aid] for aid in payload.apartment_ids]

    # Verify every apartment belongs to the target building.
    wrong_building = [
        str(a.id) for a in apartments if a.building_id != payload.building_id
    ]
    if wrong_building:
        raise HTTPException(
            status_code=400,
            detail=f"Apartments not in building {payload.building_id}: {wrong_building}",
        )

    amounts = _compute_amounts(payload, apartments)

    from datetime import date as _date
    due_date = None
    if payload.due_date:
        try:
            due_date = _date.fromisoformat(payload.due_date)
        except ValueError:
            raise HTTPException(
                status_code=400, detail="due_date must be ISO format YYYY-MM-DD"
            )

    batch = SpecialChargeBatch(
        building_id=payload.building_id,
        title=payload.title,
        description=payload.description,
        total_amount=payload.total_amount,
        split_method=payload.split_method,
        due_date=due_date,
    )
    db.add(batch)
    db.flush()

    for apt, amount in zip(apartments, amounts):
        db.add(SpecialCharge(
            batch_id=batch.id,
            apartment_id=apt.id,
            amount=amount,
            responsible_tenant_id=_resolve_responsible_tenant_id(db, apt),
        ))
    db.commit()
    db.refresh(batch)
    return _serialize_batch(batch)


@router.get("/")
def list_special_charge_batches(
    building_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """Batches for a building, newest first."""
    assert_tenant_building_access(current_user, building_id)
    batches = db.scalars(
        select(SpecialChargeBatch)
        .where(SpecialChargeBatch.building_id == building_id)
        .order_by(SpecialChargeBatch.created_at.desc())
    ).all()
    return [_serialize_batch(b) for b in batches]


@router.get("/{batch_id}/")
def get_special_charge_batch(
    batch_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    batch = db.get(SpecialChargeBatch, batch_id)
    if batch is None:
        raise HTTPException(status_code=404, detail="Batch not found")
    assert_tenant_building_access(current_user, batch.building_id)
    return _serialize_batch(batch)
