from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import User
from app.models.schemas import AdminStorageStatsResponse, AdminStorageUserListResponse
from app.services.admin_storage import (
    build_admin_storage_stats,
    build_admin_storage_user_rankings,
)
from app.services.auth import RequireRole

router = APIRouter(prefix="/api/v1/admin", tags=["admin-storage"])
require_admin_storage_role = RequireRole(["super_admin", "admin"])


@router.get("/storage/stats", response_model=AdminStorageStatsResponse)
async def get_admin_storage_stats(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_storage_role),
) -> AdminStorageStatsResponse:
    return build_admin_storage_stats(db)


@router.get("/storage/users", response_model=AdminStorageUserListResponse)
async def get_admin_storage_user_rankings(
    limit: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_storage_role),
) -> AdminStorageUserListResponse:
    return build_admin_storage_user_rankings(db, limit=limit)
