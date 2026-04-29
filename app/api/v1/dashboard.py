from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import User
from app.models.schemas import DashboardSummaryResponse
from app.services.auth import get_current_user
from app.services.dashboard import build_dashboard_summary

router = APIRouter(prefix="/api/v1/media", tags=["media-dashboard"])


@router.get("/dashboard/summary", response_model=DashboardSummaryResponse)
async def get_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DashboardSummaryResponse:
    return build_dashboard_summary(db, user_id=current_user.id)
