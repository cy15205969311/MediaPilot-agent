from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import RefreshSession, TokenTransaction, User
from app.models.schemas import (
    AdminTokenAdjustAction,
    AuditActionType,
    AdminUserCreate,
    AdminUserDeleteResponse,
    AdminUserLatestSessionItem,
    AdminUserListItem,
    AdminUserListResponse,
    AdminUserPasswordResetResponse,
    AdminUserRoleUpdateRequest,
    AdminUserStatusUpdateRequest,
    AdminUserTokenUpdateRequest,
    AdminUserTokenUpdateResponse,
)
from app.services.audit_logs import append_audit_log, get_audit_target_name
from app.services.auth import (
    JWT_ACCESS_EXPIRE_MINUTES,
    RequireRole,
    blacklist_access_token_jti,
    get_user_by_username,
    hash_password,
    list_active_refresh_sessions,
    mark_user_password_changed,
    normalize_username,
    revoke_other_refresh_sessions,
)
from app.services.persistence import resolve_media_reference
from app.services.token_usage import LEGACY_MODEL_NAME

router = APIRouter(prefix="/api/v1/admin", tags=["admin-users"])
require_admin_view_role = RequireRole(["super_admin", "admin", "finance", "operator"])
require_admin_manage_role = RequireRole(["super_admin", "admin", "operator"])
require_admin_provision_role = RequireRole(["super_admin", "admin"])
require_super_admin_role = RequireRole(["super_admin"])

ADMIN_INITIAL_GRANT_TOKENS = 10_000_000
ADMIN_RESET_PASSWORD = "12345678"
ADMIN_INITIAL_GRANT_REMARK = "管理员后台新建账号初始赠送"
SYSTEM_LEVEL_ROLES = {"super_admin", "admin"}
PROTECTED_SUPER_ADMIN_DETAIL = "禁止修改超级管理员账号。"
ROLE_CHANGE_FORBIDDEN_DETAIL = "不允许的越权操作。"


def _resolve_admin_token_change(
    *,
    current_balance: int,
    action: AdminTokenAdjustAction,
    amount: int,
) -> tuple[int, int, str]:
    if action == AdminTokenAdjustAction.ADD:
        if amount <= 0:
            raise HTTPException(
                status_code=400,
                detail="Amount must be greater than 0 for add actions.",
            )
        return current_balance + amount, amount, "recharge"

    if action == AdminTokenAdjustAction.DEDUCT:
        if amount <= 0:
            raise HTTPException(
                status_code=400,
                detail="Amount must be greater than 0 for deduct actions.",
            )
        next_balance = current_balance - amount
        if next_balance < 0:
            raise HTTPException(
                status_code=400,
                detail="Token balance cannot drop below 0.",
            )
        return next_balance, -amount, "consume"

    if amount < 0:
        raise HTTPException(
            status_code=400,
            detail="Target balance cannot be negative.",
        )

    next_balance = amount
    return next_balance, next_balance - current_balance, "adjust"


def _build_admin_latest_session_item(
    session: RefreshSession | None,
) -> AdminUserLatestSessionItem | None:
    if session is None:
        return None

    return AdminUserLatestSessionItem(
        device_info=session.device_info,
        ip_address=session.ip_address,
        last_seen_at=session.last_seen_at,
        created_at=session.created_at,
    )


def _load_latest_sessions_for_users(
    db: Session,
    *,
    user_ids: list[str],
) -> dict[str, AdminUserLatestSessionItem]:
    if not user_ids:
        return {}

    sessions = list(
        db.scalars(
            select(RefreshSession)
            .where(RefreshSession.user_id.in_(user_ids))
            .order_by(
                RefreshSession.user_id.asc(),
                RefreshSession.last_seen_at.desc(),
                RefreshSession.created_at.desc(),
            )
        ).all()
    )

    latest_sessions: dict[str, AdminUserLatestSessionItem] = {}
    for session in sessions:
        if session.user_id in latest_sessions:
            continue
        latest_session = _build_admin_latest_session_item(session)
        if latest_session is not None:
            latest_sessions[session.user_id] = latest_session
    return latest_sessions


