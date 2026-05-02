import asyncio
import base64
from pathlib import Path
from types import SimpleNamespace

import app.services.graph.provider as graph_provider_module
import app.services.providers as providers_module
from app.models.schemas import MediaChatRequest
from app.services.graph import LangGraphProvider
from app.services.providers import BaseLLMProvider


class RecordingProvider(BaseLLMProvider):
    def __init__(self) -> None:
        self.last_request_message = ""
        self.last_request_system_prompt = ""
        self.last_request_material_types: list[str] = []

    async def generate_stream(self, request, **kwargs):
        self.last_request_message = request.message
        self.last_request_system_prompt = request.system_prompt or ""
        self.last_request_material_types = [material.type.value for material in request.materials]
        yield {
            "event": "start",
            "thread_id": request.thread_id,
            "platform": request.platform.value,
            "task_type": request.task_type.value,
            "materials_count": len(request.materials),
        }
        yield {
            "event": "message",
            "delta": "已基于视觉素材生成草稿。",
            "index": 0,
        }
        yield {
            "event": "artifact",
            "artifact": {
                "artifact_type": "content_draft",
                "title": "视觉草稿",
                "title_candidates": ["标题一", "标题二", "标题三"],
                "body": "1. 已解析图片要点\n2. 已生成正文",
                "platform_cta": "欢迎继续优化。",
            },
        }
        yield {"event": "done", "thread_id": request.thread_id}


async def collect_events(provider: LangGraphProvider, request: MediaChatRequest):
    events: list[dict[str, object]] = []
    async for event in provider.generate_stream(request):
        events.append(event)
    return events


def test_media_chat_request_accepts_relative_upload_material_urls():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-relative-upload",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请根据上传图片整理一版内容草稿",
            "materials": [
                {
                    "type": "image",
                    "url": "/uploads/alice/sample.png",
                    "text": "门店新品海报",
                }
            ],
        }
    )

    assert request.materials[0].url == "/uploads/alice/sample.png"


def test_build_image_content_part_supports_local_upload_path(
    tmp_path: Path,
    monkeypatch,
):
    uploads_dir = tmp_path / "uploads"
    user_dir = uploads_dir / "alice"
    user_dir.mkdir(parents=True, exist_ok=True)
    image_path = user_dir / "sample.png"
    image_bytes = b"fake-png-binary"
    image_path.write_bytes(image_bytes)
    monkeypatch.setattr(graph_provider_module, "UPLOADS_DIR", uploads_dir)

    content_part = asyncio.run(
        graph_provider_module._build_image_content_part("/uploads/alice/sample.png")
    )

    assert content_part is not None
    assert content_part["type"] == "image_url"
    data_url = str(content_part["image_url"]["url"])
    assert data_url.startswith("data:image/png;base64,")
    encoded = data_url.split(",", 1)[1]
    assert base64.b64decode(encoded) == image_bytes


def test_build_image_content_part_downloads_remote_url_as_data_url(monkeypatch):
    raw_url = "https://media-bucket.oss-cn-hangzhou.aliyuncs.com/uploads/alice/sample.png"
    image_bytes = b"remote-png-binary"

    class FakeResponse:
        def __init__(self) -> None:
            self.content = image_bytes
            self.headers = {"content-type": "image/png"}

        def raise_for_status(self) -> None:
            return None

    class FakeAsyncClient:
        def __init__(self, **kwargs) -> None:
            self.kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url: str):
            assert url == raw_url
            return FakeResponse()

    monkeypatch.setattr(graph_provider_module.httpx, "AsyncClient", FakeAsyncClient)

    content_part = asyncio.run(
        graph_provider_module._build_image_content_part(raw_url)
    )

    assert content_part is not None
    assert content_part["type"] == "image_url"
    data_url = str(content_part["image_url"]["url"])
    assert data_url.startswith("data:image/png;base64,")
    encoded = data_url.split(",", 1)[1]
    assert base64.b64decode(encoded) == image_bytes


