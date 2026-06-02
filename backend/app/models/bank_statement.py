from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from ..database import Base


class BankStatement(Base):
    __tablename__ = "bank_statements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    building_id = Column(UUID(as_uuid=True), ForeignKey("buildings.id"), nullable=False)
    upload_date = Column(DateTime, default=datetime.utcnow)
    period_month = Column(Integer, nullable=False)
    period_year = Column(Integer, nullable=False)
    original_filename = Column(String, nullable=False)
    raw_data = Column(JSONB, nullable=True, comment="Store original parsed data")

    # Relationships
    building = relationship("Building", back_populates="bank_statements")
    transactions = relationship("Transaction", back_populates="statement", cascade="all, delete-orphan")
