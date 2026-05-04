from __future__ import annotations

import ipaddress
import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import SystemSetting
from app.services.system_settings import (
    SYSTEM_SETTING_KEY_ALIASES,
    seed_default_system_settings,
)

logger = logging.getLogger(__name__)
LOCAL_SAFE_IPS = frozenset({"127.0.0.1", "::1", "localhost", "testclient"})
SECURITY_SETTING_KEYS = frozenset(
    {
        "ip_whitelist_enabled",
        "ip_whitelist_ips",
        "session_timeout_enabled",
        "session_timeout_minutes",
        *SYSTEM_SETTING_KEY_ALIASES.keys(),
    }
)


@dataclass(frozen=True)
class SecuritySettingsSnapshot:
    ip_whitelist_enabled: bool
    ip_whitelist_ips: tuple[str, ...]
    session_timeout_enabled: bool
    session_timeout_minutes: int


_security_settings_cache: dict[str, SecuritySettingsSnapshot] = {}


def invalidate_security_settings_cache(db: Session | None = None) -> None:
    if db is None:
        _security_settings_cache.clear()
        return

    _security_settings_cache.pop(_get_bind_cache_key(db), None)


def get_security_settings(
    db: Session,
    *,
    force_refresh: bool = False,
) -> SecuritySettingsSnapshot:
    cache_key = _get_bind_cache_key(db)
    if force_refresh or cache_key not in _security_settings_cache:
        _security_settings_cache[cache_key] = _load_security_settings(db)
    return _security_settings_cache[cache_key]


def refresh_security_settings_cache(db: Session) -> SecuritySettingsSnapshot:
    return get_security_settings(db, force_refresh=True)


def get_access_token_expiry_minutes(
    db: Session,
    *,
    default_minutes: int,
) -> int:
    settings = get_security_settings(db)
    if not settings.session_timeout_enabled:
        return default_minutes
    return max(settings.session_timeout_minutes, 1)


def is_client_ip_allowed(
    client_ip: str | None,
    settings: SecuritySettingsSnapshot,
) -> bool:
    if not settings.ip_whitelist_enabled:
        return True

    if _is_local_safe_ip(client_ip):
        return True

    if not settings.ip_whitelist_ips:
        logger.warning(
            "security.ip_whitelist_enabled_without_entries skipping enforcement to avoid lockout"
        )
        return True

    normalized_client_ip = _normalize_ip_value(client_ip)
    if normalized_client_ip is None:
        return False

    return normalized_client_ip in settings.ip_whitelist_ips


def _load_security_settings(db: Session) -> SecuritySettingsSnapshot:
    seed_default_system_settings(db, commit=False)
    rows = list(
        db.scalars(
            select(SystemSetting).where(SystemSetting.key.in_(list(SECURITY_SETTING_KEYS)))
        ).all()
    )
    values = {row.key: row.value for row in rows}

    ip_whitelist_enabled = _coerce_bool(
        values.get(
            "ip_whitelist_enabled",
            values.get("ip_allowlist_enabled", False),
        )
    )
    session_timeout_enabled = _coerce_bool(values.get("session_timeout_enabled", True))
    session_timeout_minutes = max(
        _coerce_int(values.get("session_timeout_minutes", 120), fallback=120),
        1,
    )

    return SecuritySettingsSnapshot(
        ip_whitelist_enabled=ip_whitelist_enabled,
        ip_whitelist_ips=_parse_ip_whitelist(values.get("ip_whitelist_ips", "")),
        session_timeout_enabled=session_timeout_enabled,
        session_timeout_minutes=session_timeout_minutes,
    )


def _get_bind_cache_key(db: Session) -> str:
    bind = db.get_bind()
    return str(getattr(bind, "url", bind))


def _coerce_bool(raw_value: object) -> bool:
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, (int, float)):
        return bool(raw_value)

    normalized = str(raw_value or "").strip().lower()
    return normalized in {"1", "true", "yes", "on"}


def _coerce_int(raw_value: object, *, fallback: int) -> int:
    try:
        if isinstance(raw_value, bool):
            raise ValueError
        return int(str(raw_value).strip())
    except (TypeError, ValueError):
        return fallback


def _parse_ip_whitelist(raw_value: object) -> tuple[str, ...]:
    values: list[str] = []
    seen: set[str] = set()
    normalized_input = str(raw_value or "").replace("\n", ",")

    for part in normalized_input.split(","):
        normalized = _normalize_ip_value(part)
        if normalized is None or normalized in seen:
            continue
        seen.add(normalized)
        values.append(normalized)

    return tuple(values)


def _normalize_ip_value(raw_value: object) -> str | None:
    value = str(raw_value or "").strip()
    if not value:
        return None

    try:
        return ipaddress.ip_address(value).compressed
    except ValueError:
        logger.warning("security.invalid_ip_whitelist_entry entry=%s", value)
        return None


def _is_local_safe_ip(raw_value: str | None) -> bool:
    normalized = (raw_value or "").strip().lower()
    if not normalized:
        return False
    if normalized in LOCAL_SAFE_IPS:
        return True

    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False
