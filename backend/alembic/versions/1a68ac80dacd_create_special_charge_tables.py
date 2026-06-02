"""create special_charge tables

Revision ID: 1a68ac80dacd
Revises: 4b9d905ea9dc
Create Date: 2026-05-21 16:19:01.810115

Adds two new tables for one-off building expenses:

- ``special_charge_batches``: one row per extraordinary expense (lift repair,
  holiday cleaning) with title, description, total amount, split method, and
  due date.
- ``special_charges``: one row per (batch, apartment) — the apartment's
  concrete share of the batch.

The four ``split_method`` values (equal/custom/weight/flat) decide how the
batch total is sliced; the slicing is computed once at creation and the
resulting per-apartment amounts are stored on ``special_charges.amount``.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '1a68ac80dacd'
down_revision: Union[str, None] = '4b9d905ea9dc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SPLIT_METHOD_VALUES = ('equal', 'custom', 'weight', 'flat')


def upgrade() -> None:
    split_method_enum = postgresql.ENUM(
        *SPLIT_METHOD_VALUES,
        name='special_charge_split_method',
        create_type=False,
    )
    split_method_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'special_charge_batches',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('building_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            'title',
            sa.Text(),
            nullable=False,
            comment="Short label, e.g. 'תיקון מעלית Q1'",
        ),
        sa.Column(
            'description',
            sa.Text(),
            nullable=True,
            comment='Long-form context entered by the manager when creating the batch',
        ),
        sa.Column('total_amount', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('split_method', split_method_enum, nullable=False),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['building_id'], ['buildings.id'], ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_special_charge_batches_building_id'),
        'special_charge_batches',
        ['building_id'],
        unique=False,
    )

    op.create_table(
        'special_charges',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('batch_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('apartment_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('amount', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column(
            'responsible_tenant_id',
            postgresql.UUID(as_uuid=True),
            nullable=True,
            comment='Tenant the charge is assigned to; NULL means owner-fallback applies',
        ),
        sa.Column(
            'notes',
            sa.Text(),
            nullable=True,
            comment="Per-apartment exception note (e.g. 'discount for owner', 'vacancy')",
        ),
        sa.ForeignKeyConstraint(
            ['batch_id'], ['special_charge_batches.id'], ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['apartment_id'], ['apartments.id'], ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['responsible_tenant_id'], ['tenants.id'], ondelete='SET NULL',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_special_charges_batch_id'),
        'special_charges',
        ['batch_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_special_charges_apartment_id'),
        'special_charges',
        ['apartment_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_special_charges_apartment_id'), table_name='special_charges'
    )
    op.drop_index(op.f('ix_special_charges_batch_id'), table_name='special_charges')
    op.drop_table('special_charges')
    op.drop_index(
        op.f('ix_special_charge_batches_building_id'),
        table_name='special_charge_batches',
    )
    op.drop_table('special_charge_batches')
    postgresql.ENUM(name='special_charge_split_method').drop(
        op.get_bind(), checkfirst=True
    )
