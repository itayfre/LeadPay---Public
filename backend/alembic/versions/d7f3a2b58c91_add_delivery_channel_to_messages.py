"""add delivery_channel, provider_message_id, error_reason to messages

Adds tracking for which channel a message was actually sent through
(WhatsApp link, Email, or SMS), the external provider's message ID,
and a failure reason field for delivery_status=FAILED.

Revision ID: d7f3a2b58c91
Revises: a3b9d8e6c204
Create Date: 2026-05-26 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d7f3a2b58c91"
down_revision: Union[str, None] = "a3b9d8e6c204"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Postgres enum type name + values for delivery_channel
DELIVERY_CHANNEL_ENUM = "deliverychannel"
DELIVERY_CHANNEL_VALUES = ("whatsapp_link", "email", "sms")


def upgrade() -> None:
    # 1. Create the enum type.
    delivery_channel = sa.Enum(*DELIVERY_CHANNEL_VALUES, name=DELIVERY_CHANNEL_ENUM)
    delivery_channel.create(op.get_bind(), checkfirst=True)

    # 2. Add three new columns to messages.
    op.add_column(
        "messages",
        sa.Column(
            "delivery_channel",
            delivery_channel,
            nullable=True,
            comment="How the message was delivered: whatsapp_link (manual), email, or sms",
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "provider_message_id",
            sa.String(),
            nullable=True,
            comment="Message ID from external provider (Inforu / Resend)",
        ),
    )
    op.add_column(
        "messages",
        sa.Column(
            "error_reason",
            sa.String(),
            nullable=True,
            comment="Failure detail when delivery_status=FAILED",
        ),
    )


def downgrade() -> None:
    op.drop_column("messages", "error_reason")
    op.drop_column("messages", "provider_message_id")
    op.drop_column("messages", "delivery_channel")

    delivery_channel = sa.Enum(*DELIVERY_CHANNEL_VALUES, name=DELIVERY_CHANNEL_ENUM)
    delivery_channel.drop(op.get_bind(), checkfirst=True)
