"""
Expenses router — per-building user-defined expense categories + the
expense-allocations they tag.

Coexists with the legacy `TransactionAllocation.category` string column.
This router only reads/writes the new `category_id` FK; the legacy column
is still populated by the upload flow (vendor_classifier) and remains
untouched.

Expense allocations are TransactionAllocation rows where
  tenant_id IS NULL AND label IS NOT NULL
(matches the convention used by `app/routers/statements.py:843+`.)

Building scoping for allocations: walk
  TransactionAllocation -> Transaction -> BankStatement.building_id
"""
from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from ..database import get_db
from ..dependencies.auth import (
    require_worker_plus,
    require_viewer_or_tenant,
    assert_tenant_building_access,
)
from ..models import (
    BankStatement,
    Building,
    ExpenseCategory,
    Transaction,
    TransactionAllocation,
    VendorMapping,
)
from ..models.name_mapping import MappingCreatedBy
from ..models.user import User
from ..schemas.expense import (
    BulkCategorizeRequest,
    BulkCategorizeResponse,
    ExpenseCategoryCreate,
    ExpenseCategoryResponse,
    ExpenseCategoryUpdate,
    ExpenseRow,
    SetCategoryRequest,
)


router = APIRouter(
    prefix="/api/v1/expenses",
    tags=["expenses"],
)


# ---------- Helpers ----------

def _parse_period(p: str, field_name: str) -> tuple[int, int]:
    """Parse 'YYYY-MM' into (year, month). Raises 422 on bad input."""
    try:
        y_str, m_str = p.split("-")
        y, m = int(y_str), int(m_str)
        if not (1 <= m <= 12) or y < 1900 or y > 2999:
            raise ValueError
        return y, m
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name} must be in YYYY-MM format",
        )


def _period_range_pairs(from_y: int, from_m: int, to_y: int, to_m: int) -> List[tuple]:
    """All (year, month) pairs from (from_y, from_m) through (to_y, to_m), inclusive."""
    out = []
    y, m = from_y, from_m
    while (y, m) <= (to_y, to_m):
        out.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


def _ensure_building(db: Session, building_id: UUID) -> Building:
    b = db.query(Building).filter(Building.id == building_id).first()
    if not b:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found",
        )
    return b


# ---------- Categories CRUD ----------

