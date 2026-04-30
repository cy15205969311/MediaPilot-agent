"""add access token blacklist and password revocation fields

Revision ID: 20260430_01
Revises: 20260429_03
Create Date: 2026-04-30 16:20:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260430_01"
down_revision: Union[str, Sequence[str], None] = "20260429_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "users" in existing_tables:
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "password_changed_at" not in user_columns:
            with op.batch_alter_table("users") as batch_op:
                batch_op.add_column(
                    sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True)
                )
            op.execute(
                "UPDATE users SET password_changed_at = CURRENT_TIMESTAMP "
                "WHERE password_changed_at IS NULL"
            )

    if "refresh_sessions" in existing_tables:
        refresh_columns = {
            column["name"] for column in inspector.get_columns("refresh_sessions")
        }
        if "latest_access_jti" not in refresh_columns:
            with op.batch_alter_table("refresh_sessions") as batch_op:
                batch_op.add_column(sa.Column("latest_access_jti", sa.String(length=32), nullable=True))

    if "access_token_blacklist" not in existing_tables:
        op.create_table(
            "access_token_blacklist",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("jti", sa.String(length=32), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    blacklist_indexes = {
        index["name"] for index in inspector.get_indexes("access_token_blacklist")
    } if "access_token_blacklist" in set(sa.inspect(bind).get_table_names()) else set()
    if "ix_access_token_blacklist_jti" not in blacklist_indexes:
        op.create_index(
            "ix_access_token_blacklist_jti",
            "access_token_blacklist",
            ["jti"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "access_token_blacklist" in existing_tables:
        blacklist_indexes = {
            index["name"] for index in inspector.get_indexes("access_token_blacklist")
        }
        if "ix_access_token_blacklist_jti" in blacklist_indexes:
            op.drop_index("ix_access_token_blacklist_jti", table_name="access_token_blacklist")
        op.drop_table("access_token_blacklist")

    if "refresh_sessions" in existing_tables:
        refresh_columns = {
            column["name"] for column in inspector.get_columns("refresh_sessions")
        }
        if "latest_access_jti" in refresh_columns:
            with op.batch_alter_table("refresh_sessions") as batch_op:
                batch_op.drop_column("latest_access_jti")

    if "users" in existing_tables:
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "password_changed_at" in user_columns:
            with op.batch_alter_table("users") as batch_op:
                batch_op.drop_column("password_changed_at")
