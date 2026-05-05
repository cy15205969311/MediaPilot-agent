import asyncio
import json

import httpx
import pytest

from app.models.schemas import MediaChatRequest
from app.services import image_generation as image_generation_module
from app.services.image_generation import (
    ImageGenerationService,
    _extract_openai_image_urls,
    sanitize_image_response_for_log,
)


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


def test_image_generation_service_routes_standard_user_to_dashscope_backend(
    monkeypatch,
):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.setenv("IMAGE_GENERATION_API_KEY", "test-dashscope-key")
    monkeypatch.setenv("IMAGE_GENERATION_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")
    monkeypatch.setenv("IMAGE_GENERATION_MODEL", "wanx-v1")

    service = ImageGenerationService()

    assert service.resolve_backend(user_role="user") == "dashscope"
    assert service.resolve_model(user_role="user") == "wanx-v1"
    assert service.is_enabled(user_role="user") is True

    assert service.resolve_backend(user_role="super_admin") == "openai"
    assert service.resolve_model(user_role="super_admin") == "gpt-image-2"
    assert service.is_enabled(user_role="super_admin") is True


def test_image_generation_service_uses_openai_compatible_backend(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.setenv("IMAGE_GENERATION_COUNT", "2")

    service = ImageGenerationService()
    captured_request_kwargs: dict[str, object] = {}
    captured_persist_kwargs: dict[str, object] = {}

    class FakeResponse:
        def model_dump(self, mode="python"):
            return {
                "data": [
                    {"url": "https://upstream.example/cover-1.png"},
                ],
            }

    class FakeImagesAPI:
        async def generate(self, **kwargs):
            captured_request_kwargs.update(kwargs)
            return FakeResponse()

    class FakeOpenAIClient:
        images = FakeImagesAPI()

    async def fake_persist_generated_images(*, urls, user_id, thread_id):
        captured_persist_kwargs.update(
            {
                "urls": urls,
                "user_id": user_id,
                "thread_id": thread_id,
            }
        )
        return [f"persisted::{url}" for url in urls]

    monkeypatch.setattr(service, "_get_image_client", lambda: FakeOpenAIClient())
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

    assert captured_request_kwargs == {
        "model": "gpt-image-2",
        "prompt": "make a lifestyle cover image",
        "n": 1,
        "size": "1024x1024",
        "response_format": "url",
        "timeout": 120.0,
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


def test_generate_images_does_not_fallback_when_openai_generation_is_cancelled(
    monkeypatch,
):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.setenv("IMAGE_GENERATION_API_KEY", "test-dashscope-key")
    monkeypatch.setenv("IMAGE_GENERATION_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")
    monkeypatch.setenv("IMAGE_GENERATION_MODEL", "wanx-v1")

    service = ImageGenerationService()

    class FakeImagesAPI:
        async def generate(self, **kwargs):
            raise asyncio.CancelledError()

    class FakeOpenAIClient:
        images = FakeImagesAPI()

    async def unexpected_dashscope(*, request, prompt: str):
        raise AssertionError("cancelled image generation must not trigger DashScope fallback")

    monkeypatch.setattr(service, "_get_image_client", lambda: FakeOpenAIClient())
    monkeypatch.setattr(service, "_generate_images_with_dashscope", unexpected_dashscope)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-openai-cancelled",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(
            service.generate_images(
                request=request,
                prompt="make a cover image but cancel it",
                user_id="user-123",
                user_role="super_admin",
                thread_id=request.thread_id,
            )
        )


def test_openai_non_gpt_image_2_still_uses_images_generate_sdk(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://gateway.example/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "custom-image-model")

    service = ImageGenerationService()
    captured_request_kwargs: dict[str, object] = {}
    captured_persist_kwargs: dict[str, object] = {}

    class FakeResponse:
        def model_dump(self, mode="python"):
            return {
                "data": [
                    {"url": "https://upstream.example/cover-2.png"},
                ],
            }

    class FakeImagesAPI:
        async def generate(self, **kwargs):
            captured_request_kwargs.update(kwargs)
            return FakeResponse()

    class FakeOpenAIClient:
        images = FakeImagesAPI()

    async def fake_persist_generated_images(*, urls, user_id, thread_id):
        captured_persist_kwargs.update(
            {
                "urls": urls,
                "user_id": user_id,
                "thread_id": thread_id,
            }
        )
        return [f"persisted::{url}" for url in urls]

    monkeypatch.setattr(service, "_get_image_client", lambda: FakeOpenAIClient())
    monkeypatch.setattr(service, "_persist_generated_images", fake_persist_generated_images)

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

    assert result == ["persisted::https://upstream.example/cover-2.png"]
    assert captured_request_kwargs == {
        "model": "custom-image-model",
        "prompt": "make a lifestyle cover image",
        "n": 1,
        "size": "1024x1024",
        "response_format": "url",
        "timeout": 120.0,
    }
    assert captured_persist_kwargs == {
        "urls": ["https://upstream.example/cover-2.png"],
        "user_id": None,
        "thread_id": "thread-openai-standard-image",
    }


def test_openai_image_generation_accepts_b64_json_and_passes_it_to_persistence(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")

    service = ImageGenerationService()
    captured_persist_kwargs: dict[str, object] = {}

    class FakeResponse:
        def model_dump(self, mode="python"):
            return {
                "data": [
                    {"b64_json": "aGVsbG8="},
                ],
            }

    class FakeImagesAPI:
        async def generate(self, **kwargs):
            return FakeResponse()

    class FakeOpenAIClient:
        images = FakeImagesAPI()

    async def fake_persist_generated_images(*, urls, user_id, thread_id):
        captured_persist_kwargs.update(
            {
                "urls": urls,
                "user_id": user_id,
                "thread_id": thread_id,
            }
        )
        return ["persisted::image"]

    monkeypatch.setattr(service, "_get_image_client", lambda: FakeOpenAIClient())
    monkeypatch.setattr(service, "_persist_generated_images", fake_persist_generated_images)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-openai-b64",
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

    assert captured_persist_kwargs == {
        "urls": ["data:image/png;base64,aGVsbG8="],
        "user_id": "user-123",
        "thread_id": "thread-openai-b64",
    }
    assert result == ["persisted::image"]


def test_openai_text_model_still_uses_images_generate_sdk(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-5.4")

    service = ImageGenerationService()
    captured_request_kwargs: dict[str, object] = {}
    captured_persist_kwargs: dict[str, object] = {}

    class FakeResponse:
        def model_dump(self, mode="python"):
            return {
                "data": [
                    {
                        "b64_json": "aGVsbG8=",
                    }
                ]
            }

    class FakeImagesAPI:
        async def generate(self, **kwargs):
            captured_request_kwargs.update(kwargs)
            return FakeResponse()

    class FakeOpenAIClient:
        images = FakeImagesAPI()

    async def fake_persist_generated_images(*, urls, user_id, thread_id):
        captured_persist_kwargs.update(
            {
                "urls": urls,
                "user_id": user_id,
                "thread_id": thread_id,
            }
        )
        return ["persisted::response-image"]

    monkeypatch.setattr(service, "_get_image_client", lambda: FakeOpenAIClient())
    monkeypatch.setattr(service, "_persist_generated_images", fake_persist_generated_images)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-openai-responses-image",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    result = asyncio.run(
        service.generate_images(
            request=request,
            prompt="make a campaign cover image",
            user_id="user-456",
            thread_id=request.thread_id,
        )
    )

    assert captured_request_kwargs["model"] == "gpt-5.4"
    assert captured_request_kwargs["prompt"] == "make a campaign cover image"
    assert captured_request_kwargs["response_format"] == "url"
    assert captured_request_kwargs["n"] == 1
    assert captured_request_kwargs["size"] == "1024x1024"
    assert captured_request_kwargs["timeout"] == 120.0
    assert captured_persist_kwargs == {
        "urls": ["data:image/png;base64,aGVsbG8="],
        "user_id": "user-456",
        "thread_id": "thread-openai-responses-image",
    }
    assert result == ["persisted::response-image"]


def test_openai_image_generation_uses_configurable_per_request_timeout(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://api.openai.com/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.setenv("OPENAI_IMAGE_GENERATE_TIMEOUT_SECONDS", "12.5")

    service = ImageGenerationService()
    captured_request_kwargs: dict[str, object] = {}

    class FakeResponse:
        def model_dump(self, mode="python"):
            return {
                "data": [
                    {"url": "https://upstream.example/timeout-override.png"},
                ],
            }

    class FakeImagesAPI:
        async def generate(self, **kwargs):
            captured_request_kwargs.update(kwargs)
            return FakeResponse()

    class FakeOpenAIClient:
        images = FakeImagesAPI()

    monkeypatch.setattr(service, "_get_image_client", lambda: FakeOpenAIClient())

    result = asyncio.run(
        service._generate_images_with_openai_images_api(
            prompt="make a timeout override cover image",
        )
    )

    assert result == ["https://upstream.example/timeout-override.png"]
    assert captured_request_kwargs["timeout"] == 12.5
    assert captured_request_kwargs["response_format"] == "url"


def test_openai_image_generation_redacts_base64_payloads_in_logs(monkeypatch, caplog):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")

    service = ImageGenerationService()

    class FakeResponse:
        def model_dump(self, mode="python"):
            return {
                "data": [
                    {"b64_json": "aGVsbG8="},
                ],
            }

    class FakeImagesAPI:
        async def generate(self, **kwargs):
            return FakeResponse()

    class FakeOpenAIClient:
        images = FakeImagesAPI()

    monkeypatch.setattr(service, "_get_image_client", lambda: FakeOpenAIClient())

    with caplog.at_level("INFO"):
        result = asyncio.run(
            service._generate_images_with_openai(
                prompt="make a lifestyle cover image",
            )
        )

    assert result == ["data:image/png;base64,aGVsbG8="]
    assert "[BASE64_IMAGE_DATA_TRUNCATED: 8 chars]" in caplog.text
    assert "aGVsbG8=" not in caplog.text


def test_sanitize_image_response_for_log_redacts_b64_json_payloads():
    payload = {
        "created": 123,
        "data": [
            {
                "b64_json": "aGVsbG8=",
                "revised_prompt": "make a lifestyle cover image",
            }
        ],
    }

    sanitized = sanitize_image_response_for_log(payload)

    assert sanitized == {
        "created": 123,
        "data": [
            {
                "b64_json": "[BASE64_IMAGE_DATA_TRUNCATED: 8 chars]",
                "revised_prompt": "make a lifestyle cover image",
            }
        ],
    }


def test_persist_generated_images_decodes_data_urls_into_storage_uploads(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")

    service = ImageGenerationService()
    captured_upload: dict[str, object] = {}

    class FakeStorageClient:
        async def upload_file(self, *, user_id, filename, content_type, data):
            captured_upload.update(
                {
                    "user_id": user_id,
                    "filename": filename,
                    "content_type": content_type,
                    "data": data,
                }
            )

            class StoredUpload:
                backend_name = "local"
                object_key = filename

            return StoredUpload()

    monkeypatch.setattr(
        image_generation_module,
        "create_storage_client",
        lambda: FakeStorageClient(),
    )
    monkeypatch.setattr(
        image_generation_module,
        "build_delivery_url_from_stored_path",
        lambda stored_path: f"delivery::{stored_path}",
    )

    result = asyncio.run(
        service._persist_generated_images(
            urls=["data:image/png;base64,aGVsbG8="],
            user_id="user-123",
            thread_id="thread-openai-b64-storage",
        )
    )

    assert captured_upload["user_id"] == "user-123"
    assert captured_upload["content_type"] == "image/png"
    assert captured_upload["data"] == b"hello"
    assert "generated/thread-openai-b64-storage/" in str(captured_upload["filename"])
    assert result == [f"delivery::{captured_upload['filename']}"]


def test_persist_generated_images_decodes_data_urls_without_user_id(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")

    service = ImageGenerationService()
    captured_upload: dict[str, object] = {}

    class FakeStorageClient:
        async def upload_file(self, *, user_id, filename, content_type, data):
            captured_upload.update(
                {
                    "user_id": user_id,
                    "filename": filename,
                    "content_type": content_type,
                    "data": data,
                }
            )

            class StoredUpload:
                backend_name = "local"
                object_key = filename

            return StoredUpload()

    monkeypatch.setattr(
        image_generation_module,
        "create_storage_client",
        lambda preferred_backend=None: FakeStorageClient(),
    )
    monkeypatch.setattr(
        image_generation_module,
        "build_delivery_url_from_stored_path",
        lambda stored_path: f"delivery::{stored_path}",
    )

    result = asyncio.run(
        service._persist_generated_images(
            urls=["data:image/png;base64,aGVsbG8="],
            user_id=None,
            thread_id="thread-openai-b64-storage-anon",
        )
    )

    assert captured_upload["user_id"] == "system-generated"
    assert captured_upload["content_type"] == "image/png"
    assert captured_upload["data"] == b"hello"
    assert result == [f"delivery::{captured_upload['filename']}"]


def test_persist_generated_images_downloads_remote_urls_with_dedicated_timeout(monkeypatch):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")

    service = ImageGenerationService()
    captured_upload: dict[str, object] = {}
    captured_client_kwargs: dict[str, object] = {}
    captured_download: dict[str, object] = {}

    class FakeStorageClient:
        async def upload_file(self, *, user_id, filename, content_type, data):
            captured_upload.update(
                {
                    "user_id": user_id,
                    "filename": filename,
                    "content_type": content_type,
                    "data": data,
                }
            )

            class StoredUpload:
                backend_name = "local"
                object_key = filename

            return StoredUpload()

    class FakeResponse:
        headers = {"content-type": "image/png"}
        content = b"remote-image-bytes"

        def raise_for_status(self):
            return None

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            captured_client_kwargs.update(kwargs)

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return None

        async def get(self, url):
            captured_download["url"] = url
            return FakeResponse()

    monkeypatch.setattr(
        image_generation_module,
        "create_storage_client",
        lambda preferred_backend=None: FakeStorageClient(),
    )
    monkeypatch.setattr(
        image_generation_module,
        "build_delivery_url_from_stored_path",
        lambda stored_path: f"delivery::{stored_path}",
    )
    monkeypatch.setattr(image_generation_module.httpx, "AsyncClient", FakeAsyncClient)

    result = asyncio.run(
        service._persist_generated_images(
            urls=["https://upstream.example/generated-cover.png"],
            user_id=None,
            thread_id="thread-openai-url-storage-anon",
        )
    )

    assert captured_download["url"] == "https://upstream.example/generated-cover.png"
    assert captured_upload["user_id"] == "system-generated"
    assert captured_upload["content_type"] == "image/png"
    assert captured_upload["data"] == b"remote-image-bytes"
    assert captured_client_kwargs["follow_redirects"] is True
    assert isinstance(captured_client_kwargs["timeout"], httpx.Timeout)
    assert captured_client_kwargs["timeout"].read == 30.0
    assert captured_client_kwargs["timeout"].connect == 10.0
    assert result == [f"delivery::{captured_upload['filename']}"]


def test_generate_images_falls_back_to_dashscope_when_openai_returns_no_images(monkeypatch, caplog):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.setenv("IMAGE_GENERATION_API_KEY", "test-dashscope-key")
    monkeypatch.setenv("IMAGE_GENERATION_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")
    monkeypatch.setenv("IMAGE_GENERATION_MODEL", "wanx-v1")

    service = ImageGenerationService()

    async def fake_openai(*, prompt: str):
        assert prompt == "make a fallback cover image"
        return []

    async def fake_dashscope(*, request, prompt: str):
        assert request.thread_id == "thread-openai-fallback"
        assert prompt == "make a fallback cover image"
        return ["https://dashscope.example/fallback-cover.png"]

    monkeypatch.setattr(service, "_generate_images_with_openai", fake_openai)
    monkeypatch.setattr(service, "_generate_images_with_dashscope", fake_dashscope)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-openai-fallback",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    with caplog.at_level("WARNING"):
        result = asyncio.run(
            service.generate_images(
                request=request,
                prompt="make a fallback cover image",
                user_id=None,
                thread_id=request.thread_id,
            )
        )

    assert result == ["https://dashscope.example/fallback-cover.png"]
    assert "触发高可用降级，切换至 DashScope 兜底生成" in caplog.text


def test_generate_images_logs_root_timeout_before_dashscope_fallback(monkeypatch, caplog):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.setenv("IMAGE_GENERATION_API_KEY", "test-dashscope-key")
    monkeypatch.setenv("IMAGE_GENERATION_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")
    monkeypatch.setenv("IMAGE_GENERATION_MODEL", "wanx-v1")

    service = ImageGenerationService()

    class FakeImagesAPI:
        async def generate(self, **kwargs):
            raise httpx.ReadTimeout("upstream image generation timed out")

    class FakeOpenAIClient:
        images = FakeImagesAPI()

    async def fake_dashscope(*, request, prompt: str):
        assert request.thread_id == "thread-openai-timeout-fallback"
        assert prompt == "make a slow cover image"
        return ["https://dashscope.example/fallback-timeout-cover.png"]

    monkeypatch.setattr(service, "_get_image_client", lambda: FakeOpenAIClient())
    monkeypatch.setattr(service, "_generate_images_with_dashscope", fake_dashscope)

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-openai-timeout-fallback",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    with caplog.at_level("WARNING"):
        result = asyncio.run(
            service.generate_images(
                request=request,
                prompt="make a slow cover image",
                user_id=None,
                thread_id=request.thread_id,
            )
        )

    assert result == ["https://dashscope.example/fallback-timeout-cover.png"]
    assert "ReadTimeout" in caplog.text
    assert "upstream image generation timed out" in caplog.text
    assert "timed out after 120.0s" in caplog.text
    assert "Potential async billing leak" in caplog.text


def test_openai_image_generation_request_failure_returns_empty_list(monkeypatch, caplog):
    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.delenv("IMAGE_GENERATION_API_KEY", raising=False)
    monkeypatch.delenv("IMAGE_GENERATION_BASE_URL", raising=False)
    monkeypatch.delenv("IMAGE_GENERATION_MODEL", raising=False)
    monkeypatch.delenv("QWEN_API_KEY", raising=False)
    monkeypatch.delenv("QWEN_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)

    service = ImageGenerationService()

    class FakeImagesAPI:
        async def generate(self, **kwargs):
            raise RuntimeError("<html>bad gateway</html>")

    class FakeOpenAIClient:
        images = FakeImagesAPI()

    monkeypatch.setattr(service, "_get_image_client", lambda: FakeOpenAIClient())

    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-openai-non-json",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "generate a cover image",
            "materials": [],
        }
    )

    with caplog.at_level("WARNING"):
        result = asyncio.run(
            service.generate_images(
                request=request,
                prompt="make a lifestyle cover image",
                user_id="user-123",
                thread_id=request.thread_id,
            )
    )

    assert result == []
    assert "OpenAI-compatible" in caplog.text
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
            "output": [
                {
                    "type": "image_generation_call",
                    "result": "d29ybGQ=",
                }
            ],
        }
    )

    assert urls == [
        "https://upstream.example/standard.png",
        "data:image/png;base64,aGVsbG8=",
        "https://upstream.example/images-array.png",
        "https://upstream.example/image-url-dict.png",
        "data:image/png;base64,d29ybGQ=",
    ]