@router.get("/{building_id}/categories/", response_model=List[ExpenseCategoryResponse])
def list_categories(
    building_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """List active expense categories for a building."""
    assert_tenant_building_access(current_user, building_id)
    _ensure_building(db, building_id)
    rows = (
        db.query(ExpenseCategory)
        .filter(
            ExpenseCategory.building_id == building_id,
            ExpenseCategory.is_active == True,
        )
        .order_by(ExpenseCategory.is_default.desc(), ExpenseCategory.name.asc())
        .all()
    )
    return rows


@router.post(
    "/{building_id}/categories/",
    response_model=ExpenseCategoryResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_category(
    building_id: UUID,
    payload: ExpenseCategoryCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Create a new expense category. 409 on duplicate name within the building."""
    _ensure_building(db, building_id)
    try:
        cat = ExpenseCategory(
            building_id=building_id,
            name=payload.name.strip(),
            color=payload.color,
            is_default=False,
            is_active=True,
        )
        db.add(cat)
        db.commit()
        db.refresh(cat)
        return cat
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Category '{payload.name}' already exists for this building",
        )


@router.patch("/categories/{category_id}", response_model=ExpenseCategoryResponse)
def update_category(
    category_id: UUID,
    payload: ExpenseCategoryUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Rename or recolor a category."""
    cat = db.query(ExpenseCategory).filter(ExpenseCategory.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    if payload.name is not None:
        cat.name = payload.name.strip()
    if payload.color is not None:
        cat.color = payload.color

    try:
        db.commit()
        db.refresh(cat)
        return cat
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A category with this name already exists for this building",
        )


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """
    Hard-delete a category. Refuses (409) if any allocation still references it,
    so the user is forced to first move/clear those allocations.
    """
    cat = db.query(ExpenseCategory).filter(ExpenseCategory.id == category_id).first()
    if not cat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

    in_use = (
        db.query(TransactionAllocation.id)
        .filter(TransactionAllocation.category_id == category_id)
        .first()
    )
    if in_use:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Category is referenced by one or more expenses. Reassign them first.",
        )

    db.delete(cat)
    db.commit()
    return None


# ---------- Expense allocations listing + tagging ----------

@router.get("/{building_id}/", response_model=List[ExpenseRow])
def list_expenses(
    building_id: UUID,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    assert_tenant_building_access(current_user, building_id)
    """
    List expense allocations for a building over an inclusive YYYY-MM range,
    joined to category metadata (left-join — uncategorized included).

    Building scoping is via Transaction.statement_id -> BankStatement.building_id.
    Manual transactions without a statement are not currently emitted as expenses
    by any flow, so this scoping is correct for today; revisit if that changes.
    """
    _ensure_building(db, building_id)
    from_y, from_m = _parse_period(from_, "from")
    to_y, to_m = _parse_period(to, "to")
    if (from_y, from_m) > (to_y, to_m):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="`from` must be <= `to`",
        )
    pairs = _period_range_pairs(from_y, from_m, to_y, to_m)
    if len(pairs) > 24:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Range cannot exceed 24 months",
        )

    from sqlalchemy import tuple_

    # Label-only allocations have no APD pointer (Phase 6b cutover) — filter
    # by Transaction.activity_date year/month instead. The writer derives
    # the legacy period fields from activity_date in the first place, so
    # this is semantically equivalent.
    rows = (
        db.query(
            TransactionAllocation.id.label("allocation_id"),
            Transaction.id.label("transaction_id"),
            Transaction.activity_date.label("activity_date"),
            Transaction.description.label("description"),
            TransactionAllocation.amount.label("amount"),
            TransactionAllocation.label.label("vendor_label"),
            TransactionAllocation.category_id.label("category_id"),
            ExpenseCategory.name.label("category_name"),
            ExpenseCategory.color.label("category_color"),
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .join(BankStatement, BankStatement.id == Transaction.statement_id)
        .outerjoin(
            ExpenseCategory, ExpenseCategory.id == TransactionAllocation.category_id
        )
        .filter(
            BankStatement.building_id == building_id,
            TransactionAllocation.tenant_id.is_(None),
            TransactionAllocation.label.isnot(None),
            tuple_(
                func.extract("year", Transaction.activity_date),
                func.extract("month", Transaction.activity_date),
            ).in_(pairs),
        )
        .order_by(Transaction.activity_date.desc())
        .all()
    )

    return [
        ExpenseRow(
            transaction_id=r.transaction_id,
            allocation_id=r.allocation_id,
            date=r.activity_date.date() if isinstance(r.activity_date, datetime) else r.activity_date,
            amount=float(r.amount),
            description=r.description,
            vendor_label=r.vendor_label,
            category_id=r.category_id,
            category_name=r.category_name,
            category_color=r.category_color,
        )
        for r in rows
    ]


@router.patch("/transactions/{transaction_id}/category", response_model=ExpenseRow)
def set_transaction_category(
    transaction_id: UUID,
    payload: SetCategoryRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """
    Set (or unset) the category on a transaction's expense allocation.
    Returns the updated row in `ExpenseRow` shape.
    """
    alloc = (
        db.query(TransactionAllocation)
        .filter(
            TransactionAllocation.transaction_id == transaction_id,
            TransactionAllocation.tenant_id.is_(None),
            TransactionAllocation.label.isnot(None),
        )
        .first()
    )
    if not alloc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No expense allocation found for this transaction",
        )

    if payload.category_id is not None:
        cat = (
            db.query(ExpenseCategory)
            .filter(ExpenseCategory.id == payload.category_id)
            .first()
        )
        if not cat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Category not found"
            )
    alloc.category_id = payload.category_id
    db.commit()
    db.refresh(alloc)

    transaction = (
        db.query(Transaction).filter(Transaction.id == transaction_id).first()
    )
    cat = (
        db.query(ExpenseCategory)
        .filter(ExpenseCategory.id == alloc.category_id)
        .first()
        if alloc.category_id
        else None
    )
    return ExpenseRow(
        transaction_id=transaction.id,
        allocation_id=alloc.id,
        date=transaction.activity_date.date()
        if isinstance(transaction.activity_date, datetime)
        else transaction.activity_date,
        amount=float(alloc.amount),
        description=transaction.description,
        vendor_label=alloc.label,
        category_id=alloc.category_id,
        category_name=cat.name if cat else None,
        category_color=cat.color if cat else None,
    )


@router.post(
    "/{building_id}/bulk-categorize", response_model=BulkCategorizeResponse
)
def bulk_categorize(
    building_id: UUID,
    payload: BulkCategorizeRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """
    Bulk-set the same category (and optionally vendor label / notes) on many
    transactions. For each transaction in scope:
      - if an expense allocation (tenant_id IS NULL) already exists, update
        the fields that were passed (category_id always; vendor_label / notes
        only when non-None — existing values preserved otherwise).
      - if no such allocation exists, CREATE one with the request's
        vendor_label (or "הוצאה" as a fallback) and category_id / notes.
        Amount = transaction.debit_amount (fallback: credit_amount).

    If `remember=True` and `vendor_label` is set, upserts a VendorMapping per
    distinct transaction description so future uploads auto-classify.

    Returns the number of allocations created or updated. Transactions that
    don't belong to this building are silently skipped.
    """
    from decimal import Decimal

    _ensure_building(db, building_id)
    if not payload.transaction_ids:
        return BulkCategorizeResponse(updated=0)

    if payload.category_id is not None:
        cat = (
            db.query(ExpenseCategory)
            .filter(
                ExpenseCategory.id == payload.category_id,
                ExpenseCategory.building_id == building_id,
            )
            .first()
        )
        if not cat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Category not found for this building",
            )
    else:
        cat = None

    # All in-scope transactions (used for both update + create paths).
    txns = (
        db.query(Transaction)
        .join(BankStatement, BankStatement.id == Transaction.statement_id)
        .filter(
            BankStatement.building_id == building_id,
            Transaction.id.in_(payload.transaction_ids),
        )
        .all()
    )

    # Existing label-only allocations for those txns, keyed by transaction_id.
    existing_allocs = {
        a.transaction_id: a
        for a in (
            db.query(TransactionAllocation)
            .filter(
                TransactionAllocation.transaction_id.in_([t.id for t in txns]),
                TransactionAllocation.tenant_id.is_(None),
            )
            .all()
        )
    }

    normalized_notes = (
        payload.notes.strip() if payload.notes and payload.notes.strip() else None
    )
    fallback_label = "הוצאה"

    updated = 0
    for t in txns:
        alloc = existing_allocs.get(t.id)
        if alloc is not None:
            # Always apply category_id (None means unassign — backward compat).
            alloc.category_id = payload.category_id
            # Only overwrite label / notes when the caller actually supplied them.
            if payload.vendor_label is not None:
                alloc.label = payload.vendor_label
            if payload.notes is not None:
                alloc.notes = normalized_notes
            updated += 1
        else:
            amount_src = t.debit_amount if t.debit_amount else t.credit_amount
            if amount_src is None:
                # No amount to allocate — skip (shouldn't happen for real txns).
                continue
            new_alloc = TransactionAllocation(
                transaction_id=t.id,
                tenant_id=None,
                label=payload.vendor_label or fallback_label,
                category_id=payload.category_id,
                amount=Decimal(str(abs(amount_src))),
                notes=normalized_notes,
            )
            db.add(new_alloc)
            updated += 1

    # Upsert VendorMapping per distinct description (Task 8). Mirrors the
    # single-transaction `categorize_transaction` flow in statements.py.
    if payload.remember and payload.vendor_label and cat is not None:
        seen_keywords: set[str] = set()
        for t in txns:
            if not t.description:
                continue
            keyword = t.description.strip().lower()
            if not keyword or keyword in seen_keywords:
                continue
            seen_keywords.add(keyword)
            existing = (
                db.query(VendorMapping)
                .filter(
                    VendorMapping.building_id == building_id,
                    VendorMapping.keyword == keyword,
                )
                .first()
            )
            if existing:
                existing.vendor_label = payload.vendor_label
                existing.category = cat.name
                existing.created_by = MappingCreatedBy.MANUAL
            else:
                db.add(
                    VendorMapping(
                        building_id=building_id,
                        keyword=keyword,
                        vendor_label=payload.vendor_label,
                        category=cat.name,
                        created_by=MappingCreatedBy.MANUAL,
                    )
                )

    db.commit()
    return BulkCategorizeResponse(updated=updated)
