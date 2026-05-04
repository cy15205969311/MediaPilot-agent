from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import User
from app.models.schemas import (
    AdminNotificationListResponse,
    AdminNotificationReadAllResponse,
)
from app.services.admin_notifications import (
    list_admin_notifications,
    mark_all_admin_notifications_read,
)
from app.services.auth import RequireRole

router = APIRouter(prefix="/api/v1/admin", tags=["admin-notifications"])
require_admin_notification_role = RequireRole(
    ["super_admin", "admin", "finance", "operator"]
)


@router.get("/notifications", response_model=AdminNotificationListResponse)
async def get_admin_notifications(
    limit: int = Query(default=5, ge=1, le=20),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_notification_role),
) -> AdminNotificationListResponse:
    return list_admin_notifications(db, limit=limit)


@router.put(
    "/notifications/read_all",
    response_model=AdminNotificationReadAllResponse,
)
async def read_all_admin_notifications(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_notification_role),
) -> AdminNotificationReadAllResponse:
    response = mark_all_admin_notifications_read(db)
    db.commit()
    return response
