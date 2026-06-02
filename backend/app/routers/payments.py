from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, tuple_
from typing import List, Optional
from uuid import UUID
from datetime import datetime, date
from decimal import Decimal
from collections import defaultdict

from ..database import get_db
from ..models import (
    Building, Apartment, Tenant, Transaction,
    BankStatement, TransactionType, MatchMethod, TransactionAllocation,
    ExpenseCategory,
)
from ..models.apartment_period_debt import ApartmentPeriodDebt
from ..models.user import User
from ..services import allocation_service
from ..dependencies.auth import (
    require_worker_plus,
    require_viewer_or_tenant,
    assert_tenant_building_access,
)
from ..models.user import UserRole

router = APIRouter(
    prefix="/api/v1/payments",
    tags=["payments"]
)


@router.get("/bulk-summary")
def get_bulk_payment_summary(
    month: Optional[int] = None,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """
    Return payment summary for ALL buildings for a given month/year.
    Uses grouped queries — no N+1 problem.
    Falls back to current month/year if not specified.

    Each row includes `total_expected` — the sum of active tenants'
    expected payments for the period (apartment.expected_payment with
    fallback to building.expected_monthly_payment).
    """
    from datetime import datetime as dt
    if month is None or year is None:
        now = dt.now()
        month = now.month
        year = now.year

    bq = db.query(Building)
    if current_user.role == UserRole.TENANT:
        if not current_user.building_id:
            return []
        bq = bq.filter(Building.id == current_user.building_id)
    buildings = bq.all()
    if not buildings:
        return []

    building_ids = [b.id for b in buildings]

    # Active tenant counts per building
    tenant_counts = {
        str(building_id): count
        for building_id, count in db.query(Apartment.building_id, func.count(Tenant.id))
        .join(Tenant, Tenant.apartment_id == Apartment.id)
        .filter(
            Apartment.building_id.in_(building_ids),
            Tenant.is_active == True
        )
        .group_by(Apartment.building_id)
        .all()
    }

    # Paid amounts via allocations, filtered by APD's year/month
    # (Phase 6b cutover).
    paid_rows = (
        db.query(
            Apartment.building_id.label("building_id"),
            TransactionAllocation.tenant_id,
            func.sum(TransactionAllocation.amount).label("total_paid")
        )
        .join(Tenant, Tenant.id == TransactionAllocation.tenant_id)
        .join(Apartment, Apartment.id == Tenant.apartment_id)
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            ApartmentPeriodDebt.month == month,
            ApartmentPeriodDebt.year == year,
            Apartment.building_id.in_(building_ids),
            Transaction.transaction_type == TransactionType.PAYMENT,
            TransactionAllocation.tenant_id != None,
            Tenant.is_active == True,
        )
        .group_by(Apartment.building_id, TransactionAllocation.tenant_id)
        .all()
    )

    # Expected payment per tenant
    expected_rows = (
        db.query(
            Tenant.id.label("tenant_id"),
            Apartment.building_id.label("building_id"),
            Apartment.expected_payment.label("apt_expected"),
            Building.expected_monthly_payment.label("building_default"),
        )
        .join(Apartment, Tenant.apartment_id == Apartment.id)
        .join(Building, Apartment.building_id == Building.id)
        .filter(
            Apartment.building_id.in_(building_ids),
            Tenant.is_active == True,
        )
        .all()
    )
    expected_by_tenant: dict = {}
    expected_by_building: dict = {}
    for row in expected_rows:
        tid = str(row.tenant_id)
        bid = str(row.building_id)
        apt_exp = float(row.apt_expected) if row.apt_expected is not None else None
        bld_def = float(row.building_default) if row.building_default is not None else 0.0
        per_tenant = apt_exp if apt_exp is not None else bld_def
        expected_by_tenant[tid] = per_tenant
        expected_by_building[bid] = expected_by_building.get(bid, 0.0) + per_tenant

    paid_amounts_by_building: dict = {}
    collected_by_building: dict = {}
    for row in paid_rows:
        bid = str(row.building_id)
        tid = str(row.tenant_id)
        amount = float(row.total_paid or 0)
        if bid not in paid_amounts_by_building:
            paid_amounts_by_building[bid] = {}
            collected_by_building[bid] = 0.0
        paid_amounts_by_building[bid][tid] = paid_amounts_by_building[bid].get(tid, 0.0) + amount
        collected_by_building[bid] += amount

    result = []
    for building in buildings:
        bid = str(building.id)
        total = tenant_counts.get(bid, 0)
        paid_amounts = paid_amounts_by_building.get(bid, {})
        collected = collected_by_building.get(bid, 0.0)

        fully_paid = 0
        partial = 0
        for tid, amount in paid_amounts.items():
            expected = expected_by_tenant.get(tid, 0.0)
            if expected > 0:
                if amount >= expected:
                    fully_paid += 1
                else:
                    partial += 1
            else:
                if amount > 0:
                    fully_paid += 1

        unpaid = max(0, total - fully_paid - partial)
        collection_rate = round(fully_paid / total * 100, 1) if total > 0 else 0.0

        result.append({
            "building_id": bid,
            "paid": fully_paid,
            "partial": partial,
            "unpaid": unpaid,
            "total_tenants": total,
            "collection_rate": collection_rate,
            "total_collected": collected,
            "total_expected": round(expected_by_building.get(bid, 0.0), 2),
        })

    return result


