from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import User
from app.models.schemas import UserProfile
from app.services.auth import get_current_user
from app.services.persistence import resolve_media_reference

router = APIRouter(prefix="/api/v1/users", tags=["users"])


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


@router.get("/me", response_model=UserProfile)
async def get_me(
    _: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserProfile:
    return _build_user_profile(current_user)
