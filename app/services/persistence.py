import json
import logging
from datetime import datetime, timedelta, timezone

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
    build_public_url_from_stored_path,
    create_storage_client,
    extract_upload_object_key,
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
    artifact = ARTIFACT_TYPE_ADAPTER.validate_python(record.payload)
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
        db.add(
            ArtifactRecord(
                thread_id=thread_id,
                message_id=assistant_message.id,
                artifact_type=artifact.artifact_type,
                payload=artifact.model_dump(mode="json"),
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
        url=material.url,
        text=material.text,
        created_at=material.created_at,
    )


def build_upload_url(record: UploadRecord) -> str:
    try:
        return build_public_url_from_stored_path(record.file_path)
    except RuntimeError:
        logger.warning("Unable to build public URL for upload record %s", record.id)
        return record.file_path


def extract_upload_relative_path(url: str | None) -> str | None:
    storage_client = create_storage_client("local")
    return storage_client.extract_object_key_from_url(url)


def bind_material_uploads_to_thread(
    db: Session,
    *,
    user_id: str,
    thread_id: str,
    material_urls: list[str | None],
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
    for record in records:
        _, object_key = parse_stored_file_path(record.file_path)
        if object_key not in candidate_paths:
            continue
        if record.thread_id == thread_id:
            continue
        if record.thread_id:
            continue
        record.thread_id = thread_id
        updated_count += 1

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

    for record in records:
        record_url = build_upload_url(record)
        if current_avatar_url and current_avatar_url == record_url:
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
