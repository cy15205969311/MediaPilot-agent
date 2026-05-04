import json

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload
from pydantic import TypeAdapter

from app.db.database import get_db
from app.db.models import ArtifactRecord, Material, Message, Thread, User
from app.models.schemas import (
    ArtifactDeleteBatchRequest,
    ArtifactDeleteResponse,
    ArtifactListItem,
    ArtifactListResponse,
    ArtifactPayloadModel,
    ThreadDeleteResponse,
    ThreadListResponse,
    ThreadMessagesResponse,
    ThreadSummaryItem,
    ThreadUpdateRequest,
)
from app.services.auth import get_current_user
from app.services.knowledge_base import normalize_knowledge_base_scope
from app.services.persistence import (
    build_artifact_history_item,
    build_history_message_item,
    build_material_history_item,
    cleanup_abandoned_materials,
    resolve_artifact_media_references,
    summarize_message_content,
)

router = APIRouter(prefix="/api/v1/media", tags=["media-history"])
ARTIFACT_PAYLOAD_ADAPTER = TypeAdapter(ArtifactPayloadModel)


def _get_owned_thread(db: Session, thread_id: str, user_id: str) -> Thread:
    thread = db.scalar(
        select(Thread).where(
            Thread.id == thread_id,
            Thread.user_id == user_id,
        )
    )
    if thread is None:
        raise HTTPException(status_code=404, detail="未找到对应会话。")
    return thread


def _get_owned_artifact_messages(
    db: Session,
    *,
    user_id: str,
    message_ids: list[str] | None = None,
) -> list[Message]:
    statement = (
        select(Message)
        .join(Thread, Message.thread_id == Thread.id)
        .join(ArtifactRecord, ArtifactRecord.message_id == Message.id)
        .where(Thread.user_id == user_id)
    )

    if message_ids is not None:
        if len(message_ids) == 0:
            return []
        statement = statement.where(Message.id.in_(message_ids))

    return list(db.scalars(statement).unique().all())


