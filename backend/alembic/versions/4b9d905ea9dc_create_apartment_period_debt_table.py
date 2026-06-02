"""create apartment_period_debt table

Revision ID: 4b9d905ea9dc
Revises: 7147f2328084
Create Date: 2026-05-21 16:12:31.954897

Materializes the monthly building-fee debt for each apartment as one row
per (apartment, year, month). ``expected_amount`` is frozen at row creation
so historical periods are not retroactively rewritten when an apartment's
``expected_payment`` is later changed.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '4b9d905ea9dc'
down_revision: Union[str, None] = '7147f2328084'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'apartment_period_debts',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('apartment_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column(
            'expected_amount',
            sa.Numeric(precision=12, scale=2),
            nullable=False,
            comment='Frozen at row creation; edit per-row to adjust a single past period',
        ),
        sa.Column(
            'responsible_tenant_id',
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment='Active payer for this period; NULL means owner-fallback applies',
        ),
        sa.Column(
            'notes',
            sa.Text(),
            nullable=True,
            comment="Per-period note (e.g. 'lift repair surcharge') for manual adjustments",
        ),
        sa.CheckConstraint(
            'month BETWEEN 1 AND 12',
            name='ck_apartment_period_debts_month_range',
        ),
        sa.ForeignKeyConstraint(
            ['apartment_id'], ['apartments.id'], ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['responsible_tenant_id'], ['tenants.id'], ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'apartment_id', 'year', 'month',
            name='uq_apartment_period_debts_apt_year_month',
        ),
    )
    op.create_index(
        op.f('ix_apartment_period_debts_apartment_id'),
        'apartment_period_debts',
        ['apartment_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_apartment_period_debts_responsible_tenant_id'),
        'apartment_period_debts',
        ['responsible_tenant_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_apartment_period_debts_responsible_tenant_id'),
        table_name='apartment_period_debts',
    )
    op.drop_index(
        op.f('ix_apartment_period_debts_apartment_id'),
        table_name='apartment_period_debts',
    )
    op.drop_table('apartment_period_debts')
