from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session
from typing import List, Literal, Optional
from uuid import UUID
import pandas as pd
import io
import logging
import urllib.parse
from datetime import datetime
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..database import get_db
from ..models import Tenant, Apartment, Building, OwnershipType
from ..models.user import User
from ..schemas import TenantCreate, TenantUpdate, TenantResponse
from ..dependencies.auth import (
    require_manager,
    require_worker_plus,
    require_any_auth,
    require_viewer_or_tenant,
    assert_tenant_building_access,
)
from ..models.user import UserRole
from ..services.tenant_report_data import build_tenant_report_payload
from ..services.report_pdf import render_tenant_report_pdf
from ..services.report_docx import render_tenant_report_docx
from .buildings import _parse_report_period

logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)


class ResolveApartmentRequest(BaseModel):
    apt_number: int
    floor: int = 0


class PatchApartmentRequest(BaseModel):
    expected_payment: Optional[float] = None
    # Pass a UUID string to set the legal fallback owner; pass None to clear it.
    # The endpoint validates the tenant belongs to this apartment.
    fallback_owner_tenant_id: Optional[UUID] = None


class BulkReportRequest(BaseModel):
    tenant_ids: list[UUID] = Field(..., min_length=1, max_length=50)

router = APIRouter(
    prefix="/api/v1/tenants",
    tags=["tenants"]
)


def normalize_phone(phone: str) -> str:
    """Normalize phone number to +972 format"""
    if not phone:
        return None

    phone_str = str(phone).strip()

    # If already in +972 format, return as-is (strip only non-digits after the +)
    if phone_str.startswith('+972'):
        digits = ''.join(filter(str.isdigit, phone_str[4:]))
        return '+972' + digits

    # Remove spaces, dashes, and other non-numeric characters
    phone_digits = ''.join(filter(str.isdigit, phone_str))

    # If it starts with 972 (country code without +), strip it
    if phone_digits.startswith('972'):
        return '+972' + phone_digits[3:]

    # If it starts with 0, replace with +972
    if phone_digits.startswith('0'):
        return '+972' + phone_digits[1:]

    # Otherwise prepend +972
    return '+972' + phone_digits