def _build_month_list(months: int) -> List[tuple]:
    """Return [(year, month), ...] for `months` periods ending with current month, ascending."""
    from datetime import datetime as dt
    now = dt.now()
    out = []
    y, m = now.year, now.month
    for _ in range(months):
        out.append((y, m))
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    return list(reversed(out))


@router.get("/portfolio-trend")
def get_portfolio_trend(
    months: int = 13,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """
    Multi-month portfolio collection trend, in one round trip.

    Returns one entry per period (oldest → newest), with portfolio totals and
    a per-building breakdown. Default 13 periods (12 months back + current).
    """
    if months < 1 or months > 36:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="months must be between 1 and 36",
        )

    bq = db.query(Building)
    if current_user.role == UserRole.TENANT:
        if not current_user.building_id:
            return []
        bq = bq.filter(Building.id == current_user.building_id)
    buildings = bq.all()
    if not buildings:
        return []

    building_ids = [b.id for b in buildings]
    building_name = {str(b.id): b.name for b in buildings}

    month_list = _build_month_list(months)

    # ---- expected per (building, tenant) — constant across periods in current model ----
    expected_rows = (
        db.query(
            Tenant.id.label("tenant_id"),
            Apartment.building_id.label("building_id"),
            Apartment.expected_payment.label("apt_expected"),
            Building.expected_monthly_payment.label("building_default"),
        )
        .join(Apartment, Tenant.apartment_id == Apartment.id)
        .join(Building, Apartment.building_id == Building.id)
        .filter(
            Apartment.building_id.in_(building_ids),
            Tenant.is_active == True,
        )
        .all()
    )
    expected_by_building: dict = {}
    for r in expected_rows:
        bid = str(r.building_id)
        apt_exp = float(r.apt_expected) if r.apt_expected is not None else None
        bld_def = float(r.building_default) if r.building_default is not None else 0.0
        expected_by_building[bid] = expected_by_building.get(bid, 0.0) + (
            apt_exp if apt_exp is not None else bld_def
        )

    # ---- collected per (year, month, building) — single grouped query ----
    # Period sourced from ApartmentPeriodDebt via FK (Phase 6b cutover).
    period_pairs = [(y, m) for (y, m) in month_list]
    collected_rows = (
        db.query(
            ApartmentPeriodDebt.year.label("year"),
            ApartmentPeriodDebt.month.label("month"),
            Apartment.building_id.label("building_id"),
            func.sum(TransactionAllocation.amount).label("collected"),
        )
        .join(Tenant, Tenant.id == TransactionAllocation.tenant_id)
        .join(Apartment, Apartment.id == Tenant.apartment_id)
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            Apartment.building_id.in_(building_ids),
            Transaction.transaction_type == TransactionType.PAYMENT,
            TransactionAllocation.tenant_id != None,
            Tenant.is_active == True,
            tuple_(
                ApartmentPeriodDebt.year,
                ApartmentPeriodDebt.month,
            ).in_(period_pairs),
        )
        .group_by(
            ApartmentPeriodDebt.year,
            ApartmentPeriodDebt.month,
            Apartment.building_id,
        )
        .all()
    )

    # collected_by[(year, month)][building_id] = float
    collected_by: dict = defaultdict(lambda: defaultdict(float))
    for r in collected_rows:
        collected_by[(int(r.year), int(r.month))][str(r.building_id)] = float(r.collected or 0)

    # ---- pivot ----
    result = []
    for (y, m) in month_list:
        per_building_payload = []
        portfolio_collected = 0.0
        portfolio_expected = 0.0
        for b in buildings:
            bid = str(b.id)
            collected = collected_by.get((y, m), {}).get(bid, 0.0)
            expected = expected_by_building.get(bid, 0.0)
            rate = round((collected / expected * 100), 2) if expected > 0 else 0.0
            per_building_payload.append({
                "building_id": bid,
                "name": building_name[bid],
                "collected": round(collected, 2),
                "expected": round(expected, 2),
                "rate": rate,
            })
            portfolio_collected += collected
            portfolio_expected += expected

        result.append({
            "period": f"{y:04d}-{m:02d}",
            "month": m,
            "year": y,
            "portfolio_collected": round(portfolio_collected, 2),
            "portfolio_expected": round(portfolio_expected, 2),
            "buildings": per_building_payload,
        })

    return result


