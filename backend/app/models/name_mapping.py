from sqlalchemy import Column, String, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum

from ..database import Base


class MappingCreatedBy(str, enum.Enum):
    MANUAL = "manual"
    AUTO = "auto"


class NameMapping(Base):
    __tablename__ = "name_mappings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    building_id = Column(UUID(as_uuid=True), ForeignKey("buildings.id"), nullable=False)
    bank_name = Column(String, nullable=False, comment="Name as it appears in bank statement")
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    created_by = Column(SQLEnum(MappingCreatedBy, values_callable=lambda x: [e.value for e in x]), default=MappingCreatedBy.MANUAL)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    building = relationship("Building", back_populates="name_mappings")
    tenant = relationship("Tenant", back_populates="name_mappings")
