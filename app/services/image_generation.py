from __future__ import annotations

import asyncio
import base64
import copy
import json
import logging
import mimetypes
import os
import re
import uuid

import httpx
from openai import APITimeoutError
from openai import AsyncOpenAI

from app.config import get_openai_image_settings, load_environment
from app.models.schemas import MediaChatRequest, Platform
from app.services.model_access import role_has_premium_model_access
from app.services.oss_client import (
    build_delivery_url_from_stored_path,
    build_stored_file_path,
    create_storage_client,
)

load_environment()

logger = logging.getLogger(__name__)

DEFAULT_DASHSCOPE_API_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"
DEFAULT_DASHSCOPE_COMPATIBLE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
DEFAULT_DASHSCOPE_IMAGE_MODEL = "qwen-image-2.0"
DEFAULT_IMAGE_PROMPT_MODEL = "qwen-turbo"
DEFAULT_IMAGE_GENERATION_COUNT = 1
DEFAULT_IMAGE_GENERATION_TIMEOUT_SECONDS = 120.0
DEFAULT_IMAGE_GENERATION_POLL_INTERVAL_SECONDS = 2.0
OPENAI_COMPATIBLE_IMAGE_SIZE = "1024x1024"
DEFAULT_OPENAI_IMAGE_GENERATE_TIMEOUT_SECONDS = 120.0
DEFAULT_GENERATED_IMAGE_DOWNLOAD_TIMEOUT_SECONDS = 30.0
DEFAULT_OPENAI_COMPATIBLE_IMAGE_REQUEST_TIMEOUT_SECONDS = 180.0
MAX_IMAGE_GENERATION_COUNT = 3
DEFAULT_DASHSCOPE_DOUYIN_IMAGE_SIZE = "928*1664"
DEFAULT_DASHSCOPE_XIAOHONGSHU_IMAGE_SIZE = "1104*1472"
WANX_V1_DOUYIN_IMAGE_SIZE = "720*1280"
WANX_V1_XIAOHONGSHU_IMAGE_SIZE = "768*1152"
BASE64_LOG_PLACEHOLDER = "[BASE64_IMAGE_DATA_TRUNCATED_FOR_LOGS]"
MAX_LOG_STRING_LENGTH = 1200
SYSTEM_GENERATED_IMAGE_USER_ID = "system-generated"


def _build_http_timeout(seconds: float) -> httpx.Timeout:
    connect_timeout = min(seconds, 10.0)
    return httpx.Timeout(seconds, connect=connect_timeout)


