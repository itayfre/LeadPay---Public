"""create users table

Revision ID: a1b2c3d4e5f6
Revises: d329d72540d2
Create Date: 2026-03-04 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = '038dc8d991fa'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum types first
    userrole = sa.Enum('manager', 'worker', 'viewer', 'tenant', name='userrole')
    userstatus = sa.Enum('active', 'pending', 'invited', name='userstatus')

    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('hashed_password', sa.String(), nullable=True),
        sa.Column('full_name', sa.String(), nullable=False),
        sa.Column('role', userrole, nullable=False, server_default='viewer'),
        sa.Column('status', userstatus, nullable=False, server_default='active'),
        sa.Column('building_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('invite_token', sa.String(), nullable=True),
        sa.Column('invite_expires_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False,
                  server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False,
                  server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['building_id'], ['buildings.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)
    op.create_index('ix_users_invite_token', 'users', ['invite_token'])


def downgrade() -> None:
    op.drop_index('ix_users_invite_token', table_name='users')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')
    op.execute("DROP TYPE IF EXISTS userrole")
    op.execute("DROP TYPE IF EXISTS userstatus")
