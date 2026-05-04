from __future__ import annotations

from app.db.models import AuditLog, User


def get_audit_actor_name(user: User | None) -> str:
    if user is None:
        return "system"

    nickname = (user.nickname or "").strip()
    if nickname:
        return nickname
    return user.username


def get_audit_target_name(user: User | None) -> str:
    if user is None:
        return ""

    nickname = (user.nickname or "").strip()
    if nickname:
        return nickname
    return user.username


def append_audit_log(
    *,
    db,
    operator: User | None,
    action_type: str,
    target_id: str | None,
    target_name: str,
    details: dict[str, object] | None = None,
) -> AuditLog:
    audit_log = AuditLog(
        operator_id=operator.id if operator is not None else None,
        operator_name=get_audit_actor_name(operator),
        action_type=action_type,
        target_id=target_id,
        target_name=target_name,
        details=details or {},
    )
    db.add(audit_log)
    return audit_log
