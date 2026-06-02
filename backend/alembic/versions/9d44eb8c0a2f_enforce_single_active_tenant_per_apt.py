"""enforce single active tenant per apartment

Revision ID: 9d44eb8c0a2f
Revises: 5e3de9cc5ea3
Create Date: 2026-05-23 18:00:00.000000

Adds a partial unique index on ``tenants(apartment_id) WHERE is_active = true``.

Phase 0 preflight identified 61 apartments with multiple active tenants on
prod; that was cleaned up on 2026-05-23 (see
``backend/scripts/baselines/2026-05-23-prod-active-tenant-cleanup.md``).
The dataset now satisfies the invariant: exactly one active tenant per apt.
This index makes the invariant enforced — any future code path that tries
to mark a second tenant active on the same apartment will fail with a unique
constraint violation, giving us a hard backstop against drift.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "9d44eb8c0a2f"
down_revision: Union[str, None] = "5e3de9cc5ea3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "uq_tenant_active_per_apartment",
        "tenants",
        ["apartment_id"],
        unique=True,
        postgresql_where=sa.text("is_active = true"),
    )


def downgrade() -> None:
    op.drop_index("uq_tenant_active_per_apartment", table_name="tenants")
