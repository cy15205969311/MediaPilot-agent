from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, inspect, pool, text

from app.db.database import SQLALCHEMY_DATABASE_URL
from app.db.models import Base

config = context.config
config.set_main_option("sqlalchemy.url", SQLALCHEMY_DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _get_table_columns(inspector, table_name: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table_name)}


def _infer_existing_revision(connection) -> str | None:
    inspector = inspect(connection)
    existing_tables = set(inspector.get_table_names())
    user_tables = existing_tables - {"alembic_version"}
    if not user_tables:
        return None

    if "templates" in existing_tables:
        template_columns = _get_table_columns(inspector, "templates")
        if "knowledge_base_scope" in template_columns:
            if "threads" in existing_tables:
                thread_columns = _get_table_columns(inspector, "threads")
                if "knowledge_base_scope" in thread_columns:
                    return "20260429_01"
            return "20260428_02"
        return "20260428_01"

    if "materials" in existing_tables:
        material_columns = _get_table_columns(inspector, "materials")
        if "message_id" in material_columns:
            return "20260427_01"

    if "refresh_sessions" in existing_tables:
        refresh_columns = _get_table_columns(inspector, "refresh_sessions")
        if {"device_info", "ip_address", "last_seen_at"}.issubset(refresh_columns):
            return "20260425_06"

    if "upload_records" in existing_tables:
        upload_columns = _get_table_columns(inspector, "upload_records")
        if "thread_id" in upload_columns:
            return "20260425_05"

    if "refresh_sessions" in existing_tables:
        return "20260425_04"

    if "upload_records" in existing_tables:
        return "20260425_03"

    if "users" in existing_tables:
        user_columns = _get_table_columns(inspector, "users")
        if "avatar_url" in user_columns:
            return "20260425_02"
        if {"nickname", "bio"}.issubset(user_columns):
            return "20260425_01"

    if "threads" in existing_tables:
        thread_columns = _get_table_columns(inspector, "threads")
        if {"user_id", "system_prompt"}.issubset(thread_columns):
            return "20260424_03"
        if {"title", "is_archived"}.issubset(thread_columns) or "artifact_records" in existing_tables:
            return "20260424_02"

    if {"threads", "messages", "materials"}.issubset(existing_tables):
        return "20260424_01"

    return None


def _bootstrap_alembic_version(connection) -> None:
    inspector = inspect(connection)
    existing_tables = set(inspector.get_table_names())
    user_tables = existing_tables - {"alembic_version"}
    if not user_tables:
        return

    existing_versions: list[str] = []
    if "alembic_version" in existing_tables:
        existing_versions = [
            str(row[0]).strip()
            for row in connection.execute(text("SELECT version_num FROM alembic_version"))
            if row[0] is not None
        ]
        if any(existing_versions):
            return

    inferred_revision = _infer_existing_revision(connection)
    if inferred_revision is None:
        return

    if "alembic_version" not in existing_tables:
        connection.execute(
            text(
                """
                CREATE TABLE alembic_version (
                    version_num VARCHAR(32) NOT NULL,
                    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
                )
                """
            )
        )
    else:
        connection.execute(text("DELETE FROM alembic_version"))

    connection.execute(
        text("INSERT INTO alembic_version (version_num) VALUES (:version_num)"),
        {"version_num": inferred_revision},
    )
    connection.commit()


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        _bootstrap_alembic_version(connection)
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()

        if connection.in_transaction():
            connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
