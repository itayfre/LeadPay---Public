"""add tenant archived_at column

Revision ID: a3b9d8e6c204
Revises: f7c2d9a0b1e3
Create Date: 2026-05-26 12:00:00.000000

Adds a nullable ``archived_at`` timestamp to ``tenants`` to separate
"soft-deleted / left the apartment" from ``is_active`` (which now exclusively
means "the primary payer for this apartment"). Existing ``is_active=False``
rows are NOT auto-archived — they are legitimate non-paying tenants (owners
who don't pay, secondary renters, etc.). Archiving is a deliberate user
action via the delete button.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3b9d8e6c204"
down_revision: Union[str, None] = "f7c2d9a0b1e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("archived_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_tenants_archived_at",
        "tenants",
        ["archived_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_tenants_archived_at", table_name="tenants")
    op.drop_column("tenants", "archived_at")