def _build_admin_user_item(
    user: User,
    *,
    latest_session: AdminUserLatestSessionItem | None = None,
) -> AdminUserListItem:
    return AdminUserListItem(
        id=user.id,
        username=user.username,
        nickname=user.nickname,
        avatar_url=resolve_media_reference(user.avatar_url),
        role=user.role,
        status=user.status,
        token_balance=user.token_balance,
        created_at=user.created_at,
        latest_session=latest_session,
    )


def _is_system_level_role(role: str) -> bool:
    return role in SYSTEM_LEVEL_ROLES


def _ensure_admin_can_create_role(*, actor: User, target_role: str) -> None:
    if actor.role == "admin" and target_role in SYSTEM_LEVEL_ROLES:
        raise HTTPException(
            status_code=403,
            detail="权限不足，无法创建高于或等于自身权限的系统级账号",
        )


def _get_target_user_or_404(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在。")
    return user


def _ensure_target_user_is_mutable(user: User) -> None:
    if user.role == "super_admin":
        raise HTTPException(status_code=403, detail=PROTECTED_SUPER_ADMIN_DETAIL)


def _ensure_role_change_allowed(*, actor: User, target: User) -> None:
    if actor.role != "super_admin":
        raise HTTPException(status_code=403, detail=ROLE_CHANGE_FORBIDDEN_DETAIL)

    if actor.id == target.id:
        raise HTTPException(status_code=403, detail="不能修改自己的角色。")

    if target.role == "super_admin":
        raise HTTPException(status_code=403, detail="不能修改其他超级管理员的角色。")


@router.get("/users", response_model=AdminUserListResponse)
async def list_admin_users(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=64),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_view_role),
) -> AdminUserListResponse:
    filters = []
    normalized_search = (search or "").strip()
    if normalized_search:
        filters.append(User.username.ilike(f"%{normalized_search}%"))

    count_statement = select(func.count()).select_from(User)
    list_statement = select(User).order_by(User.created_at.desc()).offset(skip).limit(limit)

    for condition in filters:
        count_statement = count_statement.where(condition)
        list_statement = list_statement.where(condition)

    total = db.scalar(count_statement) or 0
    users = list(db.scalars(list_statement).all())
    latest_sessions = _load_latest_sessions_for_users(
        db,
        user_ids=[user.id for user in users],
    )

    return AdminUserListResponse(
        items=[
            _build_admin_user_item(
                user,
                latest_session=latest_sessions.get(user.id),
            )
            for user in users
        ],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.get("/roles/summary", response_model=dict[str, int])
async def get_admin_role_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_super_admin_role),
) -> dict[str, int]:
    rows = db.execute(
        select(User.role, func.count(User.id)).group_by(User.role),
    ).all()
    return {str(role): int(count) for role, count in rows}


@router.post("/users", response_model=AdminUserListItem, status_code=201)
async def create_admin_user(
    payload: AdminUserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_provision_role),
) -> AdminUserListItem:
    username = normalize_username(payload.username)
    password = payload.password
    target_role = payload.role.value

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

    _ensure_admin_can_create_role(actor=current_user, target_role=target_role)

    initial_token_balance = (
        0 if _is_system_level_role(target_role) else ADMIN_INITIAL_GRANT_TOKENS
    )
    user = User(
        username=username,
        hashed_password=hash_password(password),
        role=target_role,
        token_balance=initial_token_balance,
    )
    db.add(user)

    try:
        db.flush()
        if initial_token_balance > 0:
            db.add(
                TokenTransaction(
                    user_id=user.id,
                    amount=initial_token_balance,
                    transaction_type="grant",
                    model_name=LEGACY_MODEL_NAME,
                    remark=ADMIN_INITIAL_GRANT_REMARK,
                    operator_id=current_user.id,
                )
            )
        append_audit_log(
            db=db,
            operator=current_user,
            action_type=AuditActionType.CREATE_USER.value,
            target_id=user.id,
            target_name=get_audit_target_name(user),
            details={
                "username": user.username,
                "role": target_role,
                "initial_token_balance": int(initial_token_balance),
                "grant_tokens": int(initial_token_balance),
                "is_system_role": _is_system_level_role(target_role),
            },
        )
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="创建用户失败，请稍后重试。",
        ) from exc

    return _build_admin_user_item(user)


