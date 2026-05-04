from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db.models import SystemNotification
from app.models.schemas import (
    AdminNotificationItem,
    AdminNotificationListResponse,
    AdminNotificationReadAllResponse,
    SystemNotificationType,
)


def append_system_notification(
    db: Session,
    *,
    notification_type: SystemNotificationType,
    title: str,
    content: str,
) -> SystemNotification:
    notification = SystemNotification(
        type=notification_type.value,
        title=title.strip(),
        content=content.strip(),
    )
    db.add(notification)
    return notification


def list_admin_notifications(
    db: Session,
    *,
    limit: int,
) -> AdminNotificationListResponse:
    rows = list(
        db.scalars(
            select(SystemNotification)
            .order_by(SystemNotification.created_at.desc())
            .limit(limit)
        ).all()
    )
    unread_count = int(
        db.scalar(
            select(func.count(SystemNotification.id)).where(
                SystemNotification.is_read.is_(False)
            )
        )
        or 0
    )
    return AdminNotificationListResponse(
        items=[
            AdminNotificationItem.model_validate(notification)
            for notification in rows
        ],
        unread_count=unread_count,
        limit=limit,
    )


def mark_all_admin_notifications_read(db: Session) -> AdminNotificationReadAllResponse:
    unread_count = int(
        db.scalar(
            select(func.count(SystemNotification.id)).where(
                SystemNotification.is_read.is_(False)
            )
        )
        or 0
    )
    if unread_count > 0:
        db.execute(
            update(SystemNotification)
            .where(SystemNotification.is_read.is_(False))
            .values(is_read=True)
        )
        db.flush()

    return AdminNotificationReadAllResponse(
        updated_count=unread_count,
        unread_count=0,
    )
