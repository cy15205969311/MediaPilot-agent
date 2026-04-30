import os
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import load_environment
from app.db.database import get_db
from app.db.models import (
    AccessTokenBlacklist,
    RefreshSession,
    User,
    utcnow,
)

load_environment()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-this-secret-in-production")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
JWT_ACCESS_EXPIRE_MINUTES = int(
    os.getenv("JWT_ACCESS_EXPIRE_MINUTES", os.getenv("JWT_EXPIRE_MINUTES", "30")),
)
JWT_REFRESH_EXPIRE_DAYS = int(os.getenv("JWT_REFRESH_EXPIRE_DAYS", "7"))
JWT_PASSWORD_RESET_EXPIRE_MINUTES = int(
    os.getenv("JWT_PASSWORD_RESET_EXPIRE_MINUTES", "15"),
)

ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"
PASSWORD_RESET_TOKEN_TYPE = "reset"
SESSION_LAST_SEEN_UPDATE_WINDOW = timedelta(minutes=1)
logger = logging.getLogger(__name__)
PRECISE_ISSUED_AT_CLAIM = "iat_exact"


@dataclass(frozen=True)
class DecodedToken:
    subject: str
    token_type: str
    jti: str
    issued_at: datetime
    expires_at: datetime
    session_jti: str | None = None


@dataclass(frozen=True)
class IssuedToken:
    token: str
    jti: str
    issued_at: datetime
    expires_at: datetime


def _credentials_exception(message: str = "当前登录状态已失效，请重新登录。") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=message,
        headers={"WWW-Authenticate": "Bearer"},
    )


def normalize_username(username: str) -> str:
    return username.strip()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return pwd_context.verify(password, hashed_password)


def _create_token(
    *,
    subject: str,
    token_type: str,
    expires_delta: timedelta,
    session_jti: str | None = None,
) -> IssuedToken:
    issued_at = datetime.now(timezone.utc)
    expires_at = issued_at + expires_delta
    jti = uuid4().hex
    payload: dict[str, object] = {
        "sub": subject,
        "type": token_type,
        "iat": issued_at,
        PRECISE_ISSUED_AT_CLAIM: issued_at.isoformat(),
        "exp": expires_at,
        "jti": jti,
    }
    if session_jti:
        payload["session_jti"] = session_jti
    return IssuedToken(
        token=jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM),
        jti=jti,
        issued_at=issued_at,
        expires_at=expires_at,
    )


def create_access_token(*, subject: str, session_jti: str | None = None) -> IssuedToken:
    return _create_token(
        subject=subject,
        token_type=ACCESS_TOKEN_TYPE,
        expires_delta=timedelta(minutes=JWT_ACCESS_EXPIRE_MINUTES),
        session_jti=session_jti,
    )


def create_refresh_token(*, subject: str) -> IssuedToken:
    return _create_token(
        subject=subject,
        token_type=REFRESH_TOKEN_TYPE,
        expires_delta=timedelta(days=JWT_REFRESH_EXPIRE_DAYS),
    )


def create_password_reset_token(username: str) -> str:
    normalized_username = normalize_username(username)
    return _create_token(
        subject=normalized_username,
        token_type=PASSWORD_RESET_TOKEN_TYPE,
        expires_delta=timedelta(minutes=JWT_PASSWORD_RESET_EXPIRE_MINUTES),
    ).token


def verify_password_reset_token(token: str) -> str | None:
    try:
        return decode_token_payload(
            token=token,
            expected_token_type=PASSWORD_RESET_TOKEN_TYPE,
        ).subject
    except HTTPException:
        return None


def _parse_expiration(raw_expiration: object) -> datetime:
    if isinstance(raw_expiration, datetime):
        if raw_expiration.tzinfo is None:
            return raw_expiration.replace(tzinfo=timezone.utc)
        return raw_expiration.astimezone(timezone.utc)

    if isinstance(raw_expiration, (int, float)):
        return datetime.fromtimestamp(raw_expiration, tz=timezone.utc)

    raise _credentials_exception()


def _parse_precise_issued_at(raw_precise_issued_at: object) -> datetime | None:
    if not isinstance(raw_precise_issued_at, str) or not raw_precise_issued_at.strip():
        return None

    try:
        parsed = datetime.fromisoformat(raw_precise_issued_at)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def decode_token_payload(
    *,
    token: str,
    expected_token_type: str | None = None,
) -> DecodedToken:
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise _credentials_exception() from exc

    subject = payload.get("sub")
    token_type = payload.get("type")
    jti = payload.get("jti")
    issued_at = _parse_precise_issued_at(payload.get(PRECISE_ISSUED_AT_CLAIM))
    if issued_at is None:
        issued_at = _parse_expiration(payload.get("iat"))
    expires_at = _parse_expiration(payload.get("exp"))
    session_jti = payload.get("session_jti")

    if not isinstance(subject, str) or not subject:
        raise _credentials_exception()
    if not isinstance(token_type, str) or not token_type:
        raise _credentials_exception()
    if not isinstance(jti, str) or not jti:
        raise _credentials_exception()
    if expected_token_type is not None and token_type != expected_token_type:
        raise _credentials_exception("令牌类型无效，请重新登录。")
    if session_jti is not None and not isinstance(session_jti, str):
        raise _credentials_exception()

    return DecodedToken(
        subject=subject,
        token_type=token_type,
        jti=jti,
        issued_at=issued_at,
        expires_at=expires_at,
        session_jti=session_jti,
    )


