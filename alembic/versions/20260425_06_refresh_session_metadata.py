"""add refresh session metadata

Revision ID: 20260425_06
Revises: 20260425_05
Create Date: 2026-04-25 23:30:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260425_06"
down_revision: Union[str, Sequence[str], None] = "20260425_05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "refresh_sessions" not in existing_tables:
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("refresh_sessions")
    }

    with op.batch_alter_table("refresh_sessions") as batch_op:
        if "device_info" not in existing_columns:
            batch_op.add_column(sa.Column("device_info", sa.String(length=255), nullable=True))
        if "ip_address" not in existing_columns:
            batch_op.add_column(sa.Column("ip_address", sa.String(length=64), nullable=True))
        if "last_seen_at" not in existing_columns:
            batch_op.add_column(
                sa.Column(
                    "last_seen_at",
                    sa.DateTime(),
                    nullable=True,
                )
            )

    if "last_seen_at" not in existing_columns:
        now = sa.text("CURRENT_TIMESTAMP")
        op.execute(
            sa.text(
                "UPDATE refresh_sessions SET last_seen_at = COALESCE(last_seen_at, created_at, CURRENT_TIMESTAMP)"
            )
        )
        with op.batch_alter_table("refresh_sessions") as batch_op:
            batch_op.alter_column(
                "last_seen_at",
                existing_type=sa.DateTime(),
                nullable=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "refresh_sessions" not in existing_tables:
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("refresh_sessions")
    }

    with op.batch_alter_table("refresh_sessions") as batch_op:
        if "last_seen_at" in existing_columns:
            batch_op.drop_column("last_seen_at")
        if "ip_address" in existing_columns:
            batch_op.drop_column("ip_address")
        if "device_info" in existing_columns:
            batch_op.drop_column("device_info")
