"""Materialized monthly debt for an apartment (ועד בית fee for one period).

One row per (apartment, year, month). Frozen at creation: ``expected_amount``
captures the apartment's expected payment at the moment the row was generated,
so changing ``apartment.expected_payment`` later does not retroactively rewrite
history. ``responsible_tenant_id`` is the tenant who was the active payer when
the row was generated; for the legal-liability fallback when nobody pays, see
``apartments.fallback_owner_tenant_id``.
"""
import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    ForeignKey,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class ApartmentPeriodDebt(Base):
    __tablename__ = "apartment_period_debts"
    __table_args__ = (
        UniqueConstraint(
            "apartment_id",
            "year",
            "month",
            name="uq_apartment_period_debts_apt_year_month",
        ),
        CheckConstraint(
            "month BETWEEN 1 AND 12",
            name="ck_apartment_period_debts_month_range",
        ),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    apartment_id = Column(
        UUID(as_uuid=True),
        ForeignKey("apartments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    year = Column(Integer, nullable=False)
    month = Column(Integer, nullable=False)
    expected_amount = Column(
        Numeric(12, 2),
        nullable=False,
        comment="Frozen at row creation; edit per-row to adjust a single past period",
    )
    responsible_tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
        comment="Active payer for this period; NULL means owner-fallback applies",
    )
    notes = Column(
        Text,
        nullable=True,
        comment="Per-period note (e.g. 'lift repair surcharge') for manual adjustments",
    )
