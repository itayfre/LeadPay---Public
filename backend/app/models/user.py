import uuid
from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import Column, String, DateTime, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID
from ..database import Base


class UserRole(str, PyEnum):
    MANAGER = "manager"
    WORKER = "worker"
    VIEWER = "viewer"
    TENANT = "tenant"


class UserStatus(str, PyEnum):
    ACTIVE = "active"
    PENDING = "pending"
    INVITED = "invited"


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=True)  # null until invite accepted
    full_name = Column(String, nullable=False)
    role = Column(
        Enum(UserRole, values_callable=lambda x: [e.value for e in x]),
        default=UserRole.VIEWER, nullable=False
    )
    status = Column(
        Enum(UserStatus, values_callable=lambda x: [e.value for e in x]),
        default=UserStatus.ACTIVE, nullable=False
    )
    building_id = Column(UUID(as_uuid=True), ForeignKey("buildings.id", ondelete="SET NULL"), nullable=True)
    invite_token = Column(String, nullable=True)
    invite_expires_at = Column(DateTime, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
