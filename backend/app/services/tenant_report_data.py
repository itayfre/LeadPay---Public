"""
Per-tenant report payload builder.
Mirrors report_data.py but scoped to a single tenant.
"""
import datetime as dt
import io
import zipfile
from typing import Literal, Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ..models import Apartment, Tenant, Building
from ..models.apartment_period_debt import ApartmentPeriodDebt
from ..models.transaction import Transaction, TransactionType
from ..models.transaction_allocation import TransactionAllocation

HEB_MONTHS = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
]
HEB_QUARTERS = {1: "רבעון א", 2: "רבעון ב", 3: "רבעון ג", 4: "רבעון ד"}


def _period_label(from_d: dt.date, to_d: dt.date) -> str:
    if from_d.year == to_d.year and from_d.month == to_d.month:
        return f"{HEB_MONTHS[from_d.month - 1]} {from_d.year}"
    if (
        from_d.year == to_d.year
        and from_d.month % 3 == 1
        and to_d.month == from_d.month + 2
    ):
        q = (from_d.month - 1) // 3 + 1
        return f"{HEB_QUARTERS[q]} {from_d.year}"
    if from_d.year == to_d.year and from_d.month == 1 and to_d.month == 12:
        return str(from_d.year)
    return f"{from_d.strftime('%d.%m.%Y')} – {to_d.strftime('%d.%m.%Y')}"


def _period_months(
    from_d: dt.date,
    to_d: dt.date,
    move_in_date: Optional[dt.date] = None,
) -> list[tuple[int, int]]:
    start = from_d
    if move_in_date and move_in_date > from_d:
        start = move_in_date.replace(day=1)
    months: list[tuple[int, int]] = []
    y, m = start.year, start.month
    while (y, m) <= (to_d.year, to_d.month):
        months.append((y, m))
        m += 1
        if m == 13:
            m = 1
            y += 1
    return months


def _compute_summary(
    *, period_expected: float, period_paid: float, lifetime_debt: float, tx_count: int
) -> dict:
    return {
        "period_expected": float(period_expected),
        "period_paid": float(period_paid),
        "period_debt": float(max(period_expected - period_paid, 0)),
        "lifetime_debt": float(lifetime_debt),
        "transaction_count": int(tx_count),
    }


def _expected_for_apartment(apt: Apartment, building_default: float) -> float:
    return float(apt.expected_payment) if apt.expected_payment is not None else building_default


def _lifetime_debt(
    tenant: Tenant,
    apt: Apartment,
    building: Building,
    total_paid: float,
) -> float:
    """Total expected since effective move_in_date minus the total paid amount provided by the caller."""
    move_in = tenant.move_in_date or building.default_move_in_date
    if move_in is None:
        return 0.0
    today = dt.date.today()
    if move_in > today:
        return 0.0

    months_elapsed = (
        (today.year - move_in.year) * 12
        + (today.month - move_in.month)
        + 1
    )
    expected_per_month = _expected_for_apartment(apt, float(building.expected_monthly_payment or 0))
    return max(months_elapsed * expected_per_month - total_paid, 0.0)


def _transaction_method(
    a: TransactionAllocation, t: Transaction, alloc_count: int
) -> str:
    """Hebrew label for the תנועות table. The user's allocation note takes
    priority — if they wrote something when entering/categorizing the payment,
    that's the most informative thing we can show. Otherwise we infer the
    method from the schema."""
    if a.notes:
        return a.notes
    if t.is_manual:
        return "תשלום ידני"
    if alloc_count > 1:
        return "פיצול מצ׳ק"
    return "העברה בנקאית"


