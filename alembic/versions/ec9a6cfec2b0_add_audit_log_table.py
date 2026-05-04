"""add audit log table

Revision ID: ec9a6cfec2b0
Revises: 1fed5e89f316
Create Date: 2026-05-03 22:28:56.297642
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect



# revision identifiers, used by Alembic.
revision: str = 'ec9a6cfec2b0'
down_revision: Union[str, Sequence[str], None] = '1fed5e89f316'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "audit_logs" not in existing_tables:
        op.create_table(
            "audit_logs",
            sa.Column("id", sa.String(length=32), nullable=False),
            sa.Column("operator_id", sa.String(length=32), nullable=True),
            sa.Column("operator_name", sa.String(length=64), nullable=False),
            sa.Column("action_type", sa.String(length=64), nullable=False),
            sa.Column("target_id", sa.String(length=64), nullable=True),
            sa.Column("target_name", sa.String(length=255), nullable=False),
            sa.Column("details", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["operator_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )

    existing_indexes = {index["name"] for index in inspector.get_indexes("audit_logs")}
    if "ix_audit_logs_action_type" not in existing_indexes:
        op.create_index("ix_audit_logs_action_type", "audit_logs", ["action_type"], unique=False)
    if "ix_audit_logs_created_at" not in existing_indexes:
        op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"], unique=False)
    if "ix_audit_logs_operator_id" not in existing_indexes:
        op.create_index("ix_audit_logs_operator_id", "audit_logs", ["operator_id"], unique=False)
    if "ix_audit_logs_operator_name" not in existing_indexes:
        op.create_index("ix_audit_logs_operator_name", "audit_logs", ["operator_name"], unique=False)
    if "ix_audit_logs_target_id" not in existing_indexes:
        op.create_index("ix_audit_logs_target_id", "audit_logs", ["target_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "audit_logs" not in existing_tables:
        return

    existing_indexes = {index["name"] for index in inspector.get_indexes("audit_logs")}
    for index_name in [
        "ix_audit_logs_target_id",
        "ix_audit_logs_operator_name",
        "ix_audit_logs_operator_id",
        "ix_audit_logs_created_at",
        "ix_audit_logs_action_type",
    ]:
        if index_name in existing_indexes:
            op.drop_index(index_name, table_name="audit_logs")
    op.drop_table("audit_logs")
