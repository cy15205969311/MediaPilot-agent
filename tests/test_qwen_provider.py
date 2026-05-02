import asyncio

import httpx

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


def test_compatible_provider_routes_video_requests_to_mimo_vision_model(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[dict[str, object]] = []

    class FakeDelta:
        content = "ok"

    class FakeChoice:
        delta = FakeDelta()

    class FakeChunk:
        choices = [FakeChoice()]

    class FakeStream:
        def __init__(self) -> None:
            self._consumed = False

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._consumed:
                raise StopAsyncIteration
            self._consumed = True
            return FakeChunk()

    class FakeCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return FakeStream()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    class FakeArtifact:
        def model_dump(self, mode: str = "json") -> dict[str, object]:
            return {
                "artifact_type": "content_draft",
                "title": "视频草稿",
                "title_candidates": ["标题一", "标题二", "标题三"],
                "body": "正文",
                "platform_cta": "行动引导",
            }

    async def fake_build_structured_artifact(*args, **kwargs):
        return FakeArtifact()

    monkeypatch.setattr(
        providers_module,
        "_load_thread_history",
        lambda **kwargs: [],
    )
    monkeypatch.setattr(
        providers_module,
        "resolve_media_reference",
        lambda raw_url: f"https://cdn.example.com/{str(raw_url).split('/')[-1]}",
    )

    provider = providers_module.CompatibleLLMProvider(
        api_key="compatible-key",
        base_url="https://example.com/v1",
        model="mimo-v2.5-pro",
        vision_model="mimo-v2-omni",
    )
    monkeypatch.setattr(provider, "_get_client", lambda: FakeClient())
    monkeypatch.setattr(provider, "_build_structured_artifact", fake_build_structured_artifact)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-compatible-native-video",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请结合视频生成一段文案",
            "materials": [
                {
                    "type": "video_url",
                    "url": "/uploads/alice/demo.mp4",
                    "text": "demo.mp4",
                }
            ],
        }
    )

    events = asyncio.run(_collect_provider_events(provider, request))

    assert any(event["event"] == "artifact" for event in events)
    assert calls
    assert calls[0]["model"] == "mimo-v2-omni"
    user_content = calls[0]["messages"][-1]["content"]
    assert isinstance(user_content, list)
    assert any(
        part.get("type") == "video_url"
        and part.get("video_url", {}).get("url") == "https://cdn.example.com/demo.mp4"
        for part in user_content
    )


def test_compatible_provider_routes_audio_requests_to_mimo_vision_model(
    monkeypatch: pytest.MonkeyPatch,
):
    calls: list[dict[str, object]] = []

    class FakeDelta:
        content = "ok"

    class FakeChoice:
        delta = FakeDelta()

    class FakeChunk:
        choices = [FakeChoice()]

    class FakeStream:
        def __init__(self) -> None:
            self._consumed = False

        def __aiter__(self):
            return self

        async def __anext__(self):
            if self._consumed:
                raise StopAsyncIteration
            self._consumed = True
            return FakeChunk()

    class FakeCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return FakeStream()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    class FakeArtifact:
        def model_dump(self, mode: str = "json") -> dict[str, object]:
            return {
                "artifact_type": "content_draft",
                "title": "音频草稿",
                "title_candidates": ["标题一", "标题二", "标题三"],
                "body": "正文",
                "platform_cta": "行动引导",
            }

    async def fake_build_structured_artifact(*args, **kwargs):
        return FakeArtifact()

    monkeypatch.setattr(
        providers_module,
        "_load_thread_history",
        lambda **kwargs: [],
    )
    monkeypatch.setattr(
        providers_module,
        "resolve_media_reference",
        lambda raw_url: f"https://cdn.example.com/{str(raw_url).split('/')[-1]}",
    )

    provider = providers_module.CompatibleLLMProvider(
        api_key="compatible-key",
        base_url="https://example.com/v1",
        model="mimo-v2.5-pro",
        vision_model="mimo-v2-omni",
    )
    monkeypatch.setattr(provider, "_get_client", lambda: FakeClient())
    monkeypatch.setattr(provider, "_build_structured_artifact", fake_build_structured_artifact)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-compatible-native-audio",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请结合音频生成一段文案",
            "materials": [
                {
                    "type": "audio_url",
                    "url": "/uploads/alice/podcast.mp3",
                    "text": "podcast.mp3",
                }
            ],
        }
    )

    events = asyncio.run(_collect_provider_events(provider, request))

    assert any(event["event"] == "artifact" for event in events)
    assert calls
    assert calls[0]["model"] == "mimo-v2-omni"
    user_content = calls[0]["messages"][-1]["content"]
    assert isinstance(user_content, list)
    assert any(
        part.get("type") == "input_audio"
        and part.get("input_audio", {}).get("data") == "https://cdn.example.com/podcast.mp3"
        for part in user_content
    )


def test_compatible_provider_marks_remote_protocol_disconnect_as_retryable(
    monkeypatch: pytest.MonkeyPatch,
):
    class FakeDelta:
        def __init__(self, content: str) -> None:
            self.content = content

    class FakeChoice:
        def __init__(self, content: str) -> None:
            self.delta = FakeDelta(content)

    class FakeChunk:
        def __init__(self, content: str) -> None:
            self.choices = [FakeChoice(content)]

    class FlakyStream:
        def __init__(self) -> None:
            self._index = 0

        def __aiter__(self):
            return self

        async def __anext__(self):
            self._index += 1
            if self._index == 1:
                return FakeChunk("partial")
            raise httpx.RemoteProtocolError("incomplete chunked read")

    class FakeCompletions:
        async def create(self, **kwargs):
            return FlakyStream()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    monkeypatch.setattr(
        providers_module,
        "_load_thread_history",
        lambda **kwargs: [],
    )

    provider = providers_module.CompatibleLLMProvider(
        api_key="compatible-key",
        base_url="https://example.com/v1",
        model="mimo-v2.5-pro",
        vision_model="mimo-v2-omni",
    )
    monkeypatch.setattr(provider, "_get_client", lambda: FakeClient())

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-compatible-remote-disconnect",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请生成一段正文",
            "materials": [],
        }
    )

    events = asyncio.run(_collect_provider_events(provider, request))

    error_event = next(event for event in events if event["event"] == "error")
    assert error_event["code"] == providers_module.TRANSIENT_PROVIDER_STREAM_ERROR_CODE
    assert error_event["retriable"] is True
    assert error_event["provider"] == "compatible"
    assert error_event["model"] == "mimo-v2.5-pro"
    assert any(
        event["event"] == "message" and event.get("delta") == "partial"
        for event in events
    )


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


async def _collect_provider_events(
    provider: BaseLLMProvider,
    request: MediaChatRequest,
) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []
    async for event in provider.generate_stream(request):
        events.append(event)
    return events
