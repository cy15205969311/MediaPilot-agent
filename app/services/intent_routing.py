from __future__ import annotations

from dataclasses import dataclass
import re

from app.models.schemas import MaterialType, MediaChatRequest, TaskType


_TEXT_ONLY_KEYWORDS = (
    "不要图片",
    "不用图片",
    "无需图片",
    "只要文案",
    "只要文字",
    "纯文字",
    "仅文案",
    "只写文案",
    "只写正文",
    "text only",
    "no image",
    "no images",
    "without image",
    "without images",
)

_DIRECT_IMAGE_ONLY_KEYWORDS = (
    "只要图片",
    "只要海报",
    "只要封面",
    "只出图",
    "直接出图",
    "纯出图",
    "不要文案",
    "无需文案",
    "不要正文",
    "无需正文",
    "不要文章",
    "image only",
    "poster only",
    "cover only",
    "no copy",
    "just the image",
)

_TEXT_OUTPUT_KEYWORDS = (
    "文案",
    "正文",
    "草稿",
    "写一篇",
    "写一段",
    "写一个",
    "写个",
    "改写",
    "润色",
    "翻译",
    "分析",
    "解读",
    "总结",
    "提炼",
    "脚本",
    "口播",
    "标题",
    "选题",
    "评论回复",
    "回复",
    "caption",
    "copy",
    "article",
    "script",
    "outline",
    "rewrite",
    "summarize",
    "summary",
    "translate",
    "analysis",
    "analyze",
    "describe",
    "extract",
    "ocr",
)

_IMAGE_GENERATION_KEYWORDS = (
    "生成图片",
    "生成一张",
    "生成海报",
    "生成封面",
    "生成配图",
    "画一张",
    "画个",
    "出一张图",
    "做一张图",
    "做个海报",
    "设计一张",
    "设计海报",
    "生图",
    "出图",
    "海报",
    "宣传图",
    "封面图",
    "主视觉",
    "thumbnail",
    "poster",
    "cover image",
    "hero image",
    "illustration",
    "banner",
)

_IMAGE_ANALYSIS_KEYWORDS = (
    "分析这张图",
    "分析图片",
    "看这张图",
    "看图",
    "识别",
    "提取图片",
    "提取图中",
    "图里",
    "图上",
    "图中",
    "图片内容",
    "根据图片",
    "根据这张图",
    "describe this image",
    "analyze this image",
    "extract text",
)

_DIRECT_IMAGE_PATTERNS = (
    re.compile(
        r"(?:帮我|请|直接)?(?:生成|做|画|设计)(?:一张|个)?(?:.+)?"
        r"(?:海报|图片|封面|宣传图|主视觉)",
    ),
    re.compile(
        r"(?:generate|create|design)\s+(?:a\s+)?(?:new\s+)?"
        r"(?:poster|image|cover|thumbnail|illustration|banner)",
    ),
)


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
    resolution = resolve_media_chat_task_type(request)
    if not resolution.overridden:
        return request, resolution

    return (
        request.model_copy(
            deep=True,
            update={"task_type": resolution.resolved_task_type},
        ),
        resolution,
    )


def resolve_media_chat_task_type(request: MediaChatRequest) -> SmartTaskResolution:
    requested_task_type = request.task_type
    if requested_task_type not in {TaskType.CONTENT_GENERATION, TaskType.IMAGE_GENERATION}:
        return SmartTaskResolution(
            requested_task_type=requested_task_type,
            resolved_task_type=requested_task_type,
            reason="non_overridable_task_type",
            direct_image_mode=False,
        )

    normalized_message = _normalize_message(request.message)
    has_image_materials = any(material.type == MaterialType.IMAGE for material in request.materials)
    explicit_text_only = _contains_any(normalized_message, _TEXT_ONLY_KEYWORDS)
    explicit_image_only = _contains_any(normalized_message, _DIRECT_IMAGE_ONLY_KEYWORDS)
    wants_text_output = _contains_any(normalized_message, _TEXT_OUTPUT_KEYWORDS)
    wants_new_image = _asks_for_new_image(normalized_message)
    wants_image_analysis = has_image_materials and (
        _contains_any(normalized_message, _IMAGE_ANALYSIS_KEYWORDS) or wants_text_output
    )

    if explicit_text_only and requested_task_type == TaskType.IMAGE_GENERATION:
        return SmartTaskResolution(
            requested_task_type=requested_task_type,
            resolved_task_type=TaskType.CONTENT_GENERATION,
            reason="explicit_text_only_request",
            direct_image_mode=False,
        )

    if wants_image_analysis:
        return SmartTaskResolution(
            requested_task_type=requested_task_type,
            resolved_task_type=TaskType.CONTENT_GENERATION,
            reason="image_materials_requested_for_text_or_analysis",
            direct_image_mode=False,
        )

    if explicit_image_only or (wants_new_image and not wants_text_output and not explicit_text_only):
        return SmartTaskResolution(
            requested_task_type=requested_task_type,
            resolved_task_type=TaskType.IMAGE_GENERATION,
            reason=(
                "explicit_image_only_request"
                if explicit_image_only
                else "strong_image_generation_signal"
            ),
            direct_image_mode=True,
        )

    if requested_task_type == TaskType.IMAGE_GENERATION and wants_text_output:
        return SmartTaskResolution(
            requested_task_type=requested_task_type,
            resolved_task_type=TaskType.CONTENT_GENERATION,
            reason="text_generation_prompt_overrode_image_task",
            direct_image_mode=False,
        )

    return SmartTaskResolution(
        requested_task_type=requested_task_type,
        resolved_task_type=requested_task_type,
        reason="kept_requested_task_type",
        direct_image_mode=requested_task_type == TaskType.IMAGE_GENERATION and bool(normalized_message),
    )


def should_route_to_direct_image_generation(
    request: MediaChatRequest,
    *,
    resolution: SmartTaskResolution | None = None,
) -> bool:
    effective_resolution = resolution or resolve_media_chat_task_type(request)
    return effective_resolution.direct_image_mode


def _normalize_message(message: str) -> str:
    return " ".join(message.strip().lower().split())


def _contains_any(message: str, keywords: tuple[str, ...]) -> bool:
    if not message:
        return False
    return any(keyword in message for keyword in keywords)


def _asks_for_new_image(message: str) -> bool:
    if not message:
        return False

    if _contains_any(message, _IMAGE_GENERATION_KEYWORDS):
        return True

    return any(pattern.search(message) for pattern in _DIRECT_IMAGE_PATTERNS)