@router.post("/users/{user_id}/status", response_model=AdminUserListItem)
async def update_admin_user_status(
    user_id: str,
    payload: AdminUserStatusUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_manage_role),
) -> AdminUserListItem:
    user = _get_target_user_or_404(db, user_id)
    _ensure_target_user_is_mutable(user)
    previous_status = user.status

    active_sessions = []
    is_freezing = payload.status.value == "frozen"
    if is_freezing:
        active_sessions = list_active_refresh_sessions(db, user_id=user.id)

    user.status = payload.status.value

    try:
        if is_freezing:
            revoke_other_refresh_sessions(
                db,
                user_id=user.id,
                keep_session_jti=None,
            )
            for session in active_sessions:
                blacklist_access_token_jti(
                    db,
                    jti=session.latest_access_jti,
                    expires_at=datetime.now(timezone.utc)
                    + timedelta(minutes=JWT_ACCESS_EXPIRE_MINUTES),
                )
        append_audit_log(
            db=db,
            operator=current_user,
            action_type=(
                AuditActionType.FREEZE.value
                if payload.status.value == "frozen"
                else AuditActionType.UNFREEZE.value
            ),
            target_id=user.id,
            target_name=get_audit_target_name(user),
            details={
                "previous_status": previous_status,
                "next_status": payload.status.value,
                "revoked_sessions": len(active_sessions) if is_freezing else 0,
            },
        )
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="更新用户状态失败，请稍后重试。") from exc

    latest_session = _load_latest_sessions_for_users(db, user_ids=[user.id]).get(user.id)
    return _build_admin_user_item(user, latest_session=latest_session)


@router.post("/users/{user_id}/reset-password", response_model=AdminUserPasswordResetResponse)
async def reset_admin_user_password(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_manage_role),
) -> AdminUserPasswordResetResponse:
    user = _get_target_user_or_404(db, user_id)
    _ensure_target_user_is_mutable(user)

    new_password = ADMIN_RESET_PASSWORD
    user.hashed_password = hash_password(new_password)

    try:
        active_sessions = list_active_refresh_sessions(db, user_id=user.id)
        mark_user_password_changed(user)
        revoked_sessions = revoke_other_refresh_sessions(
            db,
            user_id=user.id,
            keep_session_jti=None,
        )
        for session in active_sessions:
            blacklist_access_token_jti(
                db,
                jti=session.latest_access_jti,
                expires_at=datetime.now(timezone.utc)
                + timedelta(minutes=JWT_ACCESS_EXPIRE_MINUTES),
            )
        append_audit_log(
            db=db,
            operator=current_user,
            action_type=AuditActionType.RESET_PASSWORD.value,
            target_id=user.id,
            target_name=get_audit_target_name(user),
            details={
                "revoked_sessions": revoked_sessions,
                "password_length": len(new_password),
            },
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="重置密码失败，请稍后重试。") from exc

    return AdminUserPasswordResetResponse(
        user_id=user.id,
        new_password=new_password,
        revoked_sessions=revoked_sessions,
    )


