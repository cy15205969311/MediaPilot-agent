from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import SystemSetting
from app.models.schemas import (
    AdminSystemSettingItem,
    AdminSystemSettingsResponse,
    AuditActionType,
)


@dataclass(frozen=True)
class SystemSettingDefinition:
    key: str
    category: str
    description: str
    default_value: Any
    allow_blank: bool = False


SYSTEM_SETTING_DEFINITIONS: tuple[SystemSettingDefinition, ...] = (
    SystemSettingDefinition(
        key="system_name",
        category="basic",
        description="平台名称，会在后台页眉和运营文案中展示。",
        default_value="OmniMedia Console",
    ),
    SystemSettingDefinition(
        key="admin_email",
        category="basic",
        description="默认管理邮箱，用于接收平台通知和人工联络。",
        default_value="admin@omnimedia.com",
    ),
    SystemSettingDefinition(
        key="timezone",
        category="basic",
        description="后台默认展示时区。",
        default_value="UTC+8 (北京时间)",
    ),
    SystemSettingDefinition(
        key="language",
        category="basic",
        description="后台默认语言。",
        default_value="简体中文",
    ),
    SystemSettingDefinition(
        key="token_price",
        category="token",
        description="平台 Token 单价。",
        default_value=0.008,
    ),
    SystemSettingDefinition(
        key="new_user_bonus",
        category="token",
        description="普通新用户注册或后台新建时默认发放的初始 Token。",
        default_value=10_000_000,
    ),
    SystemSettingDefinition(
        key="daily_free_quota",
        category="token",
        description="平台给普通用户预留的每日免费额度。",
        default_value=100,
    ),
    SystemSettingDefinition(
        key="minimum_topup",
        category="token",
        description="平台允许的最低充值基线。",
        default_value=10_000,
    ),
    SystemSettingDefinition(
        key="two_factor_auth",
        category="security",
        description="是否启用后台双因素认证。",
        default_value=True,
    ),
    SystemSettingDefinition(
        key="ip_whitelist_enabled",
        category="security",
        description="是否启用 IP 白名单。",
        default_value=False,
    ),
    SystemSettingDefinition(
        key="ip_whitelist_ips",
        category="security",
        description="允许访问后台的 IP 白名单，多个 IP 以逗号分隔。",
        default_value="",
        allow_blank=True,
    ),
    SystemSettingDefinition(
        key="login_captcha_enabled",
        category="security",
        description="是否启用登录验证码。",
        default_value=True,
    ),
    SystemSettingDefinition(
        key="session_timeout_enabled",
        category="security",
        description="是否启用后台会话超时保护。",
        default_value=True,
    ),
    SystemSettingDefinition(
        key="session_timeout_minutes",
        category="security",
        description="后台无操作自动登出的超时时间，单位为分钟。",
        default_value=120,
    ),
    SystemSettingDefinition(
        key="user_signup_notification",
        category="notification",
        description="是否推送用户注册通知。",
        default_value=True,
    ),
    SystemSettingDefinition(
        key="anomaly_alert_notification",
        category="notification",
        description="是否推送异常告警通知。",
        default_value=True,
    ),
    SystemSettingDefinition(
        key="system_maintenance_notification",
        category="notification",
        description="是否推送系统维护通知。",
        default_value=False,
    ),
    SystemSettingDefinition(
        key="daily_report_notification",
        category="notification",
        description="是否推送每日报表。",
        default_value=True,
    ),
)

SYSTEM_SETTING_DEFINITION_MAP = {
    definition.key: definition for definition in SYSTEM_SETTING_DEFINITIONS
}

SYSTEM_SETTING_KEY_ALIASES = {
    "ip_allowlist_enabled": "ip_whitelist_enabled",
}


def seed_default_system_settings(
    db: Session,
    *,
    commit: bool,
) -> None:
    tracked_keys = set(SYSTEM_SETTING_DEFINITION_MAP) | set(SYSTEM_SETTING_KEY_ALIASES)
    existing_settings = {
        item.key: item
        for item in db.scalars(
            select(SystemSetting).where(
                SystemSetting.key.in_(list(tracked_keys))
            )
        ).all()
    }

    has_changes = False
    for definition in SYSTEM_SETTING_DEFINITIONS:
        setting = existing_settings.get(definition.key)
        legacy_setting = next(
            (
                existing_settings[legacy_key]
                for legacy_key, canonical_key in SYSTEM_SETTING_KEY_ALIASES.items()
                if canonical_key == definition.key and legacy_key in existing_settings
            ),
            None,
        )
        if setting is None:
            db.add(
                SystemSetting(
                    key=definition.key,
                    value=(
                        _coerce_setting_value(definition, legacy_setting.value)
                        if legacy_setting is not None
                        else definition.default_value
                    ),
                    category=definition.category,
                    description=definition.description,
                )
            )
            has_changes = True
            continue

        if setting.category != definition.category:
            setting.category = definition.category
            has_changes = True
        if setting.description != definition.description:
            setting.description = definition.description
            has_changes = True

    if not has_changes:
        return

    if commit:
        db.commit()
    else:
        db.flush()


def build_admin_system_settings_response(db: Session) -> AdminSystemSettingsResponse:
    rows = list(
        db.scalars(
            select(SystemSetting).order_by(SystemSetting.category.asc(), SystemSetting.key.asc())
        ).all()
    )
    grouped: dict[str, list[AdminSystemSettingItem]] = {}
    for row in rows:
        if row.key in SYSTEM_SETTING_KEY_ALIASES:
            continue
        definition = SYSTEM_SETTING_DEFINITION_MAP.get(row.key)
        default_value = definition.default_value if definition is not None else row.value
        grouped.setdefault(row.category, []).append(
            AdminSystemSettingItem(
                key=row.key,
                value=row.value,
                default_value=default_value,
                category=row.category,
                description=row.description,
            )
        )
    return AdminSystemSettingsResponse(categories=grouped)


