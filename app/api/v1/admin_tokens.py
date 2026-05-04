from __future__ import annotations

from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import TokenTransaction, User
from app.models.schemas import (
    AdminTokenTransactionItem,
    AdminTokenTransactionListResponse,
    AdminTokenTransactionStatsResponse,
)
from app.services.auth import RequireRole

router = APIRouter(prefix="/api/v1/admin", tags=["admin-tokens"])
require_admin_tokens_role = RequireRole(["super_admin", "finance"])


@router.get("/transactions", response_model=AdminTokenTransactionListResponse)
async def list_admin_token_transactions(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=100),
    user_keyword: str | None = Query(default=None, max_length=64),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tokens_role),
) -> AdminTokenTransactionListResponse:
    filters = []
    normalized_keyword = (user_keyword or "").strip()
    if normalized_keyword:
        keyword_pattern = f"%{normalized_keyword}%"
        filters.append(
            or_(
                User.username.ilike(keyword_pattern),
                User.nickname.ilike(keyword_pattern),
            ),
        )

    count_statement = (
        select(func.count(TokenTransaction.id))
        .select_from(TokenTransaction)
        .join(User, User.id == TokenTransaction.user_id)
    )
    list_statement = (
        select(
            TokenTransaction.id,
            TokenTransaction.created_at,
            User.username,
            User.nickname,
            TokenTransaction.transaction_type,
            TokenTransaction.amount,
            TokenTransaction.remark,
        )
        .select_from(TokenTransaction)
        .join(User, User.id == TokenTransaction.user_id)
        .order_by(TokenTransaction.created_at.desc(), TokenTransaction.id.desc())
        .offset(skip)
        .limit(limit)
    )

    for condition in filters:
        count_statement = count_statement.where(condition)
        list_statement = list_statement.where(condition)

    total = int(db.scalar(count_statement) or 0)
    rows = db.execute(list_statement).all()

    return AdminTokenTransactionListResponse(
        items=[
            AdminTokenTransactionItem(
                id=row.id,
                created_at=row.created_at,
                username=row.username,
                nickname=row.nickname,
                transaction_type=row.transaction_type,
                amount=int(row.amount or 0),
                remark=row.remark or "",
            )
            for row in rows
        ],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/transactions/stats", response_model=AdminTokenTransactionStatsResponse)
async def get_admin_token_transaction_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_tokens_role),
) -> AdminTokenTransactionStatsResponse:
    now = datetime.now(timezone.utc)
    today_start = datetime.combine(now.date(), time.min, tzinfo=timezone.utc)
    current_month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    yesterday_start = today_start - timedelta(days=1)
    elapsed_today = now - today_start
    yesterday_compare_end = yesterday_start + elapsed_today

    previous_month_start = _month_start(_shift_to_previous_month(current_month_start))
    elapsed_month = now - current_month_start
    previous_month_compare_end = min(
        previous_month_start + elapsed_month,
        current_month_start,
    )

    today_consume = _sum_consumed_tokens(db, start=today_start, end=now)
    yesterday_consume = _sum_consumed_tokens(
        db,
        start=yesterday_start,
        end=yesterday_compare_end,
    )
    today_topup = _sum_positive_tokens(db, start=today_start, end=now)
    yesterday_topup = _sum_positive_tokens(
        db,
        start=yesterday_start,
        end=yesterday_compare_end,
    )
    month_consume = _sum_consumed_tokens(
        db,
        start=current_month_start,
        end=now,
    )
    previous_month_consume = _sum_consumed_tokens(
        db,
        start=previous_month_start,
        end=previous_month_compare_end,
    )

    total_balance = int(
        db.scalar(select(func.coalesce(func.sum(User.token_balance), 0))) or 0
    )
    today_net_change = int(
        db.scalar(
            select(func.coalesce(func.sum(TokenTransaction.amount), 0)).where(
                TokenTransaction.created_at >= today_start,
                TokenTransaction.created_at < now,
            ),
        )
        or 0
    )
    previous_total_balance = total_balance - today_net_change

    return AdminTokenTransactionStatsResponse(
        today_consume=today_consume,
        today_topup=today_topup,
        month_consume=month_consume,
        total_balance=total_balance,
        today_consume_change_percent=_calculate_change_percent(
            today_consume,
            yesterday_consume,
        ),
        today_topup_change_percent=_calculate_change_percent(
            today_topup,
            yesterday_topup,
        ),
        month_consume_change_percent=_calculate_change_percent(
            month_consume,
            previous_month_consume,
        ),
        total_balance_change_percent=_calculate_change_percent(
            total_balance,
            previous_total_balance,
        ),
    )


def _sum_consumed_tokens(
    db: Session,
    *,
    start: datetime,
    end: datetime,
) -> int:
    consume_amount = case(
        (
            or_(
                TokenTransaction.transaction_type == "consume",
                TokenTransaction.amount < 0,
            ),
            func.abs(TokenTransaction.amount),
        ),
        else_=0,
    )
    statement = select(func.coalesce(func.sum(consume_amount), 0)).where(
        TokenTransaction.created_at >= start,
        TokenTransaction.created_at < end,
    )
    return int(db.scalar(statement) or 0)


def _sum_positive_tokens(
    db: Session,
    *,
    start: datetime,
    end: datetime,
) -> int:
    positive_amount = case(
        (TokenTransaction.amount > 0, TokenTransaction.amount),
        else_=0,
    )
    statement = select(func.coalesce(func.sum(positive_amount), 0)).where(
        TokenTransaction.created_at >= start,
        TokenTransaction.created_at < end,
    )
    return int(db.scalar(statement) or 0)


def _calculate_change_percent(current: int, previous: int) -> float | None:
    if previous <= 0:
        return None
    return round(((current - previous) / previous) * 100, 1)


def _month_start(value: datetime) -> datetime:
    return datetime(value.year, value.month, 1, tzinfo=timezone.utc)


def _shift_to_previous_month(value: datetime) -> datetime:
    if value.month == 1:
        return datetime(value.year - 1, 12, 1, tzinfo=timezone.utc)
    return datetime(value.year, value.month - 1, 1, tzinfo=timezone.utc)
