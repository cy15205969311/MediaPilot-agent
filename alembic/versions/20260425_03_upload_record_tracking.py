"""add upload record tracking

Revision ID: 20260425_03
Revises: 20260425_02
Create Date: 2026-04-25 18:20:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = "20260425_03"
down_revision: Union[str, Sequence[str], None] = "20260425_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "upload_records" not in existing_tables:
        op.create_table(
            "upload_records",
            sa.Column("id", sa.String(length=32), nullable=False),
            sa.Column("user_id", sa.String(length=32), nullable=False),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("file_path", sa.String(length=2048), nullable=False),
            sa.Column("mime_type", sa.String(length=255), nullable=False),
            sa.Column("file_size", sa.Integer(), nullable=False),
            sa.Column("purpose", sa.String(length=32), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_upload_records_user_id",
            "upload_records",
            ["user_id"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "upload_records" in existing_tables:
        existing_indexes = {index["name"] for index in inspector.get_indexes("upload_records")}
        if "ix_upload_records_user_id" in existing_indexes:
            op.drop_index("ix_upload_records_user_id", table_name="upload_records")
        op.drop_table("upload_records")
