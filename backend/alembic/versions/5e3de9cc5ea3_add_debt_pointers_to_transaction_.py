"""add debt pointers to transaction_allocation

Revision ID: 5e3de9cc5ea3
Revises: 1a68ac80dacd
Create Date: 2026-05-21 16:30:33.223703

Adds two nullable FK columns to ``transaction_allocations``:

- ``apartment_period_debt_id`` → ``apartment_period_debts.id``
- ``special_charge_id`` → ``special_charges.id``

Both nullable in Phase 1. The legacy ``(tenant_id, period_year, period_month)``
columns stay in place so existing code keeps working. Backfill (Phase 2)
populates the new pointers on every existing allocation. Phase 6 cut-over
drops ``period_year``/``period_month`` and adds an XOR check constraint
between these two new pointers.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '5e3de9cc5ea3'
down_revision: Union[str, None] = '1a68ac80dacd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'transaction_allocations',
        sa.Column(
            'apartment_period_debt_id',
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment="Allocation pays down this period's apartment debt",
        ),
    )
    op.add_column(
        'transaction_allocations',
        sa.Column(
            'special_charge_id',
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment='Allocation pays down this one-off special charge',
        ),
    )
    op.create_index(
        op.f('ix_transaction_allocations_apartment_period_debt_id'),
        'transaction_allocations',
        ['apartment_period_debt_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_transaction_allocations_special_charge_id'),
        'transaction_allocations',
        ['special_charge_id'],
        unique=False,
    )
    op.create_foreign_key(
        'fk_allocations_apartment_period_debt_id',
        'transaction_allocations',
        'apartment_period_debts',
        ['apartment_period_debt_id'],
        ['id'],
        ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_allocations_special_charge_id',
        'transaction_allocations',
        'special_charges',
        ['special_charge_id'],
        ['id'],
        ondelete='CASCADE',
    )


def downgrade() -> None:
    op.drop_constraint(
        'fk_allocations_special_charge_id',
        'transaction_allocations',
        type_='foreignkey',
    )
    op.drop_constraint(
        'fk_allocations_apartment_period_debt_id',
        'transaction_allocations',
        type_='foreignkey',
    )
    op.drop_index(
        op.f('ix_transaction_allocations_special_charge_id'),
        table_name='transaction_allocations',
    )
    op.drop_index(
        op.f('ix_transaction_allocations_apartment_period_debt_id'),
        table_name='transaction_allocations',
    )
    op.drop_column('transaction_allocations', 'special_charge_id')
    op.drop_column('transaction_allocations', 'apartment_period_debt_id')