def test_langgraph_provider_uses_vision_model_from_env(monkeypatch):
    monkeypatch.setenv("LLM_VISION_MODEL", "qwen-vl-max")
    monkeypatch.setenv("LLM_MODEL", "qwen-plus")

    provider = LangGraphProvider(inner_provider=RecordingProvider())

    assert provider.vision_model == "qwen-vl-max"


def test_request_vision_analysis_uses_openai_multimodal_payload(monkeypatch):
    calls: dict[str, object] = {}

    class FakeMessage:
        content = '{"visual_summary":"ok"}'

    class FakeChoice:
        message = FakeMessage()

    class FakeResponse:
        choices = [FakeChoice()]

    class FakeCompletions:
        async def create(self, **kwargs):
            calls.update(kwargs)
            return FakeResponse()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        chat = FakeChat()

    provider = LangGraphProvider(
        inner_provider=RecordingProvider(),
        vision_model="qwen-vl-max",
    )
    monkeypatch.setattr(provider, "_get_vision_client", lambda: FakeClient())
    content_parts = [
        {"type": "text", "text": "请提取并描述这张图片的核心内容。"},
        {
            "type": "image_url",
            "image_url": {
                "url": "https://media-bucket.oss-cn-hangzhou.aliyuncs.com/uploads/alice/sample.png"
            },
        },
    ]

    result = asyncio.run(provider._request_vision_analysis(content_parts))

    assert result == '{"visual_summary":"ok"}'
    assert calls["model"] == "qwen-vl-max"
    user_message = calls["messages"][1]
    assert user_message == {"role": "user", "content": content_parts}
    assert calls["response_format"] == {"type": "json_object"}


def test_langgraph_provider_passes_vision_clues_to_inner_provider():
    inner_provider = RecordingProvider()

    async def fake_vision_analyzer(request: MediaChatRequest) -> list[str]:
        assert len(request.materials) == 1
        return ["视觉解析#1：提取文字：榴莲千层；画面描述：甜品特写。"]

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        vision_analyzer=fake_vision_analyzer,
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-vision-success",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请根据图片写一篇内容草稿",
            "materials": [
                {
                    "type": "image",
                    "url": "https://example.com/durian.png",
                    "text": "门店新品海报",
                }
            ],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    assert "视觉解析#1" in inner_provider.last_request_message
    assert any(event["event"] == "artifact" for event in events)
    assert any(
        event["event"] == "tool_call" and event.get("name") == "ocr"
        for event in events
    )
    assert not any(event["event"] == "error" for event in events)


def test_langgraph_provider_rewrites_user_message_when_vision_clues_exist():
    inner_provider = RecordingProvider()
    vision_clue = "vision-clue: a plate of yellow durian flesh"

    async def fake_vision_analyzer(_: MediaChatRequest) -> list[str]:
        return [vision_clue]

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        vision_analyzer=fake_vision_analyzer,
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-vision-guardrail",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "看这张图片，帮我写一段小红书文案",
            "materials": [
                {
                    "type": "image",
                    "url": "https://example.com/durian.png",
                    "text": "门店新品海报",
                },
                {
                    "type": "text_link",
                    "url": "https://example.com/menu",
                    "text": "门店菜单链接",
                }
            ],
        }
    )

    asyncio.run(collect_events(provider, request))

    assert "系统强制指令" not in inner_provider.last_request_message
    assert "<image_context>" in inner_provider.last_request_message
    assert "</image_context>" in inner_provider.last_request_message
    assert "不要在开头做任何解释或说明" in inner_provider.last_request_message
    assert request.message in inner_provider.last_request_message
    assert vision_clue in inner_provider.last_request_message
    assert inner_provider.last_request_system_prompt == ""
    assert inner_provider.last_request_material_types == ["text_link"]


