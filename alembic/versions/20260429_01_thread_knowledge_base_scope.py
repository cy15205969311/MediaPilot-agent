"""add thread knowledge base scope for rag retrieval

Revision ID: 20260429_01
Revises: 5f1e42aa86d4
Create Date: 2026-04-29 09:30:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260429_01"
down_revision: Union[str, Sequence[str], None] = "5f1e42aa86d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "threads" not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("threads")}
    if "knowledge_base_scope" not in existing_columns:
        with op.batch_alter_table("threads") as batch_op:
            batch_op.add_column(sa.Column("knowledge_base_scope", sa.String(length=120), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "threads" not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("threads")}
    if "knowledge_base_scope" in existing_columns:
        with op.batch_alter_table("threads") as batch_op:
            batch_op.drop_column("knowledge_base_scope")
