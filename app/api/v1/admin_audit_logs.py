from __future__ import annotations

import csv
import json
from datetime import date, datetime, time, timedelta, timezone
from io import StringIO

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import AuditLog, User
from app.models.schemas import (
    AdminAuditLogItem,
    AdminAuditLogListResponse,
    AuditActionType,
)
from app.services.auth import RequireRole

router = APIRouter(prefix="/api/v1/admin", tags=["admin-audit-logs"])
require_admin_audit_role = RequireRole(["super_admin", "admin"])
AUDIT_EXPORT_MAX_ROWS = 10_000


@router.get("/audit-logs", response_model=AdminAuditLogListResponse)
async def list_admin_audit_logs(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    operator_keyword: str | None = Query(default=None, max_length=64),
    action_type: AuditActionType | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_audit_role),
) -> AdminAuditLogListResponse:
    filters = _build_audit_log_filters(
        operator_keyword=operator_keyword,
        action_type=action_type,
        start_date=start_date,
        end_date=end_date,
    )

    count_statement = select(func.count(AuditLog.id)).select_from(AuditLog)
    list_statement = (
        select(AuditLog)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset(skip)
        .limit(limit)
    )

    for condition in filters:
        count_statement = count_statement.where(condition)
        list_statement = list_statement.where(condition)

    total = int(db.scalar(count_statement) or 0)
    rows = list(db.scalars(list_statement).all())

    return AdminAuditLogListResponse(
        items=[_build_admin_audit_log_item(row) for row in rows],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/audit-logs/export")
async def export_admin_audit_logs(
    operator_keyword: str | None = Query(default=None, max_length=64),
    action_type: AuditActionType | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_audit_role),
) -> StreamingResponse:
    filters = _build_audit_log_filters(
        operator_keyword=operator_keyword,
        action_type=action_type,
        start_date=start_date,
        end_date=end_date,
    )

    statement = (
        select(AuditLog)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(AUDIT_EXPORT_MAX_ROWS)
    )
    for condition in filters:
        statement = statement.where(condition)

    rows = list(db.scalars(statement).all())

    buffer = StringIO()
    buffer.write("\ufeff")
    writer = csv.writer(buffer)
    writer.writerow(["Time", "Operator", "Action Type", "Target Name", "Target ID", "Details"])

    for row in rows:
        writer.writerow(
            [
                _format_csv_datetime(row.created_at),
                row.operator_name,
                row.action_type,
                row.target_name,
                row.target_id or "",
                json.dumps(row.details or {}, ensure_ascii=False, sort_keys=True),
            ],
        )

    filename = f"audit_logs_export_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
    }
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers=headers,
    )


def _build_audit_log_filters(
    *,
    operator_keyword: str | None,
    action_type: AuditActionType | None,
    start_date: date | None,
    end_date: date | None,
) -> list[object]:
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date cannot be later than end_date.")

    filters: list[object] = []
    normalized_operator_keyword = (operator_keyword or "").strip()
    if normalized_operator_keyword:
        filters.append(AuditLog.operator_name.ilike(f"%{normalized_operator_keyword}%"))

    if action_type is not None:
        filters.append(AuditLog.action_type == action_type.value)

    if start_date is not None:
        filters.append(AuditLog.created_at >= _day_start(start_date))

    if end_date is not None:
        filters.append(AuditLog.created_at < _day_start(end_date + timedelta(days=1)))

    return filters


def _build_admin_audit_log_item(row: AuditLog) -> AdminAuditLogItem:
    return AdminAuditLogItem(
        id=row.id,
        operator_id=row.operator_id,
        operator_name=row.operator_name,
        action_type=row.action_type,
        target_id=row.target_id,
        target_name=row.target_name,
        details=row.details or {},
        created_at=row.created_at,
    )


def _day_start(day: date) -> datetime:
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


def _format_csv_datetime(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")
