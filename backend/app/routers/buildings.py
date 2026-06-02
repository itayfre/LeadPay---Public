import datetime as dt
import urllib.parse

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from typing import List
from uuid import UUID
from collections import defaultdict

from ..database import get_db
from ..models import Building, Apartment, Tenant
from ..models.transaction_allocation import TransactionAllocation
from ..models.user import User
from ..schemas import BuildingCreate, BuildingUpdate, BuildingResponse
from ..dependencies.auth import (
    require_manager,
    require_worker_plus,
    require_any_auth,
    assert_tenant_building_access,
)
from ..models.user import UserRole
from ..services.expense_categories import seed_default_categories
from ..services.report_data import build_report_payload
from ..services.report_pdf import render_report_pdf
from ..services.report_docx import render_report_docx

router = APIRouter(
    prefix="/api/v1/buildings",
    tags=["buildings"]
)


@router.post("/", response_model=BuildingResponse, status_code=status.HTTP_201_CREATED)
def create_building(
    building: BuildingCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Create a new building"""
    # Check if building with same name already exists
    existing = db.query(Building).filter(Building.name == building.name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Building with name '{building.name}' already exists"
        )

    try:
        # exclude_none so the DB's server_default kicks in for omitted fields like default_move_in_date
        db_building = Building(**building.model_dump(exclude_none=True))
        db.add(db_building)
        db.flush()  # populate db_building.id before seeding categories

        # Seed 6 default expense categories for the new building.
        seed_default_categories(db, db_building.id)

        db.commit()
        db.refresh(db_building)
        return db_building
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Building with name '{building.name}' already exists"
        )


def _building_row(building: Building, tenant_count: int, total_expected: float) -> dict:
    """Serialize a Building dict from pre-computed counts."""
    return {
        "id": str(building.id),
        "name": building.name,
        "address": building.address,
        "city": building.city,
        "bank_account_number": building.bank_account_number,
        "total_tenants": tenant_count,
        "expected_monthly_payment": float(building.expected_monthly_payment) if building.expected_monthly_payment else None,
        "default_move_in_date": building.default_move_in_date.isoformat() if building.default_move_in_date else None,
        "total_expected_monthly": total_expected,
        "created_at": building.created_at.isoformat() if building.created_at else None,
        "updated_at": building.updated_at.isoformat() if building.updated_at else None,
    }


def _building_with_live_count(building: Building, db: Session) -> dict:
    """Serialize a single Building with live tenant count and computed expected monthly total."""
    count = (
        db.query(func.count(Tenant.id))
        .join(Apartment, Tenant.apartment_id == Apartment.id)
        .filter(Apartment.building_id == building.id, Tenant.is_active == True)
        .scalar() or 0
    )

    # Sum expected payment per APARTMENT (not per tenant) to avoid double-counting
    # apartments that have multiple active tenants (e.g., owner + renter).
    building_default = float(building.expected_monthly_payment or 0)
    apartments_with_active_tenants = (
        db.query(Apartment)
        .join(Tenant, Tenant.apartment_id == Apartment.id)
        .filter(Apartment.building_id == building.id, Tenant.is_active == True)
        .distinct(Apartment.id)
        .all()
    )
    total_expected_monthly = sum(
        float(apt.expected_payment) if apt.expected_payment is not None else building_default
        for apt in apartments_with_active_tenants
    )

    return _building_row(building, count, total_expected_monthly)


@router.get("/", response_model=List[dict])
def list_buildings(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_auth),
):
    """Get all buildings with live tenant counts — uses bulk queries to avoid N+1."""
    q = db.query(Building)
    if current_user.role == UserRole.TENANT:
        if not current_user.building_id:
            return []
        q = q.filter(Building.id == current_user.building_id)
    buildings = q.offset(skip).limit(limit).all()
    if not buildings:
        return []

    building_ids = [b.id for b in buildings]

    # Bulk query 1: active tenant count per building
    tenant_counts = dict(
        db.query(Apartment.building_id, func.count(func.distinct(Tenant.id)))
        .join(Tenant, Tenant.apartment_id == Apartment.id)
        .filter(Apartment.building_id.in_(building_ids), Tenant.is_active == True)
        .group_by(Apartment.building_id)
        .all()
    )

    # Bulk query 2: distinct active apartments per building (for expected payment sum)
    apt_rows = (
        db.query(Apartment.building_id, Apartment.id, Apartment.expected_payment)
        .join(Tenant, Tenant.apartment_id == Apartment.id)
        .filter(Apartment.building_id.in_(building_ids), Tenant.is_active == True)
        .distinct(Apartment.building_id, Apartment.id)
        .all()
    )

    # Group apartment expected_payments by building_id
    apt_payments: dict = defaultdict(list)
    for bid, _apt_id, ep in apt_rows:
        apt_payments[bid].append(ep)

    result = []
    for b in buildings:
        building_default = float(b.expected_monthly_payment or 0)
        total_expected = sum(
            float(ep) if ep is not None else building_default
            for ep in apt_payments.get(b.id, [])
        )
        result.append(_building_row(b, tenant_counts.get(b.id, 0), total_expected))

    return result


@router.get("/{building_id}", response_model=dict)
def get_building(
    building_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_auth),
):
    """Get a specific building by ID with live tenant count"""
    assert_tenant_building_access(current_user, building_id)
    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found"
        )
    return _building_with_live_count(building, db)


@router.put("/{building_id}", response_model=BuildingResponse)
def update_building(
    building_id: UUID,
    building_update: BuildingUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Update a building"""
    db_building = db.query(Building).filter(Building.id == building_id).first()
    if not db_building:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found"
        )

    # Update only provided fields
    update_data = building_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(db_building, field, value)

    db.commit()
    db.refresh(db_building)
    return db_building


