"""add topic thread binding

Revision ID: 20260429_03
Revises: 20260429_02
Create Date: 2026-04-29 13:10:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260429_03"
down_revision: Union[str, Sequence[str], None] = "20260429_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "topic_records" not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("topic_records")}
    existing_indexes = {index["name"] for index in inspector.get_indexes("topic_records")}

    if "thread_id" not in existing_columns:
        with op.batch_alter_table("topic_records") as batch_op:
            batch_op.add_column(sa.Column("thread_id", sa.String(length=64), nullable=True))

    if "ix_topic_records_thread_id" not in existing_indexes:
        op.create_index("ix_topic_records_thread_id", "topic_records", ["thread_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "topic_records" not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("topic_records")}
    existing_indexes = {index["name"] for index in inspector.get_indexes("topic_records")}

    if "ix_topic_records_thread_id" in existing_indexes:
        op.drop_index("ix_topic_records_thread_id", table_name="topic_records")

    if "thread_id" in existing_columns:
        with op.batch_alter_table("topic_records") as batch_op:
            batch_op.drop_column("thread_id")
