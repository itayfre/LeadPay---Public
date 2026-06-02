"""add_transaction_allocations

Introduces the transaction_allocations table — the storage primitive for
splitting one bank transaction across multiple tenants and/or billing periods,
and (in PR-4) for tagging expense rows with categories.

Backfills one allocation per existing matched transaction so the
denormalized `Transaction.matched_tenant_id` cache stays in sync with the
new table. Pre/post row-count assertions abort the migration on any
divergence.

Revision ID: b7e2c5a91f3d
Revises: 8a9b0c1d2e3f
Create Date: 2026-04-28 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "b7e2c5a91f3d"
down_revision: Union[str, None] = "8a9b0c1d2e3f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Create the table ──────────────────────────────────────────────
    op.create_table(
        "transaction_allocations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column(
            "transaction_id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("period_month", sa.SmallInteger(), nullable=True),
        sa.Column("period_year", sa.SmallInteger(), nullable=True),
        sa.Column("category", sa.String(32), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "tenant_id IS NOT NULL OR label IS NOT NULL",
            name="ck_allocation_has_target",
        ),
    )
    op.create_index(
        "ix_allocations_transaction_id",
        "transaction_allocations",
        ["transaction_id"],
    )
    op.create_index(
        "ix_allocations_tenant_period",
        "transaction_allocations",
        ["tenant_id", "period_year", "period_month"],
    )

    # ── 2. Backfill from existing matched transactions ───────────────────
    # For every matched transaction, derive the billing period from its parent
    # bank statement (or fall back to its activity_date for manual transactions
    # where statement_id is null) and copy credit_amount (or debit_amount as a
    # last resort) into the allocation.
    bind = op.get_bind()

    matched_count = bind.execute(
        sa.text(
            "SELECT count(*) FROM transactions WHERE matched_tenant_id IS NOT NULL"
        )
    ).scalar()

    bind.execute(
        sa.text(
            """
            INSERT INTO transaction_allocations (
                id, transaction_id, tenant_id, amount,
                period_month, period_year, created_at
            )
            SELECT
                gen_random_uuid(),
                t.id,
                t.matched_tenant_id,
                COALESCE(t.credit_amount, t.debit_amount, 0),
                COALESCE(bs.period_month, EXTRACT(MONTH FROM t.activity_date)::smallint),
                COALESCE(bs.period_year,  EXTRACT(YEAR  FROM t.activity_date)::smallint),
                NOW()
            FROM transactions t
            LEFT JOIN bank_statements bs ON bs.id = t.statement_id
            WHERE t.matched_tenant_id IS NOT NULL
            """
        )
    )

    backfilled_count = bind.execute(
        sa.text(
            "SELECT count(*) FROM transaction_allocations WHERE tenant_id IS NOT NULL"
        )
    ).scalar()

    if backfilled_count != matched_count:
        # Abort the migration — rollback happens automatically because Alembic
        # runs each migration in its own transaction.
        raise RuntimeError(
            f"Backfill row-count mismatch: expected {matched_count} "
            f"allocations, got {backfilled_count}. Aborting migration."
        )


def downgrade() -> None:
    op.drop_index(
        "ix_allocations_tenant_period",
        table_name="transaction_allocations",
    )
    op.drop_index(
        "ix_allocations_transaction_id",
        table_name="transaction_allocations",
    )
    op.drop_table("transaction_allocations")
