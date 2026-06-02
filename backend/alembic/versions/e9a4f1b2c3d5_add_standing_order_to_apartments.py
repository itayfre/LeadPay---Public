"""add_standing_order_to_apartments

Revision ID: e9a4f1b2c3d5
Revises: c1d8f4b7e2a3
Create Date: 2026-05-16 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e9a4f1b2c3d5'
down_revision: Union[str, None] = 'c1d8f4b7e2a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('apartments', sa.Column('standing_order_active', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('apartments', sa.Column('standing_order_start_month', sa.Integer(), nullable=True))
    op.add_column('apartments', sa.Column('standing_order_start_year', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('apartments', 'standing_order_start_year')
    op.drop_column('apartments', 'standing_order_start_month')
    op.drop_column('apartments', 'standing_order_active')
