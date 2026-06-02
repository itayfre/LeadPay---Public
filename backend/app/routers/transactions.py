"""
Global transactions router — list, filter, sort, paginate, and create transactions
across all buildings/statements. Used by the top-level Transactions management page.

Per-statement / per-transaction operations (PATCH, DELETE, match, unmatch, ignore,
categorize, allocations) still live in `statements.py`. This router only owns the
two global operations the management page needs:

    GET  /api/v1/transactions/   — filtered, sorted, paginated list
    POST /api/v1/transactions/   — create a manual transaction
"""
from datetime import date, datetime
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, model_validator
from sqlalchemy import or_, and_, func
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..models import (
    BankStatement,
    Building,
    Transaction,
    TransactionType,
    TransactionAllocation,
    Tenant,
)
from ..models.user import User
from ..schemas.allocation import AllocationItem
from ..dependencies.auth import require_viewer_plus, require_worker_plus
from ..services import allocation_service


router = APIRouter(prefix="/api/v1/transactions", tags=["transactions-global"])


# Sentinel filename used to identify the per-building "Manual entries" bucket.
MANUAL_BUCKET_FILENAME = "__manual__"


# ── Request models ───────────────────────────────────────────────────────────

class TransactionCreateRequest(BaseModel):
    building_id: UUID
    activity_date: date
    description: str
    payer_name: Optional[str] = None
    credit_amount: Optional[Decimal] = None
    debit_amount: Optional[Decimal] = None
    transaction_type: Optional[TransactionType] = TransactionType.PAYMENT
    reference_number: Optional[str] = None
    allocations: Optional[List[AllocationItem]] = None

    @model_validator(mode="after")
    def exactly_one_amount(self) -> "TransactionCreateRequest":
        has_credit = self.credit_amount is not None and self.credit_amount != 0
        has_debit = self.debit_amount is not None and self.debit_amount != 0
        if has_credit == has_debit:
            raise ValueError(
                "Provide exactly one of credit_amount or debit_amount (and it must be non-zero)"
            )
        amount = self.credit_amount if has_credit else self.debit_amount
        if amount is not None and amount < 0:
            raise ValueError("Amount must be positive (use credit vs debit to indicate direction)")
        return self


# ── Helpers ──────────────────────────────────────────────────────────────────

# Allowed sort columns → SQLAlchemy expression. The signed-amount sort uses
# COALESCE so rows with only credit (or only debit) sort correctly.
_SIGNED_AMOUNT = (
    func.coalesce(Transaction.credit_amount, 0) - func.coalesce(Transaction.debit_amount, 0)
)
_SORTABLE_COLUMNS = {
    "activity_date": Transaction.activity_date,
    "amount": _SIGNED_AMOUNT,
    "match_confidence": Transaction.match_confidence,
    "created_at": Transaction.created_at,
}


def _get_or_create_manual_bucket(db: Session, building_id: UUID) -> BankStatement:
    """Return the per-building 'Manual entries' BankStatement, creating it on first use.

    Manual transactions don't belong to a real bank file, but the list endpoint joins
    transactions to BankStatement to resolve building_id; giving them a synthetic
    statement keeps the join clean and lets manual rows appear in building-scoped
    summaries that already exist (e.g. statement deletion never affects this bucket).
    """
    bucket = db.query(BankStatement).filter(
        BankStatement.building_id == building_id,
        BankStatement.original_filename == MANUAL_BUCKET_FILENAME,
    ).first()
    if bucket:
        return bucket

    now = datetime.utcnow()
    bucket = BankStatement(
        building_id=building_id,
        original_filename=MANUAL_BUCKET_FILENAME,
        period_month=now.month,
        period_year=now.year,
    )
    db.add(bucket)
    db.flush()
    return bucket


def _serialize_row(t: Transaction, building_id_by_tenant: dict, building_name_by_id: dict) -> dict:
    """Flatten a Transaction (with loaded relationships) into a list row.

    `building_id_by_tenant` and `building_name_by_id` cover the case where a manual
    payment has statement_id=None but matched_tenant_id is set — we derive the
    building from the tenant's apartment.
    """
    statement = t.statement
    building_id: Optional[str] = None
    building_name: Optional[str] = None
    if statement is not None:
        building_id = str(statement.building_id)
        building_name = building_name_by_id.get(building_id)
    elif t.matched_tenant_id is not None:
        bid = building_id_by_tenant.get(str(t.matched_tenant_id))
        if bid:
            building_id = bid
            building_name = building_name_by_id.get(bid)

    allocations = list(t.allocations or [])
    alloc_total = sum((a.amount for a in allocations), Decimal(0))

    def _alloc_label(a) -> Optional[str]:
        if a.tenant_id and a.tenant is not None:
            return a.tenant.name
        return a.label

    alloc_labels = [lbl for lbl in (_alloc_label(a) for a in allocations) if lbl]
    top_label = alloc_labels[0] if alloc_labels else None

    return {
        "id": str(t.id),
        "activity_date": t.activity_date.isoformat() if t.activity_date else None,
        "reference_number": t.reference_number,
        "description": t.description,
        "extended_description": t.extended_description,
        "payer_name": t.payer_name,
        "credit_amount": float(t.credit_amount) if t.credit_amount is not None else None,
        "debit_amount": float(t.debit_amount) if t.debit_amount is not None else None,
        "balance": float(t.balance) if t.balance is not None else None,
        "transaction_type": t.transaction_type.value if t.transaction_type else None,
        "matched_tenant_id": str(t.matched_tenant_id) if t.matched_tenant_id else None,
        "matched_tenant_name": t.tenant.name if t.tenant is not None else None,
        "match_confidence": t.match_confidence,
        "match_method": t.match_method.value if t.match_method else None,
        "is_confirmed": bool(t.is_confirmed),
        "is_manual": bool(t.is_manual),
        "statement_id": str(t.statement_id) if t.statement_id else None,
        "building_id": building_id,
        "building_name": building_name,
        "allocations_summary": {
            "count": len(allocations),
            "total": float(alloc_total),
            "top_label": top_label,
            "labels": alloc_labels,
        },
    }


