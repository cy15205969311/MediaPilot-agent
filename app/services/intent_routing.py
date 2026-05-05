from __future__ import annotations

from dataclasses import dataclass

from app.models.schemas import MediaChatRequest, TaskType


@dataclass(frozen=True)
class SmartTaskResolution:
    requested_task_type: TaskType
    resolved_task_type: TaskType
    reason: str
    direct_image_mode: bool

    @property
    def overridden(self) -> bool:
        return self.requested_task_type != self.resolved_task_type


def normalize_media_chat_request(
    request: MediaChatRequest,
) -> tuple[MediaChatRequest, SmartTaskResolution]:
    return request, resolve_media_chat_task_type(request)


def resolve_media_chat_task_type(request: MediaChatRequest) -> SmartTaskResolution:
    requested_task_type = request.task_type
    if requested_task_type not in {TaskType.CONTENT_GENERATION, TaskType.IMAGE_GENERATION}:
        return SmartTaskResolution(
            requested_task_type=requested_task_type,
            resolved_task_type=requested_task_type,
            reason="non_overridable_task_type",
            direct_image_mode=False,
        )

    return SmartTaskResolution(
        requested_task_type=requested_task_type,
        resolved_task_type=requested_task_type,
        reason="honor_requested_task_type",
        direct_image_mode=False,
    )


def should_route_to_direct_image_generation(
    request: MediaChatRequest,
    *,
    resolution: SmartTaskResolution | None = None,
) -> bool:
    _ = resolution or resolve_media_chat_task_type(request)
    return False
