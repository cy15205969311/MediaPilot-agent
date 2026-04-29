"""extend template library for growth ecosystem

Revision ID: 20260428_02
Revises: 20260428_01
Create Date: 2026-04-28 20:30:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260428_02"
down_revision: Union[str, Sequence[str], None] = "20260428_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "templates" not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("templates")}
    if "knowledge_base_scope" not in existing_columns:
        with op.batch_alter_table("templates") as batch_op:
            batch_op.add_column(sa.Column("knowledge_base_scope", sa.String(length=120), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "templates" not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("templates")}
    if "knowledge_base_scope" in existing_columns:
        with op.batch_alter_table("templates") as batch_op:
            batch_op.drop_column("knowledge_base_scope")
