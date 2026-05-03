import random
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import TokenTransaction, User
from app.models.schemas import (
    AdminUserListItem,
    AdminUserListResponse,
    AdminUserPasswordResetResponse,
    AdminUserStatusUpdateRequest,
    AdminUserTokenUpdateRequest,
    AdminUserTokenUpdateResponse,
)
from app.services.auth import (
    JWT_ACCESS_EXPIRE_MINUTES,
    RequireRole,
    blacklist_access_token_jti,
    hash_password,
    list_active_refresh_sessions,
    mark_user_password_changed,
    revoke_other_refresh_sessions,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin-users"])
require_admin_role = RequireRole(["super_admin", "admin", "operator"])
PASSWORD_SPECIAL_CHARS = "!@#$%^&*"


def _build_admin_user_item(user: User) -> AdminUserListItem:
    return AdminUserListItem(
        id=user.id,
        username=user.username,
        nickname=user.nickname,
        role=user.role,
        status=user.status,
        token_balance=user.token_balance,
        created_at=user.created_at,
    )


def _generate_random_password(length: int = 8) -> str:
    if length < 8:
        raise ValueError("Password length must be at least 8.")

    rng = random.SystemRandom()
    password_chars = [
        rng.choice(string.ascii_lowercase),
        rng.choice(string.ascii_uppercase),
        rng.choice(string.digits),
        rng.choice(PASSWORD_SPECIAL_CHARS),
    ]
    alphabet = string.ascii_letters + string.digits + PASSWORD_SPECIAL_CHARS
    password_chars.extend(rng.choice(alphabet) for _ in range(length - len(password_chars)))
    rng.shuffle(password_chars)
    return "".join(password_chars)


@router.get("/users", response_model=AdminUserListResponse)
async def list_admin_users(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    search: str | None = Query(default=None, max_length=64),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_role),
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

    return AdminUserListResponse(
        items=[_build_admin_user_item(user) for user in users],
        total=total,
        skip=skip,
        limit=limit,
    )


@router.post("/users/{user_id}/status", response_model=AdminUserListItem)
async def update_admin_user_status(
    user_id: str,
    payload: AdminUserStatusUpdateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_role),
) -> AdminUserListItem:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    user.status = payload.status.value

    try:
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="更新用户状态失败，请稍后重试。") from exc

    return _build_admin_user_item(user)


@router.post("/users/{user_id}/reset-password", response_model=AdminUserPasswordResetResponse)
async def reset_admin_user_password(
    user_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_role),
) -> AdminUserPasswordResetResponse:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    new_password = _generate_random_password(8)
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
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="重置密码失败，请稍后重试。") from exc

    return AdminUserPasswordResetResponse(
        user_id=user.id,
        new_password=new_password,
        revoked_sessions=revoked_sessions,
    )


@router.post("/users/{user_id}/tokens", response_model=AdminUserTokenUpdateResponse)
async def update_admin_user_tokens(
    user_id: str,
    payload: AdminUserTokenUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_role),
) -> AdminUserTokenUpdateResponse:
    if payload.amount == 0:
        raise HTTPException(status_code=400, detail="额度变动数量不能为 0。")

    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")

    next_balance = user.token_balance + payload.amount
    if next_balance < 0:
        raise HTTPException(status_code=400, detail="扣减后额度不能小于 0。")

    transaction_type = "recharge" if payload.amount > 0 else "consume"
    transaction = TokenTransaction(
        user_id=user.id,
        amount=payload.amount,
        transaction_type=transaction_type,
        remark=payload.remark.strip(),
        operator_id=current_user.id,
    )

    try:
        user.token_balance = next_balance
        db.add(transaction)
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
