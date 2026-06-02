"""Initial migration with all tables

Revision ID: 66cd5a46a6a1
Revises:
Create Date: 2026-02-15 23:07:28.143380

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '66cd5a46a6a1'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create buildings table
    op.create_table(
        'buildings',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('address', sa.String(), nullable=False),
        sa.Column('city', sa.String(), nullable=False),
        sa.Column('bank_account_number', sa.String(), nullable=True),
        sa.Column('total_tenants', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('expected_monthly_payment', sa.Numeric(10, 2), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # Create apartments table
    op.create_table(
        'apartments',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('building_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('number', sa.Integer(), nullable=False),
        sa.Column('floor', sa.Integer(), nullable=False),
        sa.Column('expected_payment', sa.Numeric(10, 2), nullable=True),
        sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create tenants table
    op.create_table(
        'tenants',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('apartment_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('full_name', sa.String(), nullable=True),
        sa.Column('phone', sa.String(), nullable=True),
        sa.Column('email', sa.String(), nullable=True),
        sa.Column('language', sa.Enum('he', 'en', name='languagepreference'), nullable=True),
        sa.Column('ownership_type', sa.Enum('בעלים', 'משכיר', 'שוכר', name='ownershiptype'), nullable=False),
        sa.Column('is_committee_member', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('has_standing_order', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default='true'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['apartment_id'], ['apartments.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create bank_statements table
    op.create_table(
        'bank_statements',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('building_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('upload_date', sa.DateTime(), nullable=True),
        sa.Column('period_month', sa.Integer(), nullable=False),
        sa.Column('period_year', sa.Integer(), nullable=False),
        sa.Column('original_filename', sa.String(), nullable=False),
        sa.Column('raw_data', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create transactions table
    op.create_table(
        'transactions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('statement_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('activity_date', sa.DateTime(), nullable=False),
        sa.Column('reference_number', sa.String(), nullable=True),
        sa.Column('description', sa.String(), nullable=False),
        sa.Column('credit_amount', sa.Numeric(10, 2), nullable=True),
        sa.Column('debit_amount', sa.Numeric(10, 2), nullable=True),
        sa.Column('balance', sa.Numeric(10, 2), nullable=True),
        sa.Column('transaction_type', sa.Enum('payment', 'fee', 'transfer', 'other', name='transactiontype'), nullable=True),
        sa.Column('matched_tenant_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('match_confidence', sa.Float(), nullable=True),
        sa.Column('match_method', sa.Enum('exact', 'fuzzy', 'manual', 'amount', 'reversed_name', name='matchmethod'), nullable=True),
        sa.Column('is_confirmed', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['matched_tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['statement_id'], ['bank_statements.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create name_mappings table
    op.create_table(
        'name_mappings',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('building_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('bank_name', sa.String(), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('created_by', sa.Enum('manual', 'auto', name='mappingcreatedby'), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )

    # Create messages table
    op.create_table(
        'messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('building_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('message_type', sa.Enum('reminder', 'confirmation', 'custom', name='messagetype'), nullable=True),
        sa.Column('message_text', sa.String(), nullable=False),
        sa.Column('sent_at', sa.DateTime(), nullable=True),
        sa.Column('delivery_status', sa.Enum('pending', 'sent', 'delivered', 'failed', name='deliverystatus'), nullable=True),
        sa.Column('period_month', sa.Integer(), nullable=True),
        sa.Column('period_year', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )


def downgrade() -> None:
    op.drop_table('messages')
    op.drop_table('name_mappings')
    op.drop_table('transactions')
    op.drop_table('bank_statements')
    op.drop_table('tenants')
    op.drop_table('apartments')
    op.drop_table('buildings')

    # Drop enums
    op.execute('DROP TYPE IF EXISTS deliverystatus')
    op.execute('DROP TYPE IF EXISTS messagetype')
    op.execute('DROP TYPE IF EXISTS mappingcreatedby')
    op.execute('DROP TYPE IF EXISTS matchmethod')
    op.execute('DROP TYPE IF EXISTS transactiontype')
    op.execute('DROP TYPE IF EXISTS ownershiptype')
    op.execute('DROP TYPE IF EXISTS languagepreference')
