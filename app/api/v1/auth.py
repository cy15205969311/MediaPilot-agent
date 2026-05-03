import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import User
from app.models.schemas import (
    AuthSessionItem,
    AuthSessionsResponse,
    AuthTokenResponse,
    LogoutRequest,
    LogoutResponse,
    PasswordResetConfirmRequest,
    PasswordResetConfirmResponse,
    PasswordResetRequestCreate,
    PasswordResetRequestResponse,
    RefreshTokenRequest,
    RegisterRequest,
    ResetPasswordRequest,
    ResetPasswordResponse,
    SessionRevokeResponse,
    UserProfile,
    UserProfileUpdate,
)
from app.services.auth import (
    ACCOUNT_FROZEN_DETAIL,
    DecodedToken,
    JWT_ACCESS_EXPIRE_MINUTES,
    JWT_PASSWORD_RESET_EXPIRE_MINUTES,
    REFRESH_TOKEN_TYPE,
    authenticate_user,
    blacklist_access_token_jti,
    blacklist_access_token_payload,
    create_password_reset_token,
    decode_token_payload,
    extract_client_ip,
    extract_device_info,
    get_current_access_token,
    get_current_user,
    get_user_by_username,
    hash_password,
    issue_token_pair,
    list_active_refresh_sessions,
    mark_user_password_changed,
    normalize_username,
    revoke_other_refresh_sessions,
    revoke_refresh_session,
    revoke_refresh_session_by_id,
    verify_password_reset_token,
    verify_password,
    validate_refresh_session,
)
from app.services.persistence import cleanup_orphaned_avatars
from app.services.persistence import normalize_media_reference, resolve_media_reference

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
logger = logging.getLogger(__name__)


def _build_auth_response(
    *,
    user: User,
    access_token: str,
    refresh_token: str,
) -> AuthTokenResponse:
    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=_build_user_profile(user),
    )


def _build_user_profile(user: User) -> UserProfile:
    return UserProfile(
        id=user.id,
        username=user.username,
        nickname=user.nickname,
        bio=user.bio,
        avatar_url=resolve_media_reference(user.avatar_url),
        role=user.role,
        status=user.status,
        token_balance=user.token_balance,
        created_at=user.created_at,
    )


def _build_session_item(
    session,
    *,
    current_session_jti: str | None,
) -> AuthSessionItem:
    return AuthSessionItem(
        id=session.id,
        device_info=session.device_info,
        ip_address=session.ip_address,
        expires_at=session.expires_at,
        last_seen_at=session.last_seen_at,
        created_at=session.created_at,
        is_current=bool(current_session_jti and session.refresh_token_jti == current_session_jti),
    )


