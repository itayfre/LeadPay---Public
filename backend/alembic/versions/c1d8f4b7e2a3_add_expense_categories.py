"""add_expense_categories

Adds the per-building user-defined expense categories table and a
`category_id` FK on `transaction_allocations` linking to it.

Coexists with the legacy `transaction_allocations.category` string column
(populated by the vendor classifier) — no data migration on the existing
column. The new system is opt-in via the new `category_id` FK.

Backfills 6 default Hebrew categories for every existing building so that
the new UI is usable out of the box on existing data.

Revision ID: c1d8f4b7e2a3
Revises: 6d69d1f819b8
Create Date: 2026-05-01 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c1d8f4b7e2a3"
down_revision: Union[str, None] = "6d69d1f819b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Keep this list in sync with app/services/expense_categories.py:DEFAULT_CATEGORIES.
DEFAULT_CATEGORIES = [
    ("ניקיון", "#4C72B0"),
    ("גינון", "#55A868"),
    ("חשמל", "#DD8452"),
    ("מים", "#8172B3"),
    ("תיקונים", "#C44E52"),
    ("אחר", "#937860"),
]


def upgrade() -> None:
    # gen_random_uuid() requires pgcrypto. Already enabled in Supabase but be defensive.
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.execute(
        """
        CREATE TABLE expense_categories (
            id          UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
            building_id UUID        NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
            name        VARCHAR     NOT NULL,
            color       VARCHAR(7)  NOT NULL DEFAULT '#4C72B0',
            is_default  BOOLEAN     NOT NULL DEFAULT FALSE,
            is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
            created_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMP   NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_expense_categories_building_name UNIQUE (building_id, name)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_expense_categories_building_id "
        "ON expense_categories (building_id)"
    )

    op.execute(
        "ALTER TABLE transaction_allocations "
        "ADD COLUMN category_id UUID NULL "
        "REFERENCES expense_categories(id) ON DELETE SET NULL"
    )
    op.execute(
        "CREATE INDEX ix_alloc_category_id "
        "ON transaction_allocations (category_id)"
    )

    # Backfill: 6 default categories per existing building.
    conn = op.get_bind()
    buildings = conn.execute(sa.text("SELECT id FROM buildings")).fetchall()
    for (b_id,) in buildings:
        for name, color in DEFAULT_CATEGORIES:
            conn.execute(
                sa.text(
                    "INSERT INTO expense_categories "
                    "(id, building_id, name, color, is_default, is_active, "
                    " created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :b, :n, :c, TRUE, TRUE, "
                    "        NOW(), NOW())"
                ),
                {"b": b_id, "n": name, "c": color},
            )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_alloc_category_id")
    op.execute("ALTER TABLE transaction_allocations DROP COLUMN IF EXISTS category_id")
    op.execute("DROP INDEX IF EXISTS ix_expense_categories_building_id")
    op.execute("DROP TABLE IF EXISTS expense_categories")
