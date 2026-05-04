"""add model_name to token_transaction

Revision ID: 1fed5e89f316
Revises: 20260430_01
Create Date: 2026-05-03 15:59:20.662798
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa



# revision identifiers, used by Alembic.
revision: str = '1fed5e89f316'
down_revision: Union[str, Sequence[str], None] = '20260430_01'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "token_transactions" not in existing_tables:
        op.create_table(
            "token_transactions",
            sa.Column("id", sa.String(length=32), nullable=False),
            sa.Column("user_id", sa.String(length=32), nullable=False),
            sa.Column("amount", sa.Integer(), nullable=False),
            sa.Column("transaction_type", sa.String(length=32), nullable=False),
            sa.Column("model_name", sa.String(length=50), nullable=True, server_default="legacy"),
            sa.Column("remark", sa.Text(), nullable=False, server_default=""),
            sa.Column("operator_id", sa.String(length=32), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["operator_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_token_transactions_user_id", "token_transactions", ["user_id"], unique=False)
        op.create_index("ix_token_transactions_operator_id", "token_transactions", ["operator_id"], unique=False)
        return

    token_columns = {column["name"] for column in inspector.get_columns("token_transactions")}
    if "model_name" not in token_columns:
        op.add_column(
            "token_transactions",
            sa.Column("model_name", sa.String(length=50), server_default="legacy", nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if "token_transactions" not in existing_tables:
        return

    token_columns = {column["name"] for column in inspector.get_columns("token_transactions")}
    if "model_name" in token_columns:
        op.drop_column("token_transactions", "model_name")