@router.post("/", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
def create_tenant(
    tenant: TenantCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Create a new tenant"""
    apartment = db.query(Apartment).filter(Apartment.id == tenant.apartment_id).first()
    if not apartment:
        raise HTTPException(status_code=404, detail=f"Apartment {tenant.apartment_id} not found")

    tenant_data = tenant.model_dump()
    if tenant_data.get('phone'):
        tenant_data['phone'] = normalize_phone(tenant_data['phone'])

    db_tenant = Tenant(**tenant_data)
    db.add(db_tenant)
    db.commit()
    db.refresh(db_tenant)
    return db_tenant


@router.get("/", response_model=List[dict])
def list_tenants(
    building_id: UUID = None,
    skip: int = 0,
    limit: int = 100,
    archived: bool = Query(
        False,
        description=(
            "When False (default), returns only non-archived tenants. "
            "When True, returns ONLY archived tenants (for the archive view)."
        ),
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """Get all tenants (optionally filtered by building), with apartment and building info.

    By default, archived tenants (those soft-deleted via DELETE) are excluded.
    Pass ``archived=true`` to view only the archive.
    """
    if current_user.role == UserRole.TENANT:
        if not current_user.building_id:
            return []
        if building_id and str(building_id) != str(current_user.building_id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access to this building is not permitted")
        building_id = current_user.building_id
    query = (
        db.query(Tenant, Apartment, Building)
        .join(Apartment, Tenant.apartment_id == Apartment.id)
        .join(Building, Tenant.building_id == Building.id)
    )
    if building_id:
        query = query.filter(Tenant.building_id == building_id)
    if archived:
        query = query.filter(Tenant.archived_at.isnot(None))
    else:
        query = query.filter(Tenant.archived_at.is_(None))

    results = query.offset(skip).limit(limit).all()

    return [
        {
            "id": str(tenant.id),
            "apartment_id": str(tenant.apartment_id),
            "building_id": str(tenant.building_id),
            "building_name": building.name,
            "apartment_number": apartment.number,
            "floor": apartment.floor,
            "expected_payment": float(apartment.expected_payment) if apartment.expected_payment is not None else None,
            "building_expected_payment": float(building.expected_monthly_payment) if building.expected_monthly_payment is not None else None,
            "name": tenant.name,
            "full_name": tenant.full_name,
            "phone": tenant.phone,
            "email": tenant.email,
            "language": tenant.language.value if hasattr(tenant.language, 'value') else tenant.language,
            "ownership_type": tenant.ownership_type.value if hasattr(tenant.ownership_type, 'value') else tenant.ownership_type,
            "is_committee_member": tenant.is_committee_member,
            "standing_order_start_date": tenant.standing_order_start_date.isoformat() if tenant.standing_order_start_date else None,
            "standing_order_end_date": tenant.standing_order_end_date.isoformat() if tenant.standing_order_end_date else None,
            "standing_order_amount": float(tenant.standing_order_amount) if tenant.standing_order_amount is not None else None,
            "notes": tenant.notes,
            "is_active": tenant.is_active,
            "archived_at": tenant.archived_at.isoformat() if tenant.archived_at else None,
            "move_in_date": tenant.move_in_date.isoformat() if tenant.move_in_date else None,
            "building_default_move_in_date": building.default_move_in_date.isoformat() if building.default_move_in_date else None,
            "effective_move_in_date": (tenant.move_in_date or building.default_move_in_date).isoformat()
                if (tenant.move_in_date or building.default_move_in_date) else None,
            "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
            "updated_at": tenant.updated_at.isoformat() if tenant.updated_at else None,
        }
        for tenant, apartment, building in results
    ]


@router.get("/{tenant_id}", response_model=TenantResponse)
def get_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """Get a specific tenant by ID"""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tenant with id {tenant_id} not found"
        )
    assert_tenant_building_access(current_user, tenant.building_id)
    return tenant


@router.put("/{tenant_id}", response_model=TenantResponse)
def update_tenant(
    tenant_id: UUID,
    tenant_update: TenantUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Update a tenant"""
    db_tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not db_tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tenant with id {tenant_id} not found"
        )

    # Update only provided fields
    update_data = tenant_update.model_dump(exclude_unset=True)

    # Normalize phone if provided
    if 'phone' in update_data and update_data['phone']:
        update_data['phone'] = normalize_phone(update_data['phone'])

    for field, value in update_data.items():
        setattr(db_tenant, field, value)

    db.commit()
    db.refresh(db_tenant)
    return db_tenant


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Archive a tenant (sets archived_at=now()).

    The tenant record, payment history, and allocations are preserved so the
    data can be restored via POST /{tenant_id}/restore. Archived tenants
    disappear from the default list and surface only in the archive view.

    If the tenant is the active payer for an apartment that still has other
    non-archived tenants, the request is rejected: the caller must promote a
    sibling to active first (see TenantModal flow). The active payer of an
    apartment with no other tenants may be archived freely.
    """
    db_tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not db_tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tenant with id {tenant_id} not found"
        )
    if db_tenant.archived_at is not None:
        return None  # idempotent

    if db_tenant.is_active:
        # Don't strand an apartment with siblings but no active payer.
        sibling_count = (
            db.query(Tenant)
            .filter(
                Tenant.apartment_id == db_tenant.apartment_id,
                Tenant.id != db_tenant.id,
                Tenant.archived_at.is_(None),
            )
            .count()
        )
        if sibling_count > 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "Cannot archive the active payer while other tenants remain "
                    "in the apartment. Switch the active payer to another tenant first."
                ),
            )

    db_tenant.archived_at = datetime.utcnow()
    # Clear is_active so the partial unique index doesn't block another
    # tenant from becoming active in this apartment later.
    db_tenant.is_active = False
    db.commit()
    return None


@router.post("/{tenant_id}/restore", status_code=status.HTTP_200_OK)
def restore_tenant(
    tenant_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_manager),
):
    """Restore an archived tenant (clears archived_at).

    The restored tenant comes back as non-active (is_active=False) — the
    apartment may already have an active payer, and the partial unique index
    forbids two actives. The caller can promote them via the standard
    primary-payer switch flow if desired.
    """
    db_tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not db_tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tenant with id {tenant_id} not found"
        )
    if db_tenant.archived_at is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant is not archived"
        )

    db_tenant.archived_at = None
    db.commit()
    db.refresh(db_tenant)
    return {"ok": True, "tenant_id": str(tenant_id)}


@router.post("/{building_id}/apartments/resolve")
def resolve_apartment(
    building_id: UUID,
    data: ResolveApartmentRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Find or create an apartment by building + number. Returns apartment_id."""
    apt_number = data.apt_number
    floor = data.floor

    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found"
        )

    apartment = db.query(Apartment).filter(
        Apartment.building_id == building_id,
        Apartment.number == apt_number
    ).first()

    if not apartment:
        apartment = Apartment(
            building_id=building_id,
            number=apt_number,
            floor=floor
        )
        db.add(apartment)
        db.commit()
        db.refresh(apartment)

    return {
        "apartment_id": str(apartment.id),
        "apartment_number": apartment.number,
        "floor": apartment.floor
    }


