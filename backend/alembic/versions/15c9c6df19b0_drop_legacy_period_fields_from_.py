"""drop legacy period fields from transaction_allocations

Revision ID: 15c9c6df19b0
Revises: 9d44eb8c0a2f
Create Date: 2026-05-26 01:00:12.801307

Phase 6b cutover — final step.

After Stage A writers populate apartment_period_debt_id on every tenant-
anchored allocation, and Stage B readers join through ApartmentPeriodDebt
instead of filtering on the legacy period columns, the columns can finally
be dropped. The replacement invariant is enforced by ck_allocation_debt_pointer_xor:

    Tenant allocations point at EXACTLY ONE of (apartment_period_debt_id,
    special_charge_id). Label-only allocations (tenant_id IS NULL) carry
    neither pointer.

Also drops the now-useless ix_allocations_tenant_period index that referenced
the legacy columns.
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "15c9c6df19b0"
down_revision: Union[str, None] = "9d44eb8c0a2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(
        "ix_allocations_tenant_period",
        table_name="transaction_allocations",
    )
    op.drop_column("transaction_allocations", "period_month")
    op.drop_column("transaction_allocations", "period_year")
    op.create_check_constraint(
        "ck_allocation_debt_pointer_xor",
        "transaction_allocations",
        "(tenant_id IS NULL AND apartment_period_debt_id IS NULL"
        " AND special_charge_id IS NULL)"
        " OR (tenant_id IS NOT NULL AND ("
        "(apartment_period_debt_id IS NOT NULL)::int"
        " + (special_charge_id IS NOT NULL)::int = 1"
        "))",
    )


def downgrade() -> None:
    import sqlalchemy as sa

    op.drop_constraint(
        "ck_allocation_debt_pointer_xor",
        "transaction_allocations",
        type_="check",
    )
    op.add_column(
        "transaction_allocations",
        sa.Column("period_year", sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        "transaction_allocations",
        sa.Column("period_month", sa.SmallInteger(), nullable=True),
    )
    op.create_index(
        "ix_allocations_tenant_period",
        "transaction_allocations",
        ["tenant_id", "period_year", "period_month"],
        unique=False,
    )