# ── GET /api/v1/transactions/ ────────────────────────────────────────────────

@router.get("/")
def list_transactions(
    building_id: Optional[List[UUID]] = Query(default=None),
    type: Optional[List[TransactionType]] = Query(default=None),
    direction: Optional[str] = Query(default=None, pattern="^(credit|debit|both)$"),
    match_status: Optional[List[str]] = Query(default=None),
    tenant_id: Optional[UUID] = Query(default=None),
    category_id: Optional[List[UUID]] = Query(default=None),
    source: Optional[str] = Query(default=None, pattern="^(bank|manual)$"),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    amount_min: Optional[Decimal] = Query(default=None),
    amount_max: Optional[Decimal] = Query(default=None),
    q: Optional[str] = Query(default=None),
    sort: str = Query(default="-activity_date"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_viewer_plus),
):
    """Return a paginated, filtered, sorted slice of all transactions.

    Match status values:
      confirmed  — is_confirmed=True AND matched_tenant_id IS NOT NULL  (single tenant, confirmed)
      split      — is_confirmed=True AND matched_tenant_id IS NULL      (multi-tenant split)
      auto       — matched_tenant_id IS NOT NULL AND NOT is_confirmed   (engine guess pending review)
      unmatched  — matched_tenant_id IS NULL AND NOT is_confirmed AND transaction_type != OTHER
      ignored    — matched_tenant_id IS NULL AND NOT is_confirmed AND transaction_type == OTHER

    Note: a split transaction stores its tenants in the `allocations` table and leaves
    `matched_tenant_id` NULL by design (the FK can only hold one tenant). `is_confirmed`
    is the single source of truth for "user resolved this row".
    """
    query = db.query(Transaction).outerjoin(
        BankStatement, Transaction.statement_id == BankStatement.id
    )

    # Building filter — works through statement.building_id; also include rows
    # where matched_tenant lives in one of those buildings (covers manual payments
    # with statement_id=None).
    if building_id:
        tenant_in_building = db.query(Tenant.id).filter(Tenant.building_id.in_(building_id))
        query = query.filter(
            or_(
                BankStatement.building_id.in_(building_id),
                Transaction.matched_tenant_id.in_(tenant_in_building),
            )
        )

    if type:
        query = query.filter(Transaction.transaction_type.in_(type))

    if direction == "credit":
        query = query.filter(Transaction.credit_amount.isnot(None), Transaction.credit_amount != 0)
    elif direction == "debit":
        query = query.filter(Transaction.debit_amount.isnot(None), Transaction.debit_amount != 0)

    if match_status:
        clauses = []
        for s in match_status:
            if s == "confirmed":
                # Single-tenant confirmed (FK populated, user-approved)
                clauses.append(and_(
                    Transaction.is_confirmed.is_(True),
                    Transaction.matched_tenant_id.isnot(None),
                ))
            elif s == "split":
                # Multi-tenant split: confirmed but FK is null because allocations table holds the truth
                clauses.append(and_(
                    Transaction.is_confirmed.is_(True),
                    Transaction.matched_tenant_id.is_(None),
                ))
            elif s == "auto":
                clauses.append(and_(
                    Transaction.matched_tenant_id.isnot(None),
                    Transaction.is_confirmed.is_(False),
                ))
            elif s == "unmatched":
                # Truly pending action — not confirmed, no FK, and not user-flagged as ignored
                clauses.append(and_(
                    Transaction.matched_tenant_id.is_(None),
                    Transaction.is_confirmed.is_(False),
                    Transaction.transaction_type != TransactionType.OTHER,
                ))
            elif s == "ignored":
                clauses.append(and_(
                    Transaction.matched_tenant_id.is_(None),
                    Transaction.is_confirmed.is_(False),
                    Transaction.transaction_type == TransactionType.OTHER,
                ))
        if clauses:
            query = query.filter(or_(*clauses))

    if tenant_id is not None:
        query = query.filter(Transaction.matched_tenant_id == tenant_id)

    if category_id:
        txn_ids = db.query(TransactionAllocation.transaction_id).filter(
            TransactionAllocation.category_id.in_(category_id)
        )
        query = query.filter(Transaction.id.in_(txn_ids))

    if source == "bank":
        query = query.filter(Transaction.is_manual.is_(False))
    elif source == "manual":
        query = query.filter(Transaction.is_manual.is_(True))

    if date_from is not None:
        query = query.filter(Transaction.activity_date >= datetime.combine(date_from, datetime.min.time()))
    if date_to is not None:
        # Inclusive end of day
        end = datetime.combine(date_to, datetime.max.time())
        query = query.filter(Transaction.activity_date <= end)

    if amount_min is not None:
        query = query.filter(_SIGNED_AMOUNT >= amount_min)
    if amount_max is not None:
        query = query.filter(_SIGNED_AMOUNT <= amount_max)

    if q:
        pattern = f"%{q}%"
        query = query.filter(or_(
            Transaction.description.ilike(pattern),
            Transaction.payer_name.ilike(pattern),
            Transaction.reference_number.ilike(pattern),
        ))

    # Total before pagination
    total = query.with_entities(func.count(Transaction.id)).scalar() or 0

    # Sorting
    desc = sort.startswith("-")
    sort_key = sort[1:] if desc else sort
    sort_col = _SORTABLE_COLUMNS.get(sort_key, Transaction.activity_date)
    query = query.order_by(sort_col.desc() if desc else sort_col.asc(), Transaction.id.desc())

    # Eager-load relationships used in the row serializer
    query = query.options(
        joinedload(Transaction.statement),
        joinedload(Transaction.tenant),
        joinedload(Transaction.allocations).joinedload(TransactionAllocation.tenant),
    )

    offset = (page - 1) * page_size
    rows: List[Transaction] = query.offset(offset).limit(page_size).all()

    # Resolve building names + tenant→building map in two batch queries
    building_ids = {r.statement.building_id for r in rows if r.statement is not None}
    tenant_ids_needing_building = {
        r.matched_tenant_id for r in rows
        if r.statement is None and r.matched_tenant_id is not None
    }
    tenant_to_building: dict = {}
    if tenant_ids_needing_building:
        for tid, bid in db.query(Tenant.id, Tenant.building_id).filter(
            Tenant.id.in_(tenant_ids_needing_building)
        ).all():
            tenant_to_building[str(tid)] = str(bid)
            building_ids.add(bid)

    building_name_by_id: dict = {}
    if building_ids:
        for bid, bname in db.query(Building.id, Building.name).filter(
            Building.id.in_(building_ids)
        ).all():
            building_name_by_id[str(bid)] = bname

    items = [_serialize_row(r, tenant_to_building, building_name_by_id) for r in rows]

    return {
        "items": items,
        "total": int(total),
        "page": page,
        "page_size": page_size,
    }


