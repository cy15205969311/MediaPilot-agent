"""add refresh session revocation

Revision ID: 20260425_04
Revises: 20260425_03
Create Date: 2026-04-25 20:10:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260425_04"
down_revision: Union[str, Sequence[str], None] = "20260425_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "refresh_sessions" not in existing_tables:
        op.create_table(
            "refresh_sessions",
            sa.Column("id", sa.String(length=32), nullable=False),
            sa.Column("user_id", sa.String(length=32), nullable=False),
            sa.Column("refresh_token_jti", sa.String(length=32), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column(
                "is_revoked",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_refresh_sessions_user_id",
            "refresh_sessions",
            ["user_id"],
            unique=False,
        )
        op.create_index(
            "ix_refresh_sessions_refresh_token_jti",
            "refresh_sessions",
            ["refresh_token_jti"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "refresh_sessions" in existing_tables:
        existing_indexes = {
            index["name"] for index in inspector.get_indexes("refresh_sessions")
        }
        if "ix_refresh_sessions_refresh_token_jti" in existing_indexes:
            op.drop_index(
                "ix_refresh_sessions_refresh_token_jti",
                table_name="refresh_sessions",
            )
        if "ix_refresh_sessions_user_id" in existing_indexes:
            op.drop_index("ix_refresh_sessions_user_id", table_name="refresh_sessions")
        op.drop_table("refresh_sessions")
