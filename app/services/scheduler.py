import logging
import os

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.db.database import SessionLocal
from app.services.oss_client import OSS_STORAGE_BACKEND, create_storage_client
from app.services.persistence import cleanup_abandoned_materials

logger = logging.getLogger(__name__)


def _is_enabled_env(env_name: str, *, default: bool = False) -> bool:
    raw_value = os.getenv(env_name, "").strip().lower()
    if not raw_value:
        return default
    return raw_value in {"1", "true", "yes", "on"}


async def run_material_cleanup_job() -> None:
    db = SessionLocal()
    try:
        logger.info("[GC] Started cleanup of abandoned materials.")
        deleted_count = await cleanup_abandoned_materials(db)
        logger.info("[GC] Deleted %s orphaned files.", deleted_count)
    except Exception:  # pragma: no cover - defensive runtime logging
        db.rollback()
        logger.exception("[GC] Cleanup job failed.")
    finally:
        db.close()


async def run_oss_lifecycle_rollout_job() -> None:
    if not _is_enabled_env("OSS_AUTO_SETUP_LIFECYCLE"):
        logger.info("[OSS] Lifecycle rollout skipped; OSS_AUTO_SETUP_LIFECYCLE is disabled.")
        return

    try:
        storage_client = create_storage_client(OSS_STORAGE_BACKEND)
        setup_bucket_lifecycle = getattr(storage_client, "setup_bucket_lifecycle", None)
        if setup_bucket_lifecycle is None:
            logger.info("[OSS] Active storage client does not support lifecycle rollout.")
            return
        setup_bucket_lifecycle()
        logger.info("[OSS] Bucket lifecycle rules are provisioned.")
    except Exception:  # pragma: no cover - defensive runtime logging
        logger.exception("[OSS] Lifecycle rollout failed.")


def create_scheduler() -> AsyncIOScheduler:
    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(
        run_material_cleanup_job,
        trigger="interval",
        hours=1,
        id="cleanup_abandoned_materials",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    scheduler.add_job(
        run_oss_lifecycle_rollout_job,
        trigger="interval",
        hours=24,
        id="oss_lifecycle_rollout",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    return scheduler
