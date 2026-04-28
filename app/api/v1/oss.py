import logging
import mimetypes
import re
import unicodedata
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Thread, UploadPurpose as UploadPurposeModel
from app.db.models import UploadRecord, User
from app.models.schemas import UploadMediaResponse, UploadPurpose, UploadRetentionSummary
from app.services.auth import get_current_user
from app.services.oss_client import (
    LOCAL_UPLOADS_DIR,
    OSS_STORAGE_BACKEND,
    build_stored_file_path,
    create_storage_client,
)
from app.services.persistence import build_upload_retention_summary

router = APIRouter(prefix="/api/v1/media", tags=["media-storage"])
logger = logging.getLogger(__name__)

UPLOADS_DIR = LOCAL_UPLOADS_DIR

MAX_UPLOAD_SIZE = 15 * 1024 * 1024
READ_CHUNK_SIZE = 1024 * 1024
ALLOWED_EXTENSIONS = {
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
    ".webp": "image",
    ".mp4": "video",
    ".mov": "video",
    ".txt": "document",
    ".pdf": "document",
    ".md": "document",
}


def secure_filename(filename: str) -> str:
    safe_name = Path(filename).name
    safe_name = unicodedata.normalize("NFKC", safe_name)
    safe_name = safe_name.replace("\x00", "")
    safe_name = re.sub(r"[\r\n\t]+", "_", safe_name)
    safe_name = re.sub(r'[<>:"/\\\\|?*]+', "_", safe_name)
    safe_name = re.sub(r"\s+", "_", safe_name)
    safe_name = re.sub(r"_+", "_", safe_name)
    return safe_name.strip("._")


@router.post("/upload")
async def upload_media(
    file: UploadFile = File(...),
    purpose: UploadPurpose = Form(UploadPurpose.MATERIAL),
    thread_id: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UploadMediaResponse:
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="上传失败：缺少有效的文件名。",
        )

    original_filename = secure_filename(file.filename)
    if not original_filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="上传失败：文件名不合法，请重命名后重试。",
        )

    suffix = Path(original_filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="仅支持上传 jpg、jpeg、png、webp、mp4、mov、txt、pdf、md 文件。",
        )

    resolved_thread_id: str | None = None
    if purpose == UploadPurpose.MATERIAL and thread_id:
        owned_thread = db.scalar(
            select(Thread.id).where(
                Thread.id == thread_id,
                Thread.user_id == current_user.id,
            )
        )
        if owned_thread is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="未找到当前用户可访问的会话。",
            )
        resolved_thread_id = thread_id

    stored_name = f"{uuid4().hex}{suffix}"
    total_size = 0
    content_type = file.content_type or mimetypes.guess_type(original_filename)[0]
    storage_client = create_storage_client()
    upload_object_key: str | None = None
    if (
        purpose == UploadPurpose.MATERIAL
        and resolved_thread_id is None
        and getattr(storage_client, "backend_name", "") == OSS_STORAGE_BACKEND
    ):
        upload_object_key = storage_client.build_temporary_object_key(
            user_id=current_user.id,
            filename=stored_name,
        )

    try:
        while chunk := await file.read(READ_CHUNK_SIZE):
            total_size += len(chunk)
            if total_size > MAX_UPLOAD_SIZE:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="上传文件不能超过 15MB。",
                )
        await file.seek(0)
    except HTTPException:
        raise
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="文件保存失败，请稍后重试。",
        ) from exc

    try:
        stored_upload = await storage_client.upload_file_stream(
            user_id=current_user.id,
            filename=stored_name,
            content_type=content_type or "application/octet-stream",
            file_stream=file.file,
            object_key=upload_object_key,
        )
    except RuntimeError as exc:
        logger.warning("Storage upload failed before persistence: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="对象存储配置不完整，请检查 OSS 环境变量。",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="文件上传失败，请稍后重试。",
        ) from exc
    finally:
        await file.close()

    try:
        db.add(
            UploadRecord(
                user_id=current_user.id,
                filename=stored_name,
                file_path=build_stored_file_path(
                    stored_upload.backend_name,
                    stored_upload.object_key,
                ),
                mime_type=content_type or "application/octet-stream",
                file_size=total_size,
                purpose=UploadPurposeModel(purpose.value).value,
                thread_id=resolved_thread_id,
            )
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        await storage_client.delete_file(stored_upload.object_key)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="上传记录保存失败，请稍后重试。",
        ) from exc

    return UploadMediaResponse(
        url=(
            storage_client.build_delivery_url(stored_upload.object_key)
            if hasattr(storage_client, "build_delivery_url")
            else stored_upload.public_url
        ),
        file_type=ALLOWED_EXTENSIONS[suffix],
        content_type=content_type or "application/octet-stream",
        filename=stored_name,
        original_filename=original_filename,
        purpose=purpose,
        thread_id=resolved_thread_id,
    )


@router.get("/retention", response_model=UploadRetentionSummary)
async def get_upload_retention_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UploadRetentionSummary:
    return UploadRetentionSummary.model_validate(
        build_upload_retention_summary(db, user_id=current_user.id)
    )
