from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.security import refresh_security_settings_cache
from app.db.database import get_db
from app.db.models import AuditLog, User
from app.models.schemas import (
    AdminSystemSettingsResponse,
    AdminSystemSettingsRollbackResponse,
    AuditActionType,
)
from app.models.schemas import SystemNotificationType
from app.services.admin_notifications import append_system_notification
from app.services.audit_logs import append_audit_log
from app.services.auth import RequireRole
from app.services.system_settings import (
    build_system_settings_rollback_updates,
    build_admin_system_settings_response,
    ensure_audit_log_supports_settings_rollback,
    seed_default_system_settings,
    update_system_settings,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin-settings"])
require_admin_settings_role = RequireRole(["super_admin"])


@router.get("/settings", response_model=AdminSystemSettingsResponse)
async def get_admin_system_settings(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_settings_role),
) -> AdminSystemSettingsResponse:
    seed_default_system_settings(db, commit=True)
    return build_admin_system_settings_response(db)


@router.put("/settings", response_model=AdminSystemSettingsResponse)
async def update_admin_system_settings(
    payload: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_settings_role),
) -> AdminSystemSettingsResponse:
    try:
        seed_default_system_settings(db, commit=False)
        changes = update_system_settings(db, payload)
        if changes:
            append_audit_log(
                db=db,
                operator=current_user,
                action_type=AuditActionType.UPDATE_SYSTEM_SETTINGS.value,
                target_id="system_settings",
                target_name="系统配置",
                details={
                    "changed_keys": list(changes.keys()),
                    "changes": changes,
                },
            )
            append_system_notification(
                db,
                notification_type=SystemNotificationType.WARNING,
                title="系统设置已更新",
                content=(
                    f"管理员 {current_user.username} 更新了 {len(changes)} 项系统配置："
                    f"{', '.join(changes.keys())}"
                ),
            )
        db.commit()
        refresh_security_settings_cache(db)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="保存系统配置失败，请稍后重试。",
        ) from exc

    return build_admin_system_settings_response(db)


@router.post(
    "/settings/rollback/{audit_log_id}",
    response_model=AdminSystemSettingsRollbackResponse,
)
async def rollback_admin_system_settings(
    audit_log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_settings_role),
) -> AdminSystemSettingsRollbackResponse:
    rollback_audit_log = None

    try:
        seed_default_system_settings(db, commit=False)
        snapshot_log = db.get(AuditLog, audit_log_id)
        if snapshot_log is None:
            raise HTTPException(status_code=400, detail="未找到可回滚的系统设置审计快照。")

        ensure_audit_log_supports_settings_rollback(snapshot_log.action_type)
        rollback_updates = build_system_settings_rollback_updates(snapshot_log.details or {})
        rollback_changes = update_system_settings(db, rollback_updates)
        if not rollback_changes:
            raise HTTPException(status_code=400, detail="当前配置已是该状态，无需回滚。")

        rollback_audit_log = append_audit_log(
            db=db,
            operator=current_user,
            action_type=AuditActionType.ROLLBACK_SYSTEM_SETTINGS.value,
            target_id="system_settings",
            target_name="系统配置",
            details={
                "changed_keys": list(rollback_changes.keys()),
                "changes": rollback_changes,
                "snapshot_audit_log_id": snapshot_log.id,
                "remark": f"回滚至快照 [{snapshot_log.id}] 的状态",
            },
        )
        append_system_notification(
            db,
            notification_type=SystemNotificationType.WARNING,
            title="系统配置已回滚",
            content=(
                f"管理员 {current_user.username} 已将系统配置回滚至快照 "
                f"{snapshot_log.id}，共恢复 {len(rollback_changes)} 项设置。"
            ),
        )
        db.flush()
        db.commit()
        refresh_security_settings_cache(db)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="系统设置回滚失败，请稍后重试。",
        ) from exc

    return AdminSystemSettingsRollbackResponse(
        snapshot_audit_log_id=snapshot_log.id,
        rollback_audit_log_id=rollback_audit_log.id if rollback_audit_log is not None else "",
        rolled_back_keys=list(rollback_changes.keys()),
    )
