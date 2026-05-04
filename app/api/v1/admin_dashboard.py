from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import User
from app.models.schemas import AdminDashboardResponse, AdminPendingTasksResponse
from app.services.admin_dashboard import (
    build_admin_dashboard_summary,
    build_admin_pending_tasks,
)
from app.services.auth import RequireRole

router = APIRouter(prefix="/api/v1/admin", tags=["admin-dashboard"])
require_admin_dashboard_role = RequireRole(["super_admin", "admin", "finance"])
require_admin_pending_tasks_role = RequireRole(
    ["super_admin", "admin", "finance", "operator"]
)


@router.get("/dashboard", response_model=AdminDashboardResponse)
async def get_admin_dashboard_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_dashboard_role),
) -> AdminDashboardResponse:
    return build_admin_dashboard_summary(db)


@router.get("/dashboard/pending-tasks", response_model=AdminPendingTasksResponse)
async def get_admin_pending_tasks(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_pending_tasks_role),
) -> AdminPendingTasksResponse:
    return build_admin_pending_tasks(db)
