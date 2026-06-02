"""Per-apartment "collecting" view — one row per apartment in a building.

This is the new endpoint that backs the rewritten collecting page (Phase 5).
It reads exclusively from the new tables (apartment_period_debts,
special_charges, transaction_allocations.{apartment_period_debt_id,
special_charge_id}) and exposes a stable shape for the frontend.

The existing per-tenant endpoints in payments.py are intentionally left
unchanged here — they keep serving the current UI until the frontend
switches over.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies.auth import (
    assert_tenant_building_access,
    require_viewer_or_tenant,
)
from ..models.apartment import Apartment
from ..models.apartment_period_debt import ApartmentPeriodDebt
from ..models.building import Building
from ..models.special_charge import SpecialCharge
from ..models.tenant import Tenant
from ..models.transaction_allocation import TransactionAllocation
from ..models.user import User


router = APIRouter(
    prefix="/api/v1/collecting",
    tags=["collecting"],
)


def _status(
    total_balance: Decimal,
    monthly_expected: Decimal,
    monthly_paid: Decimal,
    has_active: bool,
) -> str:
    """Compute the per-apartment status pill."""
    if total_balance <= Decimal("0"):
        return "paid"
    if not has_active:
        # No-one currently designated to pay — falls to the owner.
        return "owner_liable"
    if monthly_paid > Decimal("0"):
        return "partial"
    return "unpaid"


def _tenant_brief(t: Optional[Tenant]) -> Optional[dict]:
    if t is None:
        return None
    return {"id": str(t.id), "name": t.name}


@router.get("/{building_id}/")
def get_collecting(
    building_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """One row per apartment in the building, sourced from the new tables.

    Each row carries:
    - apartment_id, apartment_number
    - active_tenant / fallback_owner (id + name or null)
    - responsible_label: "active" | "owner_fallback" | "none"
    - monthly_expected/paid/balance — from apartment_period_debts +
      its linked allocations
    - special_expected/paid/balance — from special_charges + its linked
      allocations
    - total_balance — sum of monthly + special, clamped at 0
    - status: "paid" | "partial" | "unpaid" | "owner_liable"
    """
    assert_tenant_building_access(current_user, building_id)

    building = db.scalar(select(Building).where(Building.id == building_id))
    if building is None:
        raise HTTPException(status_code=404, detail="Building not found")

    apartments = db.scalars(
        select(Apartment)
        .where(Apartment.building_id == building_id)
        .order_by(Apartment.number)
    ).all()

    # Per-apartment aggregates: monthly expected/paid, special expected/paid.
    # Four small grouped queries to avoid N+1 — fine for this page.
    apt_ids = [a.id for a in apartments]

    monthly_expected = dict(db.execute(
        select(
            ApartmentPeriodDebt.apartment_id,
            func.coalesce(func.sum(ApartmentPeriodDebt.expected_amount), 0),
        )
        .where(ApartmentPeriodDebt.apartment_id.in_(apt_ids))
        .group_by(ApartmentPeriodDebt.apartment_id)
    ).all()) if apt_ids else {}

    monthly_paid = dict(db.execute(
        select(
            ApartmentPeriodDebt.apartment_id,
            func.coalesce(func.sum(TransactionAllocation.amount), 0),
        )
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .where(ApartmentPeriodDebt.apartment_id.in_(apt_ids))
        .group_by(ApartmentPeriodDebt.apartment_id)
    ).all()) if apt_ids else {}

    special_expected = dict(db.execute(
        select(
            SpecialCharge.apartment_id,
            func.coalesce(func.sum(SpecialCharge.amount), 0),
        )
        .where(SpecialCharge.apartment_id.in_(apt_ids))
        .group_by(SpecialCharge.apartment_id)
    ).all()) if apt_ids else {}

    special_paid = dict(db.execute(
        select(
            SpecialCharge.apartment_id,
            func.coalesce(func.sum(TransactionAllocation.amount), 0),
        )
        .join(SpecialCharge, SpecialCharge.id == TransactionAllocation.special_charge_id)
        .where(SpecialCharge.apartment_id.in_(apt_ids))
        .group_by(SpecialCharge.apartment_id)
    ).all()) if apt_ids else {}

    # All tenants for these apartments — grouped by apt for "main payer up
    # front + sub-tenants grey" rendering. Within an apt, sort actives first
    # then most-recent move_in.
    tenants_by_apt: dict = {}
    for t in db.scalars(
        select(Tenant)
        .where(Tenant.apartment_id.in_(apt_ids))
        .order_by(
            Tenant.is_active.desc(),
            Tenant.move_in_date.desc().nullslast(),
            Tenant.id,
        )
    ).all() if apt_ids else []:
        tenants_by_apt.setdefault(t.apartment_id, []).append(t)

    # The "main payer" is the first active tenant for the apt (post-cleanup
    # we expect at most one active per apt). If none active, the fallback
    # owner takes that role.
    active_tenants_by_apt: dict = {}
    for apt_id, tenants in tenants_by_apt.items():
        for t in tenants:
            if t.is_active:
                active_tenants_by_apt[apt_id] = t
                break

    # Fallback owners (one per apartment, by FK).
    fallback_ids = [
        a.fallback_owner_tenant_id for a in apartments if a.fallback_owner_tenant_id
    ]
    fallback_by_id: dict = {}
    if fallback_ids:
        for t in db.scalars(select(Tenant).where(Tenant.id.in_(fallback_ids))).all():
            fallback_by_id[t.id] = t

    rows = []
    for apt in apartments:
        m_exp = Decimal(monthly_expected.get(apt.id, 0)).quantize(Decimal("0.01"))
        m_paid = Decimal(monthly_paid.get(apt.id, 0)).quantize(Decimal("0.01"))
        m_bal = (m_exp - m_paid).quantize(Decimal("0.01"))

        s_exp = Decimal(special_expected.get(apt.id, 0)).quantize(Decimal("0.01"))
        s_paid = Decimal(special_paid.get(apt.id, 0)).quantize(Decimal("0.01"))
        s_bal = (s_exp - s_paid).quantize(Decimal("0.01"))

        total_balance = max(Decimal("0"), m_bal + s_bal).quantize(Decimal("0.01"))

        active = active_tenants_by_apt.get(apt.id)
        fallback = (
            fallback_by_id.get(apt.fallback_owner_tenant_id)
            if apt.fallback_owner_tenant_id
            else None
        )
        if active is not None:
            responsible_label = "active"
        elif fallback is not None:
            responsible_label = "owner_fallback"
        else:
            responsible_label = "none"

        # All tenants on the apt, sorted active-first then most-recent. The
        # frontend renders the first one ("primary payer") prominently and
        # the rest muted/grey.
        apt_tenants = [
            {
                "id": str(t.id),
                "name": t.name,
                "ownership_type": (
                    t.ownership_type.value
                    if t.ownership_type is not None
                    else None
                ),
                "is_active": t.is_active,
                "is_primary_payer": active is not None and t.id == active.id,
                "is_fallback_owner": (
                    fallback is not None and t.id == fallback.id
                ),
            }
            for t in tenants_by_apt.get(apt.id, [])
        ]

        rows.append({
            "apartment_id": str(apt.id),
            "apartment_number": apt.number,
            "active_tenant": _tenant_brief(active),
            "fallback_owner": _tenant_brief(fallback),
            "responsible_label": responsible_label,
            "apartment_tenants": apt_tenants,
            "monthly_expected": str(m_exp),
            "monthly_paid": str(m_paid),
            "monthly_balance": str(m_bal),
            "special_expected": str(s_exp),
            "special_paid": str(s_paid),
            "special_balance": str(s_bal),
            "total_balance": str(total_balance),
            "status": _status(total_balance, m_exp, m_paid, has_active=active is not None),
        })

    return {
        "building": {"id": str(building.id), "name": building.name},
        "rows": rows,
    }
