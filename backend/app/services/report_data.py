"""
Report data service — builds the JSON payload for the per-building
income & expenses report.

Income is read from TransactionAllocation rows with tenant_id set
(transaction_type=PAYMENT), grouped by (period_year, period_month).

Expenses are read from TransactionAllocation rows with tenant_id IS NULL
and label IS NOT NULL (the convention used throughout the app), scoped
to the building via BankStatement.building_id.

Lifetime debtors reuse the payment_status logic: expected − paid across
all time from each tenant's move_in_date.
"""
from __future__ import annotations

import datetime as dt
from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import func, tuple_
from sqlalchemy.orm import Session

from ..models import (
    Apartment,
    BankStatement,
    Building,
    ExpenseCategory,
    Tenant,
    Transaction,
    TransactionAllocation,
    TransactionType,
)
from ..models.apartment_period_debt import ApartmentPeriodDebt

HEBREW_MONTHS = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
]
QUARTER_LABELS = ["רבעון א", "רבעון ב", "רבעון ג", "רבעון ד"]


# ─── Public API ───────────────────────────────────────────────────────────────


def build_report_payload(
    db: Session,
    building_id: UUID,
    from_date: dt.date,
    to_date: dt.date,
) -> dict[str, Any]:
    building = db.query(Building).filter(Building.id == building_id).first()
    if not building:
        raise ValueError(f"building {building_id} not found")

    period = _build_period(from_date, to_date)

    apartments = (
        db.query(Apartment)
        .filter(Apartment.building_id == building_id)
        .order_by(Apartment.number)
        .all()
    )

    tenants_by_apt: dict[UUID, Tenant] = {}
    if apartments:
        apt_ids = [a.id for a in apartments]
        for t in db.query(Tenant).filter(
            Tenant.apartment_id.in_(apt_ids), Tenant.is_active == True
        ).all():
            # Keep only first active tenant per apartment for display
            if t.apartment_id not in tenants_by_apt:
                tenants_by_apt[t.apartment_id] = t

    income_rows = _income_rows(db, building, apartments, tenants_by_apt, period)
    expenses_groups = _expenses_groups(db, building_id, from_date, to_date)
    debtors_period = _period_debtors(income_rows)
    debtors_lifetime = _lifetime_debtors(db, building, apartments, tenants_by_apt)

    total_income = sum(r["paid_total"] for r in income_rows)
    total_expenses = sum(g["subtotal"] for g in expenses_groups)

    return {
        "building": {
            "name": building.name,
            "address": building.address,
            "city": building.city,
            "expected_monthly_payment": _money(building.expected_monthly_payment),
        },
        "period": period,
        "summary": {
            "total_income": total_income,
            "total_expenses": total_expenses,
            "net_balance": total_income - total_expenses,
        },
        "income_by_tenant": income_rows,
        "income_totals_row": _totals_row(income_rows, period),
        "expenses_by_month": expenses_groups,
        "expenses_grand_total": total_expenses,
        "debtors_period": debtors_period,
        "debtors_lifetime": debtors_lifetime,
    }


# ─── Period helpers ───────────────────────────────────────────────────────────


def _build_period(from_d: dt.date, to_d: dt.date) -> dict[str, Any]:
    # Snap to month boundaries for column generation
    from_month = from_d.replace(day=1)
    to_month = to_d.replace(day=1)

    months_span = (
        (to_month.year - from_month.year) * 12
        + (to_month.month - from_month.month)
        + 1
    )
    granularity = "quarter" if months_span > 6 else "month"

    columns: list[dict] = []
    if granularity == "month":
        y, m = from_month.year, from_month.month
        for _ in range(months_span):
            columns.append({"key": f"{y:04d}-{m:02d}", "label": HEBREW_MONTHS[m - 1]})
            m += 1
            if m > 12:
                m, y = 1, y + 1
    else:
        # Build quarterly columns spanning the date range
        seen: set[str] = set()
        y, m = from_month.year, from_month.month
        for _ in range(months_span):
            q = (m - 1) // 3  # 0-based quarter index
            key = f"{y}-Q{q + 1}"
            if key not in seen:
                seen.add(key)
                label = (
                    QUARTER_LABELS[q]
                    if from_month.year == to_month.year
                    else f"{QUARTER_LABELS[q]} {y}"
                )
                columns.append({"key": key, "label": label})
            m += 1
            if m > 12:
                m, y = 1, y + 1

    return {
        "from": from_d.strftime("%Y-%m"),
        "to": to_d.strftime("%Y-%m"),
        "label": _period_label(from_d, to_d),
        "columns": columns,
        "granularity": granularity,
    }


