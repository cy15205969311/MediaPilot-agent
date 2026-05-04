"""add system notifications table

Revision ID: 20260504_02
Revises: 20260504_01
Create Date: 2026-05-04 22:10:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260504_02"
down_revision: Union[str, Sequence[str], None] = "20260504_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "system_notifications" not in existing_tables:
        op.create_table(
            "system_notifications",
            sa.Column("id", sa.String(length=32), nullable=False),
            sa.Column("type", sa.String(length=32), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_system_notifications_created_at",
            "system_notifications",
            ["created_at"],
            unique=False,
        )
        op.create_index(
            "ix_system_notifications_is_read",
            "system_notifications",
            ["is_read"],
            unique=False,
        )
        op.create_index(
            "ix_system_notifications_type",
            "system_notifications",
            ["type"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "system_notifications" in existing_tables:
        existing_indexes = {
            index["name"] for index in inspector.get_indexes("system_notifications")
        }
        for index_name in (
            "ix_system_notifications_created_at",
            "ix_system_notifications_is_read",
            "ix_system_notifications_type",
        ):
            if index_name in existing_indexes:
                op.drop_index(index_name, table_name="system_notifications")
        op.drop_table("system_notifications")