def decode_token_subject(*, token: str, expected_token_type: str) -> str:
    return decode_token_payload(
        token=token,
        expected_token_type=expected_token_type,
    ).subject


def get_user_by_username(db: Session, username: str) -> User | None:
    normalized_username = normalize_username(username)
    if not normalized_username:
        return None

    return db.scalar(select(User).where(User.username == normalized_username))


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = get_user_by_username(db, username)
    if user is None:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


def _build_device_info(user_agent: str | None) -> str | None:
    raw = (user_agent or "").strip()
    if not raw:
        return None

    browser = "Unknown browser"
    browser_rules = (
        ("Edg/", "Edge"),
        ("Chrome/", "Chrome"),
        ("Firefox/", "Firefox"),
        ("Safari/", "Safari"),
        ("testclient", "TestClient"),
        ("curl/", "curl"),
    )
    for marker, label in browser_rules:
        if marker.lower() in raw.lower():
            browser = label
            break

    os_name = "Unknown OS"
    os_rules = (
        ("Windows", "Windows"),
        ("Mac OS X", "macOS"),
        ("iPhone", "iOS"),
        ("iPad", "iPadOS"),
        ("Android", "Android"),
        ("Linux", "Linux"),
    )
    for marker, label in os_rules:
        if marker.lower() in raw.lower():
            os_name = label
            break

    if browser == "Unknown browser" and os_name == "Unknown OS":
        return raw[:180]
    return f"{browser} · {os_name}"


def extract_client_ip(request: Request) -> str | None:
    forwarded_for = request.headers.get("x-forwarded-for", "").strip()
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip() or None

    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return real_ip

    return request.client.host if request.client else None


def extract_device_info(request: Request) -> str | None:
    return _build_device_info(request.headers.get("user-agent"))


def issue_token_pair(
    db: Session,
    *,
    user_id: str,
    device_info: str | None = None,
    ip_address: str | None = None,
) -> tuple[str, str]:
    refresh_token = create_refresh_token(subject=user_id)
    access_token = create_access_token(
        subject=user_id,
        session_jti=refresh_token.jti,
    )

    refresh_session = RefreshSession(
        user_id=user_id,
        refresh_token_jti=refresh_token.jti,
        latest_access_jti=access_token.jti,
        device_info=device_info,
        ip_address=ip_address,
        expires_at=refresh_token.expires_at,
        last_seen_at=datetime.now(timezone.utc),
    )
    db.add(refresh_session)
    db.flush()

    return access_token.token, refresh_token.token


def validate_refresh_session(
    db: Session,
    *,
    user_id: str,
    refresh_token: str,
) -> RefreshSession:
    refresh_payload = decode_token_payload(
        token=refresh_token,
        expected_token_type=REFRESH_TOKEN_TYPE,
    )
    if refresh_payload.subject != user_id:
        raise _credentials_exception("刷新令牌与当前用户不匹配。")

    refresh_session = db.scalar(
        select(RefreshSession).where(
            RefreshSession.user_id == user_id,
            RefreshSession.refresh_token_jti == refresh_payload.jti,
        )
    )
    if refresh_session is None or refresh_session.is_revoked:
        raise _credentials_exception("刷新令牌已失效，请重新登录。")
    if refresh_session.expires_at <= datetime.now(timezone.utc):
        refresh_session.is_revoked = True
        db.flush()
        raise _credentials_exception("刷新令牌已过期，请重新登录。")

    return refresh_session


def revoke_refresh_session(
    db: Session,
    *,
    user_id: str,
    refresh_token: str,
    allow_missing: bool = False,
) -> bool:
    refresh_payload = decode_token_payload(
        token=refresh_token,
        expected_token_type=REFRESH_TOKEN_TYPE,
    )
    if refresh_payload.subject != user_id:
        raise _credentials_exception("刷新令牌与当前用户不匹配。")

    refresh_session = db.scalar(
        select(RefreshSession).where(
            RefreshSession.user_id == user_id,
            RefreshSession.refresh_token_jti == refresh_payload.jti,
        )
    )
    if refresh_session is None:
        if allow_missing:
            return False
        raise _credentials_exception("刷新令牌已失效，请重新登录。")
    if refresh_session.is_revoked:
        return False

    refresh_session.is_revoked = True
    refresh_session.last_seen_at = datetime.now(timezone.utc)
    db.flush()
    return True