def _period_label(from_d: dt.date, to_d: dt.date) -> str:
    is_aligned = from_d.day == 1 and to_d == _last_day_of_month(to_d)
    if is_aligned:
        from_m, to_m = from_d.replace(day=1), to_d.replace(day=1)
        months_span = (
            (to_m.year - from_m.year) * 12 + (to_m.month - from_m.month) + 1
        )
        # Single month
        if months_span == 1:
            return f"{HEBREW_MONTHS[from_d.month - 1]} {from_d.year}"
        # Full calendar year
        if from_d == dt.date(from_d.year, 1, 1) and to_d == dt.date(from_d.year, 12, 31):
            return str(from_d.year)
        # Aligned quarter in same year
        if (
            from_d.year == to_d.year
            and (from_d.month - 1) % 3 == 0
            and to_d.month % 3 == 0
            and months_span == 3
        ):
            q = (from_d.month - 1) // 3
            return f"{QUARTER_LABELS[q]} {from_d.year}"
    return f"{from_d.strftime('%d.%m.%Y')} – {to_d.strftime('%d.%m.%Y')}"


def _last_day_of_month(d: dt.date) -> dt.date:
    next_m = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return next_m - dt.timedelta(days=1)


def _col_key_for_period(year: int, month: int, granularity: str) -> str:
    if granularity == "month":
        return f"{year:04d}-{month:02d}"
    q = (month - 1) // 3 + 1
    return f"{year}-Q{q}"


# ─── Income ───────────────────────────────────────────────────────────────────


