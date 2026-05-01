import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Callable

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ArtifactRecord, Material, Message, Thread, UploadPurpose, UploadRecord, User
from app.models.schemas import (
    ArtifactPayloadModel,
    MaterialHistoryItem,
    MaterialType,
    MessageHistoryItem,
    PersistedMessageType,
)
from app.services.oss_client import (
    OSS_TEMP_OBJECT_PREFIX,
    build_delivery_url_from_stored_path,
    build_stored_file_path,
    create_storage_client,
    extract_upload_object_key,
    is_temporary_upload_object_key,
    normalize_storage_reference,
    parse_stored_file_path,
)

ARTIFACT_MESSAGE_PREFIX = "__artifact__::"
ARTIFACT_TYPE_ADAPTER = TypeAdapter(ArtifactPayloadModel)
AVATAR_RETENTION_WINDOW = timedelta(hours=1)
MATERIAL_RETENTION_WINDOW = timedelta(hours=24)
logger = logging.getLogger(__name__)


def derive_thread_title(message: str, limit: int = 48) -> str:
    compact = " ".join(message.split())
    if not compact:
        return "Untitled thread"
    if len(compact) <= limit:
        return compact
    return f"{compact[: max(0, limit - 3)]}..."


def encode_artifact_message(artifact: ArtifactPayloadModel) -> str:
    artifact_json = json.dumps(artifact.model_dump(mode="json"), ensure_ascii=False)
    return f"{ARTIFACT_MESSAGE_PREFIX}{artifact_json}"


def decode_artifact_message(content: str) -> ArtifactPayloadModel | None:
    if not content.startswith(ARTIFACT_MESSAGE_PREFIX):
        return None

    payload = content.removeprefix(ARTIFACT_MESSAGE_PREFIX)
    return ARTIFACT_TYPE_ADAPTER.validate_python(json.loads(payload))


def _remap_content_artifact_generated_images(
    artifact: ArtifactPayloadModel,
    *,
    mapper: Callable[[str], str | None],
) -> ArtifactPayloadModel:
    if artifact.artifact_type != "content_draft":
        return artifact

    remapped_images: list[str] = []
    for raw_url in artifact.generated_images:
        normalized_url = str(raw_url or "").strip()
        if not normalized_url:
            continue
        remapped_images.append(mapper(normalized_url) or normalized_url)

    return artifact.model_copy(update={"generated_images": remapped_images})


def normalize_artifact_for_storage(artifact: ArtifactPayloadModel) -> ArtifactPayloadModel:
    return _remap_content_artifact_generated_images(
        artifact,
        mapper=normalize_storage_reference,
    )


def resolve_artifact_media_references(artifact: ArtifactPayloadModel) -> ArtifactPayloadModel:
    return _remap_content_artifact_generated_images(
        artifact,
        mapper=resolve_media_reference,
    )


def summarize_message_content(content: str, limit: int = 72) -> str:
    artifact = decode_artifact_message(content)
    if artifact is not None:
        return f"Artifact: {artifact.title}"

    compact = " ".join(content.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[: max(0, limit - 3)]}..."


def build_history_message_item(message: Message) -> MessageHistoryItem:
    materials = [build_material_history_item(material) for material in message.materials]
    artifact = decode_artifact_message(message.content)
    if artifact is not None:
        artifact = resolve_artifact_media_references(artifact)
        return MessageHistoryItem(
            id=message.id,
            thread_id=message.thread_id,
            role=message.role,
            message_type=PersistedMessageType.ARTIFACT,
            content=artifact.title,
            created_at=message.created_at,
            artifact=artifact,
            materials=materials,
        )

    return MessageHistoryItem(
        id=message.id,
        thread_id=message.thread_id,
        role=message.role,
        message_type=PersistedMessageType.TEXT,
        content=message.content,
        created_at=message.created_at,
        materials=materials,
    )


