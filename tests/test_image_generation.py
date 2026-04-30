import asyncio
import json

from app.models.schemas import MediaChatRequest
from app.services import image_generation as image_generation_module
from app.services.image_generation import ImageGenerationService, _extract_openai_image_urls


def test_image_generation_service_auto_falls_back_to_openai_backend(monkeypatch):
    monkeypatch.delenv("IMAGE_GENERATION_API_KEY", raising=False)
    monkeypatch.delenv("QWEN_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "auto")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")

    service = ImageGenerationService()

    assert service.resolve_backend() == "openai"
    assert service.resolve_model() == "gpt-image-2"
    assert service.is_enabled() is True


def test_image_generation_service_uses_openai_compatible_backend(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.setenv("IMAGE_GENERATION_COUNT", "2")

    service = ImageGenerationService()
    captured_client_kwargs: dict[str, object] = {}
    captured_request_kwargs: dict[str, object] = {}
    captured_persist_kwargs: dict[str, object] = {}

    class FakeResponse:
        text = '{"data":[{"url":"https://upstream.example/cover-1.png"}]}'

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "data": [
                    {"url": "https://upstream.example/cover-1.png"},
                ],
            }

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            captured_client_kwargs.update(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def post(self, url, **kwargs):
            captured_request_kwargs.update({"url": url, **kwargs})
            return FakeResponse()

    async def fake_persist_generated_images(*, urls, user_id, thread_id):
        captured_persist_kwargs.update(
            {
                "urls": urls,
                "user_id": user_id,
                "thread_id": thread_id,
            }
        )
        return [f"persisted::{url}" for url in urls]

    monkeypatch.setattr(image_generation_module.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(service, "_persist_generated_images", fake_persist_generated_images)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-openai-image",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    result = asyncio.run(
        service.generate_images(
            request=request,
            prompt="make a lifestyle cover image",
            user_id="user-123",
            thread_id=request.thread_id,
        )
    )

    assert captured_client_kwargs["follow_redirects"] is True
    assert captured_request_kwargs["url"] == "https://www.onetopai.asia/v1/chat/completions"
    assert captured_request_kwargs["headers"] == {
        "Authorization": "Bearer test-image-key",
        "Content-Type": "application/json",
    }
    assert captured_request_kwargs["json"] == {
        "model": "gpt-image-2",
        "messages": [
            {
                "role": "user",
                "content": "make a lifestyle cover image",
            }
        ],
    }
    assert captured_persist_kwargs == {
        "urls": [
            "https://upstream.example/cover-1.png",
        ],
        "user_id": "user-123",
        "thread_id": "thread-openai-image",
    }
    assert result == [
        "persisted::https://upstream.example/cover-1.png",
    ]


def test_openai_non_gpt_image_2_still_uses_images_generations(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "custom-image-model")

    service = ImageGenerationService()
    captured_request_kwargs: dict[str, object] = {}

    class FakeResponse:
        status_code = 200
        text = '{"data":[{"url":"https://upstream.example/cover-2.png"}]}'

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "data": [
                    {"url": "https://upstream.example/cover-2.png"},
                ],
            }

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def post(self, url, **kwargs):
            captured_request_kwargs.update({"url": url, **kwargs})
            return FakeResponse()

    monkeypatch.setattr(image_generation_module.httpx, "AsyncClient", FakeAsyncClient)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-openai-standard-image",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    result = asyncio.run(
        service.generate_images(
            request=request,
            prompt="make a lifestyle cover image",
            user_id=None,
            thread_id=request.thread_id,
        )
    )

    assert result == ["https://upstream.example/cover-2.png"]
    assert captured_request_kwargs["url"] == "https://gateway.example/v1/images/generations"
    assert captured_request_kwargs["json"] == {
        "model": "custom-image-model",
        "prompt": "make a lifestyle cover image",
        "n": 1,
        "size": "1024x1024",
    }


def test_openai_chat_completions_extracts_markdown_image_url(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")

    service = ImageGenerationService()

    class FakeResponse:
        status_code = 200
        text = json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": "Here is your image: ![cover](https://upstream.example/markdown-cover.png)"
                        }
                    }
                ]
            }
        )

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "choices": [
                    {
                        "message": {
                            "content": "Here is your image: ![cover](https://upstream.example/markdown-cover.png)"
                        }
                    }
                ]
            }

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def post(self, url, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(image_generation_module.httpx, "AsyncClient", FakeAsyncClient)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-openai-markdown-image",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    result = asyncio.run(
        service.generate_images(
            request=request,
            prompt="make a lifestyle cover image",
            user_id=None,
            thread_id=request.thread_id,
        )
    )

    assert result == ["https://upstream.example/markdown-cover.png"]