def test_build_conversation_messages_replaces_latest_user_history_with_rewritten_message(
    monkeypatch,
):
    rewritten_message = "用户提供了一张图片。\n<image_context>\n榴莲果肉\n</image_context>"
    history = [SimpleNamespace(role="user", content="看这张图片，帮我写一段小红书文案")]

    monkeypatch.setattr(
        providers_module,
        "_load_thread_history",
        lambda **kwargs: history,
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-history-rewrite",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": rewritten_message,
            "materials": [],
        }
    )

    messages = providers_module._build_conversation_messages(
        request,
        db=object(),
        thread=None,
        user_id=None,
    )

    user_messages = [message["content"] for message in messages if message["role"] == "user"]
    assert user_messages[-1] == rewritten_message
    assert "看这张图片，帮我写一段小红书文案" not in user_messages


def test_build_conversation_messages_embeds_native_video_parts_for_mimo_models(monkeypatch):
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

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-native-video-message",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请总结视频里的核心卖点，并结合附件整理成一段文案。",
            "materials": [
                {
                    "type": "video_url",
                    "url": "/uploads/alice/demo.mp4",
                    "text": "门店探店视频",
                },
                {
                    "type": "text_link",
                    "url": "/uploads/alice/brief.pdf",
                    "text": "brief.pdf",
                },
            ],
        }
    )

    messages = providers_module._build_conversation_messages(
        request,
        db=None,
        thread=None,
        user_id=None,
        active_model="mimo-v2-omni",
    )

    user_content = messages[-1]["content"]
    assert isinstance(user_content, list)
    assert user_content[0] == {"type": "text", "text": request.message}
    assert any(
        part.get("type") == "video_url"
        and part.get("video_url", {}).get("url") == "https://cdn.example.com/demo.mp4"
        for part in user_content
    )
    assert any(
        part.get("type") == "text" and "brief.pdf" in str(part.get("text", ""))
        for part in user_content
    )


def test_langgraph_provider_skips_transcription_for_mimo_native_video_models(monkeypatch):
    class NativeVideoRecordingProvider(RecordingProvider):
        def __init__(self) -> None:
            super().__init__()
            self.model = "mimo-v2-omni"

    async def fail_transcribe(_: str) -> str:
        raise AssertionError("native MiMo video path should not call audio transcription")

    monkeypatch.setattr(graph_provider_module, "transcribe_video", fail_transcribe)

    inner_provider = NativeVideoRecordingProvider()
    provider = LangGraphProvider(inner_provider=inner_provider)
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-native-video-skip",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请直接理解这个视频，并生成一段发布文案。",
            "materials": [
                {
                    "type": "video_url",
                    "url": "/uploads/alice/demo.mp4",
                    "text": "demo.mp4",
                }
            ],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    skip_events = [
        event
        for event in events
        if event["event"] == "tool_call" and event.get("name") == "video_transcription"
    ]

    assert inner_provider.last_request_material_types == ["video_url"]
    assert skip_events[-1]["status"] == "skipped"
    assert "原生视频理解" in str(skip_events[-1].get("message", ""))
    assert not any(event["event"] == "error" for event in events)


def test_langgraph_provider_fails_fast_when_vision_analysis_fails():
    inner_provider = RecordingProvider()

    async def failing_vision_analyzer(_: MediaChatRequest) -> list[str]:
        raise ValueError("vision boom")

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        vision_analyzer=failing_vision_analyzer,
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-vision-fallback",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请根据图片写一篇内容草稿",
            "materials": [
                {
                    "type": "image",
                    "url": "https://example.com/durian.png",
                    "text": "门店新品海报",
                }
            ],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    error_event = next(event for event in events if event["event"] == "error")
    assert error_event["code"] == "LANGGRAPH_RUNTIME_ERROR"
    assert "vision boom" in str(error_event["message"]).lower()
    assert not any(event["event"] == "artifact" for event in events)
    assert inner_provider.last_request_message == ""
    assert events[-1] == {"event": "done", "thread_id": "thread-vision-fallback"}
