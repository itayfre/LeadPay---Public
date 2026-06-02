"""add_unique_constraint_to_building_name

Revision ID: d329d72540d2
Revises: 66cd5a46a6a1
Create Date: 2025-02-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd329d72540d2'
down_revision: Union[str, None] = '66cd5a46a6a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add unique constraint to building name
    op.create_unique_constraint('uq_building_name', 'buildings', ['name'])


def downgrade() -> None:
    # Remove unique constraint
    op.drop_constraint('uq_building_name', 'buildings', type_='unique')
