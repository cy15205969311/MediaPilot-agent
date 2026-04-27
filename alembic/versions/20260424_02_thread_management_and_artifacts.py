"""thread management fields and artifact records

Revision ID: 20260424_02
Revises: 20260424_01
Create Date: 2026-04-24 00:30:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260424_02"
down_revision: Union[str, Sequence[str], None] = "20260424_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "threads",
        sa.Column("title", sa.String(length=255), nullable=False, server_default=""),
    )
    op.add_column(
        "threads",
        sa.Column(
            "is_archived",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )

    op.create_table(
        "artifact_records",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("thread_id", sa.String(length=64), nullable=False),
        sa.Column("message_id", sa.String(length=32), nullable=False),
        sa.Column("artifact_type", sa.String(length=64), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["thread_id"], ["threads.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_artifact_records_message_id"),
        "artifact_records",
        ["message_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_artifact_records_thread_id"),
        "artifact_records",
        ["thread_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_artifact_records_thread_id"), table_name="artifact_records")
    op.drop_index(op.f("ix_artifact_records_message_id"), table_name="artifact_records")
    op.drop_table("artifact_records")
    op.drop_column("threads", "is_archived")
    op.drop_column("threads", "title")
