"""add user avatar url

Revision ID: 20260425_02
Revises: 20260425_01
Create Date: 2026-04-25 14:20:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260425_02"
down_revision: Union[str, Sequence[str], None] = "20260425_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "users" not in existing_tables:
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}

    with op.batch_alter_table("users", schema=None) as batch_op:
        if "avatar_url" not in user_columns:
            batch_op.add_column(sa.Column("avatar_url", sa.String(length=2048), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "users" not in existing_tables:
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}

    with op.batch_alter_table("users", schema=None) as batch_op:
        if "avatar_url" in user_columns:
            batch_op.drop_column("avatar_url")