def _calculate_tenant_debt_from_map(
    tenant, apartment, building, paid_map: dict, up_to_month: int, up_to_year: int
) -> float:
    """
    Cumulative debt from effective move_in_date to up_to_month/year inclusive.
    Effective date = tenant.move_in_date if set, else building.default_move_in_date.
    paid_map: {(year, month): total_paid_float} — pre-fetched, no DB calls here.
    """
    move_in = tenant.move_in_date or building.default_move_in_date
    if not move_in:
        return 0.0
    expected_monthly = float(apartment.expected_payment or building.expected_monthly_payment or 0)
    if expected_monthly == 0:
        return 0.0

    months = []
    y, m = move_in.year, move_in.month
    while (y, m) <= (up_to_year, up_to_month):
        months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1

    total_expected = expected_monthly * len(months)
    total_paid = sum(paid_map.get((y, m), 0.0) for y, m in months)
    total_debt = max(0.0, total_expected - total_paid)
    return round(total_debt, 2)


class ManualPaymentRequest(BaseModel):
    building_id: str
    tenant_id: str
    amount: float
    month: int
    year: int
    note: Optional[str] = None


@router.post("/manual")
def create_manual_payment(
    payload: ManualPaymentRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_worker_plus),
):
    """
    Record a manual payment for a tenant (cash, bank transfer outside normal matching).
    Creates a Transaction with is_manual=True and statement_id=None.
    """

    tenant = db.query(Tenant).filter(Tenant.id == payload.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail=f"Tenant {payload.tenant_id} not found")

    apartment_check = db.query(Apartment).filter(
        Apartment.id == tenant.apartment_id,
        Apartment.building_id == payload.building_id
    ).first()
    if not apartment_check:
        raise HTTPException(
            status_code=404,
            detail="Tenant does not belong to the specified building"
        )

    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    description = "תשלום ידני"
    if payload.note:
        description += f" - {payload.note}"

    txn = Transaction(
        statement_id=None,
        activity_date=datetime(payload.year, payload.month, 1),
        description=description,
        credit_amount=payload.amount,
        debit_amount=None,
        balance=None,
        transaction_type=TransactionType.PAYMENT,
        matched_tenant_id=tenant.id,
        match_confidence=1.0,
        match_method=MatchMethod.MANUAL,
        is_confirmed=True,
        is_manual=True,
    )
    db.add(txn)
    db.flush()  # populate txn.id before creating allocation

    # Dual-write to transaction_allocations so allocation-based reads see this payment
    allocation_service.upsert_single_tenant_allocation(
        db=db,
        transaction=txn,
        tenant_id=tenant.id,
        amount=Decimal(str(payload.amount)),
        period_month=payload.month,
        period_year=payload.year,
    )

    db.commit()
    db.refresh(txn)

    return {
        "transaction_id": str(txn.id),
        "tenant_id": str(tenant.id),
        "tenant_name": tenant.name,
        "amount": float(txn.credit_amount),
        "month": payload.month,
        "year": payload.year,
        "description": description,
        "is_manual": True,
    }


