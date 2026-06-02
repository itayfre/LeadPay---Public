"""add_building_id_to_tenant

Revision ID: 06407327ea0a
Revises: 75895bf5dce6
Create Date: 2026-02-21 16:41:02.831096

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '06407327ea0a'
down_revision: Union[str, None] = '75895bf5dce6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Step 1: Add nullable column
    op.add_column('tenants', sa.Column('building_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_tenants_building_id', 'tenants', 'buildings', ['building_id'], ['id'])

    # Step 2: Backfill from apartments table
    op.execute("""
        UPDATE tenants t
        SET building_id = a.building_id
        FROM apartments a
        WHERE t.apartment_id = a.id
    """)

    # Step 3: Make non-nullable
    op.alter_column('tenants', 'building_id', nullable=False)


def downgrade() -> None:
    op.drop_constraint('fk_tenants_building_id', 'tenants', type_='foreignkey')
    op.drop_column('tenants', 'building_id')
