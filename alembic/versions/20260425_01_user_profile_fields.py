"""add user profile fields

Revision ID: 20260425_01
Revises: 20260424_03
Create Date: 2026-04-25 10:30:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260425_01"
down_revision: Union[str, Sequence[str], None] = "20260424_03"
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
        if "nickname" not in user_columns:
            batch_op.add_column(sa.Column("nickname", sa.String(length=64), nullable=True))
        if "bio" not in user_columns:
            batch_op.add_column(sa.Column("bio", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "users" not in existing_tables:
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}

    with op.batch_alter_table("users", schema=None) as batch_op:
        if "bio" in user_columns:
            batch_op.drop_column("bio")
        if "nickname" in user_columns:
            batch_op.drop_column("nickname")