def _read_positive_float_env(env_name: str, default: float) -> float:
    raw_value = os.getenv(env_name, "").strip()
    if not raw_value:
        return default
    try:
        parsed = float(raw_value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _read_positive_int_env(env_name: str, default: int) -> int:
    raw_value = os.getenv(env_name, "").strip()
    if not raw_value:
        return default
    try:
        parsed = int(raw_value)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def _clamp_image_count(count: int) -> int:
    return max(1, min(MAX_IMAGE_GENERATION_COUNT, count))


def _is_enabled_env(env_name: str, default: bool = False) -> bool:
    raw_value = os.getenv(env_name, "").strip().lower()
    if not raw_value:
        return default
    return raw_value in {"1", "true", "yes", "on"}


def _derive_dashscope_api_base_url(reference_url: str | None) -> str:
    normalized = (reference_url or "").strip()
    if not normalized:
        return DEFAULT_DASHSCOPE_API_BASE_URL
    return re.sub(
        r"/compatible-mode/v\d+/?$",
        "/api/v1",
        normalized.rstrip("/"),
    )


def _derive_dashscope_prompt_base_url(reference_url: str | None) -> str:
    normalized = (reference_url or "").strip()
    if not normalized:
        return DEFAULT_DASHSCOPE_COMPATIBLE_BASE_URL
    if "/compatible-mode/" in normalized:
        return normalized.rstrip("/")
    return DEFAULT_DASHSCOPE_COMPATIBLE_BASE_URL


def _resolve_image_generation_backend() -> str:
    return os.getenv("IMAGE_GENERATION_BACKEND", "disabled").strip().lower() or "disabled"


def _resolve_dashscope_image_generation_api_key() -> str:
    return (
        os.getenv("IMAGE_GENERATION_API_KEY", "").strip()
        or os.getenv("QWEN_API_KEY", "").strip()
        or os.getenv("LLM_API_KEY", "").strip()
    )


def _resolve_dashscope_image_generation_base_url() -> str:
    explicit_base_url = os.getenv("IMAGE_GENERATION_BASE_URL", "").strip()
    if explicit_base_url:
        return explicit_base_url.rstrip("/")
    return _derive_dashscope_api_base_url(
        os.getenv("QWEN_BASE_URL", "").strip() or os.getenv("LLM_BASE_URL", "").strip(),
    )


def _resolve_image_prompt_api_key() -> str:
    return (
        os.getenv("IMAGE_PROMPT_API_KEY", "").strip()
        or os.getenv("QWEN_API_KEY", "").strip()
        or os.getenv("LLM_API_KEY", "").strip()
    )


def _resolve_image_prompt_base_url() -> str:
    explicit_base_url = os.getenv("IMAGE_PROMPT_BASE_URL", "").strip()
    if explicit_base_url:
        return explicit_base_url.rstrip("/")
    return _derive_dashscope_prompt_base_url(
        os.getenv("QWEN_BASE_URL", "").strip() or os.getenv("LLM_BASE_URL", "").strip(),
    )


def _is_wanx_v1_model(model_name: str) -> bool:
    return model_name.strip().lower() == "wanx-v1"


def _resolve_dashscope_platform_size(
    platform: Platform,
    *,
    model_name: str = "",
) -> str:
    if _is_wanx_v1_model(model_name):
        if platform == Platform.DOUYIN:
            return WANX_V1_DOUYIN_IMAGE_SIZE
        return WANX_V1_XIAOHONGSHU_IMAGE_SIZE

    if platform == Platform.DOUYIN:
        return DEFAULT_DASHSCOPE_DOUYIN_IMAGE_SIZE
    return DEFAULT_DASHSCOPE_XIAOHONGSHU_IMAGE_SIZE


def _compact_text(value: str, limit: int = 240) -> str:
    compact = " ".join(str(value or "").split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."


def _describe_exception_for_log(exc: Exception) -> str:
    root_exc: BaseException = exc
    while getattr(root_exc, "__cause__", None) is not None:
        root_exc = root_exc.__cause__  # type: ignore[assignment]
    return f"{type(root_exc).__name__}: {root_exc}"


def _looks_like_base64_image_data(value: str) -> bool:
    normalized = value.strip()
    if not normalized:
        return False
    if normalized.startswith("data:image/"):
        return True
    compact = "".join(normalized.split())
    return len(compact) > 256 and re.fullmatch(r"[A-Za-z0-9+/=]+", compact) is not None


def _sanitize_log_string(value: str, *, limit: int = MAX_LOG_STRING_LENGTH) -> str:
    if _looks_like_base64_image_data(value):
        return BASE64_LOG_PLACEHOLDER
    if len(value) <= limit:
        return value
    remaining = len(value) - limit
    return f"{value[:limit].rstrip()}... [truncated {remaining} chars]"


def _build_base64_log_placeholder(value: object) -> str:
    if isinstance(value, str) and value:
        return f"[BASE64_IMAGE_DATA_TRUNCATED: {len(value)} chars]"
    return BASE64_LOG_PLACEHOLDER


def _sanitize_log_payload(payload: object) -> object:
    if isinstance(payload, dict):
        normalized_type = str(payload.get("type", "")).strip().lower()
        return {
            str(key): (
                _build_base64_log_placeholder(value)
                if (
                    str(key).strip().lower() == "b64_json"
                    or (
                        normalized_type == "image_generation_call"
                        and str(key).strip().lower() == "result"
                    )
                )
                else _sanitize_log_payload(value)
            )
            for key, value in payload.items()
        }
    if isinstance(payload, list):
        return [_sanitize_log_payload(item) for item in payload]
    if isinstance(payload, tuple):
        return [_sanitize_log_payload(item) for item in payload]
    if isinstance(payload, str):
        return _sanitize_log_string(payload)
    return payload


def _resolve_generated_image_storage_user_id(user_id: str | None) -> str:
    normalized = (user_id or "").strip()
    return normalized or SYSTEM_GENERATED_IMAGE_USER_ID


def _resolve_cover_title(
    *,
    request: MediaChatRequest,
    artifact_candidate: dict[str, object] | None,
    draft: str,
) -> str:
    if isinstance(artifact_candidate, dict):
        title_candidates = artifact_candidate.get("title_candidates")
        if isinstance(title_candidates, list):
            for item in title_candidates:
                normalized = str(item).strip()
                if normalized:
                    return normalized
        title = str(artifact_candidate.get("title", "")).strip()
        if title:
            return title

    if draft.strip():
        first_line = draft.strip().splitlines()[0]
        if first_line.strip():
            return _compact_text(first_line, limit=42)

    return _compact_text(request.message, limit=42) or "封面主标题"


def _build_heuristic_cover_prompt(
    *,
    request: MediaChatRequest,
    draft: str,
    artifact_candidate: dict[str, object] | None,
) -> str:
    cover_title = _resolve_cover_title(
        request=request,
        artifact_candidate=artifact_candidate,
        draft=draft,
    )
    summary = _compact_text(
        draft
        or str((artifact_candidate or {}).get("body", "")).strip()
        or request.message,
        limit=260,
    )

    if request.platform == Platform.DOUYIN:
        platform_style = (
            "抖音爆款封面，竖版 9:16，视觉冲击力强，对比鲜明，主体特写明显，"
            "适合短视频首屏停留。"
        )
    else:
        platform_style = (
            "小红书高点击封面，竖版 3:4，生活方式感、真实质感、明亮高级，"
            "适合图文笔记封面。"
        )

    return (
        f"{platform_style}\n"
        f"主题标题：{cover_title}\n"
        f"内容摘要：{summary}\n"
        "画面要求：\n"
        "1. 只保留一个核心视觉主体和一个明确场景，不要做杂乱拼贴。\n"
        "2. 构图干净，主体靠前，留出可放标题的安全留白区域。\n"
        "3. 商业摄影质感，色彩统一，有情绪张力，但不要廉价夸张。\n"
        "4. 不要水印、不要 logo、不要边框、不要二维码。\n"
        f"5. 如果需要画面文字，只允许极少量清晰中文标题，优先使用：{cover_title}\n"
        "6. 输出适合品牌营销与内容运营场景的封面图。"
    ).strip()


def _extract_dashscope_image_urls(payload: object) -> list[str]:
    if not isinstance(payload, dict):
        return []

    output = payload.get("output")
    if not isinstance(output, dict):
        return []

    urls: list[str] = []

    choices = output.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            message = choice.get("message")
            if not isinstance(message, dict):
                continue
            content = message.get("content")
            if isinstance(content, list):
                for item in content:
                    if not isinstance(item, dict):
                        continue
                    candidates = [
                        item.get("image"),
                        item.get("url"),
                        item.get("image_url"),
                    ]
                    image_url = item.get("image_url")
                    if isinstance(image_url, dict):
                        candidates.append(image_url.get("url"))
                    for candidate in candidates:
                        normalized = str(candidate or "").strip()
                        if normalized.startswith("http"):
                            urls.append(normalized)

    results = output.get("results")
    if isinstance(results, list):
        for result in results:
            if not isinstance(result, dict):
                continue
            for candidate in (
                result.get("url"),
                result.get("image"),
                result.get("image_url"),
            ):
                normalized = str(candidate or "").strip()
                if normalized.startswith("http"):
                    urls.append(normalized)

    return _dedupe_urls(urls)


def _append_openai_base64_reference(urls: list[str], candidate: object) -> None:
    normalized = str(candidate or "").strip()
    if not normalized:
        return
    if normalized.startswith("data:image/"):
        urls.append(normalized)
        return
    compact_base64 = "".join(normalized.split())
    if compact_base64:
        urls.append(f"data:image/png;base64,{compact_base64}")


def _append_openai_image_reference(urls: list[str], candidate: object) -> None:
    if isinstance(candidate, dict):
        if str(candidate.get("type", "")).strip().lower() == "image_generation_call":
            _append_openai_base64_reference(urls, candidate.get("result"))
        for key in ("url", "image"):
            _append_openai_image_reference(urls, candidate.get(key))
        _append_openai_base64_reference(urls, candidate.get("b64_json"))
        image_url = candidate.get("image_url")
        if isinstance(image_url, dict):
            _append_openai_image_reference(urls, image_url.get("url"))
        else:
            _append_openai_image_reference(urls, image_url)
        return

    normalized = str(candidate or "").strip()
    if not normalized:
        return
    if normalized.startswith("http"):
        urls.append(normalized)
        return
    if normalized.startswith("data:image/"):
        urls.append(normalized)
        return

    # OpenAI-compatible gateways may return raw b64_json without the data URL prefix.
    if len(normalized) > 100 and re.fullmatch(r"[A-Za-z0-9+/=\s]+", normalized):
        compact_base64 = "".join(normalized.split())
        urls.append(f"data:image/png;base64,{compact_base64}")


def _extract_openai_image_urls(payload: object) -> list[str]:
    urls: list[str] = []
    if not isinstance(payload, dict):
        return urls

    response_data = payload.get("data")
    if isinstance(response_data, list):
        for item in response_data:
            _append_openai_image_reference(urls, item)

    images = payload.get("images")
    if isinstance(images, list):
        for item in images:
            _append_openai_image_reference(urls, item)

    output = payload.get("output")
    if isinstance(output, list):
        for item in output:
            _append_openai_image_reference(urls, item)
    elif isinstance(output, dict):
        _append_openai_image_reference(urls, output.get("url"))
        _append_openai_image_reference(urls, output.get("image"))
        _append_openai_image_reference(urls, output.get("image_url"))
        _append_openai_base64_reference(urls, output.get("b64_json"))
        output_images = output.get("images")
        if isinstance(output_images, list):
            for item in output_images:
                _append_openai_image_reference(urls, item)

    return _dedupe_urls(urls)


def _dedupe_urls(urls: list[str]) -> list[str]:
    deduped_urls: list[str] = []
    seen_urls: set[str] = set()
    for url in urls:
        if url in seen_urls:
            continue
        seen_urls.add(url)
        deduped_urls.append(url)
    return deduped_urls


def _read_response_text(response: httpx.Response | None) -> str:
    if response is None:
        return ""
    try:
        return response.text
    except Exception as exc:  # pragma: no cover - defensive logging fallback
        return f"<failed to read response text: {exc}>"


def _parse_image_generation_response_json(
    response: httpx.Response,
    *,
    provider_name: str,
) -> dict[str, object] | None:
    response_text = _sanitize_log_string(_read_response_text(response))
    try:
        payload = response.json()
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error(
            "%s image generation API returned non-JSON data. status=%s raw_response=%s",
            provider_name,
            response.status_code,
            response_text,
        )
        logger.debug("%s image generation JSON decode failed: %s", provider_name, exc)
        return None

    if not isinstance(payload, dict):
        logger.error(
            "%s image generation returned a non-object response. status=%s body=%s payload=%s",
            provider_name,
            response.status_code,
            response_text,
            _sanitize_log_payload(payload),
        )
        return None

    return payload


def _resolve_extension(*, source_url: str, content_type: str | None) -> str:
    normalized_content_type = (content_type or "").split(";", 1)[0].strip().lower()
    guessed_extension = (
        mimetypes.guess_extension(normalized_content_type)
        if normalized_content_type
        else None
    )
    if guessed_extension:
        return guessed_extension.lstrip(".")

    path = source_url.split("?", 1)[0]
    guessed_type = mimetypes.guess_type(path)[0]
    guessed_extension = mimetypes.guess_extension(guessed_type or "")
    if guessed_extension:
        return guessed_extension.lstrip(".")
    return "png"


def _decode_data_image_url(source_url: str) -> tuple[bytes, str]:
    match = re.match(
        r"^data:(?P<content_type>image/[a-zA-Z0-9.+-]+);base64,(?P<payload>.+)$",
        source_url,
        flags=re.DOTALL,
    )
    if not match:
        raise RuntimeError("Generated image data URL is invalid.")

    image_bytes = base64.b64decode(match.group("payload"), validate=True)
    if not image_bytes:
        raise RuntimeError("Generated image data URL is empty.")
    return image_bytes, match.group("content_type").lower()


def _serialize_openai_response_payload(response: object) -> dict[str, object]:
    if isinstance(response, dict):
        return response
    model_dump = getattr(response, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump(mode="python")
        if isinstance(dumped, dict):
            return dumped
    return {"response": str(response)}


def sanitize_image_response_for_log(response_obj: object) -> dict[str, object]:
    try:
        safe_data = copy.deepcopy(_serialize_openai_response_payload(response_obj))
        sanitized = _sanitize_log_payload(safe_data)
        if isinstance(sanitized, dict):
            return sanitized
        return {"response": sanitized}
    except Exception:
        return {"notice": "Log sanitization failed, omitted."}


class ImageGenerationService:
    def __init__(self) -> None:
        self.backend = _resolve_image_generation_backend()
        self.dashscope_api_key = _resolve_dashscope_image_generation_api_key()
        self.dashscope_base_url = _resolve_dashscope_image_generation_base_url()
        self.dashscope_model = (
            os.getenv("IMAGE_GENERATION_MODEL", "").strip()
            or DEFAULT_DASHSCOPE_IMAGE_MODEL
        )
        self.openai_settings = get_openai_image_settings()
        self.count = _clamp_image_count(
            _read_positive_int_env(
                "IMAGE_GENERATION_COUNT",
                DEFAULT_IMAGE_GENERATION_COUNT,
            ),
        )
        self.timeout_seconds = _read_positive_float_env(
            "IMAGE_GENERATION_TIMEOUT_SECONDS",
            DEFAULT_IMAGE_GENERATION_TIMEOUT_SECONDS,
        )
        self.poll_interval_seconds = _read_positive_float_env(
            "IMAGE_GENERATION_POLL_INTERVAL_SECONDS",
            DEFAULT_IMAGE_GENERATION_POLL_INTERVAL_SECONDS,
        )
        self.request_timeout = _build_http_timeout(self.timeout_seconds)
        self.openai_request_timeout = _build_http_timeout(
            _read_positive_float_env(
                "OPENAI_IMAGE_REQUEST_TIMEOUT_SECONDS",
                max(
                    DEFAULT_OPENAI_COMPATIBLE_IMAGE_REQUEST_TIMEOUT_SECONDS,
                    self.timeout_seconds,
                ),
            ),
        )
        self.openai_generate_timeout_seconds = _read_positive_float_env(
            "OPENAI_IMAGE_GENERATE_TIMEOUT_SECONDS",
            DEFAULT_OPENAI_IMAGE_GENERATE_TIMEOUT_SECONDS,
        )
        self.generated_image_download_timeout = _build_http_timeout(
            _read_positive_float_env(
                "GENERATED_IMAGE_DOWNLOAD_TIMEOUT_SECONDS",
                DEFAULT_GENERATED_IMAGE_DOWNLOAD_TIMEOUT_SECONDS,
            ),
        )
        self.persist_results = _is_enabled_env(
            "IMAGE_GENERATION_PERSIST_RESULTS",
            default=True,
        )
        self.prompt_api_key = _resolve_image_prompt_api_key()
        self.prompt_base_url = _resolve_image_prompt_base_url()
        self.prompt_model = (
            os.getenv("IMAGE_PROMPT_MODEL", "").strip()
            or DEFAULT_IMAGE_PROMPT_MODEL
        )
        self.prompt_timeout = _build_http_timeout(
            _read_positive_float_env(
                "IMAGE_PROMPT_TIMEOUT_SECONDS",
                self.timeout_seconds,
            ),
        )
        self._image_client: AsyncOpenAI | None = None
        self._prompt_client: AsyncOpenAI | None = None

    def _resolve_configured_backend(self) -> str:
        requested_backend = self.backend
        if requested_backend == "disabled":
            return "disabled"
        if requested_backend == "dashscope":
            return "dashscope" if self._has_dashscope_config() else "disabled"
        if requested_backend == "openai":
            return "openai" if self._has_openai_config() else "disabled"
        if requested_backend == "auto":
            if self._has_dashscope_config():
                return "dashscope"
            if self._has_openai_config():
                return "openai"
            return "disabled"
        return "disabled"

    def resolve_backend(self, *, user_role: str | None = None) -> str:
        configured_backend = self._resolve_configured_backend()
        if configured_backend in {"disabled", "dashscope"}:
            return configured_backend

        if user_role is None:
            return configured_backend

        if role_has_premium_model_access(user_role):
            return configured_backend

        if self._has_dashscope_config():
            return "dashscope"
        return "disabled"

    def resolve_model(self, *, user_role: str | None = None) -> str:
        backend = self.resolve_backend(user_role=user_role)
        if backend == "openai":
            return self.openai_settings.model
        if backend == "dashscope":
            return self.dashscope_model
        return ""

    def is_enabled(self, *, user_role: str | None = None) -> bool:
        return self.resolve_backend(user_role=user_role) != "disabled"

    async def build_prompt(
        self,
        *,
        request: MediaChatRequest,
        draft: str,
        artifact_candidate: dict[str, object] | None,
    ) -> str:
        heuristic_prompt = _build_heuristic_cover_prompt(
            request=request,
            draft=draft,
            artifact_candidate=artifact_candidate,
        )
        if not (self.prompt_api_key and self.prompt_model):
            return heuristic_prompt

        try:
            response = await self._get_prompt_client().chat.completions.create(
                model=self.prompt_model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是资深新媒体视觉策划。请根据给定草稿生成一段中文文生图提示词，"
                            "用于生成高点击封面图。只输出最终提示词，不要解释。"
                        ),
                    },
                    {
                        "role": "user",
                        "content": (
                            f"目标平台：{request.platform.value}\n"
                            f"候选标题：{_resolve_cover_title(request=request, artifact_candidate=artifact_candidate, draft=draft)}\n"
                            f"正文摘要：{_compact_text(draft, limit=320)}\n"
                            f"请输出一段适合 {request.platform.value} 的高点击封面图提示词，"
                            "强调主体、场景、情绪、构图、质感和留白。"
                        ),
                    },
                ],
                temperature=0.5,
                timeout=self.prompt_timeout,
            )
            content = str(response.choices[0].message.content or "").strip()
            if content:
                return content
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - graceful fallback
            logger.warning("Image prompt builder fallback triggered: %s", exc)

        return heuristic_prompt

    async def generate_images(
        self,
        *,
        request: MediaChatRequest,
        prompt: str,
        user_id: str | None,
        user_role: str | None = None,
        thread_id: str,
    ) -> list[str]:
        active_backend = self.resolve_backend(user_role=user_role)
        if active_backend == "disabled":
            logger.info(
                "image_generation skipped thread_id=%s role=%s backend=disabled requested_backend=%s",
                thread_id,
                (user_role or "").strip() or "<unknown>",
                self.backend,
            )
            return []

        requested_count = 1 if active_backend == "openai" else self.count
        logger.info(
            "image_generation start thread_id=%s role=%s backend=%s model=%s count=%s",
            thread_id,
            (user_role or "").strip() or "<unknown>",
            active_backend,
            self.resolve_model(user_role=user_role) or "<unset>",
            requested_count,
        )

        if active_backend == "openai":
            urls = await self._generate_images_with_openai_with_fallback(
                request=request,
                prompt=prompt,
            )
        else:
            urls = await self._generate_images_with_dashscope(
                request=request,
                prompt=prompt,
            )

        if not urls:
            return []

        return await self._persist_generated_images(
            urls=urls,
            user_id=user_id,
            thread_id=thread_id,
        )

    async def _generate_images_with_openai_with_fallback(
        self,
        *,
        request: MediaChatRequest,
        prompt: str,
    ) -> list[str]:
        try:
            urls = await self._generate_images_with_openai(prompt=prompt)
            if urls:
                return urls
            raise RuntimeError(
                "OpenAI-compatible image generation returned no usable image references.",
            )
        except asyncio.CancelledError:
            logger.info("Image generation cancelled before fallback could start.")
            raise
        except Exception as exc:
            if not self._has_dashscope_config():
                logger.warning(
                    "主生图引擎(OpenAI-compatible)失败，且 DashScope 兜底不可用。exception=%s",
                    _describe_exception_for_log(exc),
                )
                return []

            logger.warning(
                "主生图引擎(OpenAI-compatible)失败，触发高可用降级，切换至 DashScope 兜底生成。exception=%s",
                _describe_exception_for_log(exc),
            )
            try:
                return await self._generate_images_with_dashscope(
                    request=request,
                    prompt=prompt,
                )
            except Exception as fallback_exc:
                logger.error(
                    "DashScope 兜底生图在 OpenAI-compatible 失败后仍然执行失败。exception=%s",
                    _describe_exception_for_log(fallback_exc),
                )
                return []

    async def _generate_images_with_dashscope(
        self,
        *,
        request: MediaChatRequest,
        prompt: str,
    ) -> list[str]:
        if _is_wanx_v1_model(self.dashscope_model):
            payload = {
                "model": self.dashscope_model,
                "input": {
                    "prompt": prompt,
                },
                "parameters": {
                    "size": _resolve_dashscope_platform_size(
                        request.platform,
                        model_name=self.dashscope_model,
                    ),
                    "n": self.count,
                },
            }
            return await self._generate_images_with_dashscope_async_task(
                payload,
                endpoint_path="/services/aigc/text2image/image-synthesis",
            )

        payload = {
            "model": self.dashscope_model,
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": prompt,
                            }
                        ],
                    }
                ]
            },
            "parameters": {
                "size": _resolve_dashscope_platform_size(
                    request.platform,
                    model_name=self.dashscope_model,
                ),
                "n": self.count,
            },
        }

        if self._should_use_dashscope_async_task():
            return await self._generate_images_with_dashscope_async_task(payload)
        return await self._generate_images_with_dashscope_sync(payload)

    def _should_use_dashscope_async_task(self) -> bool:
        normalized_model = self.dashscope_model.strip().lower()
        return normalized_model.startswith("wan")

    async def _generate_images_with_dashscope_sync(
        self,
        payload: dict[str, object],
    ) -> list[str]:
        endpoint = (
            f"{self.dashscope_base_url.rstrip('/')}"
            "/services/aigc/multimodal-generation/generation"
        )
        response = await self._request_dashscope_json(
            "POST",
            endpoint,
            json=payload,
        )
        if response is None:
            return []
        return _extract_dashscope_image_urls(response)

    async def _generate_images_with_dashscope_async_task(
        self,
        payload: dict[str, object],
        *,
        endpoint_path: str = "/services/aigc/image-generation/generation",
    ) -> list[str]:
        endpoint = f"{self.dashscope_base_url.rstrip('/')}{endpoint_path}"
        response = await self._request_dashscope_json(
            "POST",
            endpoint,
            headers={"X-DashScope-Async": "enable"},
            json=payload,
        )
        if response is None:
            return []
        task_id = str(((response.get("output") or {}).get("task_id") or "")).strip()
        if not task_id:
            raise RuntimeError("DashScope image generation did not return a task_id.")

        max_attempts = max(1, int(self.timeout_seconds / self.poll_interval_seconds))
        for _ in range(max_attempts):
            await asyncio.sleep(self.poll_interval_seconds)
            task_payload = await self._request_dashscope_json(
                "GET",
                f"{self.dashscope_base_url.rstrip('/')}/tasks/{task_id}",
            )
            if task_payload is None:
                continue
            task_output = task_payload.get("output")
            if not isinstance(task_output, dict):
                continue

            task_status = str(task_output.get("task_status", "")).strip().upper()
            if task_status in {"SUCCEEDED", "SUCCESS"}:
                urls = _extract_dashscope_image_urls(task_payload)
                if urls:
                    return urls
                break
            if task_status in {"FAILED", "CANCELED", "CANCELLED"}:
                raise RuntimeError(
                    str(
                        task_output.get("message")
                        or task_output.get("task_message")
                        or "DashScope image task failed."
                    ),
                )

        raise RuntimeError("DashScope image generation task timed out.")

    async def _request_dashscope_json(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        json: dict[str, object] | None = None,
    ) -> dict[str, object] | None:
        request_headers = {
            "Authorization": f"Bearer {self.dashscope_api_key}",
            "Content-Type": "application/json",
        }
        if headers:
            request_headers.update(headers)

        try:
            async with httpx.AsyncClient(
                timeout=self.request_timeout,
                follow_redirects=True,
            ) as client:
                response = await client.request(
                    method,
                    url,
                    headers=request_headers,
                    json=json,
                )
                _read_response_text(response)
                response.raise_for_status()
        except asyncio.CancelledError:
            raise
        except httpx.HTTPStatusError as exc:
            response_text = _sanitize_log_string(_read_response_text(exc.response))
            raise RuntimeError(
                "DashScope image generation HTTP request failed: "
                f"{exc}; response={response_text}",
            ) from exc
        except Exception as exc:
            raise RuntimeError(
                f"DashScope image generation request failed: {exc}",
            ) from exc

        return _parse_image_generation_response_json(
            response,
            provider_name="DashScope",
        )

    async def _generate_images_with_openai(
        self,
        *,
        prompt: str,
    ) -> list[str]:
        return await self._generate_images_with_openai_images_api(prompt=prompt)

    async def _generate_images_with_openai_images_api(
        self,
        *,
        prompt: str,
    ) -> list[str]:
        try:
            response = await self._get_image_client().images.generate(
                model=self.openai_settings.model,
                prompt=prompt,
                response_format="url",
                n=1,
                size=OPENAI_COMPATIBLE_IMAGE_SIZE,
                timeout=self.openai_generate_timeout_seconds,
            )
        except asyncio.CancelledError:
            raise
        except httpx.ReadTimeout as exc:
            logger.error(
                "OpenAI-compatible image generation timed out after %.1fs. "
                "Potential async billing leak avoided only via explicit fallback; "
                "please verify proxy stability, upstream queue latency, or user balance. error=%s",
                self.openai_generate_timeout_seconds,
                exc,
            )
            raise RuntimeError(
                f"OpenAI-compatible image generation request timed out after "
                f"{self.openai_generate_timeout_seconds:.1f}s: {exc}",
            ) from exc
        except APITimeoutError as exc:
            logger.error(
                "OpenAI-compatible image generation SDK timeout after %.1fs. "
                "Potential async billing leak avoided only via explicit fallback; "
                "please verify proxy stability, upstream queue latency, or user balance. error=%s",
                self.openai_generate_timeout_seconds,
                exc,
            )
            raise RuntimeError(
                f"OpenAI-compatible image generation request timed out after "
                f"{self.openai_generate_timeout_seconds:.1f}s: {exc}",
            ) from exc
        except Exception as exc:
            raise RuntimeError(
                f"OpenAI-compatible image generation request failed: {exc}",
            ) from exc

        data = _serialize_openai_response_payload(response)
        logger.info(
            "OpenAI-compatible image generation raw response: %s",
            sanitize_image_response_for_log(response),
        )

        if isinstance(data.get("error"), dict):
            logger.error(
                "OpenAI-compatible image generation error response: %s",
                sanitize_image_response_for_log(response),
            )
            error = data["error"]
            raise RuntimeError(
                str(error.get("message") or error.get("code") or "OpenAI-compatible image generation failed."),
            )

        urls = _extract_openai_image_urls(data)
        if urls:
            return urls

        logger.error(
            "OpenAI-compatible image generation returned no usable image references: %s",
            sanitize_image_response_for_log(response),
        )
        return []

    async def _persist_generated_images(
        self,
        *,
        urls: list[str],
        user_id: str | None,
        thread_id: str,
    ) -> list[str]:
        has_data_image_urls = any(url.startswith("data:image/") for url in urls)
        if not self.persist_results and not has_data_image_urls:
            return urls

        try:
            storage_client = create_storage_client()
        except RuntimeError as exc:  # pragma: no cover - environment-specific fallback
            logger.warning("Image storage persistence skipped: %s", exc)
            if not has_data_image_urls:
                return urls
            storage_client = create_storage_client(preferred_backend="local")

        storage_user_id = _resolve_generated_image_storage_user_id(user_id)
        persisted_urls: list[str] = []
        async with httpx.AsyncClient(
            timeout=self.generated_image_download_timeout,
            follow_redirects=True,
        ) as client:
            for index, url in enumerate(urls, start=1):
                try:
                    if url.startswith("data:image/"):
                        image_bytes, content_type = _decode_data_image_url(url)
                    else:
                        response = await client.get(url)
                        response.raise_for_status()
                        image_bytes = response.content
                        if not image_bytes:
                            raise RuntimeError("Generated image content is empty.")

                        content_type = (
                            response.headers.get("content-type", "").split(";", 1)[0].strip()
                            or "image/png"
                        )
                    extension = _resolve_extension(
                        source_url=url,
                        content_type=content_type,
                    )
                    filename = f"generated/{thread_id}/{uuid.uuid4().hex}-{index}.{extension}"
                    persisted_urls.append(
                        await self._store_generated_image_bytes(
                            storage_client=storage_client,
                            storage_user_id=storage_user_id,
                            filename=filename,
                            content_type=content_type,
                            image_bytes=image_bytes,
                        )
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # pragma: no cover - network/storage fallback
                    logger.warning(
                        "Generated image persistence failed for %s: %s",
                        _sanitize_log_string(url),
                        exc,
                    )
                    if has_data_image_urls and url.startswith("data:image/"):
                        try:
                            fallback_storage_client = create_storage_client(
                                preferred_backend="local"
                            )
                            image_bytes, content_type = _decode_data_image_url(url)
                            extension = _resolve_extension(
                                source_url=url,
                                content_type=content_type,
                            )
                            filename = (
                                f"generated/{thread_id}/{uuid.uuid4().hex}-{index}.{extension}"
                            )
                            persisted_urls.append(
                                await self._store_generated_image_bytes(
                                    storage_client=fallback_storage_client,
                                    storage_user_id=storage_user_id,
                                    filename=filename,
                                    content_type=content_type,
                                    image_bytes=image_bytes,
                                )
                            )
                            continue
                        except Exception as fallback_exc:
                            logger.error(
                                "Generated base64 image local fallback persistence failed "
                                "thread_id=%s error=%s",
                                thread_id,
                                fallback_exc,
                            )
                            continue
                    persisted_urls.append(url)

        return persisted_urls

    async def _store_generated_image_bytes(
        self,
        *,
        storage_client,
        storage_user_id: str,
        filename: str,
        content_type: str,
        image_bytes: bytes,
    ) -> str:
        stored_upload = await storage_client.upload_file(
            user_id=storage_user_id,
            filename=filename,
            content_type=content_type,
            data=image_bytes,
        )
        stored_path = build_stored_file_path(
            stored_upload.backend_name,
            stored_upload.object_key,
        )
        return build_delivery_url_from_stored_path(stored_path)

    def _has_dashscope_config(self) -> bool:
        return bool(self.dashscope_api_key and self.dashscope_base_url and self.dashscope_model)

    def _has_openai_config(self) -> bool:
        return bool(
            self.openai_settings.api_key
            and self.openai_settings.base_url
            and self.openai_settings.model
        )

    def _get_image_client(self) -> AsyncOpenAI:
        if self._image_client is None:
            self._image_client = AsyncOpenAI(
                api_key=self.openai_settings.api_key,
                base_url=self.openai_settings.base_url,
                timeout=self.openai_request_timeout,
            )
        return self._image_client

    def _get_prompt_client(self) -> AsyncOpenAI:
        if self._prompt_client is None:
            self._prompt_client = AsyncOpenAI(
                api_key=self.prompt_api_key,
                base_url=self.prompt_base_url,
                timeout=self.prompt_timeout,
            )
        return self._prompt_client


DashScopeImageGenerationService = ImageGenerationService


def build_cover_image_prompt(
    *,
    request: MediaChatRequest,
    draft: str,
    artifact_candidate: dict[str, object] | None,
) -> str:
    return _build_heuristic_cover_prompt(
        request=request,
        draft=draft,
        artifact_candidate=artifact_candidate,
    )
