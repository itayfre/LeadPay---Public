from sqlalchemy import Column, String, Boolean, DateTime, Date, Numeric, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum

from ..database import Base


class OwnershipType(str, enum.Enum):
    OWNER = "בעלים"
    LANDLORD = "משכיר"
    RENTER = "שוכר"


class LanguagePreference(str, enum.Enum):
    HEBREW = "he"
    ENGLISH = "en"


class Tenant(Base):
    __tablename__ = "tenants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    apartment_id = Column(UUID(as_uuid=True), ForeignKey("apartments.id"), nullable=False)
    building_id = Column(UUID(as_uuid=True), ForeignKey("buildings.id"), nullable=False)
    name = Column(String, nullable=False, comment="Display name (may be abbreviated)")
    full_name = Column(String, nullable=True, comment="Full name for bank matching")
    phone = Column(String, nullable=True, comment="Normalized to +972 format")
    email = Column(String, nullable=True)
    language = Column(SQLEnum(LanguagePreference, values_callable=lambda x: [e.value for e in x]), default=LanguagePreference.HEBREW)
    ownership_type = Column(SQLEnum(OwnershipType, values_callable=lambda x: [e.value for e in x]), nullable=True)
    is_committee_member = Column(Boolean, default=False)
    standing_order_start_date = Column(Date, nullable=True, comment="First month this tenant's standing order covers")
    standing_order_end_date = Column(Date, nullable=True, comment="Last month covered; NULL = ongoing")
    standing_order_amount = Column(Numeric(10, 2), nullable=True, comment="Monthly amount; required when start_date is set")
    notes = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    archived_at = Column(
        DateTime,
        nullable=True,
        index=True,
        comment="When the tenant left the apartment / was soft-deleted. NULL = still in the apartment list.",
    )
    move_in_date = Column(
        Date,
        nullable=True,
        comment="Per-tenant override for debt-calc start date; NULL = use building.default_move_in_date",
    )
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    apartment = relationship("Apartment", back_populates="tenants", foreign_keys=[apartment_id])
    building = relationship("Building", back_populates="tenants")
    transactions = relationship("Transaction", back_populates="tenant")
    allocations = relationship("TransactionAllocation", back_populates="tenant")
    name_mappings = relationship("NameMapping", back_populates="tenant")
    messages = relationship("Message", back_populates="tenant")
