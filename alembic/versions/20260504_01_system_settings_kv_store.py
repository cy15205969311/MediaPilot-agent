"""add system settings kv store

Revision ID: 20260504_01
Revises: ec9a6cfec2b0
Create Date: 2026-05-04 18:10:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260504_01"
down_revision: Union[str, Sequence[str], None] = "ec9a6cfec2b0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "users" in existing_tables:
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        with op.batch_alter_table("users") as batch_op:
            if "role" not in user_columns:
                batch_op.add_column(
                    sa.Column("role", sa.String(length=32), nullable=False, server_default="user")
                )
            if "status" not in user_columns:
                batch_op.add_column(
                    sa.Column("status", sa.String(length=32), nullable=False, server_default="active")
                )
            if "token_balance" not in user_columns:
                batch_op.add_column(
                    sa.Column("token_balance", sa.Integer(), nullable=False, server_default="0")
                )

    if "system_settings" not in existing_tables:
        op.create_table(
            "system_settings",
            sa.Column("key", sa.String(length=120), nullable=False),
            sa.Column("value", sa.JSON(), nullable=False),
            sa.Column("category", sa.String(length=32), nullable=False),
            sa.Column("description", sa.String(length=255), nullable=False, server_default=""),
            sa.PrimaryKeyConstraint("key"),
        )
        op.create_index(
            "ix_system_settings_category",
            "system_settings",
            ["category"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "system_settings" in existing_tables:
        existing_indexes = {index["name"] for index in inspector.get_indexes("system_settings")}
        if "ix_system_settings_category" in existing_indexes:
            op.drop_index("ix_system_settings_category", table_name="system_settings")
        op.drop_table("system_settings")

    if "users" in existing_tables:
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        with op.batch_alter_table("users") as batch_op:
            if "token_balance" in user_columns:
                batch_op.drop_column("token_balance")
            if "status" in user_columns:
                batch_op.drop_column("status")
            if "role" in user_columns:
                batch_op.drop_column("role")
