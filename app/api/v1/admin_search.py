from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import AuditLog, Template, User
from app.models.schemas import (
    AdminGlobalSearchAuditLogItem,
    AdminGlobalSearchResponse,
    AdminGlobalSearchTemplateItem,
    AdminGlobalSearchUserItem,
    AdminTemplatePlatform,
    TemplatePlatform,
)
from app.services.auth import RequireRole

router = APIRouter(prefix="/api/v1/admin", tags=["admin-search"])
require_admin_search_role = RequireRole(["super_admin", "admin", "finance", "operator"])


def _map_template_platform(platform: str) -> AdminTemplatePlatform:
    if platform == TemplatePlatform.XIAOHONGSHU.value:
        return AdminTemplatePlatform.XIAOHONGSHU
    if platform == TemplatePlatform.DOUYIN.value:
        return AdminTemplatePlatform.DOUYIN
    return AdminTemplatePlatform.GENERAL


@router.get("/global-search", response_model=AdminGlobalSearchResponse)
async def global_admin_search(
    q: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(default=3, ge=1, le=5),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_search_role),
) -> AdminGlobalSearchResponse:
    keyword = q.strip()
    if not keyword:
        return AdminGlobalSearchResponse()

    user_rows = list(
        db.scalars(
            select(User)
            .where(
                or_(
                    User.username.ilike(f"%{keyword}%"),
                    User.id == keyword,
                )
            )
            .order_by(User.created_at.desc())
            .limit(limit)
        ).all()
    )

    template_rows = list(
        db.scalars(
            select(Template)
            .where(
                Template.user_id.is_(None),
                or_(
                    Template.title.ilike(f"%{keyword}%"),
                    Template.id == keyword,
                ),
            )
            .order_by(Template.created_at.desc())
            .limit(limit)
        ).all()
    )

    audit_rows = list(
        db.scalars(
            select(AuditLog)
            .where(
                or_(
                    AuditLog.action_type.ilike(f"%{keyword}%"),
                    AuditLog.operator_name.ilike(f"%{keyword}%"),
                )
            )
            .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
            .limit(limit)
        ).all()
    )

    return AdminGlobalSearchResponse(
        users=[
            AdminGlobalSearchUserItem(
                id=row.id,
                username=row.username,
                nickname=row.nickname,
                role=row.role,
                status=row.status,
            )
            for row in user_rows
        ],
        templates=[
            AdminGlobalSearchTemplateItem(
                id=row.id,
                title=row.title,
                platform=_map_template_platform(row.platform),
                is_preset=row.is_preset,
            )
            for row in template_rows
        ],
        audit_logs=[
            AdminGlobalSearchAuditLogItem(
                id=row.id,
                action_type=row.action_type,
                operator_name=row.operator_name,
                target_name=row.target_name,
                created_at=row.created_at,
            )
            for row in audit_rows
        ],
    )
