from fastapi import APIRouter, Depends

from app.db.models import User
from app.models.schemas import (
    AvailableModelItem,
    AvailableModelProviderItem,
    AvailableModelsResponse,
)
from app.services.auth import get_current_user
from app.services.model_registry import get_available_model_providers

router = APIRouter(prefix="/api/v1/models", tags=["model-registry"])


@router.get("/available", response_model=AvailableModelsResponse)
async def list_available_models(
    current_user: User = Depends(get_current_user),
) -> AvailableModelsResponse:
    _ = current_user
    provider_groups = [
        AvailableModelProviderItem(
            provider_key=provider.provider_key,
            provider=provider.provider,
            status=provider.status,
            status_label=provider.status_label,
            models=[
                AvailableModelItem(
                    id=model.id,
                    model=model.model,
                    name=model.name,
                    group=model.group,
                    tags=list(model.tags),
                    is_default=model.is_default,
                )
                for model in provider.models
            ],
        )
        for provider in get_available_model_providers()
    ]
    return AvailableModelsResponse(
        items=provider_groups,
        total_providers=len(provider_groups),
        total_models=sum(len(provider.models) for provider in provider_groups),
    )