@router.get("/tenant/{tenant_id}/history")
def get_tenant_payment_history(
    tenant_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """
    Return month-by-month payment history for a tenant from move_in_date to current month.
    Amounts reflect the tenant's allocation share (correct for splits).
    """

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail=f"Tenant {tenant_id} not found")

    apartment = db.query(Apartment).filter(Apartment.id == tenant.apartment_id).first()
    if not apartment:
        raise HTTPException(status_code=404, detail="Apartment not found for tenant")
    assert_tenant_building_access(current_user, apartment.building_id)
    building = db.query(Building).filter(Building.id == apartment.building_id).first()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found for apartment")

    expected_monthly = float(apartment.expected_payment or building.expected_monthly_payment or 0)
    move_in = tenant.move_in_date or building.default_move_in_date or date(2026, 1, 1)
    today = date.today()

    months_list = []
    y, m = move_in.year, move_in.month
    while (y, m) <= (today.year, today.month):
        months_list.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1

    # Query allocations for this tenant — period sourced from the linked
    # ApartmentPeriodDebt row (Phase 6b cutover).
    alloc_rows = (
        db.query(
            TransactionAllocation,
            Transaction,
            ApartmentPeriodDebt.year.label("apd_year"),
            ApartmentPeriodDebt.month.label("apd_month"),
        )
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            TransactionAllocation.tenant_id == tenant.id,
            Transaction.transaction_type == TransactionType.PAYMENT,
        )
        .order_by(Transaction.activity_date.asc())
        .all()
    )

    txns_by_month: dict = {}
    for alloc, txn, apd_year, apd_month in alloc_rows:
        key = (int(apd_year), int(apd_month))

        if key not in txns_by_month:
            txns_by_month[key] = []

        act = txn.activity_date
        date_str = act.date().isoformat() if hasattr(act, "date") else str(act)[:10]
        headline = float(txn.credit_amount or 0)
        alloc_amount = float(alloc.amount)
        is_split = abs(alloc_amount - headline) > 0.01 and headline > 0

        txns_by_month[key].append({
            "id": str(txn.id),
            "date": date_str,
            "amount": alloc_amount,
            "description": txn.description,
            "is_manual": bool(txn.is_manual),
            "is_split": is_split,
        })

    result_months = []
    for (y, m) in months_list:
        month_txns = txns_by_month.get((y, m), [])
        paid = sum(t["amount"] for t in month_txns)
        diff = paid - expected_monthly
        if expected_monthly == 0:
            st = "paid"
        elif paid >= expected_monthly - 0.5:
            st = "paid"
        elif paid > 0:
            st = "partial"
        else:
            st = "unpaid"

        result_months.append({
            "month": m,
            "year": y,
            "period": f"{m:02d}/{y}",
            "expected": expected_monthly,
            "paid": round(paid, 2),
            "difference": round(diff, 2),
            "status": st,
            "transactions": month_txns,
            "soft_covered_by": None,
            "soft_covered_fully": False,
        })

    # Soft-cover pass: any month with surplus contributes its overage to a
    # pool of "credits". Then walk unpaid/partial months oldest → newest and
    # draw from the pool (oldest credit first) to mark them as "may have been
    # covered" by that big transaction. Display-only — no allocation mutation.
    if expected_monthly > 0:
        credits: list = []  # all surplus pools, in chronological order
        for row in result_months:
            surplus = row["paid"] - expected_monthly
            if surplus > 0.5 and row["transactions"]:
                big_tx = max(row["transactions"], key=lambda t: t["amount"])
                credits.append({
                    "source_period": row["period"],
                    "source_tx_id": big_tx["id"],
                    "source_tx_amount": big_tx["amount"],
                    "source_tx_date": big_tx["date"],
                    "remaining": surplus,
                })

        for row in result_months:
            if row["status"] not in ("unpaid", "partial"):
                continue
            deficit = expected_monthly - row["paid"]
            if deficit <= 0.5:
                continue
            consumed_from = []
            for credit in credits:
                if deficit <= 0.5:
                    break
                if credit["remaining"] <= 0.5:
                    continue
                take = min(credit["remaining"], deficit)
                consumed_from.append({
                    "source_period": credit["source_period"],
                    "source_tx_id": credit["source_tx_id"],
                    "source_tx_amount": credit["source_tx_amount"],
                    "source_tx_date": credit["source_tx_date"],
                    "applied": round(take, 2),
                })
                credit["remaining"] -= take
                deficit -= take
            if consumed_from:
                row["soft_covered_by"] = consumed_from
                row["soft_covered_fully"] = deficit <= 0.5

    return {
        "tenant_id": str(tenant.id),
        "tenant_name": tenant.name,
        "apartment_number": apartment.number,
        "move_in_date": move_in.isoformat(),
        "months": result_months,
    }


@router.get("/{building_id}/tenant-debts")
def get_tenant_debts(
    building_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """
    Return cumulative all-time debt (from move_in_date to today) for every
    active tenant in a building. Single batch DB query — no N+1.
    Returns: { tenant_id: total_debt }
    """
    assert_tenant_building_access(current_user, building_id)

    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")

    tenants_query = (
        db.query(Tenant, Apartment)
        .join(Apartment, Tenant.apartment_id == Apartment.id)
        .filter(
            Apartment.building_id == building_id,
            Tenant.is_active == True
        )
        .all()
    )

    if not tenants_query:
        return {}

    tenant_ids = [t.id for t, _ in tenants_query]
    today = date.today()

    # Use allocations as source of truth for amounts; period sourced from
    # the linked ApartmentPeriodDebt row (Phase 6b cutover).
    alloc_rows = (
        db.query(
            TransactionAllocation.tenant_id,
            TransactionAllocation.amount,
            ApartmentPeriodDebt.year,
            ApartmentPeriodDebt.month,
        )
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            TransactionAllocation.tenant_id.in_(tenant_ids),
            Transaction.transaction_type == TransactionType.PAYMENT,
        )
        .all()
    )

    historical: dict = defaultdict(lambda: defaultdict(float))
    for tenant_id, amount, year_, month_ in alloc_rows:
        historical[str(tenant_id)][(int(year_), int(month_))] += float(amount)

    result = {}
    for tenant, apartment in tenants_query:
        result[str(tenant.id)] = _calculate_tenant_debt_from_map(
            tenant, apartment, building,
            dict(historical.get(str(tenant.id), {})),
            today.month, today.year
        )

    return result


