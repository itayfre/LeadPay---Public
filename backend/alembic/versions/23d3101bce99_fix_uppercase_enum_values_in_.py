"""fix_uppercase_enum_values_in_transactions

Revision ID: 23d3101bce99
Revises: 06407327ea0a
Create Date: 2026-02-22 16:03:18.983284

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '23d3101bce99'
down_revision: Union[str, None] = '06407327ea0a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Fix transaction_type values stored as uppercase Python enum names
    op.execute("""
        UPDATE transactions
        SET transaction_type = LOWER(transaction_type::text)::transactiontype
        WHERE transaction_type::text != LOWER(transaction_type::text)
    """)

    # Fix match_method values stored as uppercase Python enum names
    op.execute("""
        UPDATE transactions
        SET match_method = LOWER(match_method::text)::matchmethod
        WHERE match_method IS NOT NULL
          AND match_method::text != LOWER(match_method::text)
    """)


def downgrade() -> None:
    pass
