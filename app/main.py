import logging
import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import load_environment

load_environment()

from app.api.v1.auth import router as auth_router
from app.api.v1.chat import router as media_chat_router
from app.api.v1.dashboard import router as media_dashboard_router
from app.api.v1.history import router as media_history_router
from app.api.v1.knowledge import router as media_knowledge_router
from app.api.v1.models import router as model_registry_router
from app.api.v1.oss import UPLOADS_DIR, router as media_upload_router
from app.api.v1.templates import router as media_templates_router
from app.api.v1.topics import router as media_topics_router
from app.db.database import engine
from app.db.models import Base
from app.services.scheduler import (
    create_scheduler,
    run_material_cleanup_job,
    run_oss_lifecycle_rollout_job,
)

APP_LOGGER_NAME = "app"
STREAM_TRACE_PATHS = frozenset({"/api/v1/media/chat/stream"})
DEFAULT_LOCAL_DEV_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
logger = logging.getLogger(f"{APP_LOGGER_NAME}.main")


def load_cors_allowed_origins() -> list[str]:
    raw_value = os.getenv("CORS_ALLOWED_ORIGINS", "").strip()
    if not raw_value:
        return DEFAULT_LOCAL_DEV_CORS_ORIGINS

    origins = [item.strip().rstrip("/") for item in raw_value.split(",") if item.strip()]
    return origins or DEFAULT_LOCAL_DEV_CORS_ORIGINS


def configure_application_logging() -> None:
    app_logger = logging.getLogger(APP_LOGGER_NAME)
    uvicorn_logger = logging.getLogger("uvicorn.error")

    app_logger.setLevel(logging.INFO)
    if uvicorn_logger.handlers:
        existing_handler_ids = {id(handler) for handler in app_logger.handlers}
        for handler in uvicorn_logger.handlers:
            if id(handler) not in existing_handler_ids:
                app_logger.addHandler(handler)
        app_logger.propagate = True
        return

    if app_logger.handlers:
        return

    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s"),
    )
    app_logger.addHandler(handler)
    app_logger.propagate = True


configure_application_logging()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    Base.metadata.create_all(bind=engine)
    scheduler = create_scheduler()
    scheduler.start()
    await run_oss_lifecycle_rollout_job()
    await run_material_cleanup_job()
    try:
        yield
    finally:
        scheduler.shutdown(wait=False)


app = FastAPI(
    title="OmniMedia Agent API",
    description="OmniMedia Agent backend gateway.",
    version="0.10.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=load_cors_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")


@app.middleware("http")
async def log_request_lifecycle(request: Request, call_next):
    should_trace = request.url.path in STREAM_TRACE_PATHS
    start_time = time.perf_counter()

    if should_trace:
        logger.info(
            "request.start method=%s path=%s content_length=%s has_authorization=%s",
            request.method,
            request.url.path,
            request.headers.get("content-length", "unknown"),
            request.headers.get("authorization") is not None,
        )

    try:
        response = await call_next(request)
    except Exception:
        if should_trace:
            logger.exception(
                "request.error method=%s path=%s elapsed_ms=%.1f",
                request.method,
                request.url.path,
                (time.perf_counter() - start_time) * 1000,
            )
        raise

    if should_trace:
        logger.info(
            "request.response method=%s path=%s status=%s elapsed_ms=%.1f",
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - start_time) * 1000,
        )

    return response


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "OmniMedia Engine is running."}


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "OmniMedia Agent API",
        "status": "ok",
        "frontend": "Run the Vite frontend from ./frontend",
        "docs": "/docs",
        "uploads": "/uploads",
    }


app.include_router(auth_router)
app.include_router(media_chat_router)
app.include_router(media_dashboard_router)
app.include_router(media_history_router)
app.include_router(media_knowledge_router)
app.include_router(model_registry_router)
app.include_router(media_upload_router)
app.include_router(media_templates_router)
app.include_router(media_topics_router)