@router.get("/{building_id}/status")
def get_payment_status(
    building_id: UUID,
    month: Optional[int] = None,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """
    Get payment status for all tenants in a building for a specific period.
    If month/year not specified, uses the latest bank statement period.
    Amounts are read through transaction_allocations (supports splits).
    """
    assert_tenant_building_access(current_user, building_id)
    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found"
        )

    if not month or not year:
        latest_statement = db.query(BankStatement).filter(
            BankStatement.building_id == building_id
        ).order_by(
            BankStatement.period_year.desc(),
            BankStatement.period_month.desc()
        ).first()

        if not latest_statement:
            now = datetime.now()
            return {
                "building_id": str(building_id),
                "building_name": building.name,
                "period": f"{now.month:02d}/{now.year}",
                "summary": {
                    "total_tenants": 0,
                    "paid": 0,
                    "unpaid": 0,
                    "total_expected": 0,
                    "total_collected": 0,
                    "collection_rate": "N/A",
                    "amount_rate": "N/A"
                },
                "tenants": []
            }

        month = latest_statement.period_month
        year = latest_statement.period_year

    tenants_query = db.query(Tenant, Apartment).join(Apartment, Tenant.apartment_id == Apartment.id).filter(
        Apartment.building_id == building_id,
        Tenant.is_active == True
    ).all()

    tenant_ids_in_building = [t.id for t, _ in tenants_query]

    # Historical allocations for debt calculation — period sourced from the
    # linked ApartmentPeriodDebt row (Phase 6b cutover).
    all_historical_allocs = (
        db.query(
            TransactionAllocation.tenant_id,
            TransactionAllocation.amount,
            ApartmentPeriodDebt.year,
            ApartmentPeriodDebt.month,
        )
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            TransactionAllocation.tenant_id.in_(tenant_ids_in_building),
            Transaction.transaction_type == TransactionType.PAYMENT,
        )
        .all()
    )

    historical_paid_by_tenant: dict = defaultdict(lambda: defaultdict(float))
    for tenant_id, amount, year_, month_ in all_historical_allocs:
        historical_paid_by_tenant[str(tenant_id)][(int(year_), int(month_))] += float(amount)

    # Current-period allocations — filter by APD's year/month (Phase 6b cutover).
    current_period_allocs = (
        db.query(TransactionAllocation.tenant_id, TransactionAllocation.amount)
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            Transaction.transaction_type == TransactionType.PAYMENT,
            TransactionAllocation.tenant_id.in_(tenant_ids_in_building),
            ApartmentPeriodDebt.month == month,
            ApartmentPeriodDebt.year == year,
        )
        .all()
    )

    payments_by_tenant: dict = {}
    for tenant_id, amount in current_period_allocs:
        if tenant_id:
            tid = str(tenant_id)
            if tid not in payments_by_tenant:
                payments_by_tenant[tid] = 0
            payments_by_tenant[tid] += float(amount)

    tenant_statuses = []
    total_expected = 0
    total_collected = 0
    paid_count = 0
    partial_count = 0
    unpaid_count = 0

    for tenant, apartment in tenants_query:
        tenant_id = str(tenant.id)

        expected = apartment.expected_payment or building.expected_monthly_payment
        if expected:
            expected = float(expected)
        else:
            expected = 0

        paid = payments_by_tenant.get(tenant_id, 0)

        is_paid = paid >= expected if expected > 0 else paid > 0
        is_partial = (not is_paid) and paid > 0
        difference = paid - expected

        if is_paid:
            paid_count += 1
        elif is_partial:
            partial_count += 1
        else:
            unpaid_count += 1

        total_expected += expected
        total_collected += paid

        if is_paid:
            status_str = "paid"
        elif is_partial:
            status_str = "partial"
        else:
            status_str = "unpaid"

        period_first = date(year, month, 1)
        so_start = tenant.standing_order_start_date
        so_end = tenant.standing_order_end_date
        if so_start is not None and period_first >= so_start and (so_end is None or period_first <= so_end):
            has_standing_order = True
            so_amount = float(tenant.standing_order_amount) if tenant.standing_order_amount is not None else None
        else:
            has_standing_order = False
            so_amount = None

        tenant_statuses.append({
            "tenant_id": tenant_id,
            "tenant_name": tenant.name,
            "apartment_number": apartment.number,
            "floor": apartment.floor,
            "expected_amount": expected,
            "paid_amount": paid,
            "difference": difference,
            "status": status_str,
            "is_overpaid": difference > 1.0,
            "is_underpaid": difference < -1.0,
            "phone": tenant.phone,
            "language": tenant.language.value if tenant.language else "he",
            "apartment_id": str(apartment.id),
            "move_in_date": (tenant.move_in_date or building.default_move_in_date).isoformat()
                if (tenant.move_in_date or building.default_move_in_date) else None,
            "has_standing_order": has_standing_order,
            "standing_order_amount": so_amount,
            "total_debt": _calculate_tenant_debt_from_map(
                tenant, apartment, building,
                dict(historical_paid_by_tenant.get(str(tenant.id), {})),
                month, year
            ),
        })

    tenant_statuses.sort(key=lambda x: x['apartment_number'])

    return {
        "building_id": str(building_id),
        "building_name": building.name,
        "period": f"{month:02d}/{year}",
        "summary": {
            "total_tenants": len(tenant_statuses),
            "paid": paid_count,
            "partial": partial_count,
            "unpaid": unpaid_count,
            "total_expected": total_expected,
            "total_collected": total_collected,
            "collection_rate": f"{(paid_count / len(tenant_statuses) * 100):.1f}%" if tenant_statuses else "N/A",
            "amount_rate": f"{(total_collected / total_expected * 100):.1f}%" if total_expected > 0 else "N/A"
        },
        "tenants": tenant_statuses
    }


