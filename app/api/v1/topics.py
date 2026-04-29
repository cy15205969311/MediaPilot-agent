from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import TopicRecord, User
from app.models.schemas import (
    TopicCreateRequest,
    TopicDeleteResponse,
    TopicListItem,
    TopicListResponse,
    TopicStatus,
    TopicUpdateRequest,
)
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/v1/media", tags=["media-topics"])


def _serialize_topic(topic: TopicRecord) -> TopicListItem:
    return TopicListItem(
        id=topic.id,
        title=topic.title,
        inspiration=topic.inspiration,
        platform=topic.platform,
        status=topic.status,
        thread_id=topic.thread_id,
        created_at=topic.created_at,
        updated_at=topic.updated_at,
    )


def _get_owned_topic(db: Session, *, topic_id: str, user_id: str) -> TopicRecord:
    topic = db.scalar(
        select(TopicRecord).where(
            TopicRecord.id == topic_id,
            TopicRecord.user_id == user_id,
        )
    )
    if topic is None:
        raise HTTPException(status_code=404, detail="未找到对应选题。")
    return topic


@router.get("/topics", response_model=TopicListResponse)
async def list_topics(
    status_filter: TopicStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TopicListResponse:
    statement = select(TopicRecord).where(TopicRecord.user_id == current_user.id)
    if status_filter is not None:
        statement = statement.where(TopicRecord.status == status_filter.value)

    topics = list(
        db.scalars(statement.order_by(TopicRecord.updated_at.desc(), TopicRecord.created_at.desc())).all()
    )
    items = [_serialize_topic(topic) for topic in topics]
    return TopicListResponse(items=items, total=len(items))


@router.post("/topics", response_model=TopicListItem, status_code=status.HTTP_201_CREATED)
async def create_topic(
    payload: TopicCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TopicListItem:
    topic = TopicRecord(
        user_id=current_user.id,
        title=payload.title.strip(),
        inspiration=payload.inspiration.strip(),
        platform=payload.platform.value,
        status=TopicStatus.IDEA.value,
    )
    db.add(topic)
    db.commit()
    db.refresh(topic)
    return _serialize_topic(topic)


@router.patch("/topics/{topic_id}", response_model=TopicListItem)
async def update_topic(
    topic_id: str,
    payload: TopicUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TopicListItem:
    topic = _get_owned_topic(db, topic_id=topic_id, user_id=current_user.id)

    if payload.title is not None:
        topic.title = payload.title.strip()
    if payload.inspiration is not None:
        topic.inspiration = payload.inspiration.strip()
    if payload.platform is not None:
        topic.platform = payload.platform.value
    if payload.status is not None:
        topic.status = payload.status.value
    if payload.thread_id is not None:
        topic.thread_id = payload.thread_id.strip() or None

    db.commit()
    db.refresh(topic)
    return _serialize_topic(topic)


@router.delete("/topics/{topic_id}", response_model=TopicDeleteResponse)
async def delete_topic(
    topic_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TopicDeleteResponse:
    topic = _get_owned_topic(db, topic_id=topic_id, user_id=current_user.id)
    db.delete(topic)
    db.commit()
    return TopicDeleteResponse(id=topic_id, deleted=True)
