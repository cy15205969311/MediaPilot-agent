import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import Thread, TokenTransaction, User
from app.models.schemas import ArtifactPayloadModel, MediaChatRequest
from app.services.graph import LangGraphProvider
from app.services.persistence import ARTIFACT_TYPE_ADAPTER, persist_assistant_output
from app.services.providers import (
    BaseLLMProvider,
    CompatibleLLMProvider,
    MockLLMProvider,
    OpenAIProvider,
    QwenLLMProvider,
    create_provider_from_env,
)
from app.services.token_usage import (
    LEGACY_MODEL_NAME,
    merge_model_token_usage,
    normalize_model_token_usage,
    normalize_model_name,
)

logger = logging.getLogger(__name__)
TOKEN_BILLING_EXEMPT_ROLES = {"super_admin", "admin"}


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
        effective_provider = self._resolve_effective_provider(request.model_override)

        async for event in self._run_with_provider(
            effective_provider,
            request,
            db=db,
            thread=thread,
            user_id=user_id,
        ):
            yield event

    async def _run_with_provider(
        self,
        effective_provider: BaseLLMProvider,
        request: MediaChatRequest,
        *,
        db: Session | None = None,
        thread: Thread | None = None,
        user_id: str | None = None,
    ) -> AsyncGenerator[dict[str, object], None]:
        async for event in effective_provider.generate_stream(
            request,
            db=db,
            thread=thread,
            user_id=user_id,
        ):
            yield event

    def _resolve_effective_provider(self, model_override: str | None) -> BaseLLMProvider:
        normalized_override = (model_override or "").strip()
        if not normalized_override:
            return self.provider

        provider_prefix, actual_model = _split_model_override(normalized_override)
        if provider_prefix:
            routed_provider = _build_provider_from_prefix(
                provider_prefix,
                actual_model,
            )
            if routed_provider is not None:
                return _wrap_provider_for_workflow(
                    base_provider=self.provider,
                    routed_provider=routed_provider,
                )

        return self.provider.clone_with_model_override(normalized_override)

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
        accumulated_token_usage: dict[str, int] = {}
        effective_provider = self._resolve_effective_provider(request.model_override)

        effective_provider_name = type(effective_provider).__name__
        effective_inner_provider_name = ""
        effective_model_name = getattr(effective_provider, "model", "")
        if isinstance(effective_provider, LangGraphProvider):
            effective_inner_provider_name = type(effective_provider.inner_provider).__name__
            effective_model_name = getattr(effective_provider.inner_provider, "model", "")
        resolved_model_name = _resolve_runtime_model_name(
            provider_model_name=effective_model_name,
            model_override=request.model_override,
        )

        logger.info(
            "agent.stream start thread_id=%s provider=%s runtime_provider=%s inner_provider=%s model=%s model_override=%s",
            request.thread_id,
            type(self.provider).__name__,
            effective_provider_name,
            effective_inner_provider_name,
            resolved_model_name,
            request.model_override or "",
        )

        try:
            async for event in self._run_with_provider(
                effective_provider,
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
                    accumulated_token_usage = merge_model_token_usage(
                        accumulated_token_usage,
                        event.get("token_usage"),
                    )
                    logger.info(
                        "agent.stream final token_usage thread_id=%s token_usage=%s",
                        request.thread_id,
                        accumulated_token_usage,
                    )
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
                    else:
                        try:
                            _record_generated_token_consumption(
                                user_id=user_id,
                                task_type=request.task_type.value,
                                token_usage=accumulated_token_usage,
                            )
                        except Exception:
                            logger.exception(
                                "agent.stream token_ledger failed thread_id=%s",
                                request.thread_id,
                            )

                if event_name == "done":
                    logger.info(
                        "agent.stream done thread_id=%s provider_error=%s text_chars=%s has_artifact=%s",
                        request.thread_id,
                        had_provider_error,
                        len(accumulated_text),
                        latest_artifact is not None,
                    )

                yield self._format_sse(event, event=event_name)
                await asyncio.sleep(0)
        except asyncio.CancelledError:
            logger.info(
                "客户端已主动取消流式请求 thread_id=%s text_chars=%s has_artifact=%s",
                request.thread_id,
                len(accumulated_text),
                latest_artifact is not None,
            )
            raise

    @staticmethod
    def _format_sse(data: dict[str, Any], event: str) -> str:
        payload = json.dumps(data, ensure_ascii=False)
        return f"event: {event}\ndata: {payload}\n\n"


def _split_model_override(model_override: str) -> tuple[str, str]:
    normalized_override = model_override.strip()
    if ":" not in normalized_override:
        return "", normalized_override

    provider_prefix, actual_model = normalized_override.split(":", 1)
    return provider_prefix.strip().lower(), actual_model.strip()


def _build_provider_from_prefix(
    provider_prefix: str,
    actual_model: str,
) -> BaseLLMProvider | None:
    normalized_model = actual_model.strip()
    if provider_prefix in {"compatible", "xiaomi"} and normalized_model:
        return CompatibleLLMProvider(
            model=normalized_model,
            artifact_model=normalized_model,
        )
    if provider_prefix in {"qwen", "dashscope"} and normalized_model:
        return QwenLLMProvider(
            model=normalized_model,
            artifact_model=normalized_model,
        )
    if provider_prefix == "openai" and normalized_model:
        return OpenAIProvider(
            model=normalized_model,
            artifact_model=normalized_model,
        )
    if provider_prefix == "mock":
        return MockLLMProvider()
    return None


def _wrap_provider_for_workflow(
    *,
    base_provider: BaseLLMProvider,
    routed_provider: BaseLLMProvider,
) -> BaseLLMProvider:
    if not isinstance(base_provider, LangGraphProvider):
        return routed_provider

    return type(base_provider)(
        inner_provider=routed_provider,
        route_analyzer=base_provider.route_analyzer,
        vision_analyzer=base_provider.vision_analyzer,
        search_analyzer=base_provider.search_analyzer,
        vision_model=base_provider.vision_model,
        vision_timeout_seconds=base_provider.vision_timeout_seconds,
        search_timeout_seconds=base_provider.search_timeout_seconds,
        business_tool_max_iterations=base_provider.business_tool_max_iterations,
    )


def _resolve_runtime_model_name(
    *,
    provider_model_name: str | None,
    model_override: str | None,
) -> str:
    normalized_provider_model = normalize_model_name(provider_model_name)
    if normalized_provider_model:
        return normalized_provider_model

    _, override_model_name = _split_model_override(model_override or "")
    normalized_override_model = normalize_model_name(override_model_name)
    if normalized_override_model:
        return normalized_override_model

    return LEGACY_MODEL_NAME


def _record_generated_token_consumption(
    *,
    user_id: str,
    task_type: str,
    token_usage: object,
) -> None:
    normalized_token_usage = normalize_model_token_usage(token_usage)
    if not normalized_token_usage:
        logger.info(
            "agent.stream token_ledger skipped user_id=%s task_type=%s reason=no_tracked_usage token_usage=%s",
            user_id,
            task_type,
            token_usage,
        )
        return

    total_tokens = int(sum(int(value) for value in normalized_token_usage.values()))
    if total_tokens <= 0:
        logger.info(
            "agent.stream token_ledger skipped user_id=%s task_type=%s reason=non_positive_total",
            user_id,
            task_type,
        )
        return

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            raise ValueError(f"User not found for token ledger: {user_id}")

        if user.role in TOKEN_BILLING_EXEMPT_ROLES:
            logger.info(
                "agent.stream token_ledger skipped user_id=%s task_type=%s reason=privileged_bypass role=%s token_usage=%s",
                user_id,
                task_type,
                user.role,
                normalized_token_usage,
            )
            return

        user.token_balance = int(user.token_balance or 0) - total_tokens
        for model_name, model_tokens in normalized_token_usage.items():
            normalized_model_tokens = int(model_tokens)
            if normalized_model_tokens <= 0:
                continue
            db.add(
                TokenTransaction(
                    user_id=user_id,
                    amount=-normalized_model_tokens,
                    transaction_type="consume",
                    model_name=normalize_model_name(model_name) or LEGACY_MODEL_NAME,
                    remark=f"media_chat:{task_type}",
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    logger.info(
        "agent.stream token_ledger recorded user_id=%s task_type=%s total=%s models=%s",
        user_id,
        task_type,
        total_tokens,
        normalized_token_usage,
    )


media_agent_workflow = MediaAgentWorkflow(provider=create_provider_from_env())
