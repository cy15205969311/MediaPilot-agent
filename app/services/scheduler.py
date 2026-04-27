import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.db.database import SessionLocal
from app.services.persistence import cleanup_abandoned_materials

logger = logging.getLogger(__name__)


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
    return scheduler
