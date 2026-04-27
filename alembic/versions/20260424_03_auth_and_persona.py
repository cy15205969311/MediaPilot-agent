"""add users, thread ownership, and system prompt

Revision ID: 20260424_03
Revises: 20260424_02
Create Date: 2026-04-24 09:30:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "20260424_03"
down_revision: Union[str, Sequence[str], None] = "20260424_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LEGACY_USER_ID = "legacyuser0000000000000000000001"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    existing_tables = set(inspector.get_table_names())
    if "users" not in existing_tables:
        op.create_table(
            "users",
            sa.Column("id", sa.String(length=32), nullable=False),
            sa.Column("username", sa.String(length=64), nullable=False),
            sa.Column("hashed_password", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )

    user_indexes = {index["name"] for index in inspector.get_indexes("users")}
    if "ix_users_username" not in user_indexes:
        op.create_index(op.f("ix_users_username"), "users", ["username"], unique=True)

    legacy_owner_exists = bind.execute(
        sa.text("SELECT 1 FROM users WHERE id = :id"),
        {"id": LEGACY_USER_ID},
    ).scalar()
    if legacy_owner_exists is None:
        bind.execute(
            sa.text(
                """
                INSERT INTO users (id, username, hashed_password, created_at)
                VALUES (:id, :username, :hashed_password, CURRENT_TIMESTAMP)
                """
            ),
            {
                "id": LEGACY_USER_ID,
                "username": "legacy-owner",
                "hashed_password": "migration-placeholder",
            },
        )

    thread_columns = {column["name"] for column in inspector.get_columns("threads")}
    thread_indexes = {index["name"] for index in inspector.get_indexes("threads")}
    thread_foreign_keys = {
        fk.get("name")
        for fk in inspector.get_foreign_keys("threads")
        if fk.get("name")
    }

    with op.batch_alter_table("threads", schema=None) as batch_op:
        if "user_id" not in thread_columns:
            batch_op.add_column(
                sa.Column(
                    "user_id",
                    sa.String(length=32),
                    nullable=False,
                    server_default=LEGACY_USER_ID,
                )
            )
        if "system_prompt" not in thread_columns:
            batch_op.add_column(
                sa.Column(
                    "system_prompt",
                    sa.Text(),
                    nullable=False,
                    server_default="",
                )
            )
        if "ix_threads_user_id" not in thread_indexes:
            batch_op.create_index(batch_op.f("ix_threads_user_id"), ["user_id"], unique=False)
        if "fk_threads_user_id_users" not in thread_foreign_keys:
            batch_op.create_foreign_key(
                "fk_threads_user_id_users",
                "users",
                ["user_id"],
                ["id"],
                ondelete="CASCADE",
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    thread_columns = {column["name"] for column in inspector.get_columns("threads")}
    thread_indexes = {index["name"] for index in inspector.get_indexes("threads")}
    thread_foreign_keys = {
        fk.get("name")
        for fk in inspector.get_foreign_keys("threads")
        if fk.get("name")
    }

    with op.batch_alter_table("threads", schema=None) as batch_op:
        if "fk_threads_user_id_users" in thread_foreign_keys:
            batch_op.drop_constraint("fk_threads_user_id_users", type_="foreignkey")
        if "ix_threads_user_id" in thread_indexes:
            batch_op.drop_index(batch_op.f("ix_threads_user_id"))
        if "system_prompt" in thread_columns:
            batch_op.drop_column("system_prompt")
        if "user_id" in thread_columns:
            batch_op.drop_column("user_id")

    existing_tables = set(inspector.get_table_names())
    if "users" in existing_tables:
        user_indexes = {index["name"] for index in inspector.get_indexes("users")}
        if "ix_users_username" in user_indexes:
            op.drop_index(op.f("ix_users_username"), table_name="users")
        op.drop_table("users")
