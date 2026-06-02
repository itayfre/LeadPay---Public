from sqlalchemy import Column, Integer, Numeric, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid

from ..database import Base


class Apartment(Base):
    __tablename__ = "apartments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    building_id = Column(UUID(as_uuid=True), ForeignKey("buildings.id"), nullable=False)
    number = Column(Integer, nullable=False)
    floor = Column(Integer, nullable=False)
    expected_payment = Column(Numeric(10, 2), nullable=True, comment="Overrides building default if set")
    weight = Column(
        Numeric(10, 4),
        nullable=True,
        comment="Proportional weight for special-charge splits (e.g. size, %). NULL = equal-split",
    )
    fallback_owner_tenant_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        comment="Legally-liable owner-role tenant when no active payer exists",
    )

    # Relationships
    building = relationship("Building", back_populates="apartments")
    tenants = relationship(
        "Tenant",
        back_populates="apartment",
        cascade="all, delete-orphan",
        foreign_keys="Tenant.apartment_id",
    )
