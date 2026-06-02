"""add apartment weight and owner fallback

Revision ID: 7147f2328084
Revises: 7a4f2e9c81b3
Create Date: 2026-05-21 10:25:25.762103

Adds two new nullable columns to ``apartments`` to support the upcoming
per-period debt and special-charge features:

- ``weight``: proportional weight for special-charge splits (e.g. by size
  or %). NULL means equal-split semantics.
- ``fallback_owner_tenant_id``: the legally-liable owner-role tenant when
  no active payer exists. Backfilled in a later migration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '7147f2328084'
down_revision: Union[str, None] = '7a4f2e9c81b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'apartments',
        sa.Column(
            'weight',
            sa.Numeric(precision=10, scale=4),
            nullable=True,
            comment='Proportional weight for special-charge splits (e.g. size, %). NULL = equal-split',
        ),
    )
    op.add_column(
        'apartments',
        sa.Column(
            'fallback_owner_tenant_id',
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment='Legally-liable owner-role tenant when no active payer exists',
        ),
    )
    op.create_foreign_key(
        'fk_apartments_fallback_owner_tenant_id_tenants',
        'apartments',
        'tenants',
        ['fallback_owner_tenant_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint(
        'fk_apartments_fallback_owner_tenant_id_tenants',
        'apartments',
        type_='foreignkey',
    )
    op.drop_column('apartments', 'fallback_owner_tenant_id')
    op.drop_column('apartments', 'weight')
