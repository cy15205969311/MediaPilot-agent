"""link materials to messages

Revision ID: 20260427_01
Revises: 20260425_06
Create Date: 2026-04-27 10:30:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260427_01"
down_revision: Union[str, Sequence[str], None] = "20260425_06"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "materials" not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("materials")}
    existing_indexes = {index["name"] for index in inspector.get_indexes("materials")}

    with op.batch_alter_table("materials") as batch_op:
        if "message_id" not in existing_columns:
            batch_op.add_column(sa.Column("message_id", sa.String(length=32), nullable=True))
            batch_op.create_foreign_key(
                "fk_materials_message_id_messages",
                "messages",
                ["message_id"],
                ["id"],
                ondelete="CASCADE",
            )
        if "ix_materials_message_id" not in existing_indexes:
            batch_op.create_index("ix_materials_message_id", ["message_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "materials" not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("materials")}
    existing_indexes = {index["name"] for index in inspector.get_indexes("materials")}

    with op.batch_alter_table("materials") as batch_op:
        if "ix_materials_message_id" in existing_indexes:
            batch_op.drop_index("ix_materials_message_id")
        if "message_id" in existing_columns:
            batch_op.drop_constraint("fk_materials_message_id_messages", type_="foreignkey")
            batch_op.drop_column("message_id")
