"""add_vendor_mappings_table

Revision ID: 6d69d1f819b8
Revises: b7e2c5a91f3d
Create Date: 2026-04-30 08:23:17.553977

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6d69d1f819b8'
down_revision: Union[str, None] = 'b7e2c5a91f3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use raw SQL to avoid SQLAlchemy trying to CREATE TYPE mappingcreatedby,
    # which already exists (created by the name_mappings migration).
    op.execute("""
        CREATE TABLE vendor_mappings (
            id          UUID         NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
            building_id UUID         NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
            keyword     VARCHAR      NOT NULL,
            vendor_label VARCHAR     NOT NULL,
            category    VARCHAR(32)  NOT NULL,
            created_by  mappingcreatedby NOT NULL DEFAULT 'manual',
            created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX ix_vendor_mappings_building_keyword
        ON vendor_mappings (building_id, keyword)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_vendor_mappings_building_keyword")
    op.execute("DROP TABLE IF EXISTS vendor_mappings")
