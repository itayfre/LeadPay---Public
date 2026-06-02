from sqlalchemy import Column, String, DateTime, ForeignKey, Index
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from ..database import Base
from .name_mapping import MappingCreatedBy


class VendorMapping(Base):
    """
    User-defined (or auto-learned) keyword → vendor rules for expense classification.

    When the vendor classifier encounters a debit transaction, it checks these rows
    before falling back to the static DEFAULT_VENDOR_RULES dict.  A match here gets
    confidence 1.0; a static-dict match gets 0.8.

    Mirrors the structure of name_mappings.  Created automatically when a user
    categorizes a transaction with remember=True, or never if they skip the checkbox.
    """

    __tablename__ = "vendor_mappings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    building_id = Column(
        UUID(as_uuid=True),
        ForeignKey("buildings.id", ondelete="CASCADE"),
        nullable=False,
    )

    # The substring / token that triggers this rule (e.g. "חברת חשמל", "ביטוח")
    keyword = Column(String, nullable=False)

    # Human-readable label shown in the UI (e.g. "חברת החשמל", "ביטוח מבנה")
    vendor_label = Column(String, nullable=False)

    # One of ALLOCATION_CATEGORIES; stored as varchar so adding categories
    # doesn't require a migration.
    category = Column(String(32), nullable=False)

    created_by = Column(
        # create_type=False: reuse the existing mappingcreatedby PG enum from name_mappings
        SQLEnum(MappingCreatedBy, values_callable=lambda x: [e.value for e in x], create_type=False),
        default=MappingCreatedBy.MANUAL,
        nullable=False,
    )
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    building = relationship("Building", back_populates="vendor_mappings")

    __table_args__ = (
        # One keyword per building — upsert logic relies on this uniqueness.
        Index("ix_vendor_mappings_building_keyword", "building_id", "keyword", unique=True),
    )

    def __repr__(self) -> str:
        return (
            f"<VendorMapping building={self.building_id} "
            f"keyword={self.keyword!r} category={self.category}>"
        )