def test_openai_image_generation_non_json_response_returns_empty_list(monkeypatch, caplog):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")

    service = ImageGenerationService()

    class FakeResponse:
        status_code = 200
        text = "<html>bad gateway</html>"

        def raise_for_status(self):
            return None

        def json(self):
            raise json.JSONDecodeError("Expecting value", self.text, 0)

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def post(self, url, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(image_generation_module.httpx, "AsyncClient", FakeAsyncClient)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-openai-non-json",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    with caplog.at_level("ERROR"):
        result = asyncio.run(
            service.generate_images(
                request=request,
                prompt="make a lifestyle cover image",
                user_id="user-123",
                thread_id=request.thread_id,
            )
        )

    assert result == []
    assert "OpenAI-compatible image generation API returned non-JSON data" in caplog.text
    assert "<html>bad gateway</html>" in caplog.text


def test_dashscope_image_generation_non_json_response_returns_empty_list(monkeypatch, caplog):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "dashscope")
    monkeypatch.setenv("IMAGE_GENERATION_API_KEY", "test-dashscope-key")
    monkeypatch.setenv("IMAGE_GENERATION_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")
    monkeypatch.setenv("IMAGE_GENERATION_MODEL", "wanx-v1")

    service = ImageGenerationService()

    class FakeResponse:
        status_code = 200
        text = ""

        def raise_for_status(self):
            return None

        def json(self):
            raise json.JSONDecodeError("Expecting value", self.text, 0)

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def request(self, method, url, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(image_generation_module.httpx, "AsyncClient", FakeAsyncClient)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-dashscope-non-json",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    with caplog.at_level("ERROR"):
        result = asyncio.run(
            service.generate_images(
                request=request,
                prompt="make a lifestyle cover image",
                user_id="user-123",
                thread_id=request.thread_id,
            )
        )

    assert result == []
    assert "DashScope image generation API returned non-JSON data" in caplog.text


def test_dashscope_wanx_v1_uses_text2image_endpoint(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "dashscope")
    monkeypatch.setenv("IMAGE_GENERATION_API_KEY", "test-dashscope-key")
    monkeypatch.setenv("IMAGE_GENERATION_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")
    monkeypatch.setenv("IMAGE_GENERATION_MODEL", "wanx-v1")
    monkeypatch.setenv("IMAGE_GENERATION_COUNT", "1")

    service = ImageGenerationService()
    captured_requests: list[dict[str, object]] = []

    class FakeResponse:
        def __init__(self, payload):
            self._payload = payload
            self.status_code = 200
            self.text = json.dumps(payload)

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def request(self, method, url, **kwargs):
            captured_requests.append({"method": method, "url": url, **kwargs})
            if method == "POST":
                return FakeResponse({"output": {"task_id": "wanx-task-1"}})
            return FakeResponse(
                {
                    "output": {
                        "task_status": "SUCCEEDED",
                        "results": [
                            {"url": "https://dashscope.example/generated-cover.png"},
                        ],
                    }
                }
            )

    async def fake_sleep(_seconds):
        return None

    monkeypatch.setattr(image_generation_module.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(image_generation_module.asyncio, "sleep", fake_sleep)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-dashscope-wanx",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    result = asyncio.run(
        service.generate_images(
            request=request,
            prompt="make a sticky-note graduation project cover image",
            user_id=None,
            thread_id=request.thread_id,
        )
    )

    assert result == ["https://dashscope.example/generated-cover.png"]
    assert captured_requests[0]["url"] == (
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis"
    )
    assert captured_requests[0]["headers"]["X-DashScope-Async"] == "enable"
    assert captured_requests[0]["json"] == {
        "model": "wanx-v1",
        "input": {
            "prompt": "make a sticky-note graduation project cover image",
        },
        "parameters": {
            "size": "768*1152",
            "n": 1,
        },
    }


def test_extract_openai_image_urls_handles_gateway_variants():
    urls = _extract_openai_image_urls(
        {
            "data": [
                {"url": "https://upstream.example/standard.png"},
                {"b64_json": "aGVsbG8="},
            ],
            "images": [
                "https://upstream.example/images-array.png",
                {"image_url": {"url": "https://upstream.example/image-url-dict.png"}},
            ],
        }
    )

    assert urls == [
        "https://upstream.example/standard.png",
        "data:image/png;base64,aGVsbG8=",
        "https://upstream.example/images-array.png",
        "https://upstream.example/image-url-dict.png",
    ]
