from datetime import datetime, timezone

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
    RefreshTokenRequest,
    RegisterRequest,
    ResetPasswordRequest,
    ResetPasswordResponse,
    SessionRevokeResponse,
    UserProfile,
    UserProfileUpdate,
)
from app.services.auth import (
    DecodedToken,
    REFRESH_TOKEN_TYPE,
    authenticate_user,
    decode_token_payload,
    extract_client_ip,
    extract_device_info,
    get_current_access_token,
    get_current_user,
    get_user_by_username,
    hash_password,
    issue_token_pair,
    list_active_refresh_sessions,
    normalize_username,
    revoke_other_refresh_sessions,
    revoke_refresh_session,
    revoke_refresh_session_by_id,
    verify_password,
    validate_refresh_session,
)
from app.services.persistence import cleanup_orphaned_avatars

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _build_auth_response(
    *,
    user: User,
    access_token: str,
    refresh_token: str,
) -> AuthTokenResponse:
    return AuthTokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserProfile.model_validate(user, from_attributes=True),
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
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LogoutResponse:
    try:
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
        current_user.avatar_url = avatar_url or None
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

    return UserProfile.model_validate(current_user, from_attributes=True)
