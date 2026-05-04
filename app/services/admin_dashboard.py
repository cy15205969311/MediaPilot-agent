from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import ArtifactRecord, TokenTransaction, UploadRecord, User
from app.models.schemas import (
    AdminDashboardModelUsageItem,
    AdminPendingTasksResponse,
    AdminDashboardResponse,
    AdminDashboardTrendItem,
)
from app.services.admin_storage import read_storage_capacity_bytes
from app.services.token_usage import (
    LEGACY_MODEL_NAME,
    UNTRACKED_HISTORICAL_MODEL_LABEL,
    estimate_payload_tokens,
)

ADMIN_DASHBOARD_WINDOW_DAYS = 30


def build_admin_dashboard_summary(db: Session) -> AdminDashboardResponse:
    now = datetime.now(timezone.utc)
    start_date = now.date() - timedelta(days=ADMIN_DASHBOARD_WINDOW_DAYS - 1)
    start_datetime = datetime.combine(start_date, time.min, tzinfo=timezone.utc)
    today_date = now.date().isoformat()

    total_users = int(db.scalar(select(func.count(User.id))) or 0)
    today_contents = int(
        db.scalar(
            select(func.count(ArtifactRecord.id)).where(
                ArtifactRecord.created_at >= _day_start(now.date())
            ),
        )
        or 0
    )
    oss_storage_bytes = int(
        db.scalar(select(func.coalesce(func.sum(UploadRecord.file_size), 0))) or 0
    )

    trend_30_days = _build_token_trend_30_days(
        db,
        start_date=start_date,
        start_datetime=start_datetime,
    )
    today_tokens = next(
        (item.token_count for item in trend_30_days if item.date == today_date),
        0,
    )
    model_usage_ratio = _build_model_usage_ratio(db, start_datetime=start_datetime)

    return AdminDashboardResponse(
        total_users=total_users,
        today_tokens=today_tokens,
        today_contents=today_contents,
        oss_storage_bytes=oss_storage_bytes,
        trend_30_days=trend_30_days,
        model_usage_ratio=model_usage_ratio,
    )


def build_admin_pending_tasks(db: Session) -> AdminPendingTasksResponse:
    abnormal_users = int(
        db.scalar(
            select(func.count(User.id)).where(User.status != "active"),
        )
        or 0
    )
    total_storage_bytes = int(
        db.scalar(select(func.coalesce(func.sum(UploadRecord.file_size), 0))) or 0
    )
    capacity_bytes = read_storage_capacity_bytes()
    storage_warnings = int(
        capacity_bytes > 0 and total_storage_bytes >= int(capacity_bytes * 0.9)
    )

    return AdminPendingTasksResponse(
        abnormal_users=abnormal_users,
        storage_warnings=storage_warnings,
    )


def _build_token_trend_30_days(
    db: Session,
    *,
    start_date: date,
    start_datetime: datetime,
) -> list[AdminDashboardTrendItem]:
    buckets = {
        (start_date + timedelta(days=offset)).isoformat(): 0
        for offset in range(ADMIN_DASHBOARD_WINDOW_DAYS)
    }

    consume_amount = case(
        (TokenTransaction.transaction_type == "consume", func.abs(TokenTransaction.amount)),
        (TokenTransaction.amount < 0, func.abs(TokenTransaction.amount)),
        else_=0,
    )
    statement = (
        select(func.date(TokenTransaction.created_at), func.sum(consume_amount))
        .where(TokenTransaction.created_at >= start_datetime)
        .group_by(func.date(TokenTransaction.created_at))
        .order_by(func.date(TokenTransaction.created_at).asc())
    )

    saw_transaction_rows = False
    for raw_date, total in db.execute(statement):
        saw_transaction_rows = True
        date_key = str(raw_date)
        if date_key in buckets:
            buckets[date_key] = int(total or 0)

    if not saw_transaction_rows:
        return _build_estimated_artifact_token_trend(
            db,
            start_date=start_date,
            start_datetime=start_datetime,
        )

    return [
        AdminDashboardTrendItem(date=date_key, token_count=token_count)
        for date_key, token_count in buckets.items()
    ]


def _build_estimated_artifact_token_trend(
    db: Session,
    *,
    start_date: date,
    start_datetime: datetime,
) -> list[AdminDashboardTrendItem]:
    buckets = {
        (start_date + timedelta(days=offset)).isoformat(): 0
        for offset in range(ADMIN_DASHBOARD_WINDOW_DAYS)
    }
    statement = (
        select(ArtifactRecord.created_at, ArtifactRecord.payload)
        .where(ArtifactRecord.created_at >= start_datetime)
        .order_by(ArtifactRecord.created_at.asc())
    )

    for created_at, payload in db.execute(statement):
        if created_at is None:
            continue
        date_key = created_at.date().isoformat()
        if date_key not in buckets:
            continue
        buckets[date_key] += estimate_payload_tokens(payload)

    return [
        AdminDashboardTrendItem(date=date_key, token_count=token_count)
        for date_key, token_count in buckets.items()
    ]


def _build_model_usage_ratio(
    db: Session,
    *,
    start_datetime: datetime,
) -> list[AdminDashboardModelUsageItem]:
    model_bucket = case(
        (
            TokenTransaction.model_name.is_(None),
            UNTRACKED_HISTORICAL_MODEL_LABEL,
        ),
        (
            func.trim(TokenTransaction.model_name) == "",
            UNTRACKED_HISTORICAL_MODEL_LABEL,
        ),
        (
            func.lower(TokenTransaction.model_name) == LEGACY_MODEL_NAME,
            UNTRACKED_HISTORICAL_MODEL_LABEL,
        ),
        else_=TokenTransaction.model_name,
    )
    consume_filter = or_(
        TokenTransaction.transaction_type == "consume",
        TokenTransaction.amount < 0,
    )
    usage_amount = case(
        (TokenTransaction.amount < 0, func.abs(TokenTransaction.amount)),
        else_=TokenTransaction.amount,
    )
    statement = (
        select(
            model_bucket.label("model_name"),
            func.coalesce(func.sum(usage_amount), 0).label("count"),
        )
        .where(TokenTransaction.created_at >= start_datetime)
        .where(consume_filter)
        .group_by(model_bucket)
        .order_by(func.coalesce(func.sum(usage_amount), 0).desc(), model_bucket.asc())
    )
    rows = [
        AdminDashboardModelUsageItem(model_name=str(model_name), count=int(count or 0))
        for model_name, count in db.execute(statement)
        if model_name is not None
    ]
    if rows:
        return rows

    historical_artifact_count = int(
        db.scalar(
            select(func.count(ArtifactRecord.id)).where(
                ArtifactRecord.created_at >= start_datetime
            ),
        )
        or 0
    )
    if historical_artifact_count <= 0:
        return []

    return [
        AdminDashboardModelUsageItem(
            model_name=UNTRACKED_HISTORICAL_MODEL_LABEL,
            count=historical_artifact_count,
        )
    ]


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=timezone.utc)
