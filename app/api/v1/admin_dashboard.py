from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import User
from app.models.schemas import AdminDashboardResponse
from app.services.admin_dashboard import build_admin_dashboard_summary
from app.services.auth import RequireRole

router = APIRouter(prefix="/api/v1/admin", tags=["admin-dashboard"])
require_admin_dashboard_role = RequireRole(["super_admin", "admin"])


@router.get("/dashboard", response_model=AdminDashboardResponse)
async def get_admin_dashboard_summary(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_dashboard_role),
) -> AdminDashboardResponse:
    return build_admin_dashboard_summary(db)
