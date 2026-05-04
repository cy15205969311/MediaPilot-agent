import os
import logging
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import load_environment

load_environment()

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "omnimedia_agent.db"
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{DEFAULT_DATABASE_PATH.as_posix()}",
)
SQLALCHEMY_DATABASE_URL = DATABASE_URL
logger = logging.getLogger(__name__)

engine = create_engine(
    DATABASE_URL,
    connect_args=(
        {"check_same_thread": False, "timeout": 20}
        if DATABASE_URL.startswith("sqlite")
        else {}
    ),
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def run_startup_migrations() -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    if "users" not in existing_tables:
        return

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    thread_columns = (
        {column["name"] for column in inspector.get_columns("threads")}
        if "threads" in existing_tables
        else set()
    )
    column_statements: list[str] = []

    if "role" not in user_columns:
        column_statements.append(
            "ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'user'"
        )
    if "status" not in user_columns:
        column_statements.append(
            "ALTER TABLE users ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'"
        )
    if "token_balance" not in user_columns:
        column_statements.append(
            "ALTER TABLE users ADD COLUMN token_balance INTEGER NOT NULL DEFAULT 0"
        )
    if "threads" in existing_tables and "model_override" not in thread_columns:
        column_statements.append(
            "ALTER TABLE threads ADD COLUMN model_override VARCHAR(80)"
        )

    if not column_statements:
        from app.db.models import SystemNotification, SystemSetting

        SystemSetting.__table__.create(bind=engine, checkfirst=True)
        SystemNotification.__table__.create(bind=engine, checkfirst=True)
        with SessionLocal() as db:
            from app.services.system_settings import seed_default_system_settings

            seed_default_system_settings(db, commit=True)
        return

    logger.info("Applying startup schema migrations for users table.")
    with engine.begin() as connection:
        for statement in column_statements:
            connection.exec_driver_sql(statement)

    from app.db.models import SystemNotification, SystemSetting

    SystemSetting.__table__.create(bind=engine, checkfirst=True)
    SystemNotification.__table__.create(bind=engine, checkfirst=True)
    with SessionLocal() as db:
        from app.services.system_settings import seed_default_system_settings

        seed_default_system_settings(db, commit=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
