from sqlalchemy import Column, String, Integer, DateTime, Numeric, Date
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from ..database import Base


class Building(Base):
    __tablename__ = "buildings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    address = Column(String, nullable=False)
    city = Column(String, nullable=False)
    bank_account_number = Column(String, nullable=True)
    total_tenants = Column(Integer, default=0)
    expected_monthly_payment = Column(Numeric(10, 2), nullable=True, comment="Default expected payment per apartment")
    default_move_in_date = Column(
        Date,
        nullable=False,
        server_default='2026-01-01',
        comment="Default move-in date for new tenants; used as fallback when tenant.move_in_date is NULL",
    )
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    apartments = relationship("Apartment", back_populates="building", cascade="all, delete-orphan")
    tenants = relationship("Tenant", back_populates="building", cascade="save-update, merge")
    bank_statements = relationship("BankStatement", back_populates="building", cascade="all, delete-orphan")
    name_mappings = relationship("NameMapping", back_populates="building", cascade="all, delete-orphan")
    vendor_mappings = relationship("VendorMapping", back_populates="building", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="building", cascade="all, delete-orphan")