def build_tenant_report_payload(
    db: Session, tenant_id: UUID, from_date: dt.date, to_date: dt.date
) -> dict:
    tenant = (
        db.query(Tenant)
        .options(joinedload(Tenant.apartment), joinedload(Tenant.building))
        .filter(Tenant.id == tenant_id)
        .first()
    )
    if not tenant:
        raise ValueError(f"Tenant {tenant_id} not found")
    apt = tenant.apartment
    if not apt:
        raise ValueError(f"Apartment for tenant {tenant_id} not found")
    building = tenant.building
    if not building:
        raise ValueError(f"Building for tenant {tenant_id} not found")

    expected_per_month = _expected_for_apartment(apt, float(building.expected_monthly_payment or 0))
    months_yyyymm = _period_months(from_date, to_date, tenant.move_in_date or building.default_move_in_date)

    # Single join: every PAYMENT allocation for this tenant, paired with its
    # parent Transaction and the ApartmentPeriodDebt row (Phase 6b cutover —
    # period sourced from APD instead of allocation's legacy period_year/month).
    alloc_rows = (
        db.query(
            TransactionAllocation,
            Transaction,
            ApartmentPeriodDebt.year.label("apd_year"),
            ApartmentPeriodDebt.month.label("apd_month"),
        )
        .select_from(TransactionAllocation)
        .join(
            ApartmentPeriodDebt,
            ApartmentPeriodDebt.id == TransactionAllocation.apartment_period_debt_id,
        )
        .join(Transaction, TransactionAllocation.transaction_id == Transaction.id)
        .filter(
            TransactionAllocation.tenant_id == tenant.id,
            Transaction.transaction_type == TransactionType.PAYMENT,
        )
        .all()
    )
    lifetime_paid = sum(float(a.amount) for (a, _t, _y, _m) in alloc_rows)

    in_range_keys = set(months_yyyymm)
    in_range = [
        (a, t, int(apd_y), int(apd_m)) for (a, t, apd_y, apd_m) in alloc_rows
        if (int(apd_y), int(apd_m)) in in_range_keys
    ]
    period_paid = sum(float(a.amount) for (a, _t, _y, _m) in in_range)
    period_expected = expected_per_month * len(months_yyyymm)

    # Per-month rows.
    paid_by_month: dict[tuple[int, int], float] = {}
    for (a, _t, apd_y, apd_m) in in_range:
        key = (apd_y, apd_m)
        paid_by_month[key] = paid_by_month.get(key, 0.0) + float(a.amount)

    months_payload = []
    for (y, m) in months_yyyymm:
        paid = paid_by_month.get((y, m), 0.0)
        diff = paid - expected_per_month
        if paid <= 0:
            status = "unpaid"
        elif paid + 1 < expected_per_month:
            status = "partial"
        else:
            status = "paid"
        months_payload.append({
            "month": m,
            "year": y,
            "period_label": f"{HEB_MONTHS[m - 1]} {y}",
            "expected": expected_per_month,
            "paid": paid,
            "difference": diff,
            "status": status,
        })

    # Transaction rows from the in-range set, sorted by activity_date desc.
    in_range_sorted = sorted(
        in_range,
        key=lambda tup: tup[1].activity_date or dt.datetime.min,
        reverse=True,
    )

    # Count allocations per parent transaction so we can tell split-from-check
    # rows apart from single-allocation transactions. The count must include
    # allocations to *other* tenants too — that's what makes it a split.
    tx_ids = [a.transaction_id for (a, _t, _y, _m) in in_range_sorted]
    alloc_counts: dict = {}
    if tx_ids:
        alloc_counts = dict(
            db.query(
                TransactionAllocation.transaction_id,
                func.count(TransactionAllocation.id),
            )
            .filter(TransactionAllocation.transaction_id.in_(tx_ids))
            .group_by(TransactionAllocation.transaction_id)
            .all()
        )

    # Response keeps the period_month/period_year keys (frontend contract);
    # values now come from the APD join.
    transactions_payload = [
        {
            "date": (t.activity_date.isoformat() if t.activity_date else ""),
            "amount": float(a.amount),
            "description": t.description or "",
            "method": _transaction_method(a, t, alloc_counts.get(a.transaction_id, 1)),
            "period_month": apd_m,
            "period_year": apd_y,
        }
        for (a, t, apd_y, apd_m) in in_range_sorted
    ]

    summary = _compute_summary(
        period_expected=period_expected,
        period_paid=period_paid,
        lifetime_debt=_lifetime_debt(tenant, apt, building, lifetime_paid),
        tx_count=len(transactions_payload),
    )

    return {
        "tenant": {
            "id": str(tenant.id),
            "name": tenant.full_name or tenant.name,
            "apartment_number": apt.number,
            "floor": apt.floor,
            "standing_order": (
                {
                    "start_date": tenant.standing_order_start_date.isoformat(),
                    "end_date": (
                        tenant.standing_order_end_date.isoformat()
                        if tenant.standing_order_end_date else None
                    ),
                    "amount": float(tenant.standing_order_amount or 0),
                }
                if tenant.standing_order_start_date else None
            ),
            "building": {
                "name": building.name,
                "address": building.address,
                "city": building.city,
            },
        },
        "period": {
            "from": from_date.strftime("%Y-%m"),
            "to": to_date.strftime("%Y-%m"),
            "label": _period_label(from_date, to_date),
        },
        "summary": summary,
        "months": months_payload,
        "transactions": transactions_payload,
    }


def build_bulk_report_zip(
    db: Session,
    tenant_ids: list[UUID],
    from_date: dt.date,
    to_date: dt.date,
    fmt: Literal["pdf", "docx"],
) -> tuple[bytes, str]:
    """
    Render reports for every tenant id and pack into a ZIP.
    Returns (zip_bytes, zip_filename).

    On per-tenant render failure: include a .txt with the error and continue —
    one bad tenant must never abort the whole batch.
    """
    # Lazy imports — same lazy strategy as render_tenant_report_pdf.
    from .report_pdf import render_tenant_report_pdf
    from .report_docx import render_tenant_report_docx
    renderer = render_tenant_report_pdf if fmt == "pdf" else render_tenant_report_docx
    ext = "pdf" if fmt == "pdf" else "docx"

    # Detect filename collisions up front so we can disambiguate with the
    # apartment number when two selected tenants share a name.
    name_counts: dict[str, int] = {}
    for tid in tenant_ids:
        t = db.query(Tenant).filter(Tenant.id == tid).first()
        if t:
            n = t.full_name or t.name
            name_counts[n] = name_counts.get(n, 0) + 1
    collisions = {n for n, c in name_counts.items() if c > 1}

    buf = io.BytesIO()
    building_name = "דוחות"
    period_label = ""

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for tid in tenant_ids:
            try:
                payload = build_tenant_report_payload(db, tid, from_date, to_date)
            except ValueError as e:
                zf.writestr(f"שגיאה_{tid}.txt", str(e))
                continue
            try:
                content = renderer(payload)
            except Exception as e:  # noqa: BLE001 — log + continue, never abort the batch
                zf.writestr(
                    f"שגיאה_{payload['tenant']['name']}.txt",
                    f"רינדור הדוח נכשל: {e}",
                )
                continue

            name = payload["tenant"]["name"]
            if name in collisions:
                inner = f"דוח_{name}_דירה{payload['tenant']['apartment_number']}.{ext}"
            else:
                inner = f"דוח_{name}.{ext}"
            zf.writestr(inner, content)
            building_name = payload["tenant"]["building"]["name"]
            period_label = payload["period"]["label"]

    zip_filename = f"דוחות_{building_name}_{period_label}.zip" if period_label else "דוחות.zip"
    return buf.getvalue(), zip_filename
