"""add_manual_payment_support

Revision ID: 038dc8d991fa
Revises: 4de6ea9cc716
Create Date: 2026-02-26 23:25:07.299323

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '038dc8d991fa'
down_revision: Union[str, None] = '4de6ea9cc716'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('transactions', sa.Column('is_manual', sa.Boolean(), server_default='false', nullable=False, comment='True if entered manually (not from bank statement)'))
    op.alter_column('transactions', 'statement_id',
               existing_type=sa.UUID(),
               nullable=True)


def downgrade() -> None:
    op.alter_column('transactions', 'statement_id',
               existing_type=sa.UUID(),
               nullable=False)
    op.drop_column('transactions', 'is_manual')
