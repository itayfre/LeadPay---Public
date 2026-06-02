"""
messaging_service — Channel-agnostic façade for the SendRemindersModal flow.

Encapsulates:
  1. build_recipient_list(filters)     — applies all UI filters, returns tenants
  2. compute_availability(recipients)  — counts who has email / phone
  3. send_via_channel(channel, ...)    — dispatches to SMS / Email / WhatsApp

Channels:
  EMAIL          — auto-sent via ResendClient (stub-safe)
  SMS            — auto-sent via InforuClient batch (stub-safe)
  WHATSAPP_LINK  — generates wa.me links only; user clicks them in the UI to
                   actually send via WhatsApp Web (no provider involved).
"""

from __future__ import annotations

import logging
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable, List, Optional, Set
from uuid import UUID

from sqlalchemy.orm import Session

from ..models import (
    Apartment,
    Building,
    DeliveryChannel,
    DeliveryStatus,
    Message,
    MessageType,
    Tenant,
    TransactionAllocation,
    Transaction,
    TransactionType,
    ApartmentPeriodDebt,
)
from . import templates as templates_mod
from .sms_service import InforuClient, SMSResult
from .email_service import ResendClient, EmailResult

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Filter & DTO types
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class ReminderFilters:
    """All filter inputs from the SendRemindersModal."""
    building_ids: List[UUID]
    ownership_types: List[str] = field(default_factory=list)       # ['בעלים','שוכר','משכיר']
    include_committee: bool = True                                  # 'ועד בית' chip selected
    active_only: bool = True
    status_filter: str = "has_debt"                                 # 'has_debt' | 'all'
    debt_period: str = "current_month"                              # 'current_month'|'all_history'|'range'
    debt_from: Optional[str] = None                                 # 'YYYY-MM'
    debt_to: Optional[str] = None                                   # 'YYYY-MM'
    current_month: Optional[int] = None                             # 1-12 — required when debt_period='current_month'
    current_year: Optional[int] = None
    excluded_tenant_ids: List[UUID] = field(default_factory=list)


@dataclass
class Recipient:
    """One tenant resolved against the filters, with everything we need to send."""
    tenant_id: UUID
    name: str
    apartment_number: int
    building_id: UUID
    building_name: str
    ownership_type: Optional[str]
    is_committee_member: bool
    is_active: bool
    phone: Optional[str]
    email: Optional[str]
    language: str
    expected_amount: float
    current_debt: float


@dataclass
class AvailabilityCounts:
    total: int
    with_email: int
    with_phone: int


# ─────────────────────────────────────────────────────────────────────────────
# Recipient resolution
# ─────────────────────────────────────────────────────────────────────────────


def build_recipient_list(filters: ReminderFilters, db: Session) -> List[Recipient]:
    """Apply UI filters to produce the final recipient list."""
    if not filters.building_ids:
        return []

    # Base query: tenants in selected buildings, joined with apartment + building
    q = (
        db.query(Tenant, Apartment, Building)
        .join(Apartment, Tenant.apartment_id == Apartment.id)
        .join(Building, Tenant.building_id == Building.id)
        .filter(Tenant.building_id.in_(filters.building_ids))
    )

    # "Active members only" = not archived (still associated with the apartment).
    # We deliberately do NOT filter on is_active, because Phase 6b made is_active
    # mean "primary payer for this apartment" — which would exclude co-tenants who
    # should also receive reminders.
    if filters.active_only:
        q = q.filter(Tenant.archived_at.is_(None))

    rows = q.all()

    # Build set of tenant IDs that have debt for each period mode (if filtering)
    debt_tenant_ids: Optional[Set[str]] = None
    if filters.status_filter == "has_debt":
        debt_tenant_ids = _tenants_with_debt(filters, [t.id for t, _, _ in rows], db)

    excluded = {str(tid) for tid in filters.excluded_tenant_ids}

    recipients: List[Recipient] = []
    for tenant, apartment, building in rows:
        if str(tenant.id) in excluded:
            continue

        # Ownership / committee filter — "ועד בית" chip = is_committee_member flag
        ownership = tenant.ownership_type.value if tenant.ownership_type else None
        is_committee = bool(tenant.is_committee_member)
        if not _matches_role_filter(ownership, is_committee, filters):
            continue

        # Debt filter
        if debt_tenant_ids is not None and str(tenant.id) not in debt_tenant_ids:
            continue

        expected = float(apartment.expected_payment or building.expected_monthly_payment or 0)
        current_debt = _current_period_debt(
            tenant_id=tenant.id,
            apartment_id=apartment.id,
            expected=expected,
            month=filters.current_month,
            year=filters.current_year,
            db=db,
        )

        recipients.append(
            Recipient(
                tenant_id=tenant.id,
                name=tenant.name,
                apartment_number=apartment.number,
                building_id=building.id,
                building_name=building.name,
                ownership_type=ownership,
                is_committee_member=is_committee,
                is_active=bool(tenant.is_active),
                phone=tenant.phone,
                email=tenant.email,
                language=tenant.language.value if tenant.language else "he",
                expected_amount=expected,
                current_debt=current_debt,
            )
        )

    return recipients


