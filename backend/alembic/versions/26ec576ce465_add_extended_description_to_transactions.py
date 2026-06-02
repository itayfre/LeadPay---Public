"""add extended_description to transactions

Revision ID: 26ec576ce465
Revises: d7f3a2b58c91
Create Date: 2026-05-27 23:45:56.819093

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '26ec576ce465'
down_revision: Union[str, None] = 'd7f3a2b58c91'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'transactions',
        sa.Column('extended_description', sa.Text(), nullable=True,
                  comment="Rich vendor text from 'תאור מורחב' column when present"),
    )


def downgrade() -> None:
    op.drop_column('transactions', 'extended_description')
