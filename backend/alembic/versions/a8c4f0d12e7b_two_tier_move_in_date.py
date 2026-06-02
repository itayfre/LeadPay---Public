"""two-tier move-in date: building default + nullable tenant override

Revision ID: a8c4f0d12e7b
Revises: f1b2c3d4e5a6
Create Date: 2026-05-18 12:00:00.000000

Adds buildings.default_move_in_date (non-nullable, default 2026-01-01) and
makes tenants.move_in_date nullable so that NULL means "use building default".
Existing tenant rows keep their current move_in_date values (treated as
explicit overrides) — no data is rewritten.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a8c4f0d12e7b'
down_revision: Union[str, None] = 'f1b2c3d4e5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'buildings',
        sa.Column(
            'default_move_in_date',
            sa.Date(),
            server_default='2026-01-01',
            nullable=False,
            comment='Default move-in date for new tenants; fallback when tenant.move_in_date is NULL',
        ),
    )
    op.alter_column(
        'tenants',
        'move_in_date',
        existing_type=sa.Date(),
        nullable=True,
        server_default=None,
        comment='Per-tenant override; NULL = use building.default_move_in_date',
        existing_comment='Debt calculation start date',
    )


def downgrade() -> None:
    op.alter_column(
        'tenants',
        'move_in_date',
        existing_type=sa.Date(),
        nullable=False,
        server_default='2026-01-01',
        comment='Debt calculation start date',
        existing_comment='Per-tenant override; NULL = use building.default_move_in_date',
    )
    op.drop_column('buildings', 'default_move_in_date')