@router.post("/{building_id}/import", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/minute")
async def import_tenants_from_excel(
    request: Request,
    building_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """
    Import tenants from an Excel file for a specific building.
    Expected columns: דירה (apartment), קומה (floor), שם (name),
    טלפון (phone), דואל (email), סוג בעלות (ownership type)
    """
    # Verify building exists
    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found"
        )

    # Read Excel file
    try:
        contents = await file.read()
        df = pd.read_excel(io.BytesIO(contents))
        # Strip leading/trailing whitespace from all column names (real Excel files have trailing spaces)
        df.columns = df.columns.str.strip()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read Excel file: {str(e)}"
        )

    # Map Hebrew column names to English
    column_mapping = {
        'דירה': 'apartment',
        'קומה': 'floor',
        'שם': 'name',
        'טלפון': 'phone',
        'דואל': 'email',
        'סוג בעלות': 'ownership_type',
    }

    df = df.rename(columns=column_mapping)

    # Validate required columns
    required_columns = ['apartment', 'floor', 'name', 'ownership_type']
    missing_columns = [col for col in required_columns if col not in df.columns]
    if missing_columns:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"חסרות עמודות נדרשות: {', '.join(missing_columns)}"
        )

    imported_count = 0
    errors = []

    for index, row in df.iterrows():
        try:
            # Get tenant name for error messages
            tenant_name_raw = row.get('name')
            tenant_name_for_error = str(tenant_name_raw).strip() if pd.notna(tenant_name_raw) else f'שורה {index + 1}'

            # Check for missing apartment number
            apt_val = row.get('apartment')
            if pd.isna(apt_val) or apt_val is None:
                errors.append(f"שורה {index + 1}: מספר דירה חסר עבור {tenant_name_for_error}. אנא הוסף ידנית.")
                continue

            # Get or create apartment
            apartment = db.query(Apartment).filter(
                Apartment.building_id == building_id,
                Apartment.number == int(row['apartment'])
            ).first()

            if not apartment:
                # Create apartment
                apartment = Apartment(
                    building_id=building_id,
                    number=int(row['apartment']),
                    floor=int(row['floor'])
                )
                db.add(apartment)
                db.flush()

            # Map ownership type — empty/NaN defaults silently to RENTER;
            # unrecognised non-empty value still imports as RENTER but adds a warning.
            ownership_map = {
                'בעלים': OwnershipType.OWNER,
                'משכיר': OwnershipType.LANDLORD,
                'שוכר': OwnershipType.RENTER
            }
            raw_ownership = row['ownership_type']
            is_missing = pd.isna(raw_ownership) or str(raw_ownership).strip() == ''
            ownership_str = '' if is_missing else str(raw_ownership).strip()
            ownership_type = ownership_map.get(ownership_str)
            if ownership_type is None:
                ownership_type = OwnershipType.RENTER
                if not is_missing:
                    errors.append(f"שורה {index + 1}: סוג בעלות לא חוקי '{raw_ownership}' — שונה לשוכר")

            # Check for existing tenant with same name in this apartment
            existing = db.query(Tenant).filter(
                Tenant.apartment_id == apartment.id,
                Tenant.name == row['name']
            ).first()
            if existing:
                errors.append(f"שורה {index + 1}: דייר '{row['name']}' כבר קיים בדירה {int(row['apartment'])}")
                continue

            # Create tenant
            phone_raw = row.get('phone')
            if pd.notna(phone_raw):
                phone = normalize_phone(str(phone_raw))  # coerce int/float to str first
            else:
                phone = None
            email = row.get('email') if pd.notna(row.get('email')) else None

            tenant = Tenant(
                apartment_id=apartment.id,
                building_id=building_id,
                name=row['name'],
                full_name=row['name'],
                phone=phone,
                email=email,
                ownership_type=ownership_type,
                is_active=True
            )
            db.add(tenant)
            imported_count += 1

        except Exception as e:
            logger.error(f"Row {index+1} error: {e}")
            errors.append(f"שורה {index + 1}: שגיאה בעיבוד השורה")
            continue

    # Commit all changes
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save tenants: {str(e)}"
        )

    return {
        "message": f"Successfully imported {imported_count} tenants",
        "imported_count": imported_count,
        "errors": errors if errors else None
    }


