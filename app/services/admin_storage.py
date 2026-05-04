from __future__ import annotations

import os

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import UploadRecord, User
from app.models.schemas import (
    AdminStorageDistribution,
    AdminStorageStatsResponse,
    AdminStorageUserItem,
    AdminStorageUserListResponse,
)

DEFAULT_STORAGE_CAPACITY_BYTES = 1024 ** 4
DOCUMENT_MIME_TYPES = frozenset(
    {
        "application/pdf",
        "application/msword",
        "application/vnd.ms-excel",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/json",
        "application/xml",
        "text/csv",
        "text/plain",
        "text/markdown",
    }
)


def build_admin_storage_stats(db: Session) -> AdminStorageStatsResponse:
    total_bytes = int(
        db.scalar(select(func.coalesce(func.sum(UploadRecord.file_size), 0))) or 0
    )
    category_bucket = _build_storage_category_bucket()
    rows = db.execute(
        select(
            category_bucket.label("category"),
            func.coalesce(func.sum(UploadRecord.file_size), 0).label("total_bytes"),
        ).group_by(category_bucket)
    ).all()

    distribution = {
        "image": 0,
        "video": 0,
        "audio": 0,
        "document": 0,
        "other": 0,
    }
    for category, bucket_bytes in rows:
        category_key = str(category or "other")
        if category_key in distribution:
            distribution[category_key] = int(bucket_bytes or 0)

    return AdminStorageStatsResponse(
        total_bytes=total_bytes,
        capacity_bytes=read_storage_capacity_bytes(),
        distribution=AdminStorageDistribution(**distribution),
    )


def build_admin_storage_user_rankings(
    db: Session,
    *,
    limit: int,
) -> AdminStorageUserListResponse:
    total_size_bytes = func.coalesce(func.sum(UploadRecord.file_size), 0)
    last_upload_time = func.max(UploadRecord.created_at)
    rows = db.execute(
        select(
            User.id,
            User.username,
            User.nickname,
            total_size_bytes.label("total_size_bytes"),
            func.count(UploadRecord.id).label("file_count"),
            last_upload_time.label("last_upload_time"),
        )
        .join(UploadRecord, UploadRecord.user_id == User.id)
        .group_by(User.id, User.username, User.nickname)
        .order_by(total_size_bytes.desc(), last_upload_time.desc(), User.username.asc())
        .limit(limit)
    ).all()

    return AdminStorageUserListResponse(
        items=[
            AdminStorageUserItem(
                user_id=str(user_id),
                username=str(username),
                nickname=str(nickname) if nickname is not None else None,
                total_size_bytes=int(size_bytes or 0),
                file_count=int(file_count or 0),
                last_upload_time=last_uploaded_at,
            )
            for user_id, username, nickname, size_bytes, file_count, last_uploaded_at in rows
        ],
        limit=limit,
    )


def read_storage_capacity_bytes() -> int:
    return _read_storage_capacity_bytes()


def _read_storage_capacity_bytes() -> int:
    raw_value = os.getenv("OMNIMEDIA_STORAGE_CAPACITY_BYTES", "").strip()
    if not raw_value:
        return DEFAULT_STORAGE_CAPACITY_BYTES

    try:
        parsed = int(raw_value)
    except ValueError:
        return DEFAULT_STORAGE_CAPACITY_BYTES

    return parsed if parsed > 0 else DEFAULT_STORAGE_CAPACITY_BYTES


def _build_storage_category_bucket():
    normalized_mime = func.lower(func.coalesce(UploadRecord.mime_type, ""))
    is_document = or_(
        normalized_mime.like("text/%"),
        normalized_mime.in_(DOCUMENT_MIME_TYPES),
        normalized_mime.like("application/vnd.openxmlformats-officedocument.%"),
        normalized_mime.like("application/vnd.ms-%"),
    )
    return case(
        (normalized_mime.like("image/%"), "image"),
        (normalized_mime.like("video/%"), "video"),
        (normalized_mime.like("audio/%"), "audio"),
        (is_document, "document"),
        else_="other",
    )
