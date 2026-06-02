"""Import the per-building 'tenants xlsx' file to set monthly expected
amounts on apartments + optionally backfill unpaid period debts.

Two operations:

- :func:`build_preview` — parse the file, match apartments by number, return
  a list of changes the import WOULD make. No DB writes.
- :func:`apply_import` — actually apply: update ``apartment.expected_payment``
  for every matched apt, and conditionally rewrite ``apartment_period_debts``
  rows according to the ``scope``.

The "tenants xlsx" comes from :mod:`app.services.tenants_xlsx_parser`. Only
the per-apt monthly amount is consumed here; tenant rows are ignored at the
import-amount level. The same file can also be used to seed tenants in a
separate flow (out of scope for this endpoint).
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.apartment import Apartment
from app.models.apartment_period_debt import ApartmentPeriodDebt
from app.models.transaction_allocation import TransactionAllocation
from app.services.tenants_xlsx_parser import parse_monthly_amounts


Scope = Literal["future_only", "future_plus_current", "all_unpaid"]


@dataclass(frozen=True)
class PreviewRow:
    apt_label: str             # what the Excel said
    apartment_id: str | None   # matched DB apartment id (None if unmatched)
    apartment_number: int | None
    current_amount: str | None  # apartment.expected_payment before the change
    new_amount: str             # the value from the Excel
    delta: str                  # new - current (or "—" when no current)
    status: Literal["unchanged", "update", "new_value", "unmatched"]


@dataclass(frozen=True)
class ImportPreview:
    rows: list[PreviewRow]
    matched_count: int
    unmatched_count: int
    update_count: int          # rows that will actually change the amount


@dataclass(frozen=True)
class ApplyResult:
    apartments_updated: int    # rows where apartment.expected_payment changed
    period_debts_updated: int  # apartment_period_debts.expected_amount edits


def _match_apartment(
    session: Session,
    building_id,
    apt_label: str,
) -> Apartment | None:
    """Match an Excel apartment label (string) to a DB apartment.

    Today: only numeric labels are auto-matched (the prod data has integer
    apartment numbers). Text labels like 'מסחר 0' or 'דירת גן 1' return
    None — the operator handles those manually before re-running the import.
    """
    try:
        as_int = int(float(apt_label))  # handles both "1" and "1.0"
    except (TypeError, ValueError):
        return None
    return session.scalar(
        select(Apartment)
        .where(Apartment.building_id == building_id, Apartment.number == as_int)
    )


def build_preview(
    session: Session,
    building_id,
    xlsx_path: Path,
) -> ImportPreview:
    """Parse the xlsx file and report what the import would do (no writes)."""
    parsed = parse_monthly_amounts(xlsx_path)
    rows: list[PreviewRow] = []
    matched = unmatched = updates = 0

    for apt_label, new_amount in parsed.items():
        apt = _match_apartment(session, building_id, apt_label)
        if apt is None:
            rows.append(PreviewRow(
                apt_label=apt_label, apartment_id=None, apartment_number=None,
                current_amount=None, new_amount=str(new_amount), delta="—",
                status="unmatched",
            ))
            unmatched += 1
            continue
        matched += 1
        current = apt.expected_payment
        if current is None:
            status: Literal["unchanged", "update", "new_value"] = "new_value"
            delta = str(new_amount)
            updates += 1
        elif Decimal(current).quantize(Decimal("0.01")) == new_amount.quantize(Decimal("0.01")):
            status = "unchanged"
            delta = "0.00"
        else:
            status = "update"
            delta = str((new_amount - Decimal(current)).quantize(Decimal("0.01")))
            updates += 1
        rows.append(PreviewRow(
            apt_label=apt_label,
            apartment_id=str(apt.id),
            apartment_number=apt.number,
            current_amount=str(current) if current is not None else None,
            new_amount=str(new_amount),
            delta=delta,
            status=status,
        ))

    # Sort: matched updates first, then unchanged, then unmatched.
    rows.sort(key=lambda r: (r.status == "unmatched", r.status == "unchanged"))
    return ImportPreview(
        rows=rows,
        matched_count=matched,
        unmatched_count=unmatched,
        update_count=updates,
    )


def _is_period_unpaid(session: Session, period_debt_id) -> bool:
    """A period debt is 'unpaid' if no allocation points at it."""
    paid = session.scalar(
        select(TransactionAllocation.id)
        .where(TransactionAllocation.apartment_period_debt_id == period_debt_id)
        .limit(1)
    )
    return paid is None


def apply_import(
    session: Session,
    building_id,
    xlsx_path: Path,
    scope: Scope,
    current_year: int,
    current_month: int,
) -> ApplyResult:
    """Apply the import. Updates apartment.expected_payment for every matched
    apartment + conditionally updates apartment_period_debts depending on scope:

    - ``future_only``  — only ``apartment.expected_payment``. Future
       period-debt rows generated AFTER this import will use the new value.
    - ``future_plus_current`` — also updates the CURRENT month's period_debt
       row when it's unpaid (paid rows are not retroactively rewritten).
    - ``all_unpaid`` — updates EVERY unpaid period_debt row for the apartment.

    Always: ``apartment.expected_payment`` is set for matched apartments.
    """
    parsed = parse_monthly_amounts(xlsx_path)

    apartments_updated = 0
    period_debts_updated = 0

    for apt_label, new_amount in parsed.items():
        apt = _match_apartment(session, building_id, apt_label)
        if apt is None:
            continue
        if apt.expected_payment is None or Decimal(apt.expected_payment).quantize(Decimal("0.01")) != new_amount.quantize(Decimal("0.01")):
            apt.expected_payment = new_amount
            apartments_updated += 1

        if scope == "future_only":
            continue

        # Update period_debt rows depending on scope.
        if scope == "future_plus_current":
            # Just the current month (if unpaid).
            current_period = session.scalar(
                select(ApartmentPeriodDebt)
                .where(
                    ApartmentPeriodDebt.apartment_id == apt.id,
                    ApartmentPeriodDebt.year == current_year,
                    ApartmentPeriodDebt.month == current_month,
                )
            )
            if current_period and _is_period_unpaid(session, current_period.id):
                if Decimal(current_period.expected_amount).quantize(Decimal("0.01")) != new_amount.quantize(Decimal("0.01")):
                    current_period.expected_amount = new_amount
                    period_debts_updated += 1
            continue

        # all_unpaid: walk every period_debt and update if unpaid.
        all_periods = session.scalars(
            select(ApartmentPeriodDebt).where(
                ApartmentPeriodDebt.apartment_id == apt.id
            )
        ).all()
        for pd in all_periods:
            if _is_period_unpaid(session, pd.id) and Decimal(pd.expected_amount).quantize(Decimal("0.01")) != new_amount.quantize(Decimal("0.01")):
                pd.expected_amount = new_amount
                period_debts_updated += 1

    session.commit()
    return ApplyResult(
        apartments_updated=apartments_updated,
        period_debts_updated=period_debts_updated,
    )