@router.get("/{building_id}/unpaid")
def get_unpaid_tenants(
    building_id: UUID,
    month: Optional[int] = None,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """Get list of tenants who haven't paid for a specific period"""
    assert_tenant_building_access(current_user, building_id)
    status_data = get_payment_status(building_id, month, year, db, current_user)

    unpaid_tenants = [
        t for t in status_data['tenants']
        if t['status'] == 'unpaid'
    ]

    return {
        "building_id": str(building_id),
        "building_name": status_data['building_name'],
        "period": status_data['period'],
        "unpaid_count": len(unpaid_tenants),
        "unpaid_tenants": unpaid_tenants
    }


@router.get("/{building_id}/history")
def get_payment_history(
    building_id: UUID,
    months: int = 6,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    """Get payment history for the last N months"""
    assert_tenant_building_access(current_user, building_id)
    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found"
        )

    statements = db.query(BankStatement).filter(
        BankStatement.building_id == building_id
    ).order_by(
        BankStatement.period_year.desc(),
        BankStatement.period_month.desc()
    ).limit(months).all()

    history = []
    for statement in statements:
        # Count transactions that have at least one allocation (or are directly matched)
        # This is correct for both split and single-tenant transactions.
        payment_count = (
            db.query(func.count(func.distinct(Transaction.id)))
            .join(TransactionAllocation, TransactionAllocation.transaction_id == Transaction.id)
            .filter(
                Transaction.statement_id == statement.id,
                Transaction.transaction_type == TransactionType.PAYMENT,
            )
            .scalar()
        ) or 0

        total_amount = db.query(func.sum(Transaction.credit_amount)).filter(
            Transaction.statement_id == statement.id,
            Transaction.transaction_type == TransactionType.PAYMENT
        ).scalar() or 0

        history.append({
            "period": f"{statement.period_month:02d}/{statement.period_year}",
            "statement_id": str(statement.id),
            "upload_date": statement.upload_date.isoformat(),
            "payments_received": payment_count,
            "total_amount": float(total_amount)
        })

    return {
        "building_id": str(building_id),
        "building_name": building.name,
        "history": history
    }


# ----------------------------------------------------------------------------
# Summary stats — single round-trip backing the building-detail "Summary" tab.
# ----------------------------------------------------------------------------

def _parse_period_str(p: str, field: str) -> tuple[int, int]:
    try:
        y_str, m_str = p.split("-")
        y, m = int(y_str), int(m_str)
        if not (1 <= m <= 12) or y < 1900 or y > 2999:
            raise ValueError
        return y, m
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field} must be in YYYY-MM format",
        )


def _months_inclusive(from_y: int, from_m: int, to_y: int, to_m: int) -> List[tuple]:
    out = []
    y, m = from_y, from_m
    while (y, m) <= (to_y, to_m):
        out.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return out


