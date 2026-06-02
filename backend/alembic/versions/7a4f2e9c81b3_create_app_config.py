"""create app_config key-value table for system-wide settings

Revision ID: 7a4f2e9c81b3
Revises: c5e1a7d4f088
Create Date: 2026-05-20 12:00:00.000000

Generic key-value store for system-wide configuration. First consumer is the
home-page risk thresholds (key=risk_thresholds, value={partial, onTrack}).
Subsequent settings (template overrides, default currency, etc.) can use the
same table without new migrations.

The table is allowed to be empty — endpoints synthesise defaults when a key
is missing. So no seed row is inserted here.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '7a4f2e9c81b3'
down_revision: Union[str, None] = 'c5e1a7d4f088'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'app_config',
        sa.Column('key', sa.Text(), primary_key=True),
        sa.Column('value', postgresql.JSONB(), nullable=False),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.Column(
            'updated_by',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_table('app_config')
