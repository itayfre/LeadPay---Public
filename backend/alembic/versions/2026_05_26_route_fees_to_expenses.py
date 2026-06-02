"""route_fees_to_expenses

Backfill data for the "remove irrelevant tab" change:
- Ensure every building has the system "עמלות ומסים" expense category.
- For every FEE transaction with a debit_amount, create a categorized
  expense allocation pointing at that category.
- For every OTHER transaction (legacy "ignore" action), create an
  uncategorized expense allocation so the review UI surfaces it under
  the Expenses tab instead of the now-removed Irrelevant tab.

Idempotent: re-running the upgrade is a no-op (skips buildings that
already have the category and transactions that already have an
expense allocation).

Revision ID: f7c2d9a0b1e3
Revises: 15c9c6df19b0
Create Date: 2026-05-26
"""
from typing import Sequence, Union

from alembic import op


revision: str = "f7c2d9a0b1e3"
down_revision: Union[str, None] = "15c9c6df19b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


FEE_CATEGORY_NAME = "עמלות ומסים"
FEE_CATEGORY_COLOR = "#94A3B8"


def upgrade() -> None:
    # 1. Ensure the fee category exists for every building.
    op.execute(
        f"""
        INSERT INTO expense_categories
            (id, building_id, name, color, is_default, is_active, created_at, updated_at)
        SELECT
            gen_random_uuid(),
            b.id,
            '{FEE_CATEGORY_NAME}',
            '{FEE_CATEGORY_COLOR}',
            TRUE,
            TRUE,
            NOW(),
            NOW()
        FROM buildings b
        WHERE NOT EXISTS (
            SELECT 1 FROM expense_categories ec
            WHERE ec.building_id = b.id
              AND ec.name = '{FEE_CATEGORY_NAME}'
        )
        """
    )

    # 2. Backfill FEE transactions → categorized expense allocation.
    # `label` is required by ck_allocation_has_target whenever tenant_id IS NULL.
    op.execute(
        f"""
        INSERT INTO transaction_allocations
            (id, transaction_id, tenant_id, label, category_id, amount, created_at)
        SELECT
            gen_random_uuid(),
            t.id,
            NULL,
            COALESCE(NULLIF(LEFT(t.description, 255), ''), 'עמלות / מסים'),
            ec.id,
            ABS(COALESCE(t.debit_amount, t.credit_amount, 0)),
            NOW()
        FROM transactions t
        JOIN bank_statements bs ON bs.id = t.statement_id
        JOIN expense_categories ec
            ON ec.building_id = bs.building_id
           AND ec.name = '{FEE_CATEGORY_NAME}'
        WHERE t.transaction_type = 'fee'
          AND COALESCE(t.debit_amount, t.credit_amount) IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM transaction_allocations a
              WHERE a.transaction_id = t.id
                AND a.tenant_id IS NULL
          )
        """
    )

    # 3. Backfill OTHER transactions (legacy "ignore") → uncategorized expense allocation.
    op.execute(
        """
        INSERT INTO transaction_allocations
            (id, transaction_id, tenant_id, label, category_id, amount, created_at)
        SELECT
            gen_random_uuid(),
            t.id,
            NULL,
            COALESCE(NULLIF(LEFT(t.description, 255), ''), 'ללא קטגוריה'),
            NULL,
            ABS(COALESCE(t.debit_amount, t.credit_amount, 0)),
            NOW()
        FROM transactions t
        WHERE t.transaction_type = 'other'
          AND COALESCE(t.debit_amount, t.credit_amount) IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM transaction_allocations a
              WHERE a.transaction_id = t.id
                AND a.tenant_id IS NULL
          )
        """
    )


def downgrade() -> None:
    # Best-effort reversal: drop the auto-created allocations and the
    # auto-created category. We can't distinguish migration-created
    # allocations from user-created ones perfectly, so we only delete
    # allocations that point at the fees category (safe) and uncategorized
    # allocations attached to OTHER-type transactions (also safe — pre-
    # migration these didn't exist).
    op.execute(
        f"""
        DELETE FROM transaction_allocations a
        USING expense_categories ec
        WHERE a.category_id = ec.id
          AND ec.name = '{FEE_CATEGORY_NAME}'
        """
    )
    op.execute(
        """
        DELETE FROM transaction_allocations a
        USING transactions t
        WHERE a.transaction_id = t.id
          AND a.tenant_id IS NULL
          AND a.category_id IS NULL
          AND t.transaction_type = 'other'
        """
    )
    op.execute(
        f"DELETE FROM expense_categories WHERE name = '{FEE_CATEGORY_NAME}'"
    )