@router.post("/register", response_model=AuthTokenResponse)
async def register(
    payload: RegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthTokenResponse:
    username = normalize_username(payload.username)
    password = payload.password

    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空。")
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="用户名至少需要 3 个字符。")
    if not password:
        raise HTTPException(status_code=400, detail="密码不能为空。")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="密码至少需要 8 个字符。")

    if get_user_by_username(db, username) is not None:
        raise HTTPException(status_code=409, detail="该用户名已存在，请更换后重试。")

    user = User(
        username=username,
        hashed_password=hash_password(password),
    )
    db.add(user)

    try:
        db.flush()
        access_token, refresh_token = issue_token_pair(
            db,
            user_id=user.id,
            device_info=extract_device_info(request),
            ip_address=extract_client_ip(request),
        )
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="注册失败，请稍后重试。",
        ) from exc

    return _build_auth_response(
        user=user,
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/login", response_model=AuthTokenResponse)
async def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> AuthTokenResponse:
    user = authenticate_user(db, form_data.username, form_data.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误。",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status == "frozen":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=ACCOUNT_FROZEN_DETAIL,
        )

    try:
        access_token, refresh_token = issue_token_pair(
            db,
            user_id=user.id,
            device_info=extract_device_info(request),
            ip_address=extract_client_ip(request),
        )
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="登录失败，请稍后重试。",
        ) from exc

    return _build_auth_response(
        user=user,
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/refresh", response_model=AuthTokenResponse)
async def refresh_auth_token(
    payload: RefreshTokenRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthTokenResponse:
    token_payload = decode_token_payload(
        token=payload.refresh_token,
        expected_token_type=REFRESH_TOKEN_TYPE,
    )
    user = db.get(User, token_payload.subject)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="刷新令牌无效，请重新登录。",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        validate_refresh_session(db, user_id=user.id, refresh_token=payload.refresh_token)
        revoke_refresh_session(db, user_id=user.id, refresh_token=payload.refresh_token)
        access_token, refresh_token = issue_token_pair(
            db,
            user_id=user.id,
            device_info=extract_device_info(request),
            ip_address=extract_client_ip(request),
        )
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="刷新登录状态失败，请稍后重试。",
        ) from exc

    return _build_auth_response(
        user=user,
        access_token=access_token,
        refresh_token=refresh_token,
    )


@router.post("/logout", response_model=LogoutResponse)
async def logout(
    payload: LogoutRequest,
    token_payload: DecodedToken = Depends(get_current_access_token),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LogoutResponse:
    try:
        blacklist_access_token_payload(db, token_payload=token_payload)
        revoke_refresh_session(
            db,
            user_id=current_user.id,
            refresh_token=payload.refresh_token,
            allow_missing=True,
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="退出登录失败，请稍后重试。",
        ) from exc

    return LogoutResponse()


@router.post(
    "/password-reset-request",
    response_model=PasswordResetRequestResponse,
)
async def request_password_reset(
    payload: PasswordResetRequestCreate,
    db: Session = Depends(get_db),
) -> PasswordResetRequestResponse:
    username = normalize_username(payload.username)
    if not username:
        raise HTTPException(status_code=400, detail="用户名不能为空。")

    user = get_user_by_username(db, username)
    if user is not None:
        reset_token = create_password_reset_token(user.username)
        reset_link = f"http://127.0.0.1:5173/?reset_token={reset_token}"
        logger.info(
            "Password reset requested username=%s reset_link=%s",
            user.username,
            reset_link,
        )
    else:
        logger.info("Password reset requested for unknown username=%s", username)

    return PasswordResetRequestResponse(
        expires_in_minutes=JWT_PASSWORD_RESET_EXPIRE_MINUTES,
    )


@router.post("/password-reset", response_model=PasswordResetConfirmResponse)
async def password_reset_by_token(
    payload: PasswordResetConfirmRequest,
    db: Session = Depends(get_db),
) -> PasswordResetConfirmResponse:
    if not payload.new_password:
        raise HTTPException(status_code=400, detail="新密码不能为空。")
    if len(payload.new_password) < 8:
        raise HTTPException(status_code=400, detail="新密码至少需要 8 个字符。")

    username = verify_password_reset_token(payload.token)
    if not username:
        raise HTTPException(status_code=400, detail="重置令牌无效或已过期。")

    user = get_user_by_username(db, username)
    if user is None:
        raise HTTPException(status_code=400, detail="重置令牌无效或已过期。")
    if verify_password(payload.new_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同。")

    user.hashed_password = hash_password(payload.new_password)

    try:
        mark_user_password_changed(user)
        revoked_sessions = revoke_other_refresh_sessions(
            db,
            user_id=user.id,
            keep_session_jti=None,
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="重置密码失败，请稍后重试。",
        ) from exc

    return PasswordResetConfirmResponse(revoked_sessions=revoked_sessions)


@router.post("/reset-password", response_model=ResetPasswordResponse)
async def reset_password(
    payload: ResetPasswordRequest,
    token_payload: DecodedToken = Depends(get_current_access_token),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ResetPasswordResponse:
    old_password = payload.old_password
    new_password = payload.new_password

    if not old_password:
        raise HTTPException(status_code=400, detail="当前密码不能为空。")
    if not new_password:
        raise HTTPException(status_code=400, detail="新密码不能为空。")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="新密码至少需要 8 个字符。")
    if old_password == new_password:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同。")
    if not verify_password(old_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="当前密码校验失败。")

    current_user.hashed_password = hash_password(new_password)

    try:
        mark_user_password_changed(current_user)
        blacklist_access_token_payload(db, token_payload=token_payload)
        revoked_sessions = revoke_other_refresh_sessions(
            db,
            user_id=current_user.id,
            keep_session_jti=token_payload.session_jti,
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="修改密码失败，请稍后重试。",
        ) from exc

    return ResetPasswordResponse(revoked_sessions=revoked_sessions)


@router.get("/sessions", response_model=AuthSessionsResponse)
async def list_sessions(
    token_payload: DecodedToken = Depends(get_current_access_token),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AuthSessionsResponse:
    sessions = list_active_refresh_sessions(db, user_id=current_user.id)
    return AuthSessionsResponse(
        items=[
            _build_session_item(session, current_session_jti=token_payload.session_jti)
            for session in sessions
        ]
    )


@router.delete("/sessions/{session_id}", response_model=SessionRevokeResponse)
async def revoke_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SessionRevokeResponse:
    try:
        session = revoke_refresh_session_by_id(
            db,
            user_id=current_user.id,
            session_id=session_id,
        )
        blacklist_access_token_jti(
            db,
            jti=session.latest_access_jti,
            expires_at=datetime.now(timezone.utc)
            + timedelta(minutes=JWT_ACCESS_EXPIRE_MINUTES),
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="吊销登录会话失败，请稍后重试。",
        ) from exc

    return SessionRevokeResponse(id=session.id, revoked=True)


@router.patch("/profile", response_model=UserProfile)
async def update_profile(
    payload: UserProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserProfile:
    if not payload.model_fields_set:
        raise HTTPException(status_code=400, detail="至少提供一个可更新字段。")

    if "nickname" in payload.model_fields_set:
        nickname = payload.nickname.strip() if payload.nickname else ""
        current_user.nickname = nickname or None

    if "bio" in payload.model_fields_set:
        bio = payload.bio.strip() if payload.bio else ""
        current_user.bio = bio or None

    avatar_changed = False
    if "avatar_url" in payload.model_fields_set:
        avatar_url = payload.avatar_url.strip() if payload.avatar_url else ""
        current_user.avatar_url = normalize_media_reference(avatar_url) if avatar_url else None
        avatar_changed = True

    try:
        db.commit()
        db.refresh(current_user)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="更新个人资料失败，请稍后重试。",
        ) from exc

    if avatar_changed:
        await cleanup_orphaned_avatars(db, user_id=current_user.id)
        db.refresh(current_user)

    return _build_user_profile(current_user)