def _build_thread_summary(db: Session, thread: Thread) -> ThreadSummaryItem:
    latest_message = db.scalar(
        select(Message)
        .where(Message.thread_id == thread.id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    title = thread.title.strip() or "Untitled thread"

    return ThreadSummaryItem(
        id=thread.id,
        title=title,
        latest_message_excerpt=(
            summarize_message_content(latest_message.content)
            if latest_message is not None
            else ""
        ),
        is_archived=thread.is_archived,
        model_override=thread.model_override,
        knowledge_base_scope=thread.knowledge_base_scope,
        updated_at=thread.updated_at,
    )


def _compact_text(value: str, limit: int = 140) -> str:
    compact = " ".join(value.split())
    if len(compact) <= limit:
        return compact
    return f"{compact[: max(0, limit - 3)]}..."


def _build_artifact_excerpt(artifact: ArtifactPayloadModel) -> str:
    if artifact.artifact_type == "content_draft":
        return _compact_text(artifact.body)

    if artifact.artifact_type == "topic_list":
        return _compact_text(
            "；".join(f"{topic.title}：{topic.angle}" for topic in artifact.topics),
        )

    if artifact.artifact_type == "hot_post_analysis":
        dimensions = "；".join(
            f"{dimension.dimension}：{dimension.insight}"
            for dimension in artifact.analysis_dimensions
        )
        templates = "；".join(artifact.reusable_templates)
        return _compact_text(dimensions or templates or artifact.title)

    if artifact.artifact_type == "comment_reply":
        return _compact_text(
            "；".join(
                f"{suggestion.comment_type}：{suggestion.reply}"
                for suggestion in artifact.suggestions
            ),
        )

    return _compact_text(artifact.title)


def _infer_artifact_platform(
    *,
    thread: Thread,
    message: Message,
    artifact: ArtifactPayloadModel,
) -> str | None:
    def detect_platform(source_text: str) -> str | None:
        normalized = source_text.lower()
        has_xiaohongshu = "xiaohongshu" in normalized or "小红书" in normalized
        has_douyin = "douyin" in normalized or "抖音" in normalized

        if has_xiaohongshu and has_douyin:
            return "both"
        if has_xiaohongshu:
            return "xiaohongshu"
        if has_douyin:
            return "douyin"
        return None

    primary_context = " ".join(
        item for item in [thread.title, thread.system_prompt] if item
    )
    primary_platform = detect_platform(primary_context)
    if primary_platform in {"xiaohongshu", "douyin"}:
        return primary_platform

    secondary_context = " ".join(
        item
        for item in [
            primary_context,
            message.content,
            json.dumps(artifact.model_dump(mode="json"), ensure_ascii=False),
        ]
        if item
    )
    return detect_platform(secondary_context)


@router.get("/threads", response_model=ThreadListResponse)
async def list_threads(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    include_archived: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ThreadListResponse:
    offset = (page - 1) * page_size

    total_statement = select(func.count()).select_from(Thread).where(
        Thread.user_id == current_user.id,
    )
    thread_statement = (
        select(Thread)
        .where(Thread.user_id == current_user.id)
        .order_by(Thread.updated_at.desc())
        .offset(offset)
        .limit(page_size)
    )

    if not include_archived:
        total_statement = total_statement.where(Thread.is_archived.is_(False))
        thread_statement = thread_statement.where(Thread.is_archived.is_(False))

    total = db.scalar(total_statement) or 0
    threads = db.scalars(thread_statement).all()

    return ThreadListResponse(
        items=[_build_thread_summary(db, thread) for thread in threads],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/threads/{thread_id}/messages", response_model=ThreadMessagesResponse)
async def get_thread_messages(
    thread_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ThreadMessagesResponse:
    thread = _get_owned_thread(db, thread_id, current_user.id)

    messages = db.scalars(
        select(Message)
        .options(selectinload(Message.materials))
        .where(Message.thread_id == thread_id)
        .order_by(Message.created_at.asc())
    ).all()
    artifact_records = db.scalars(
        select(ArtifactRecord)
        .where(ArtifactRecord.thread_id == thread_id)
        .order_by(ArtifactRecord.created_at.asc())
    ).all()
    thread_materials = list(db.scalars(
        select(Material)
        .where(Material.thread_id == thread_id)
        .order_by(Material.created_at.asc())
    ).all())
    attached_material_ids = {
        material.id for message in messages for material in message.materials
    }

    history_messages = [build_history_message_item(message) for message in messages]
    history_messages.extend(
        build_artifact_history_item(record) for record in artifact_records
    )
    history_messages.sort(key=lambda item: (item.created_at, item.id))

    return ThreadMessagesResponse(
        thread_id=thread_id,
        title=thread.title,
        system_prompt=thread.system_prompt,
        model_override=thread.model_override,
        knowledge_base_scope=thread.knowledge_base_scope,
        messages=history_messages,
        materials=[
            build_material_history_item(material)
            for material in thread_materials
            if material.id not in attached_material_ids
        ],
    )


@router.get("/artifacts", response_model=ArtifactListResponse)
async def list_artifacts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ArtifactListResponse:
    rows = db.execute(
        select(ArtifactRecord, Thread, Message)
        .join(Thread, ArtifactRecord.thread_id == Thread.id)
        .join(Message, ArtifactRecord.message_id == Message.id)
        .where(Thread.user_id == current_user.id)
        .order_by(ArtifactRecord.created_at.desc())
    ).all()

    items = []
    for record, thread, message in rows:
        artifact = resolve_artifact_media_references(
            ARTIFACT_PAYLOAD_ADAPTER.validate_python(record.payload)
        )
        items.append(
            ArtifactListItem(
                id=record.id,
                thread_id=record.thread_id,
                thread_title=thread.title.strip() or artifact.title or "Untitled thread",
                message_id=record.message_id,
                artifact_type=artifact.artifact_type,
                title=artifact.title,
                excerpt=_build_artifact_excerpt(artifact),
                platform=_infer_artifact_platform(
                    thread=thread,
                    message=message,
                    artifact=artifact,
                ),
                created_at=record.created_at,
                artifact=artifact,
            )
        )

    return ArtifactListResponse(items=items, total=len(items))


@router.delete("/artifacts/{message_id}", response_model=ArtifactDeleteResponse)
async def delete_artifact(
    message_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ArtifactDeleteResponse:
    messages = _get_owned_artifact_messages(
        db,
        user_id=current_user.id,
        message_ids=[message_id],
    )
    if len(messages) != 1:
        raise HTTPException(status_code=404, detail="Artifact draft not found.")

    messages[0].thread.touch()
    db.delete(messages[0])
    db.commit()
    return ArtifactDeleteResponse(
        deleted_count=1,
        deleted_message_ids=[message_id],
        cleared_all=False,
    )


@router.delete("/artifacts", response_model=ArtifactDeleteResponse)
async def delete_artifacts(
    payload: ArtifactDeleteBatchRequest = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ArtifactDeleteResponse:
    requested_ids = list(dict.fromkeys(payload.message_ids))

    if not payload.clear_all and len(requested_ids) == 0:
        raise HTTPException(status_code=400, detail="At least one artifact message_id is required.")

    messages = _get_owned_artifact_messages(
        db,
        user_id=current_user.id,
        message_ids=None if payload.clear_all else requested_ids,
    )

    if not payload.clear_all and len(messages) != len(requested_ids):
        raise HTTPException(status_code=404, detail="Some artifact drafts were not found.")

    touched_thread_ids: set[str] = set()
    deleted_message_ids = [message.id for message in messages]
    for message in messages:
        if message.thread_id not in touched_thread_ids:
            message.thread.touch()
            touched_thread_ids.add(message.thread_id)
        db.delete(message)
    db.commit()

    return ArtifactDeleteResponse(
        deleted_count=len(deleted_message_ids),
        deleted_message_ids=deleted_message_ids,
        cleared_all=payload.clear_all,
    )


@router.patch("/threads/{thread_id}", response_model=ThreadSummaryItem)
async def update_thread(
    thread_id: str,
    payload: ThreadUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ThreadSummaryItem:
    thread = _get_owned_thread(db, thread_id, current_user.id)

    if (
        payload.title is None
        and payload.is_archived is None
        and payload.system_prompt is None
        and payload.knowledge_base_scope is None
    ):
        raise HTTPException(status_code=400, detail="至少需要提供一个可更新字段。")

    if payload.title is not None:
        normalized_title = payload.title.strip()
        if not normalized_title:
            raise HTTPException(status_code=400, detail="会话标题不能为空。")
        thread.title = normalized_title

    if payload.is_archived is not None:
        thread.is_archived = payload.is_archived

    if payload.system_prompt is not None:
        thread.system_prompt = payload.system_prompt.strip()
    if payload.knowledge_base_scope is not None:
        thread.knowledge_base_scope = normalize_knowledge_base_scope(
            payload.knowledge_base_scope,
        )

    thread.touch()
    db.commit()
    db.refresh(thread)
    return _build_thread_summary(db, thread)


@router.delete("/threads/{thread_id}", response_model=ThreadDeleteResponse)
async def delete_thread(
    thread_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ThreadDeleteResponse:
    thread = _get_owned_thread(db, thread_id, current_user.id)
    db.delete(thread)
    db.commit()
    await cleanup_abandoned_materials(db, deleted_thread_id=thread_id)
    return ThreadDeleteResponse(id=thread_id, deleted=True)
