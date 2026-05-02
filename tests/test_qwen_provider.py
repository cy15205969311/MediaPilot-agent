import asyncio

import pytest

import app.services.providers as providers_module
from app.models.schemas import MediaChatRequest
from app.services.agent import MediaAgentWorkflow
from app.services.graph import LangGraphProvider
from app.services.providers import BaseLLMProvider
from app.services.tools import get_business_tools


def test_qwen_provider_uses_dashscope_defaults_and_disables_tool_binding():
    provider = providers_module.QwenLLMProvider(api_key="qwen-key")

    assert provider.base_url == providers_module.DEFAULT_QWEN_BASE_URL

    with pytest.raises(NotImplementedError):
        provider.bind_tools(get_business_tools())


def test_qwen_provider_execute_with_fallback_retries_then_switches_model(
    monkeypatch: pytest.MonkeyPatch,
):
    provider = providers_module.QwenLLMProvider(
        api_key="qwen-key",
        model="qwen-max",
        fallback_models=["qwen-plus", "qwen-turbo"],
        retry_attempts=2,
        retry_base_delay_seconds=0.0,
    )
    attempts: list[str] = []

    class RetryableError(RuntimeError):
        pass

    class FallbackError(RuntimeError):
        pass

    monkeypatch.setattr(
        provider,
        "_should_retry_same_model",
        lambda exc: isinstance(exc, RetryableError),
    )
    monkeypatch.setattr(
        provider,
        "_should_fallback_to_next_model",
        lambda exc: isinstance(exc, FallbackError),
    )

    async def request_factory(model_name: str) -> str:
        attempts.append(model_name)
        if model_name == "qwen-max" and attempts.count("qwen-max") == 1:
            raise RetryableError("429")
        if model_name == "qwen-max":
            raise FallbackError("quota")
        return model_name

    result = asyncio.run(
        provider._execute_with_fallback(
            initial_model="qwen-max",
            operation_name="artifact_json",
            request_factory=request_factory,
        )
    )

    assert result == "qwen-plus"
    assert attempts == ["qwen-max", "qwen-max", "qwen-plus"]


def test_create_provider_from_env_prefers_qwen_for_dashscope_auto_detection(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("OMNIMEDIA_LLM_PROVIDER", "auto")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("QWEN_API_KEY", raising=False)
    monkeypatch.delenv("QWEN_BASE_URL", raising=False)
    monkeypatch.setenv("LLM_API_KEY", "dashscope-key")
    monkeypatch.setenv(
        "LLM_BASE_URL",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    )

    provider = providers_module.create_provider_from_env()

    assert isinstance(provider, providers_module.QwenLLMProvider)


def test_langgraph_provider_clone_with_model_override_rebuilds_qwen_inner_provider():
    provider = LangGraphProvider(
        inner_provider=providers_module.QwenLLMProvider(
            api_key="qwen-key",
            model="qwen-plus",
            fallback_models=["qwen-turbo"],
        )
    )

    cloned = provider.clone_with_model_override("qwen-max")

    assert isinstance(cloned, LangGraphProvider)
    assert cloned is not provider
    assert isinstance(cloned.inner_provider, providers_module.QwenLLMProvider)
    assert cloned.inner_provider.model == "qwen-max"
    assert cloned.inner_provider.artifact_model == "qwen-max"


def test_qwen_provider_clone_accepts_dashscope_prefixed_model_override():
    provider = providers_module.QwenLLMProvider(
        api_key="qwen-key",
        model="qwen-plus",
    )

    cloned = provider.clone_with_model_override("dashscope:qwen-max")

    assert isinstance(cloned, providers_module.QwenLLMProvider)
    assert cloned.model == "qwen-max"
    assert cloned.artifact_model == "qwen-max"


def test_compatible_provider_clone_accepts_prefixed_model_override():
    provider = providers_module.CompatibleLLMProvider(
        api_key="compatible-key",
        base_url="https://example.com/v1",
        model="legacy-compatible-model",
    )

    cloned = provider.clone_with_model_override("compatible:mimo-v2.5-pro")

    assert isinstance(cloned, providers_module.CompatibleLLMProvider)
    assert cloned.model == "mimo-v2.5-pro"
    assert cloned.artifact_model == "mimo-v2.5-pro"


def test_compatible_provider_normalizes_legacy_mimo_model_casing():
    provider = providers_module.CompatibleLLMProvider(
        api_key="compatible-key",
        base_url="https://example.com/v1",
        model="MiMo-V2.5-Pro",
        artifact_model="MiMo-V2-Omni",
    )

    assert provider.model == "mimo-v2.5-pro"
    assert provider.artifact_model == "mimo-v2-omni"


def test_media_agent_workflow_uses_provider_clone_for_model_override():
    seen_models: list[str] = []

    class RecordingProvider(BaseLLMProvider):
        def __init__(self, model_name: str = "default") -> None:
            self.model_name = model_name

        def clone_with_model_override(
            self,
            model_override: str | None,
        ) -> BaseLLMProvider:
            normalized_model = (model_override or "").strip()
            if not normalized_model:
                return self
            return type(self)(normalized_model)

        async def generate_stream(self, request, **kwargs):
            seen_models.append(self.model_name)
            yield {"event": "done", "thread_id": request.thread_id}

    workflow = MediaAgentWorkflow(provider=RecordingProvider())
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-model-override",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "test",
            "materials": [],
            "model_override": "qwen-max",
        }
    )

    events = asyncio.run(
        _collect_workflow_events(
            workflow,
            request,
        )
    )

    assert events == [{"event": "done", "thread_id": "thread-model-override"}]
    assert seen_models == ["qwen-max"]


def test_media_agent_workflow_routes_dashscope_override_to_qwen_inner_provider():
    workflow = MediaAgentWorkflow(
        provider=LangGraphProvider(
            inner_provider=providers_module.CompatibleLLMProvider(
                api_key="compatible-key",
                base_url="https://example.com/v1",
                model="legacy-compatible-model",
            )
        )
    )

    effective_provider = workflow._resolve_effective_provider("dashscope:qwen2.5")

    assert isinstance(effective_provider, LangGraphProvider)
    assert effective_provider is not workflow.provider
    assert isinstance(workflow.provider.inner_provider, providers_module.CompatibleLLMProvider)
    assert isinstance(effective_provider.inner_provider, providers_module.QwenLLMProvider)
    assert effective_provider.inner_provider.model == "qwen2.5"
    assert effective_provider.inner_provider.artifact_model == "qwen2.5"


def test_media_agent_workflow_routes_xiaomi_override_to_compatible_inner_provider():
    workflow = MediaAgentWorkflow(
        provider=LangGraphProvider(
            inner_provider=providers_module.CompatibleLLMProvider(
                api_key="compatible-key",
                base_url="https://example.com/v1",
                model="legacy-compatible-model",
            )
        )
    )

    effective_provider = workflow._resolve_effective_provider("xiaomi:MiMo-V2-Omni")

    assert isinstance(effective_provider, LangGraphProvider)
    assert effective_provider is not workflow.provider
    assert isinstance(workflow.provider.inner_provider, providers_module.CompatibleLLMProvider)
    assert isinstance(effective_provider.inner_provider, providers_module.CompatibleLLMProvider)
    assert effective_provider.inner_provider.model == "mimo-v2-omni"
    assert effective_provider.inner_provider.artifact_model == "mimo-v2-omni"


async def _collect_workflow_events(
    workflow: MediaAgentWorkflow,
    request: MediaChatRequest,
) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    async for event in workflow.run(request):
        events.append(event)
    return events