def build_artifact_history_item(record: ArtifactRecord) -> MessageHistoryItem:
    artifact = resolve_artifact_media_references(
        ARTIFACT_TYPE_ADAPTER.validate_python(record.payload)
    )
    return MessageHistoryItem(
        id=record.id,
        thread_id=record.thread_id,
        role="assistant",
        message_type=PersistedMessageType.ARTIFACT,
        content=artifact.title,
        created_at=record.created_at,
        artifact=artifact,
    )


def persist_assistant_output(
    db: Session,
    *,
    thread_id: str,
    user_id: str,
    assistant_text: str,
    artifact: ArtifactPayloadModel | None,
) -> None:
    logger.info(
        "persistence.persist_assistant_output start thread_id=%s text_chars=%s has_artifact=%s",
        thread_id,
        len(assistant_text.strip()),
        artifact is not None,
    )
    thread = db.get(Thread, thread_id)
    if thread is None:
        thread = Thread(
            id=thread_id,
            user_id=user_id,
            title="Untitled thread",
            system_prompt="",
        )
        db.add(thread)

    thread.touch()

    normalized_text = assistant_text.strip()
    assistant_message: Message | None = None
    if normalized_text or artifact is not None:
        assistant_message = Message(
            thread_id=thread_id,
            role="assistant",
            content=normalized_text or artifact.title,
        )
        db.add(assistant_message)
        db.flush()

    if artifact is not None and assistant_message is not None:
        artifact_for_storage = normalize_artifact_for_storage(artifact)
        db.add(
            ArtifactRecord(
                thread_id=thread_id,
                message_id=assistant_message.id,
                artifact_type=artifact_for_storage.artifact_type,
                payload=artifact_for_storage.model_dump(mode="json"),
            )
        )

    db.commit()
    logger.info("persistence.persist_assistant_output committed thread_id=%s", thread_id)


def material_type_from_db(value: str) -> MaterialType:
    return MaterialType(value)


def build_material_history_item(material: Material) -> MaterialHistoryItem:
    return MaterialHistoryItem(
        id=material.id,
        thread_id=material.thread_id,
        message_id=material.message_id,
        type=material_type_from_db(material.type),
        url=resolve_media_reference(material.url),
        text=material.text,
        created_at=material.created_at,
    )


def build_upload_url(record: UploadRecord) -> str:
    try:
        return build_delivery_url_from_stored_path(record.file_path)
    except RuntimeError:
        logger.warning("Unable to build public URL for upload record %s", record.id)
        return record.file_path


def extract_upload_relative_path(url: str | None) -> str | None:
    normalized_reference = normalize_storage_reference(url)
    if normalized_reference is None:
        return None
    if normalized_reference.startswith("http://") or normalized_reference.startswith("https://"):
        return None
    backend_name, object_key = parse_stored_file_path(normalized_reference)
    if backend_name != "local":
        return None
    return object_key or None


def normalize_media_reference(url: str | None) -> str | None:
    return normalize_storage_reference(url)


def resolve_media_reference(url: str | None) -> str | None:
    normalized_reference = normalize_storage_reference(url)
    if normalized_reference is None:
        return None
    if normalized_reference.startswith("http://") or normalized_reference.startswith("https://"):
        return normalized_reference
    try:
        return build_delivery_url_from_stored_path(normalized_reference)
    except RuntimeError:
        logger.warning("Unable to build delivery URL for media reference %s", normalized_reference)
        return normalized_reference