def update_system_settings(
    db: Session,
    updates: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    if not updates:
        raise HTTPException(status_code=400, detail="请至少提交一项系统配置。")

    normalized_updates: dict[str, Any] = {}
    for key, value in updates.items():
        normalized_key = SYSTEM_SETTING_KEY_ALIASES.get(key, key)
        normalized_updates[normalized_key] = value

    unknown_keys = [
        key for key in normalized_updates if key not in SYSTEM_SETTING_DEFINITION_MAP
    ]
    if unknown_keys:
        raise HTTPException(
            status_code=400,
            detail=f"存在未注册的系统配置键：{', '.join(sorted(unknown_keys))}",
        )

    settings = {
        item.key: item
        for item in db.scalars(
            select(SystemSetting).where(SystemSetting.key.in_(list(normalized_updates.keys())))
        ).all()
    }

    changes: dict[str, dict[str, Any]] = {}
    for key, raw_value in normalized_updates.items():
        definition = SYSTEM_SETTING_DEFINITION_MAP[key]
        setting = settings.get(key)
        if setting is None:
            setting = SystemSetting(
                key=definition.key,
                value=definition.default_value,
                category=definition.category,
                description=definition.description,
            )
            db.add(setting)
            settings[key] = setting

        next_value = _coerce_setting_value(definition, raw_value)
        previous_value = setting.value
        setting.value = next_value
        setting.category = definition.category
        setting.description = definition.description

        if previous_value != next_value:
            changes[key] = {
                "previous_value": previous_value,
                "next_value": next_value,
                "category": definition.category,
            }

    db.flush()
    return changes


def build_system_settings_rollback_updates(
    details: dict[str, Any],
) -> dict[str, Any]:
    raw_changes = details.get("changes")
    if not isinstance(raw_changes, dict):
        raise HTTPException(status_code=400, detail="当前审计快照不包含可回滚的配置变更。")

    rollback_updates: dict[str, Any] = {}
    for raw_key, raw_change in raw_changes.items():
        if not isinstance(raw_key, str) or not isinstance(raw_change, dict):
            continue

        key = SYSTEM_SETTING_KEY_ALIASES.get(raw_key, raw_key)
        if key not in SYSTEM_SETTING_DEFINITION_MAP:
            continue

        if "old_value" in raw_change:
            rollback_updates[key] = raw_change["old_value"]
            continue

        if "previous_value" in raw_change:
            rollback_updates[key] = raw_change["previous_value"]

    if not rollback_updates:
        raise HTTPException(status_code=400, detail="当前审计快照不包含可回滚的旧值。")

    return rollback_updates


def ensure_audit_log_supports_settings_rollback(action_type: str) -> None:
    if action_type != AuditActionType.UPDATE_SYSTEM_SETTINGS.value:
        raise HTTPException(status_code=400, detail="仅系统设置修改日志支持一键回滚。")


def get_int_system_setting(
    db: Session,
    key: str,
    *,
    fallback: int = 0,
) -> int:
    key = SYSTEM_SETTING_KEY_ALIASES.get(key, key)
    definition = SYSTEM_SETTING_DEFINITION_MAP.get(key)
    if definition is None:
        return fallback

    setting = db.get(SystemSetting, key)
    if setting is None:
        seed_default_system_settings(db, commit=False)
        setting = db.get(SystemSetting, key)
    if setting is None:
        return fallback

    try:
        return int(setting.value)
    except (TypeError, ValueError):
        try:
            return int(definition.default_value)
        except (TypeError, ValueError):
            return fallback


def _coerce_setting_value(
    definition: SystemSettingDefinition,
    raw_value: Any,
) -> Any:
    default_value = definition.default_value

    if isinstance(default_value, bool):
        return _coerce_bool_value(raw_value, key=definition.key)

    if isinstance(default_value, int) and not isinstance(default_value, bool):
        return _coerce_int_value(raw_value, key=definition.key)

    if isinstance(default_value, float):
        return _coerce_float_value(raw_value, key=definition.key)

    normalized = str(raw_value or "").strip()
    if not normalized and not definition.allow_blank:
        raise HTTPException(status_code=400, detail=f"{definition.key} 不能为空。")
    return normalized


def _coerce_bool_value(raw_value: Any, *, key: str) -> bool:
    if isinstance(raw_value, bool):
        return raw_value

    if isinstance(raw_value, (int, float)):
        return bool(raw_value)

    normalized = str(raw_value or "").strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False

    raise HTTPException(status_code=400, detail=f"{key} 需要布尔值。")


def _coerce_int_value(raw_value: Any, *, key: str) -> int:
    try:
        if isinstance(raw_value, bool):
            raise ValueError
        value = int(str(raw_value).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{key} 需要整数值。") from None

    if key == "session_timeout_minutes" and value < 1:
        raise HTTPException(status_code=400, detail=f"{key} 需要大于等于 1。")
    if value < 0:
        raise HTTPException(status_code=400, detail=f"{key} 不能小于 0。")
    return value


def _coerce_float_value(raw_value: Any, *, key: str) -> float:
    try:
        if isinstance(raw_value, bool):
            raise ValueError
        value = float(str(raw_value).strip())
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{key} 需要数字值。") from None

    if value < 0:
        raise HTTPException(status_code=400, detail=f"{key} 不能小于 0。")
    return value
