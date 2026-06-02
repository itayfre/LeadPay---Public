"""One-off building expenses spread across apartments.

A ``SpecialChargeBatch`` is a single extraordinary expense (lift repair,
window cleaning, holiday upkeep, etc.) created by the building manager.
The total amount is split across one or more apartments per the chosen
``SplitMethod``, producing one ``SpecialCharge`` row per apartment.

The split is decided at creation time and stored as concrete per-apartment
amounts on ``SpecialCharge.amount`` — there is no "live recompute". If the
manager later edits the batch, they edit individual charges.
"""
import enum
import uuid

from sqlalchemy import (
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Numeric,
    Text,
    Date,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class SplitMethod(str, enum.Enum):
    """How the batch total is split across apartments.

    - EQUAL: total / N apartments (last apartment absorbs rounding).
    - CUSTOM: caller supplies per-apartment amounts; sum must equal total.
    - WEIGHT: proportional to ``Apartment.weight``; sum of weights ≡ 100%.
    - FLAT: a per-apartment amount; ``total`` field is informational only.
    """

    EQUAL = "equal"
    CUSTOM = "custom"
    WEIGHT = "weight"
    FLAT = "flat"


class SpecialChargeBatch(Base):
    __tablename__ = "special_charge_batches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    building_id = Column(
        UUID(as_uuid=True),
        ForeignKey("buildings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title = Column(Text, nullable=False, comment="Short label, e.g. 'תיקון מעלית Q1'")
    description = Column(
        Text,
        nullable=True,
        comment="Long-form context entered by the manager when creating the batch",
    )
    total_amount = Column(Numeric(12, 2), nullable=False)
    split_method = Column(
        SAEnum(
            SplitMethod,
            name="special_charge_split_method",
            values_callable=lambda x: [e.value for e in x],
        ),
        nullable=False,
    )
    due_date = Column(Date, nullable=True)
    created_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    charges = relationship(
        "SpecialCharge",
        back_populates="batch",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class SpecialCharge(Base):
    __tablename__ = "special_charges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id = Column(
        UUID(as_uuid=True),
        ForeignKey("special_charge_batches.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    apartment_id = Column(
        UUID(as_uuid=True),
        ForeignKey("apartments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    amount = Column(Numeric(12, 2), nullable=False)
    responsible_tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        comment="Tenant the charge is assigned to; NULL means owner-fallback applies",
    )
    notes = Column(
        Text,
        nullable=True,
        comment="Per-apartment exception note (e.g. 'discount for owner', 'vacancy')",
    )

    batch = relationship("SpecialChargeBatch", back_populates="charges")