@router.patch("/apartments/{apartment_id}", status_code=status.HTTP_200_OK)
def patch_apartment(
    apartment_id: UUID,
    data: PatchApartmentRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Patch an apartment's expected_payment override. Pass null to clear override."""
    apartment = db.query(Apartment).filter(Apartment.id == apartment_id).first()
    if not apartment:
        raise HTTPException(status_code=404, detail=f"Apartment {apartment_id} not found")

    fields = data.model_dump(exclude_unset=True)

    if "expected_payment" in fields:
        apartment.expected_payment = (
            float(fields["expected_payment"]) if fields["expected_payment"] is not None else None
        )

    if "fallback_owner_tenant_id" in fields:
        new_owner_id = fields["fallback_owner_tenant_id"]
        if new_owner_id is not None:
            # Verify the tenant exists AND belongs to this apartment.
            tenant = db.query(Tenant).filter(Tenant.id == new_owner_id).first()
            if tenant is None:
                raise HTTPException(
                    status_code=404,
                    detail=f"Tenant {new_owner_id} not found",
                )
            if tenant.apartment_id != apartment.id:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Tenant {new_owner_id} belongs to apartment "
                        f"{tenant.apartment_id}, not {apartment.id}"
                    ),
                )
        apartment.fallback_owner_tenant_id = new_owner_id

    db.commit()
    db.refresh(apartment)
    return {
        "apartment_id": str(apartment.id),
        "expected_payment": float(apartment.expected_payment) if apartment.expected_payment is not None else None,
        "fallback_owner_tenant_id": (
            str(apartment.fallback_owner_tenant_id)
            if apartment.fallback_owner_tenant_id is not None
            else None
        ),
    }


# ─── Tenant report endpoints ──────────────────────────────────────────────────

@router.get("/{tenant_id}/report")
def get_tenant_report(
    tenant_id: UUID,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_any_auth),
):
    f, t = _parse_report_period(from_, to)
    try:
        return build_tenant_report_payload(db, tenant_id, f, t)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.get("/{tenant_id}/report.pdf")
def get_tenant_report_pdf(
    tenant_id: UUID,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_any_auth),
):
    f, t = _parse_report_period(from_, to)
    try:
        payload = build_tenant_report_payload(db, tenant_id, f, t)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    pdf = render_tenant_report_pdf(payload)
    fname = urllib.parse.quote(f"דוח_{payload['tenant']['name']}_{payload['period']['label']}.pdf")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"},
    )


@router.get("/{tenant_id}/report.docx")
def get_tenant_report_docx(
    tenant_id: UUID,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_any_auth),
):
    f, t = _parse_report_period(from_, to)
    try:
        payload = build_tenant_report_payload(db, tenant_id, f, t)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    doc = render_tenant_report_docx(payload)
    fname = urllib.parse.quote(f"דוח_{payload['tenant']['name']}_{payload['period']['label']}.docx")
    return Response(
        content=doc,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"},
    )


@router.post("/bulk-report")
def post_bulk_tenant_report(
    body: BulkReportRequest,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    fmt: Literal["pdf", "docx"] = Query("pdf", alias="format"),
    db: Session = Depends(get_db),
    _: User = Depends(require_any_auth),
):
    from ..services.tenant_report_data import build_bulk_report_zip

    f, t = _parse_report_period(from_, to)

    # All tenant_ids must belong to a single building (anti-leak guard).
    tenants = db.query(Tenant).filter(Tenant.id.in_(body.tenant_ids)).all()
    if len(tenants) != len(body.tenant_ids):
        raise HTTPException(status_code=400, detail="Duplicate or invalid tenant_ids")
    building_ids = {t.building_id for t in tenants}
    if len(building_ids) != 1:
        raise HTTPException(
            status_code=400,
            detail="All tenant_ids must belong to the same building",
        )

    zip_bytes, zip_filename = build_bulk_report_zip(db, body.tenant_ids, f, t, fmt)
    fname = urllib.parse.quote(zip_filename)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{fname}"},
    )
