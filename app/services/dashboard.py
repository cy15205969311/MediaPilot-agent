from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from math import ceil
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import ArtifactRecord, Message, Thread, TopicRecord
from app.models.schemas import (
    DashboardActivityItem,
    DashboardAssetsSummary,
    DashboardProductivitySummary,
    DashboardSummaryResponse,
    DashboardTopicStatusSummary,
    TopicStatus,
)
from app.services.knowledge_base import get_knowledge_base_service

RECENT_ACTIVITY_DAYS = 14
WEEK_DAYS = 7
WORDS_PER_DRAFT_HOUR = 45


def build_dashboard_summary(db: Session, *, user_id: str) -> DashboardSummaryResponse:
    now = datetime.now(timezone.utc)
    week_start = now - timedelta(days=WEEK_DAYS)
    activity_start_date = (now.date() - timedelta(days=RECENT_ACTIVITY_DAYS - 1))
    activity_start = datetime.combine(
        activity_start_date,
        datetime.min.time(),
        tzinfo=timezone.utc,
    )

    total_drafts = _count_user_artifacts(db, user_id=user_id)
    drafts_this_week = _count_user_artifacts(db, user_id=user_id, created_since=week_start)
    total_words_generated = _estimate_total_generated_words(db, user_id=user_id)
    topic_counts = _count_topics_by_status(db, user_id=user_id)
    activity_items = _build_activity_items(
        db,
        user_id=user_id,
        start_date=activity_start_date,
        start_datetime=activity_start,
    )
    knowledge_scopes = get_knowledge_base_service().list_scopes(user_id)
    knowledge_chunk_count = sum(item.chunk_count for item in knowledge_scopes)

    return DashboardSummaryResponse(
        productivity=DashboardProductivitySummary(
            total_drafts=total_drafts,
            drafts_this_week=drafts_this_week,
            total_words_generated=total_words_generated,
            estimated_tokens=ceil(total_words_generated * 1.35),
            estimated_saved_minutes=total_drafts * WORDS_PER_DRAFT_HOUR,
        ),
        assets=DashboardAssetsSummary(
            total_topics=sum(topic_counts.values()),
            active_topics=topic_counts[TopicStatus.IDEA.value]
            + topic_counts[TopicStatus.DRAFTING.value],
            total_knowledge_scopes=len(knowledge_scopes),
            total_knowledge_chunks=knowledge_chunk_count,
        ),
        topic_status=DashboardTopicStatusSummary(
            idea=topic_counts[TopicStatus.IDEA.value],
            drafting=topic_counts[TopicStatus.DRAFTING.value],
            published=topic_counts[TopicStatus.PUBLISHED.value],
        ),
        activity_heatmap=activity_items,
    )


def _count_user_artifacts(
    db: Session,
    *,
    user_id: str,
    created_since: datetime | None = None,
) -> int:
    statement = (
        select(func.count(ArtifactRecord.id))
        .join(Thread, ArtifactRecord.thread_id == Thread.id)
        .where(Thread.user_id == user_id)
    )
    if created_since is not None:
        statement = statement.where(ArtifactRecord.created_at >= created_since)
    return int(db.scalar(statement) or 0)


def _estimate_total_generated_words(db: Session, *, user_id: str) -> int:
    statement = (
        select(ArtifactRecord.payload, Message.content)
        .join(Thread, ArtifactRecord.thread_id == Thread.id)
        .join(Message, ArtifactRecord.message_id == Message.id)
        .where(Thread.user_id == user_id)
    )
    total = 0
    for payload, message_content in db.execute(statement):
        total += _estimate_payload_words(payload, str(message_content or ""))
    return total


def _estimate_payload_words(payload: Any, fallback_content: str) -> int:
    if not isinstance(payload, dict):
        return len(fallback_content.strip())

    artifact_type = str(payload.get("artifact_type", ""))
    if artifact_type == "content_draft":
        return len(str(payload.get("body", "")).strip())
    if artifact_type == "topic_list":
        topics = payload.get("topics")
        if isinstance(topics, list):
            return sum(
                len(str(item.get("title", "")))
                + len(str(item.get("angle", "")))
                + len(str(item.get("goal", "")))
                for item in topics
                if isinstance(item, dict)
            )
    if artifact_type == "hot_post_analysis":
        dimensions = payload.get("analysis_dimensions")
        templates = payload.get("reusable_templates")
        dimension_words = 0
        if isinstance(dimensions, list):
            dimension_words = sum(
                len(str(item.get("dimension", ""))) + len(str(item.get("insight", "")))
                for item in dimensions
                if isinstance(item, dict)
            )
        template_words = sum(len(str(item)) for item in templates) if isinstance(templates, list) else 0
        return dimension_words + template_words
    if artifact_type == "comment_reply":
        suggestions = payload.get("suggestions")
        if isinstance(suggestions, list):
            return sum(
                len(str(item.get("reply", ""))) + len(str(item.get("compliance_note", "")))
                for item in suggestions
                if isinstance(item, dict)
            )

    text_candidates = [
        str(value)
        for value in payload.values()
        if isinstance(value, str) and value.strip()
    ]
    return len("".join(text_candidates)) or len(fallback_content.strip())


def _count_topics_by_status(db: Session, *, user_id: str) -> dict[str, int]:
    counts = {
        TopicStatus.IDEA.value: 0,
        TopicStatus.DRAFTING.value: 0,
        TopicStatus.PUBLISHED.value: 0,
    }
    statement = (
        select(TopicRecord.status, func.count(TopicRecord.id))
        .where(TopicRecord.user_id == user_id)
        .group_by(TopicRecord.status)
    )
    for status, count in db.execute(statement):
        normalized_status = str(status or TopicStatus.IDEA.value)
        if normalized_status in counts:
            counts[normalized_status] = int(count or 0)
    return counts


def _build_activity_items(
    db: Session,
    *,
    user_id: str,
    start_date: date,
    start_datetime: datetime,
) -> list[DashboardActivityItem]:
    buckets = {
        (start_date + timedelta(days=offset)).isoformat(): 0
        for offset in range(RECENT_ACTIVITY_DAYS)
    }
    statement = (
        select(func.date(ArtifactRecord.created_at), func.count(ArtifactRecord.id))
        .join(Thread, ArtifactRecord.thread_id == Thread.id)
        .where(Thread.user_id == user_id, ArtifactRecord.created_at >= start_datetime)
        .group_by(func.date(ArtifactRecord.created_at))
        .order_by(func.date(ArtifactRecord.created_at).asc())
    )
    for raw_date, count in db.execute(statement):
        date_key = str(raw_date)
        if date_key in buckets:
            buckets[date_key] = int(count or 0)
    return [DashboardActivityItem(date=date_key, count=count) for date_key, count in buckets.items()]