def _income_rows(
    db: Session,
    building: Building,
    apartments: list[Apartment],
    tenants_by_apt: dict[UUID, Tenant],
    period: dict[str, Any],
) -> list[dict[str, Any]]:
    if not apartments:
        return []

    # Build list of (year, month) pairs covered by the period columns
    col_keys = [c["key"] for c in period["columns"]]
    period_pairs: list[tuple[int, int]] = []
    if period["granularity"] == "month":
        for key in col_keys:
            y, m = map(int, key.split("-"))
            period_pairs.append((y, m))
    else:
        # For quarterly: cover all months in each quarter
        for key in col_keys:
            yr_str, q_str = key.split("-Q")
            yr, q = int(yr_str), int(q_str)
            start_m = (q - 1) * 3 + 1
            for mm in range(start_m, start_m + 3):
                period_pairs.append((yr, mm))

    tenant_ids = [t.id for t in tenants_by_apt.values()]
    if not tenant_ids or not period_pairs:
        return _zero_rows(building, apartments, tenants_by_apt, period)

    # Sum paid amounts per tenant per (year, month) — period sourced from
    # ApartmentPeriodDebt via FK join (Phase 6b cutover).
    paid_rows = (
        db.query(
            TransactionAllocation.tenant_id.label("tenant_id"),
            ApartmentPeriodDebt.year.label("period_year"),
            ApartmentPeriodDebt.month.label("period_month"),
            func.sum(TransactionAllocation.amount).label("total"),
        )
        .select_from(TransactionAllocation)
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            TransactionAllocation.tenant_id.in_(tenant_ids),
            Transaction.transaction_type == TransactionType.PAYMENT,
            tuple_(
                ApartmentPeriodDebt.year,
                ApartmentPeriodDebt.month,
            ).in_(period_pairs),
        )
        .group_by(
            TransactionAllocation.tenant_id,
            ApartmentPeriodDebt.year,
            ApartmentPeriodDebt.month,
        )
        .all()
    )

    # Index paid amounts: tenant_id → column_key → amount
    paid_index: dict[UUID, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in paid_rows:
        col_key = _col_key_for_period(row.period_year, row.period_month, period["granularity"])
        paid_index[row.tenant_id][col_key] += float(row.total)

    rows = []
    for apt in apartments:
        tenant = tenants_by_apt.get(apt.id)
        cells = [{"key": c["key"], "amount": 0.0} for c in period["columns"]]

        if tenant:
            t_paid = paid_index.get(tenant.id, {})
            for cell in cells:
                cell["amount"] = t_paid.get(cell["key"], 0.0)

        paid_total = sum(c["amount"] for c in cells)
        expected_per_month = float(
            apt.expected_payment
            if apt.expected_payment is not None
            else (building.expected_monthly_payment or 0)
        )
        num_months = len(period_pairs)
        expected_total = expected_per_month * num_months

        rows.append({
            "apartment_number": apt.number,
            "tenant_name": (tenant.full_name or tenant.name) if tenant else "—",
            "cells": cells,
            "paid_total": paid_total,
            "expected_total": expected_total,
            "balance": max(expected_total - paid_total, 0.0),
        })

    return rows


def _zero_rows(building, apartments, tenants_by_apt, period):
    rows = []
    for apt in apartments:
        tenant = tenants_by_apt.get(apt.id)
        cells = [{"key": c["key"], "amount": 0.0} for c in period["columns"]]
        rows.append({
            "apartment_number": apt.number,
            "tenant_name": (tenant.full_name or tenant.name) if tenant else "—",
            "cells": cells,
            "paid_total": 0.0,
            "expected_total": 0.0,
            "balance": 0.0,
        })
    return rows


# ─── Expenses ─────────────────────────────────────────────────────────────────


def _expenses_groups(
    db: Session,
    building_id: UUID,
    from_d: dt.date,
    to_d: dt.date,
) -> list[dict[str, Any]]:
    from_month = from_d.replace(day=1)
    to_month_last = _last_day_of_month(to_d)

    rows = (
        db.query(
            Transaction.activity_date,
            Transaction.description,
            TransactionAllocation.amount,
            TransactionAllocation.label,
            TransactionAllocation.category_id,
            ExpenseCategory.name.label("category_name"),
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
            Transaction.activity_date >= dt.datetime.combine(from_month, dt.time.min),
            Transaction.activity_date <= dt.datetime.combine(to_month_last, dt.time.max),
        )
        .order_by(Transaction.activity_date.asc())
        .all()
    )

    groups: dict[str, dict] = {}
    for row in rows:
        d = row.activity_date
        month_d = d.date() if hasattr(d, "date") else d
        key = f"{month_d.year:04d}-{month_d.month:02d}"
        if key not in groups:
            groups[key] = {
                "month_label": HEBREW_MONTHS[month_d.month - 1],
                "rows": [],
                "subtotal": 0.0,
            }
        amount = float(row.amount)
        description = row.label or row.description or "—"
        category = row.category_name or "—"
        groups[key]["rows"].append(
            {"description": description, "category": category, "amount": amount}
        )
        groups[key]["subtotal"] += amount

    return list(groups.values())


# ─── Debtors ──────────────────────────────────────────────────────────────────


def _period_debtors(income_rows: list[dict]) -> list[dict]:
    return [
        {
            "apartment_number": r["apartment_number"],
            "tenant_name": r["tenant_name"],
            "debt": r["balance"],
            "note": "",
        }
        for r in income_rows
        if r["balance"] > 0
    ]


def _lifetime_debtors(
    db: Session,
    building: Building,
    apartments: list[Apartment],
    tenants_by_apt: dict[UUID, Tenant],
) -> list[dict]:
    if not apartments:
        return []

    tenant_ids = [t.id for t in tenants_by_apt.values()]
    if not tenant_ids:
        return []

    # Sum all historical PAYMENT allocations per tenant
    paid_totals = dict(
        db.query(
            TransactionAllocation.tenant_id,
            func.sum(TransactionAllocation.amount).label("total"),
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            TransactionAllocation.tenant_id.in_(tenant_ids),
            Transaction.transaction_type == TransactionType.PAYMENT,
        )
        .group_by(TransactionAllocation.tenant_id)
        .all()
    )

    today = dt.date.today()
    debtors = []
    for apt in apartments:
        tenant = tenants_by_apt.get(apt.id)
        if not tenant:
            continue

        expected_per_month = float(
            apt.expected_payment
            if apt.expected_payment is not None
            else 0
        )
        if expected_per_month == 0 and apt.building_id:
            # Re-query building default — building reference may not be loaded
            pass  # already scoped via apartments

        # Months since effective move_in_date (tenant override → building default)
        move_in = tenant.move_in_date or building.default_move_in_date or dt.date(today.year, 1, 1)
        months_active = (
            (today.year - move_in.year) * 12 + (today.month - move_in.month) + 1
        )
        months_active = max(months_active, 0)

        total_expected = expected_per_month * months_active
        total_paid = float(paid_totals.get(tenant.id, 0))
        debt = max(total_expected - total_paid, 0.0)

        if debt > 0:
            debtors.append({
                "apartment_number": apt.number,
                "tenant_name": (tenant.full_name or tenant.name),
                "debt": debt,
                "note": "",
            })

    return debtors


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _money(v: Any) -> float | None:
    return float(v) if v is not None else None


def _totals_row(rows: list[dict], period: dict) -> dict:
    cells = [{"key": c["key"], "amount": 0.0} for c in period["columns"]]
    paid = expected = balance = 0.0
    for r in rows:
        for src, dst in zip(r["cells"], cells):
            dst["amount"] += src["amount"]
        paid += r["paid_total"]
        expected += r["expected_total"]
        balance += r["balance"]
    return {"cells": cells, "paid_total": paid, "expected_total": expected, "balance": balance}