def compute_availability(recipients: Iterable[Recipient]) -> AvailabilityCounts:
    rs = list(recipients)
    return AvailabilityCounts(
        total=len(rs),
        with_email=sum(1 for r in rs if r.email),
        with_phone=sum(1 for r in rs if r.phone and _looks_like_phone(r.phone)),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Sending
# ─────────────────────────────────────────────────────────────────────────────


def send_via_channel(
    channel: str,
    recipients: List[Recipient],
    *,
    template_id: str,
    custom_text: Optional[str],
    period: str,
    period_month: int,
    period_year: int,
    db: Session,
) -> dict:
    """
    Dispatch send. Returns a summary dict the router can serialize.

    channel: 'EMAIL' | 'SMS' | 'WHATSAPP_LINK'
    """
    channel = channel.upper()
    if channel == "EMAIL":
        return _send_email(recipients, template_id, custom_text, period, period_month, period_year, db)
    if channel == "SMS":
        return _send_sms(recipients, template_id, custom_text, period, period_month, period_year, db)
    if channel == "WHATSAPP_LINK":
        return _send_whatsapp_links(recipients, template_id, custom_text, period, period_month, period_year, db)

    raise ValueError(f"Unknown channel: {channel}")


# ─── Email path ───────────────────────────────────────────────────────────────

def _send_email(
    recipients: List[Recipient],
    template_id: str,
    custom_text: Optional[str],
    period: str,
    period_month: int,
    period_year: int,
    db: Session,
) -> dict:
    client = ResendClient()
    eligible = [r for r in recipients if r.email]
    skipped_no_email = len(recipients) - len(eligible)

    items_to_send = []
    rendered_per_recipient = []  # parallel array (Recipient, rendered_dict)
    for r in eligible:
        rendered = templates_mod.render(
            "EMAIL",
            template_id,
            r.language,
            tenant_name=r.name,
            apartment_number=r.apartment_number,
            building_name=r.building_name,
            amount=(r.current_debt if r.current_debt > 0 else r.expected_amount),
            period=period,
            custom_text=custom_text,
        )
        items_to_send.append({
            "to": r.email,
            "subject": rendered["subject"],
            "html": rendered["html"],
            "text": rendered.get("text"),
        })
        rendered_per_recipient.append((r, rendered))

    results: List[EmailResult] = client.send_bulk(items_to_send)

    sent = 0
    failed = 0
    for (r, rendered), res in zip(rendered_per_recipient, results):
        msg = Message(
            tenant_id=r.tenant_id,
            building_id=r.building_id,
            message_type=MessageType.REMINDER,
            message_text=rendered.get("text") or rendered.get("html", "")[:500],
            sent_at=datetime.utcnow() if res.success else None,
            delivery_status=DeliveryStatus.SENT if res.success else DeliveryStatus.FAILED,
            delivery_channel=DeliveryChannel.EMAIL,
            provider_message_id=res.provider_message_id,
            error_reason=res.error,
            period_month=period_month,
            period_year=period_year,
        )
        db.add(msg)
        if res.success:
            sent += 1
        else:
            failed += 1

    db.commit()

    return {
        "channel": "EMAIL",
        "total_recipients": len(recipients),
        "sent": sent,
        "failed": failed,
        "skipped_no_email": skipped_no_email,
        "is_stub": client.is_stub,
    }


# ─── SMS path ─────────────────────────────────────────────────────────────────

def _send_sms(
    recipients: List[Recipient],
    template_id: str,
    custom_text: Optional[str],
    period: str,
    period_month: int,
    period_year: int,
    db: Session,
) -> dict:
    client = InforuClient()
    eligible = [r for r in recipients if r.phone and _looks_like_phone(r.phone)]
    skipped_no_phone = len(recipients) - len(eligible)

    # SMS is a broadcast — Inforu accepts a single message + list of recipients.
    # But for personalized content, we render per recipient and send individually.
    # For ≤ ~100 it's fine; for larger volumes we'd chunk.
    sent = 0
    failed = 0
    for r in eligible:
        rendered = templates_mod.render(
            "SMS",
            template_id,
            r.language,
            tenant_name=r.name,
            apartment_number=r.apartment_number,
            building_name=r.building_name,
            amount=(r.current_debt if r.current_debt > 0 else r.expected_amount),
            period=period,
            custom_text=custom_text,
        )
        text = rendered["text"]
        results: List[SMSResult] = client.send_bulk([r.phone], text)
        res = results[0]

        msg = Message(
            tenant_id=r.tenant_id,
            building_id=r.building_id,
            message_type=MessageType.REMINDER,
            message_text=text,
            sent_at=datetime.utcnow() if res.success else None,
            delivery_status=DeliveryStatus.SENT if res.success else DeliveryStatus.FAILED,
            delivery_channel=DeliveryChannel.SMS,
            provider_message_id=res.provider_message_id,
            error_reason=res.error,
            period_month=period_month,
            period_year=period_year,
        )
        db.add(msg)
        if res.success:
            sent += 1
        else:
            failed += 1

    db.commit()

    return {
        "channel": "SMS",
        "total_recipients": len(recipients),
        "sent": sent,
        "failed": failed,
        "skipped_no_phone": skipped_no_phone,
        "is_stub": client.is_stub,
    }


# ─── WhatsApp manual-link path ────────────────────────────────────────────────

def _send_whatsapp_links(
    recipients: List[Recipient],
    template_id: str,
    custom_text: Optional[str],
    period: str,
    period_month: int,
    period_year: int,
    db: Session,
) -> dict:
    """
    Doesn't actually send. Creates PENDING Message rows + returns wa.me links
    so the frontend can show a list with per-row "Send" buttons. The user
    clicks each → opens WhatsApp Web → presses Send manually → frontend
    POSTs /mark-sent to flip the row to SENT.
    """
    eligible = [r for r in recipients if r.phone and _looks_like_phone(r.phone)]
    skipped_no_phone = len(recipients) - len(eligible)

    items = []
    for r in eligible:
        rendered = templates_mod.render(
            "WHATSAPP_LINK",
            template_id,
            r.language,
            tenant_name=r.name,
            apartment_number=r.apartment_number,
            building_name=r.building_name,
            amount=(r.current_debt if r.current_debt > 0 else r.expected_amount),
            period=period,
            custom_text=custom_text,
        )
        text = rendered["text"]
        link = _build_wa_me_link(r.phone, text)

        db_msg = Message(
            tenant_id=r.tenant_id,
            building_id=r.building_id,
            message_type=MessageType.REMINDER,
            message_text=text,
            delivery_status=DeliveryStatus.PENDING,
            delivery_channel=DeliveryChannel.WHATSAPP_LINK,
            period_month=period_month,
            period_year=period_year,
        )
        db.add(db_msg)
        db.flush()

        items.append({
            "message_id": str(db_msg.id),
            "tenant_id": str(r.tenant_id),
            "tenant_name": r.name,
            "apartment_number": r.apartment_number,
            "building_name": r.building_name,
            "phone": r.phone,
            "whatsapp_link": link,
            "message_preview": text[:140] + ("..." if len(text) > 140 else ""),
        })

    db.commit()

    return {
        "channel": "WHATSAPP_LINK",
        "total_recipients": len(recipients),
        "skipped_no_phone": skipped_no_phone,
        "items": items,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _matches_role_filter(
    ownership_type: Optional[str],
    is_committee: bool,
    filters: ReminderFilters,
) -> bool:
    """A tenant matches if EITHER:
      - their ownership_type is in the selected list, OR
      - committee chip is on AND they're a committee member.
    """
    if filters.include_committee and is_committee:
        return True
    if ownership_type and ownership_type in filters.ownership_types:
        return True
    return False


def _looks_like_phone(phone: str) -> bool:
    digits = "".join(c for c in phone if c.isdigit())
    return len(digits) >= 9


def _build_wa_me_link(phone: str, message: str) -> str:
    digits = "".join(c for c in phone if c.isdigit())
    encoded = urllib.parse.quote(message, safe="")
    return f"https://wa.me/{digits}?text={encoded}"


def _tenants_with_debt(
    filters: ReminderFilters,
    tenant_ids: List[UUID],
    db: Session,
) -> Set[str]:
    """Return the set of tenant_id strings that have debt under the configured
    debt_period mode.

    Phase-6b note: ``transaction_allocations`` no longer carries period_year /
    period_month — it points at an ``apartment_period_debts`` row via
    ``apartment_period_debt_id``. We compute per-period paid amounts by
    aggregating allocations grouped by their pointed-to period_debt.

    A tenant has debt for a period if the apartment_period_debt's
    ``expected_amount`` exceeds the sum of allocations pointing to it, AND
    the tenant is the row's ``responsible_tenant_id`` (or, if NULL,
    the apartment's ``fallback_owner_tenant_id``).
    """
    if not tenant_ids:
        return set()

    # Period bounds
    if filters.debt_period == "current_month":
        if not (filters.current_month and filters.current_year):
            return set()
        from_y, from_m = filters.current_year, filters.current_month
        to_y, to_m = filters.current_year, filters.current_month
    elif filters.debt_period == "all_history":
        from_y, from_m = 1900, 1
        to_y, to_m = 9999, 12
    elif filters.debt_period == "range":
        if not (filters.debt_from and filters.debt_to):
            return set()
        from_y, from_m = _parse_yyyy_mm(filters.debt_from)
        to_y, to_m = _parse_yyyy_mm(filters.debt_to)
    else:
        return set()

    def in_range(year: int, month: int) -> bool:
        return (year, month) >= (from_y, from_m) and (year, month) <= (to_y, to_m)

    # Pull each candidate tenant's apartment + fallback-owner mapping in one go.
    tenant_rows = (
        db.query(Tenant.id, Tenant.apartment_id, Apartment.fallback_owner_tenant_id)
        .join(Apartment, Apartment.id == Tenant.apartment_id)
        .filter(Tenant.id.in_(tenant_ids))
        .all()
    )
    if not tenant_rows:
        return set()

    candidate_tenant_ids = {str(t.id) for t in tenant_rows}
    apt_ids = list({t.apartment_id for t in tenant_rows})
    # apartment_id → fallback_owner_tenant_id (for unallocated period debts)
    apt_fallback = {t.apartment_id: t.fallback_owner_tenant_id for t in tenant_rows}

    # Expected per period_debt row (only for apartments we care about, in range)
    pd_rows = (
        db.query(ApartmentPeriodDebt)
        .filter(ApartmentPeriodDebt.apartment_id.in_(apt_ids))
        .all()
    )
    period_debts = [pd for pd in pd_rows if in_range(pd.year, pd.month)]
    if not period_debts:
        return set()
    pd_ids = [pd.id for pd in period_debts]

    # Paid amount summed per period_debt_id, from allocations pointing at them.
    paid_rows = (
        db.query(
            TransactionAllocation.apartment_period_debt_id,
            TransactionAllocation.amount,
        )
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            TransactionAllocation.apartment_period_debt_id.in_(pd_ids),
            Transaction.transaction_type == TransactionType.PAYMENT,
        )
        .all()
    )
    paid_by_pd: dict = {}
    for pd_id, amount in paid_rows:
        if pd_id is None:
            continue
        paid_by_pd[pd_id] = paid_by_pd.get(pd_id, 0.0) + float(amount or 0)

    # Walk period_debts; if expected > paid, attribute debt to the responsible
    # tenant (or the apartment's fallback owner). Only count if that tenant is
    # in our candidate set.
    debtors: Set[str] = set()
    for pd in period_debts:
        paid = paid_by_pd.get(pd.id, 0.0)
        if float(pd.expected_amount or 0) - paid <= 1.0:  # 1 ₪ tolerance
            continue
        responsible = pd.responsible_tenant_id or apt_fallback.get(pd.apartment_id)
        if responsible and str(responsible) in candidate_tenant_ids:
            debtors.add(str(responsible))

    return debtors


def _current_period_debt(
    tenant_id: UUID,
    apartment_id: UUID,
    expected: float,
    month: Optional[int],
    year: Optional[int],
    db: Session,
) -> float:
    """Debt for the displayed period — used to fill the {amount} placeholder.

    Phase-6b: paid amount comes from allocations pointing at the period_debt
    row, not from any period column on the allocation itself.
    """
    if not (month and year):
        return 0.0

    pd = (
        db.query(ApartmentPeriodDebt)
        .filter(
            ApartmentPeriodDebt.apartment_id == apartment_id,
            ApartmentPeriodDebt.year == year,
            ApartmentPeriodDebt.month == month,
        )
        .first()
    )
    # No frozen row → fall back to the apartment's expected payment with no allocations
    if not pd:
        return max(0.0, expected)

    paid_rows = (
        db.query(TransactionAllocation.amount)
        .join(Transaction, Transaction.id == TransactionAllocation.transaction_id)
        .filter(
            TransactionAllocation.apartment_period_debt_id == pd.id,
            Transaction.transaction_type == TransactionType.PAYMENT,
        )
        .all()
    )
    paid_total = sum(float(a or 0) for (a,) in paid_rows)
    return max(0.0, float(pd.expected_amount or 0) - paid_total)


def _parse_yyyy_mm(s: str) -> tuple[int, int]:
    parts = s.split("-")
    if len(parts) != 2:
        raise ValueError(f"Bad YYYY-MM: {s}")
    return int(parts[0]), int(parts[1])
