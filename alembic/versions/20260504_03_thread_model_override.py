"""add thread model override for per-thread model restore

Revision ID: 20260504_03
Revises: 20260504_02
Create Date: 2026-05-04 22:20:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260504_03"
down_revision: Union[str, Sequence[str], None] = "20260504_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "threads" not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("threads")}
    if "model_override" not in existing_columns:
        with op.batch_alter_table("threads") as batch_op:
            batch_op.add_column(sa.Column("model_override", sa.String(length=80), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "threads" not in existing_tables:
        return

    existing_columns = {column["name"] for column in inspector.get_columns("threads")}
    if "model_override" in existing_columns:
        with op.batch_alter_table("threads") as batch_op:
            batch_op.drop_column("model_override")