# ── POST /api/v1/transactions/ ───────────────────────────────────────────────

@router.post("/", status_code=status.HTTP_201_CREATED)
def create_manual_transaction(
    payload: TransactionCreateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """Create a manually-entered transaction attached to the per-building manual bucket.

    Optional `allocations` are applied via the existing allocation service so the row
    behaves identically to one imported from a bank statement (counts toward summaries,
    can be split, etc.). If a single tenant-only allocation is provided, the transaction's
    `matched_tenant_id` cache is also set so existing tenant-scoped queries pick it up.
    """
    building = db.query(Building).filter(Building.id == payload.building_id).first()
    if not building:
        raise HTTPException(status_code=404, detail=f"Building {payload.building_id} not found")

    bucket = _get_or_create_manual_bucket(db, payload.building_id)

    txn = Transaction(
        statement_id=bucket.id,
        activity_date=datetime.combine(payload.activity_date, datetime.min.time()),
        description=payload.description,
        payer_name=payload.payer_name,
        credit_amount=payload.credit_amount,
        debit_amount=payload.debit_amount,
        balance=None,
        transaction_type=payload.transaction_type or TransactionType.PAYMENT,
        reference_number=payload.reference_number,
        is_manual=True,
    )
    db.add(txn)
    db.flush()

    if payload.allocations:
        # Validate each allocation's tenant_id belongs to this building.
        for a in payload.allocations:
            if a.tenant_id is not None:
                t = db.query(Tenant).filter(Tenant.id == a.tenant_id).first()
                if t is None or t.building_id != payload.building_id:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Tenant {a.tenant_id} is not in building {payload.building_id}",
                    )

        # set_split_allocations also enforces sum-matches-amount and sets the
        # matched_tenant_id cache for single-tenant full-amount allocations.
        try:
            allocation_service.set_split_allocations(
                db=db,
                transaction=txn,
                allocations=[a.model_dump() for a in payload.allocations],
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    db.refresh(txn)

    # Return a shape compatible with the list-row format so the frontend can
    # patch the row in place without a refetch.
    tenant_to_building: dict = {}
    if txn.matched_tenant_id is not None:
        tenant_to_building[str(txn.matched_tenant_id)] = str(payload.building_id)
    return _serialize_row(
        txn,
        tenant_to_building,
        {str(payload.building_id): building.name},
    )