@router.delete("/users/{user_id}", response_model=AdminUserDeleteResponse)
async def delete_admin_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_manage_role),
) -> AdminUserDeleteResponse:
    user = _get_target_user_or_404(db, user_id)
    _ensure_target_user_is_mutable(user)

    if current_user.id == user.id:
        raise HTTPException(status_code=403, detail="Cannot delete the current signed-in account.")

    deleted_user_id = user.id
    deleted_username = user.username
    deleted_role = user.role
    deleted_target_name = get_audit_target_name(user)

    try:
        active_sessions = list_active_refresh_sessions(db, user_id=user.id)
        revoked_sessions = revoke_other_refresh_sessions(
            db,
            user_id=user.id,
            keep_session_jti=None,
        )
        for session in active_sessions:
            blacklist_access_token_jti(
                db,
                jti=session.latest_access_jti,
                expires_at=datetime.now(timezone.utc)
                + timedelta(minutes=JWT_ACCESS_EXPIRE_MINUTES),
            )

        append_audit_log(
            db=db,
            operator=current_user,
            action_type=AuditActionType.DELETE_USER.value,
            target_id=deleted_user_id,
            target_name=deleted_target_name,
            details={
                "username": deleted_username,
                "role": deleted_role,
                "revoked_sessions": revoked_sessions,
            },
        )
        db.delete(user)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to delete user. Please try again later.",
        ) from exc

    return AdminUserDeleteResponse(id=deleted_user_id)


@router.post("/users/{user_id}/tokens", response_model=AdminUserTokenUpdateResponse)
async def update_admin_user_tokens(
    user_id: str,
    payload: AdminUserTokenUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_manage_role),
) -> AdminUserTokenUpdateResponse:
    user = _get_target_user_or_404(db, user_id)
    _ensure_target_user_is_mutable(user)
    previous_balance = user.token_balance

    normalized_remark = payload.remark.strip()
    if not normalized_remark:
        raise HTTPException(status_code=400, detail="备注不能为空。")

    next_balance, delta, transaction_type = _resolve_admin_token_change(
        current_balance=user.token_balance,
        action=payload.action,
        amount=payload.amount,
    )

    transaction = TokenTransaction(
        user_id=user.id,
        amount=delta,
        transaction_type=transaction_type,
        model_name=LEGACY_MODEL_NAME,
        remark=normalized_remark,
        operator_id=current_user.id,
    )

    try:
        user.token_balance = next_balance
        db.add(transaction)
        append_audit_log(
            db=db,
            operator=current_user,
            action_type=(
                AuditActionType.TOPUP.value
                if payload.action == AdminTokenAdjustAction.ADD
                else AuditActionType.TOKEN_DEDUCT.value
                if payload.action == AdminTokenAdjustAction.DEDUCT
                else AuditActionType.TOKEN_SET.value
            ),
            target_id=user.id,
            target_name=get_audit_target_name(user),
            details={
                "action": payload.action.value,
                "amount": int(payload.amount),
                "delta": int(delta),
                "previous_balance": int(previous_balance),
                "next_balance": int(next_balance),
                "transaction_type": transaction_type,
                "remark": normalized_remark,
            },
        )
        db.flush()
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="更新额度失败，请稍后重试。") from exc

    return AdminUserTokenUpdateResponse(
        user_id=user.id,
        token_balance=user.token_balance,
        transaction_id=transaction.id,
        amount=transaction.amount,
        transaction_type=transaction.transaction_type,
        remark=transaction.remark,
    )


@router.patch("/users/{user_id}/role", response_model=AdminUserListItem)
async def update_admin_user_role(
    user_id: str,
    payload: AdminUserRoleUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_super_admin_role),
) -> AdminUserListItem:
    user = _get_target_user_or_404(db, user_id)
    _ensure_role_change_allowed(actor=current_user, target=user)
    previous_role = user.role

    if user.role != payload.role.value:
        user.role = payload.role.value

        try:
            append_audit_log(
                db=db,
                operator=current_user,
                action_type=AuditActionType.ROLE_CHANGE.value,
                target_id=user.id,
                target_name=get_audit_target_name(user),
                details={
                    "previous_role": previous_role,
                    "next_role": payload.role.value,
                },
            )
            db.commit()
            db.refresh(user)
        except SQLAlchemyError as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail="角色变更失败，请稍后重试。") from exc

    latest_session = _load_latest_sessions_for_users(db, user_ids=[user.id]).get(user.id)
    return _build_admin_user_item(user, latest_session=latest_session)
