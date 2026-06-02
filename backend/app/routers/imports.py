"""Bulk-import endpoints. Today: monthly-amounts from the building's
'tenants xlsx' file.
"""
from __future__ import annotations

import os
import tempfile
from datetime import date
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies.auth import assert_tenant_building_access, require_worker_plus
from ..models.building import Building
from ..models.user import User
from ..services.monthly_amount_import import (
    apply_import,
    build_preview,
)


router = APIRouter(
    prefix="/api/v1/imports",
    tags=["imports"],
)


ALLOWED_EXTENSIONS = {".xlsx", ".xls"}
MAX_UPLOAD_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/monthly-amounts/", status_code=status.HTTP_200_OK)
async def import_monthly_amounts(
    file: UploadFile = File(...),
    building_id: UUID = Form(...),
    dry_run: bool = Form(True),
    scope: str = Form("future_only"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_worker_plus),
):
    """Upload the per-building 'tenants xlsx' and import its monthly amounts.

    Workflow:
    1. POST with ``dry_run=true`` to get a preview of changes. No DB writes.
    2. Review the preview; if it looks right, POST again with ``dry_run=false``
       and a ``scope`` value:
         - ``future_only`` — only updates ``apartment.expected_payment``.
         - ``future_plus_current`` — also rewrites the CURRENT month's
           period-debt row if it's unpaid.
         - ``all_unpaid`` — rewrites EVERY unpaid period-debt row.

    Apartments whose label in the Excel can't be matched to a DB apartment
    (e.g. 'מסחר 0', 'דירת גן 1') are listed as 'unmatched' in the preview
    and skipped during apply.
    """
    assert_tenant_building_access(current_user, building_id)

    building = db.get(Building, building_id)
    if building is None:
        raise HTTPException(status_code=404, detail="Building not found")

    # Validate file extension.
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="סוג קובץ לא נתמך. יש להעלות קבצי Excel בלבד (.xlsx, .xls)",
        )

    # Validate scope (only used when applying, but reject early).
    if scope not in {"future_only", "future_plus_current", "all_unpaid"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown scope: {scope!r}. Expected one of "
                   "'future_only', 'future_plus_current', 'all_unpaid'.",
        )

    # L3: reject oversized uploads early, before buffering / writing to disk.
    if file.size is not None and file.size > MAX_UPLOAD_SIZE:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="הקובץ גדול מדי. הגודל המקסימלי הוא 10MB",
        )

    # Persist the upload to a temp file so the parser can read it.
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=ext, prefix="leadpay-monthly-"
    ) as tmp:
        contents = await file.read()
        if len(contents) > MAX_UPLOAD_SIZE:
            tmp_path = Path(tmp.name)
            tmp_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="הקובץ גדול מדי. הגודל המקסימלי הוא 10MB",
            )
        tmp.write(contents)
        tmp_path = Path(tmp.name)

    try:
        if dry_run:
            preview = build_preview(db, building_id, tmp_path)
            return {
                "dry_run": True,
                "matched_count": preview.matched_count,
                "unmatched_count": preview.unmatched_count,
                "update_count": preview.update_count,
                "rows": [_preview_row(r) for r in preview.rows],
            }

        today = date.today()
        result = apply_import(
            db, building_id, tmp_path,
            scope=scope,  # type: ignore[arg-type]
            current_year=today.year,
            current_month=today.month,
        )
        return {
            "dry_run": False,
            "scope": scope,
            "apartments_updated": result.apartments_updated,
            "period_debts_updated": result.period_debts_updated,
        }
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:  # pragma: no cover
            pass


def _preview_row(r) -> dict:
    return {
        "apt_label": r.apt_label,
        "apartment_id": r.apartment_id,
        "apartment_number": r.apartment_number,
        "current_amount": r.current_amount,
        "new_amount": r.new_amount,
        "delta": r.delta,
        "status": r.status,
    }
