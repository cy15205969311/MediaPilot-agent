"""add topic pool records

Revision ID: 20260429_02
Revises: 20260429_01
Create Date: 2026-04-29 12:10:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260429_02"
down_revision: Union[str, Sequence[str], None] = "20260429_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "topic_records" not in existing_tables:
        op.create_table(
            "topic_records",
            sa.Column("id", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.String(length=32), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("inspiration", sa.Text(), nullable=False, server_default=""),
            sa.Column("platform", sa.String(length=32), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="idea"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    topic_indexes = {index["name"] for index in inspector.get_indexes("topic_records")}
    if "ix_topic_records_user_id" not in topic_indexes:
        op.create_index("ix_topic_records_user_id", "topic_records", ["user_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "topic_records" not in existing_tables:
        return

    topic_indexes = {index["name"] for index in inspector.get_indexes("topic_records")}
    if "ix_topic_records_user_id" in topic_indexes:
        op.drop_index("ix_topic_records_user_id", table_name="topic_records")

    op.drop_table("topic_records")
