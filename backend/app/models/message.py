from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
import enum

from ..database import Base


class MessageType(str, enum.Enum):
    REMINDER = "reminder"
    CONFIRMATION = "confirmation"
    CUSTOM = "custom"


class DeliveryStatus(str, enum.Enum):
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    FAILED = "failed"


class DeliveryChannel(str, enum.Enum):
    """How the message was sent.

    WHATSAPP_LINK = wa.me deep-link (user clicks Send in WhatsApp Web — manual).
    EMAIL         = sent automatically via Resend / SMTP.
    SMS           = sent automatically via Inforu.
    """
    WHATSAPP_LINK = "whatsapp_link"
    EMAIL = "email"
    SMS = "sms"


class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), ForeignKey("tenants.id"), nullable=False)
    building_id = Column(UUID(as_uuid=True), ForeignKey("buildings.id"), nullable=False)
    message_type = Column(SQLEnum(MessageType, values_callable=lambda x: [e.value for e in x]), default=MessageType.REMINDER)
    message_text = Column(String, nullable=False)
    sent_at = Column(DateTime, nullable=True)
    delivery_status = Column(SQLEnum(DeliveryStatus, values_callable=lambda x: [e.value for e in x]), default=DeliveryStatus.PENDING)
    delivery_channel = Column(
        SQLEnum(DeliveryChannel, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
        comment="How the message was delivered: WHATSAPP_LINK (manual), EMAIL, or SMS",
    )
    provider_message_id = Column(String, nullable=True, comment="Message ID from external provider (Inforu / Resend)")
    error_reason = Column(String, nullable=True, comment="Failure detail from provider when delivery_status=FAILED")
    period_month = Column(Integer, nullable=True)
    period_year = Column(Integer, nullable=True)

    # Relationships
    tenant = relationship("Tenant", back_populates="messages")
    building = relationship("Building", back_populates="messages")