@router.delete("/{building_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_building(
    building_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Delete a building"""
    db_building = db.query(Building).filter(Building.id == building_id).first()
    if not db_building:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found"
        )

    # Wipe allocations targeting tenants in this building first — otherwise the
    # ON DELETE SET NULL FK on transaction_allocations.tenant_id fires during the
    # cascade and violates ck_allocation_has_target for label-less allocations.
    tenant_ids = db.query(Tenant.id).filter(Tenant.building_id == building_id).subquery()
    db.query(TransactionAllocation).filter(
        TransactionAllocation.tenant_id.in_(tenant_ids)
    ).delete(synchronize_session=False)

    db.delete(db_building)
    db.commit()
    return None


# ─── Report endpoints ─────────────────────────────────────────────────────────

def _parse_report_period(from_: str, to: str) -> tuple[dt.date, dt.date]:
    try:
        f = dt.datetime.strptime(from_, "%Y-%m").date()
        t = dt.datetime.strptime(to, "%Y-%m").date()
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="from/to must be YYYY-MM format",
        )
    if f > t:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="`from` must be <= `to`",
        )
    # Snap to month boundaries
    last_day = (t.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    return f.replace(day=1), last_day


@router.get("/{building_id}/report")
def get_building_report(
    building_id: UUID,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_auth),
):
    assert_tenant_building_access(current_user, building_id)
    f, t = _parse_report_period(from_, to)
    try:
        return build_report_payload(db, building_id, f, t)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("/{building_id}/report.pdf")
def get_building_report_pdf(
    building_id: UUID,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_auth),
):
    assert_tenant_building_access(current_user, building_id)
    f, t = _parse_report_period(from_, to)
    try:
        payload = build_report_payload(db, building_id, f, t)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    pdf = render_report_pdf(payload)
    fname = urllib.parse.quote(
        f"דוח_{payload['building']['name']}_{payload['period']['label']}.pdf"
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"},
    )


@router.get("/{building_id}/report.docx")
def get_building_report_docx(
    building_id: UUID,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_any_auth),
):
    assert_tenant_building_access(current_user, building_id)
    f, t = _parse_report_period(from_, to)
    try:
        payload = build_report_payload(db, building_id, f, t)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    doc = render_report_docx(payload)
    fname = urllib.parse.quote(
        f"דוח_{payload['building']['name']}_{payload['period']['label']}.docx"
    )
    return Response(
        content=doc,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"},
    )