def revoke_refresh_session_by_id(
    db: Session,
    *,
    user_id: str,
    session_id: str,
) -> RefreshSession:
    session = db.scalar(
        select(RefreshSession).where(
            RefreshSession.id == session_id,
            RefreshSession.user_id == user_id,
        )
    )
    if session is None:
        raise HTTPException(status_code=404, detail="未找到对应登录会话。")

    if not session.is_revoked:
        session.is_revoked = True
        session.last_seen_at = datetime.now(timezone.utc)
        db.flush()

    return session


def blacklist_access_token_jti(
    db: Session,
    *,
    jti: str | None,
    expires_at: datetime | None,
) -> bool:
    normalized_jti = (jti or "").strip()
    if not normalized_jti or expires_at is None:
        return False

    existing_entry = db.scalar(
        select(AccessTokenBlacklist).where(AccessTokenBlacklist.jti == normalized_jti)
    )
    if existing_entry is not None:
        if expires_at > existing_entry.expires_at:
            existing_entry.expires_at = expires_at
            db.flush()
        return False

    db.add(
        AccessTokenBlacklist(
            jti=normalized_jti,
            expires_at=expires_at,
        )
    )
    db.flush()
    return True


def blacklist_access_token_payload(
    db: Session,
    *,
    token_payload: DecodedToken | None,
) -> bool:
    if token_payload is None:
        return False
    return blacklist_access_token_jti(
        db,
        jti=token_payload.jti,
        expires_at=token_payload.expires_at,
    )


def is_access_token_blacklisted(
    db: Session,
    *,
    jti: str,
) -> bool:
    now = datetime.now(timezone.utc)
    entry = db.scalar(
        select(AccessTokenBlacklist).where(AccessTokenBlacklist.jti == jti)
    )
    if entry is None:
        return False
    return entry.expires_at > now


def mark_user_password_changed(user: User) -> datetime:
    changed_at = utcnow()
    user.password_changed_at = changed_at
    return changed_at


def revoke_other_refresh_sessions(
    db: Session,
    *,
    user_id: str,
    keep_session_jti: str | None = None,
) -> int:
    active_sessions = list(
        db.scalars(
            select(RefreshSession).where(
                RefreshSession.user_id == user_id,
                RefreshSession.is_revoked.is_(False),
            )
        ).all()
    )

    now = datetime.now(timezone.utc)
    revoked_count = 0

    for session in active_sessions:
        if keep_session_jti and session.refresh_token_jti == keep_session_jti:
            session.last_seen_at = now
            continue

        session.is_revoked = True
        session.last_seen_at = now
        revoked_count += 1

    db.flush()
    return revoked_count


def list_active_refresh_sessions(
    db: Session,
    *,
    user_id: str,
) -> list[RefreshSession]:
    now = datetime.now(timezone.utc)
    sessions = list(
        db.scalars(
            select(RefreshSession)
            .where(
                RefreshSession.user_id == user_id,
                RefreshSession.is_revoked.is_(False),
                RefreshSession.expires_at > now,
            )
            .order_by(RefreshSession.last_seen_at.desc(), RefreshSession.created_at.desc())
        ).all()
    )
    return sessions


def _resolve_active_refresh_session(
    db: Session,
    *,
    user_id: str,
    session_jti: str | None,
) -> RefreshSession | None:
    if not session_jti:
        return None

    session = db.scalar(
        select(RefreshSession).where(
            RefreshSession.user_id == user_id,
            RefreshSession.refresh_token_jti == session_jti,
        )
    )
    if session is None or session.is_revoked:
        raise _credentials_exception()
    if session.expires_at <= datetime.now(timezone.utc):
        session.is_revoked = True
        db.commit()
        raise _credentials_exception()

    now = datetime.now(timezone.utc)
    if session.last_seen_at <= now - SESSION_LAST_SEEN_UPDATE_WINDOW:
        session.last_seen_at = now
        db.commit()

    return session


def get_current_access_token(
    token: str = Depends(oauth2_scheme),
) -> DecodedToken:
    return decode_token_payload(token=token, expected_token_type=ACCESS_TOKEN_TYPE)


def get_current_user(
    token_payload: DecodedToken = Depends(get_current_access_token),
    db: Session = Depends(get_db),
) -> User:
    logger.info(
        "auth.get_current_user start subject=%s has_session_jti=%s",
        token_payload.subject,
        token_payload.session_jti is not None,
    )
    user = db.get(User, token_payload.subject)
    if user is None:
        raise _credentials_exception()

    if (
        user.password_changed_at is not None
        and token_payload.issued_at < user.password_changed_at
    ):
        raise _credentials_exception("当前凭证已全局失效，请重新登录。")

    if is_access_token_blacklisted(db, jti=token_payload.jti):
        raise _credentials_exception("当前访问令牌已被吊销，请重新登录。")

    _resolve_active_refresh_session(
        db,
        user_id=token_payload.subject,
        session_jti=token_payload.session_jti,
    )

    logger.info("auth.get_current_user resolved user_id=%s", user.id)
    return user
