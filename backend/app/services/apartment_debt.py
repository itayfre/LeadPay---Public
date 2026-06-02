"""Per-apartment debt queries against the new tables.

Two read-only entry points:

- :func:`apartment_balance` — total outstanding debt for a single apartment
  (period debts + special charges, minus the allocations linked to either).
  Clamped at 0 so the apartment never appears to be "in credit" from this
  query.

- :func:`apartment_ledger` — per-month rows for the apartment, suitable for
  the per-apartment detail/ledger view. Each row carries expected, paid,
  per-period balance (NOT clamped), and the responsible tenant id at the
  time the period was generated.

Special charges are intentionally NOT included in :func:`apartment_ledger`
yet — once the special-charge UI lands (Phase 4 product work) we'll decide
whether to interleave them with monthly rows or surface them in a separate
section. For Phase 3, the ledger is just monthly history.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.apartment_period_debt import ApartmentPeriodDebt
from app.models.special_charge import SpecialCharge
from app.models.transaction_allocation import TransactionAllocation


@dataclass(frozen=True)
class LedgerRow:
    year: int
    month: int
    expected: Decimal
    paid: Decimal
    balance: Decimal
    responsible_tenant_id: str | None


def apartment_balance(session: Session, apartment_id: UUID | str) -> Decimal:
    """Total outstanding debt for the apartment, clamped at 0.

    expected = SUM(period_debt.expected) + SUM(special_charge.amount)
    paid     = SUM(allocation.amount) joined to period_debt
             + SUM(allocation.amount) joined to special_charge
    balance  = max(0, expected - paid)  rounded to 2 dp
    """
    expected = (
        session.scalar(
            select(func.coalesce(func.sum(ApartmentPeriodDebt.expected_amount), 0))
            .where(ApartmentPeriodDebt.apartment_id == apartment_id)
        )
        or Decimal("0")
    )
    paid = (
        session.scalar(
            select(func.coalesce(func.sum(TransactionAllocation.amount), 0))
            .join(
                ApartmentPeriodDebt,
                ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
            )
            .where(ApartmentPeriodDebt.apartment_id == apartment_id)
        )
        or Decimal("0")
    )
    special_expected = (
        session.scalar(
            select(func.coalesce(func.sum(SpecialCharge.amount), 0))
            .where(SpecialCharge.apartment_id == apartment_id)
        )
        or Decimal("0")
    )
    special_paid = (
        session.scalar(
            select(func.coalesce(func.sum(TransactionAllocation.amount), 0))
            .join(SpecialCharge, SpecialCharge.id == TransactionAllocation.special_charge_id)
            .where(SpecialCharge.apartment_id == apartment_id)
        )
        or Decimal("0")
    )

    delta = (
        Decimal(expected)
        + Decimal(special_expected)
        - Decimal(paid)
        - Decimal(special_paid)
    )
    return max(Decimal("0"), delta.quantize(Decimal("0.01")))


def apartment_ledger(session: Session, apartment_id: UUID | str) -> list[LedgerRow]:
    """One row per (year, month) for the apartment, sorted chronologically.

    The per-row ``balance`` is NOT clamped at 0 — a single period can show
    negative balance (overpayment) even when the aggregate is positive.
    """
    paid_subq = (
        select(
            TransactionAllocation.apartment_period_debt_id.label("apd_id"),
            func.sum(TransactionAllocation.amount).label("paid"),
        )
        .group_by(TransactionAllocation.apartment_period_debt_id)
        .subquery()
    )

    stmt = (
        select(
            ApartmentPeriodDebt.year,
            ApartmentPeriodDebt.month,
            ApartmentPeriodDebt.expected_amount,
            ApartmentPeriodDebt.responsible_tenant_id,
            func.coalesce(paid_subq.c.paid, 0).label("paid"),
        )
        .outerjoin(paid_subq, paid_subq.c.apd_id == ApartmentPeriodDebt.id)
        .where(ApartmentPeriodDebt.apartment_id == apartment_id)
        .order_by(ApartmentPeriodDebt.year, ApartmentPeriodDebt.month)
    )

    def _row(raw: Any) -> LedgerRow:
        expected = Decimal(raw.expected_amount).quantize(Decimal("0.01"))
        paid = Decimal(raw.paid).quantize(Decimal("0.01"))
        return LedgerRow(
            year=int(raw.year),
            month=int(raw.month),
            expected=expected,
            paid=paid,
            balance=(expected - paid).quantize(Decimal("0.01")),
            responsible_tenant_id=(
                str(raw.responsible_tenant_id)
                if raw.responsible_tenant_id is not None
                else None
            ),
        )

    return [_row(r) for r in session.execute(stmt)]
