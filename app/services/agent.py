import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.models import Thread
from app.models.schemas import ArtifactPayloadModel, MediaChatRequest
from app.services.persistence import ARTIFACT_TYPE_ADAPTER, persist_assistant_output
from app.services.providers import BaseLLMProvider, create_provider_from_env

logger = logging.getLogger(__name__)


class MediaAgentWorkflow:
    def __init__(self, provider: BaseLLMProvider) -> None:
        self.provider = provider

    async def run(
        self,
        request: MediaChatRequest,
        *,
        db: Session | None = None,
        thread: Thread | None = None,
        user_id: str | None = None,
    ) -> AsyncGenerator[dict[str, object], None]:
        async for event in self.provider.generate_stream(
            request,
            db=db,
            thread=thread,
            user_id=user_id,
        ):
            yield event

    async def stream(
        self,
        request: MediaChatRequest,
        *,
        db: Session | None = None,
        thread: Thread | None = None,
        user_id: str | None = None,
    ) -> AsyncGenerator[str, None]:
        latest_artifact: ArtifactPayloadModel | None = None
        had_provider_error = False
        accumulated_text = ""

        logger.info(
            "agent.stream start thread_id=%s provider=%s",
            request.thread_id,
            type(self.provider).__name__,
        )

        async for event in self.run(
            request,
            db=db,
            thread=thread,
            user_id=user_id,
        ):
            event_name = str(event.get("event", "message"))

            if event_name == "message":
                accumulated_text += str(event.get("delta", ""))
            elif event_name == "artifact":
                artifact_payload = event.get("artifact")
                if isinstance(artifact_payload, dict):
                    latest_artifact = ARTIFACT_TYPE_ADAPTER.validate_python(artifact_payload)
            elif event_name == "error":
                had_provider_error = True
                logger.warning(
                    "agent.stream provider_error thread_id=%s code=%s",
                    request.thread_id,
                    event.get("code"),
                )
            elif (
                event_name == "done"
                and db is not None
                and user_id is not None
                and not had_provider_error
            ):
                try:
                    logger.info(
                        "agent.stream persist_output thread_id=%s text_chars=%s has_artifact=%s",
                        request.thread_id,
                        len(accumulated_text),
                        latest_artifact is not None,
                    )
                    persist_assistant_output(
                        db,
                        thread_id=request.thread_id,
                        user_id=user_id,
                        assistant_text=accumulated_text,
                        artifact=latest_artifact,
                    )
                    logger.info("agent.stream persist_output completed thread_id=%s", request.thread_id)
                except SQLAlchemyError:
                    db.rollback()
                    logger.exception(
                        "agent.stream persist_output failed thread_id=%s",
                        request.thread_id,
                    )
                    error_event = {
                        "event": "error",
                        "code": "PERSISTENCE_ERROR",
                        "message": "Failed to persist assistant output. Please retry.",
                    }
                    yield self._format_sse(error_event, event="error")

            if event_name == "done":
                logger.info(
                    "agent.stream done thread_id=%s provider_error=%s text_chars=%s has_artifact=%s",
                    request.thread_id,
                    had_provider_error,
                    len(accumulated_text),
                    latest_artifact is not None,
                )

            yield self._format_sse(event, event=event_name)

    @staticmethod
    def _format_sse(data: dict[str, Any], event: str) -> str:
        payload = json.dumps(data, ensure_ascii=False)
        return f"event: {event}\ndata: {payload}\n\n"


media_agent_workflow = MediaAgentWorkflow(provider=create_provider_from_env())