def build_upload_retention_summary(
    db: Session,
    *,
    user_id: str | None = None,
) -> dict[str, int | str | bool]:
    now = datetime.now(timezone.utc)
    stale_material_cutoff = now - MATERIAL_RETENTION_WINDOW
    statement = select(UploadRecord)
    if user_id is not None:
        statement = statement.where(UploadRecord.user_id == user_id)
    records = list(db.scalars(statement).all())

    summary: dict[str, int | str | bool] = {
        "storage_backend": os.getenv("OMNIMEDIA_STORAGE_BACKEND", "auto").strip().lower() or "auto",
        "total_files": 0,
        "total_bytes": 0,
        "temporary_files": 0,
        "temporary_bytes": 0,
        "thread_material_files": 0,
        "thread_material_bytes": 0,
        "avatar_files": 0,
        "avatar_bytes": 0,
        "stale_unbound_material_files": 0,
        "signed_url_expires_seconds": _clamp_positive_int(
            _read_positive_int_env("OSS_SIGNED_URL_EXPIRE_SECONDS", 3600),
            minimum=_read_positive_int_env("OSS_SIGNED_URL_MIN_EXPIRE_SECONDS", 60),
            maximum=_read_positive_int_env("OSS_SIGNED_URL_MAX_EXPIRE_SECONDS", 86400),
        ),
        "lifecycle_auto_rollout_enabled": _is_enabled_env("OSS_AUTO_SETUP_LIFECYCLE"),
        "tmp_upload_expire_days": _read_positive_int_env("OSS_TMP_UPLOAD_EXPIRE_DAYS", 3),
        "thread_upload_transition_days": _read_positive_int_env(
            "OSS_THREAD_UPLOAD_TRANSITION_DAYS",
            30,
        ),
        "thread_upload_transition_storage_class": os.getenv(
            "OSS_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS",
            "IA",
        ).strip()
        or "IA",
    }

    for record in records:
        file_size = max(0, record.file_size or 0)
        summary["total_files"] = int(summary["total_files"]) + 1
        summary["total_bytes"] = int(summary["total_bytes"]) + file_size

        if record.purpose == UploadPurpose.AVATAR.value:
            summary["avatar_files"] = int(summary["avatar_files"]) + 1
            summary["avatar_bytes"] = int(summary["avatar_bytes"]) + file_size
            continue

        _, object_key = parse_stored_file_path(record.file_path)
        is_tmp_record = (
            not record.thread_id
            or object_key.startswith(f"tmp/")
            or object_key.startswith(f"{OSS_TEMP_OBJECT_PREFIX}/")
        )
        if is_tmp_record:
            summary["temporary_files"] = int(summary["temporary_files"]) + 1
            summary["temporary_bytes"] = int(summary["temporary_bytes"]) + file_size
            if not record.thread_id and record.created_at <= stale_material_cutoff:
                summary["stale_unbound_material_files"] = (
                    int(summary["stale_unbound_material_files"]) + 1
                )
            continue

        summary["thread_material_files"] = int(summary["thread_material_files"]) + 1
        summary["thread_material_bytes"] = int(summary["thread_material_bytes"]) + file_size

    return summary


def _is_enabled_env(env_name: str) -> bool:
    return os.getenv(env_name, "").strip().lower() in {"1", "true", "yes", "on"}