@router.get("/{building_id}/summary-stats")
def get_summary_stats(
    building_id: UUID,
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    projection_months: int = Query(0, ge=0, le=24),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_viewer_or_tenant),
):
    assert_tenant_building_access(current_user, building_id)
    """
    One-shot KPI + trend + expenses + debt-aging + worst-payers payload for
    the Summary tab.

    Range params are inclusive `YYYY-MM`, capped at 24 months.
    """
    from datetime import date as _date

    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Building with id {building_id} not found",
        )

    from_y, from_m = _parse_period_str(from_, "from")
    to_y, to_m = _parse_period_str(to, "to")
    if (from_y, from_m) > (to_y, to_m):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="`from` must be <= `to`",
        )
    months = _months_inclusive(from_y, from_m, to_y, to_m)
    if len(months) > 24:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Range cannot exceed 24 months",
        )

    # --- expected per tenant (constant across periods in current model) ----
    tenant_rows = (
        db.query(
            Tenant.id.label("tenant_id"),
            Tenant.name.label("name"),
            Apartment.number.label("apt_number"),
            Apartment.expected_payment.label("apt_expected"),
            Building.expected_monthly_payment.label("building_default"),
            Tenant.move_in_date.label("move_in_date"),
            Tenant.standing_order_start_date.label("so_start"),
            Tenant.standing_order_end_date.label("so_end"),
            Tenant.standing_order_amount.label("so_amount"),
        )
        .join(Apartment, Tenant.apartment_id == Apartment.id)
        .join(Building, Apartment.building_id == Building.id)
        .filter(
            Apartment.building_id == building_id,
            Tenant.is_active == True,
        )
        .all()
    )
    tenant_meta: dict = {}
    for r in tenant_rows:
        apt_exp = float(r.apt_expected) if r.apt_expected is not None else None
        bld_def = float(r.building_default) if r.building_default is not None else 0.0
        tenant_meta[str(r.tenant_id)] = {
            "name": r.name,
            "apt_number": int(r.apt_number) if r.apt_number is not None else 0,
            "expected": apt_exp if apt_exp is not None else bld_def,
            "move_in_date": r.move_in_date or building.default_move_in_date,
            "so_start": r.so_start,
            "so_end": r.so_end,
            "so_amount": float(r.so_amount) if r.so_amount is not None else None,
        }

    expected_per_month = sum(t["expected"] for t in tenant_meta.values())

    # --- collected per (year, month) and per tenant ---
    # Period sourced from ApartmentPeriodDebt (Phase 6b cutover).
    coll_rows = (
        db.query(
            ApartmentPeriodDebt.year.label("year"),
            ApartmentPeriodDebt.month.label("month"),
            TransactionAllocation.tenant_id.label("tenant_id"),
            func.sum(TransactionAllocation.amount).label("amt"),
        )
        .select_from(TransactionAllocation)
        .join(Tenant, Tenant.id == TransactionAllocation.tenant_id)
        .join(Apartment, Apartment.id == Tenant.apartment_id)
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            Apartment.building_id == building_id,
            Transaction.transaction_type == TransactionType.PAYMENT,
            TransactionAllocation.tenant_id.isnot(None),
            Tenant.is_active == True,
            tuple_(
                ApartmentPeriodDebt.year,
                ApartmentPeriodDebt.month,
            ).in_(months),
        )
        .group_by(
            ApartmentPeriodDebt.year,
            ApartmentPeriodDebt.month,
            TransactionAllocation.tenant_id,
        )
        .all()
    )
    collected_by_month: dict = defaultdict(float)
    collected_by_tenant: dict = defaultdict(float)
    for r in coll_rows:
        amt = float(r.amt or 0)
        collected_by_month[(int(r.year), int(r.month))] += amt
        collected_by_tenant[str(r.tenant_id)] += amt

    def _projected_so_total(y: int, m: int) -> float:
        period_first = _date(y, m, 1)
        total = 0.0
        for meta in tenant_meta.values():
            so_start = meta.get("so_start")
            so_end = meta.get("so_end")
            so_amount = meta.get("so_amount")
            if so_start is None or so_amount is None:
                continue
            if period_first < so_start:
                continue
            if so_end is not None and period_first > so_end:
                continue
            total += so_amount
        return round(total, 2)

    # --- trend per month + avg_collection_rate ---
    rate_samples: List[float] = []
    trend = []
    for (y, m) in months:
        coll = collected_by_month.get((y, m), 0.0)
        rate = round((coll / expected_per_month * 100), 2) if expected_per_month > 0 else 0.0
        if expected_per_month > 0:
            rate_samples.append(rate)
        trend.append({
            "period": f"{y:04d}-{m:02d}",
            "rate": rate,
            "collected": round(coll, 2),
            "expected": round(expected_per_month, 2),
            "projected_standing_order_income": None,
            "is_future": False,
        })
    avg_collection_rate = round(sum(rate_samples) / len(rate_samples), 2) if rate_samples else 0.0

    # --- forward projection (sum of active standing orders per future month) ---
    if projection_months > 0:
        py, pm = to_y, to_m
        for _ in range(projection_months):
            pm += 1
            if pm == 13:
                pm = 1
                py += 1
            trend.append({
                "period": f"{py:04d}-{pm:02d}",
                "rate": None,
                "collected": None,
                "expected": round(expected_per_month, 2),
                "projected_standing_order_income": _projected_so_total(py, pm),
                "is_future": True,
            })

    # --- open AR (most recent month: expected - collected, clamped >= 0) ---
    last_y, last_m = months[-1]
    last_collected = collected_by_month.get((last_y, last_m), 0.0)
    open_ar = round(max(0.0, expected_per_month - last_collected), 2)

    # --- expense allocations in range, joined to category ----
    # Label-only rows (no tenant, no APD) — filter by Transaction.activity_date
    # year/month instead of the dropped allocation.period_year/month
    # (Phase 6b cutover).
    exp_rows = (
        db.query(
            TransactionAllocation.id.label("alloc_id"),
            TransactionAllocation.amount.label("amount"),
            TransactionAllocation.category_id.label("category_id"),
            ExpenseCategory.name.label("category_name"),
            ExpenseCategory.color.label("category_color"),
            Transaction.activity_date.label("activity_date"),
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .join(BankStatement, BankStatement.id == Transaction.statement_id)
        .outerjoin(ExpenseCategory, ExpenseCategory.id == TransactionAllocation.category_id)
        .filter(
            BankStatement.building_id == building_id,
            TransactionAllocation.tenant_id.is_(None),
            TransactionAllocation.label.isnot(None),
            tuple_(
                func.extract("year", Transaction.activity_date),
                func.extract("month", Transaction.activity_date),
            ).in_(months),
        )
        .all()
    )
    expenses_total = 0.0
    by_cat: dict = {}
    for r in exp_rows:
        amt = float(r.amount or 0)
        expenses_total += amt
        key = str(r.category_id) if r.category_id else None
        if key not in by_cat:
            by_cat[key] = {
                "category_id": str(r.category_id) if r.category_id else None,
                "name": r.category_name if r.category_name else "לא מסווג",
                "color": r.category_color if r.category_color else "#9CA3AF",
                "amount": 0.0,
            }
        by_cat[key]["amount"] += amt
    expenses_by_category = sorted(
        ({**v, "amount": round(v["amount"], 2)} for v in by_cat.values()),
        key=lambda x: x["amount"],
        reverse=True,
    )

    # --- debt aging — based on PAYMENT allocations' (activity_date - period_start) ---
    # Period sourced from ApartmentPeriodDebt (Phase 6b cutover).
    paid_alloc_rows = (
        db.query(
            Transaction.activity_date.label("activity_date"),
            ApartmentPeriodDebt.year.label("year"),
            ApartmentPeriodDebt.month.label("month"),
        )
        .select_from(TransactionAllocation)
        .join(Tenant, Tenant.id == TransactionAllocation.tenant_id)
        .join(Apartment, Apartment.id == Tenant.apartment_id)
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            Apartment.building_id == building_id,
            Transaction.transaction_type == TransactionType.PAYMENT,
            TransactionAllocation.tenant_id.isnot(None),
            Tenant.is_active == True,
            tuple_(
                ApartmentPeriodDebt.year,
                ApartmentPeriodDebt.month,
            ).in_(months),
        )
        .all()
    )
    aging = {"0-7": 0, "8-30": 0, "31-60": 0, "60+": 0, "unpaid": 0}
    days_samples: List[int] = []
    for r in paid_alloc_rows:
        if r.activity_date is None or r.year is None or r.month is None:
            continue
        period_start = _date(int(r.year), int(r.month), 1)
        ad = r.activity_date.date() if isinstance(r.activity_date, datetime) else r.activity_date
        delta = max(0, (ad - period_start).days)
        days_samples.append(delta)
        if delta <= 7:
            aging["0-7"] += 1
        elif delta <= 30:
            aging["8-30"] += 1
        elif delta <= 60:
            aging["31-60"] += 1
        else:
            aging["60+"] += 1

    avg_days_to_pay = round(sum(days_samples) / len(days_samples), 1) if days_samples else 0.0

    # Unpaid count = (tenant, period) pairs where tenant was active in that period and no allocation exists.
    paid_pairs = {
        (str(r.tenant_id), int(r.year), int(r.month))
        for r in coll_rows
    }
    unpaid_count = 0
    for tid, meta in tenant_meta.items():
        move_in = meta.get("move_in_date")
        for (y, m) in months:
            if move_in and (move_in.year, move_in.month) > (y, m):
                continue
            if (tid, y, m) not in paid_pairs:
                unpaid_count += 1
    aging["unpaid"] = unpaid_count

    # --- worst payers — top 5 by (expected_total_in_range - collected) ---
    worst = []
    for tid, meta in tenant_meta.items():
        move_in = meta.get("move_in_date")
        active_months = 0
        for (y, m) in months:
            if move_in and (move_in.year, move_in.month) > (y, m):
                continue
            active_months += 1
        expected_total = meta["expected"] * active_months
        collected = collected_by_tenant.get(tid, 0.0)
        debt = max(0.0, expected_total - collected)
        rate = round((collected / expected_total * 100), 1) if expected_total > 0 else 0.0
        worst.append({
            "tenant_id": tid,
            "name": meta["name"],
            "apartment_number": meta["apt_number"],
            "rate": rate,
            "debt": round(debt, 2),
        })
    worst.sort(key=lambda x: x["debt"], reverse=True)
    worst_payers = [w for w in worst if w["debt"] > 0][:5]

    # --- income (sum of allocations to tenants in range) ---
    income_total = sum(collected_by_tenant.values())

    return {
        "kpis": {
            "avg_collection_rate": avg_collection_rate,
            "open_ar": open_ar,
            "avg_days_to_pay": avg_days_to_pay,
            "income": round(income_total, 2),
            "expenses": round(expenses_total, 2),
        },
        "trend": trend,
        "expenses_by_category": expenses_by_category,
        "debt_aging": aging,
        "worst_payers": worst_payers,
    }
