"""
AppConfig — generic system-wide key-value configuration store.

Allows mutable settings (e.g. home-page risk thresholds) without code
deploys. The table is allowed to be empty: endpoints synthesise defaults
when a key is missing.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from ..database import Base


class AppConfig(Base):
    __tablename__ = "app_config"

    key = Column(Text, primary_key=True)
    value = Column(JSONB, nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False,
    )
    updated_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    def __repr__(self) -> str:
        return f"<AppConfig key={self.key!r} updated_at={self.updated_at}>"
