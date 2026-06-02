"""add_payer_name_and_learned_match

Revision ID: 8a9b0c1d2e3f
Revises: 367bf5d442d0
Create Date: 2026-03-09 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8a9b0c1d2e3f'
down_revision: Union[str, None] = '367bf5d442d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add payer_name column to transactions
    op.add_column('transactions', sa.Column('payer_name', sa.String(), nullable=True,
                                            comment='Extracted payer name from bank statement'))

    # Add 'learned' value to matchmethod enum
    # PostgreSQL requires this to be committed before it can be used
    op.execute("ALTER TYPE matchmethod ADD VALUE IF NOT EXISTS 'learned'")


def downgrade() -> None:
    # Remove payer_name column
    op.drop_column('transactions', 'payer_name')
    # Note: PostgreSQL does not support removing enum values without recreating the type.
    # The 'learned' value remains in the enum on downgrade.
