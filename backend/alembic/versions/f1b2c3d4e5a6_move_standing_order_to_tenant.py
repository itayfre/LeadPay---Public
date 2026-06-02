"""move standing order from apartment to tenant, drop bank fields

Revision ID: f1b2c3d4e5a6
Revises: e9a4f1b2c3d5
Create Date: 2026-05-16 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f1b2c3d4e5a6'
down_revision: Union[str, None] = 'e9a4f1b2c3d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop apartment-level standing-order columns (added 2026-05-16, not yet in prod use)
    op.drop_column('apartments', 'standing_order_start_year')
    op.drop_column('apartments', 'standing_order_start_month')
    op.drop_column('apartments', 'standing_order_active')

    # Drop unused tenant bank fields and the redundant boolean flag
    op.drop_column('tenants', 'has_standing_order')
    op.drop_column('tenants', 'bank_name')
    op.drop_column('tenants', 'bank_account')

    # Add tenant-level standing-order fields
    op.add_column('tenants', sa.Column('standing_order_start_date', sa.Date(), nullable=True))
    op.add_column('tenants', sa.Column('standing_order_end_date', sa.Date(), nullable=True))
    op.add_column('tenants', sa.Column('standing_order_amount', sa.Numeric(10, 2), nullable=True))


def downgrade() -> None:
    op.drop_column('tenants', 'standing_order_amount')
    op.drop_column('tenants', 'standing_order_end_date')
    op.drop_column('tenants', 'standing_order_start_date')

    op.add_column('tenants', sa.Column('bank_account', sa.String(), nullable=True))
    op.add_column('tenants', sa.Column('bank_name', sa.String(), nullable=True))
    op.add_column('tenants', sa.Column('has_standing_order', sa.Boolean(), nullable=True, server_default=sa.text('false')))

    op.add_column('apartments', sa.Column('standing_order_active', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('apartments', sa.Column('standing_order_start_month', sa.Integer(), nullable=True))
    op.add_column('apartments', sa.Column('standing_order_start_year', sa.Integer(), nullable=True))