def _read_positive_int_env(env_name: str, default: int) -> int:
    raw_value = os.getenv(env_name, "").strip()
    if not raw_value:
        return default
    try:
        parsed = int(raw_value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _clamp_positive_int(value: int, *, minimum: int, maximum: int) -> int:
    effective_maximum = max(minimum, maximum)
    if value < minimum:
        return minimum
    if value > effective_maximum:
        return effective_maximum
    return value


def bind_material_uploads_to_thread(
    db: Session,
    *,
    user_id: str,
    thread_id: str,
    material_urls: list[str | None],
    material_items: list[Material] | None = None,
) -> int:
    logger.info(
        "persistence.bind_material_uploads_to_thread start thread_id=%s material_urls=%s",
        thread_id,
        len(material_urls),
    )
    candidate_paths = {
        object_key
        for url in material_urls
        if (object_key := extract_upload_object_key(url))
        and user_id in object_key.split("/")
    }

    if not candidate_paths:
        return 0

    records = list(
        db.scalars(
            select(UploadRecord).where(
                UploadRecord.user_id == user_id,
                UploadRecord.purpose == UploadPurpose.MATERIAL.value,
            )
        ).all()
    )

    updated_count = 0
    rewritten_paths: dict[str, str] = {}
    for record in records:
        backend_name, object_key = parse_stored_file_path(record.file_path)
        if object_key not in candidate_paths:
            continue
        if record.thread_id == thread_id:
            continue
        if record.thread_id:
            continue

        if is_temporary_upload_object_key(object_key):
            storage_client = create_storage_client(backend_name)
            destination_object_key = storage_client.build_object_key(
                user_id=user_id,
                filename=record.filename,
            )
            if destination_object_key != object_key:
                storage_client.copy_file_sync(object_key, destination_object_key)
                next_file_path = build_stored_file_path(backend_name, destination_object_key)
                rewritten_paths[record.file_path] = next_file_path
                record.file_path = next_file_path

        record.thread_id = thread_id
        updated_count += 1

    if material_items and rewritten_paths:
        for material in material_items:
            normalized_material_reference = normalize_storage_reference(material.url)
            if normalized_material_reference in rewritten_paths:
                material.url = rewritten_paths[normalized_material_reference]

    logger.info(
        "persistence.bind_material_uploads_to_thread updated thread_id=%s updated_count=%s",
        thread_id,
        updated_count,
    )
    return updated_count


async def cleanup_orphaned_avatars(
    db: Session,
    *,
    user_id: str,
) -> int:
    user = db.get(User, user_id)
    if user is None:
        return 0

    current_avatar_url = (user.avatar_url or "").strip()
    cutoff = datetime.now(timezone.utc) - AVATAR_RETENTION_WINDOW

    records = list(
        db.scalars(
            select(UploadRecord).where(
                UploadRecord.user_id == user_id,
                UploadRecord.purpose == UploadPurpose.AVATAR.value,
            )
        ).all()
    )

    if not records:
        return 0

    deleted_count = 0

    normalized_current_avatar = normalize_storage_reference(current_avatar_url)
    for record in records:
        if normalized_current_avatar and normalized_current_avatar == record.file_path:
            continue
        if record.created_at > cutoff:
            continue

        try:
            backend_name, object_key = parse_stored_file_path(record.file_path)
            await create_storage_client(backend_name).delete_file(object_key)
        except Exception:
            logger.exception("Failed to delete orphaned avatar upload: %s", record.file_path)
            continue

        db.delete(record)
        deleted_count += 1

    if deleted_count > 0:
        db.commit()

    return deleted_count


async def cleanup_abandoned_materials(
    db: Session,
    *,
    deleted_thread_id: str | None = None,
) -> int:
    cutoff = datetime.now(timezone.utc) - MATERIAL_RETENTION_WINDOW

    statement = select(UploadRecord).where(
        UploadRecord.purpose == UploadPurpose.MATERIAL.value,
    )
    if deleted_thread_id:
        statement = statement.where(UploadRecord.thread_id == deleted_thread_id)
    else:
        statement = statement.where(UploadRecord.created_at <= cutoff)

    records = list(db.scalars(statement).all())
    if not records:
        return 0

    existing_thread_ids: set[str] = set()
    if not deleted_thread_id:
        candidate_thread_ids = {
            record.thread_id for record in records if record.thread_id
        }
        if candidate_thread_ids:
            existing_thread_ids = set(
                db.scalars(
                    select(Thread.id).where(Thread.id.in_(sorted(candidate_thread_ids)))
                ).all()
            )

    deleted_count = 0
    for record in records:
        should_delete = False
        if deleted_thread_id:
            should_delete = True
        elif not record.thread_id:
            should_delete = True
        elif record.thread_id not in existing_thread_ids:
            should_delete = True

        if not should_delete:
            continue

        try:
            backend_name, object_key = parse_stored_file_path(record.file_path)
            await create_storage_client(backend_name).delete_file(object_key)
        except Exception:
            logger.exception("Failed to delete abandoned material upload: %s", record.file_path)
            continue

        db.delete(record)
        deleted_count += 1

    if deleted_count > 0:
        db.commit()

    return deleted_count
