"""add_move_in_date_to_tenants

Revision ID: 4de6ea9cc716
Revises: 23d3101bce99
Create Date: 2026-02-26 23:21:26.876132

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4de6ea9cc716'
down_revision: Union[str, None] = '23d3101bce99'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('tenants', sa.Column('move_in_date', sa.Date(), server_default='2026-01-01', nullable=False, comment='Debt calculation start date'))


def downgrade() -> None:
    op.drop_column('tenants', 'move_in_date')
