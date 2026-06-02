"""
ExpenseCategory — per-building, user-defined expense categories.

Coexists with the legacy `TransactionAllocation.category` string column (set by the
vendor classifier at upload time). New UI/API works exclusively through the FK on
`TransactionAllocation.category_id` introduced alongside this model.

Each building gets 6 default categories (ניקיון, גינון, חשמל, מים, תיקונים, אחר)
seeded on building create (and backfilled for existing buildings via Alembic
migration `add_expense_categories`).
"""
from sqlalchemy import (
    Column,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from ..database import Base


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    building_id = Column(
        UUID(as_uuid=True),
        ForeignKey("buildings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name = Column(String, nullable=False)
    color = Column(String(7), nullable=False, default="#4C72B0")
    is_default = Column(Boolean, nullable=False, default=False, server_default="false")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )

    # Relationships
    building = relationship("Building")
    allocations = relationship(
        "TransactionAllocation",
        back_populates="category_ref",
    )

    __table_args__ = (
        UniqueConstraint(
            "building_id", "name", name="uq_expense_categories_building_name"
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<ExpenseCategory id={self.id} building={self.building_id} "
            f"name={self.name!r} default={self.is_default}>"
        )
