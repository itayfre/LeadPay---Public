"""NULL out tenants.move_in_date that equals the legacy server default

Revision ID: c5e1a7d4f088
Revises: a8c4f0d12e7b
Create Date: 2026-05-19 16:00:00.000000

Before migration a8c4f0d12e7b the tenants table had
``server_default='2026-01-01'`` on move_in_date, so every row created prior
to that migration carries that exact value as if it were an explicit
override. Now that move_in_date is nullable, those rows should be NULL so
they fall back to ``buildings.default_move_in_date``.

This migration sets to NULL only those tenants whose move_in_date equals
2026-01-01 — the one value that could only have come from the old server
default. Tenants edited to any other date keep their explicit override.
Tenants that genuinely should be 2026-01-01 will continue to behave
correctly as long as their building's default is also 2026-01-01 (the
default for buildings created before any edit).
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c5e1a7d4f088'
down_revision: Union[str, None] = 'a8c4f0d12e7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE tenants SET move_in_date = NULL WHERE move_in_date = '2026-01-01'"
    )


def downgrade() -> None:
    # No-op: we cannot distinguish post-backfill NULLs from genuine NULLs.
    pass
