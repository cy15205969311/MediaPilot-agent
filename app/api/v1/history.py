from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.db.database import get_db
from app.db.models import ArtifactRecord, Material, Message, Thread, User
from app.models.schemas import (
    ThreadDeleteResponse,
    ThreadListResponse,
    ThreadMessagesResponse,
    ThreadSummaryItem,
    ThreadUpdateRequest,
)
from app.services.auth import get_current_user
from app.services.persistence import (
    build_artifact_history_item,
    build_history_message_item,
    build_material_history_item,
    cleanup_abandoned_materials,
    summarize_message_content,
)

router = APIRouter(prefix="/api/v1/media", tags=["media-history"])


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
        updated_at=thread.updated_at,
    )


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
        messages=history_messages,
        materials=[
            build_material_history_item(material)
            for material in thread_materials
            if material.id not in attached_material_ids
        ],
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
