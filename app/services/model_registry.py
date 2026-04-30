from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

from app.services.providers import (
    DEFAULT_QWEN_PRIMARY_MODEL,
    _is_dashscope_compatible_base_url,
)

ModelProviderStatus = Literal["configured", "unconfigured"]


@dataclass(frozen=True)
class RegisteredModel:
    id: str
    model: str
    name: str
    group: str
    tags: tuple[str, ...]
    is_default: bool = False


@dataclass(frozen=True)
class RegisteredProvider:
    provider_key: str
    provider: str
    status: ModelProviderStatus
    status_label: str
    models: tuple[RegisteredModel, ...]


GROUP_ORDER = (
    "大语言模型",
    "视觉理解",
    "全模态",
    "语音",
    "向量",
    "图像与视频",
)

MODEL_PRIORITY = {
    "qwen-max": 0,
    "qwen-plus": 1,
    "qwen-turbo": 2,
    "qwen-flash": 3,
    "qwen-long": 4,
    "qwen3-max": 5,
    "qwen3-vl-plus": 6,
    "qwen3-vl-flash": 7,
    "qwen-omni": 8,
    "qwen3-omni": 9,
    "qwen3-asr-flash": 10,
    "qwen-tts": 11,
    "text-embedding-v4": 12,
    "wan2.6-t2v": 13,
    "wan2.7-t2v": 14,
}

_DASHSCOPE_MODEL_IDS = (
    "cosyvoice-v1",
    "cosyvoice-v2",
    "cosyvoice-v3-flash",
    "cosyvoice-v3-plus",
    "cosyvoice-v3.5-flash",
    "cosyvoice-v3.5-plus",
    "gte-rerank-v2",
    "paraformer-8k-v1",
    "paraformer-8k-v2",
    "paraformer-mtl-v1",
    "paraformer-realtime-8k-v1",
    "paraformer-realtime-8k-v2",
    "paraformer-realtime-v1",
    "paraformer-realtime-v2",
    "paraformer-v1",
    "paraformer-v2",
    "qvq-72b-preview",
    "qvq-max",
    "qvq-plus",
    "qwen-14b",
    "qwen-14b-chat",
    "qwen-32b",
    "qwen-72b-chat",
    "qwen-7b",
    "qwen-7b-chat",
    "qwen-audio-asr",
    "qwen-audio-chat",
    "qwen-audio-turbo",
    "qwen-coder",
    "qwen-coder-plus",
    "qwen-coder-turbo",
    "qwen-doc",
    "qwen-doc-turbo",
    "qwen-flash",
    "qwen-flash-character",
    "qwen-flash-title",
    "qwen-image",
    "qwen-image-2.0",
    "qwen-image-2.0-pro",
    "qwen-image-edit",
    "qwen-image-edit-max",
    "qwen-image-edit-plus",
    "qwen-image-max",
    "qwen-image-plus",
    "qwen-long",
    "qwen-math",
    "qwen-math-plus",
    "qwen-math-turbo",
    "qwen-max",
    "qwen-mt-flash",
    "qwen-mt-image",
    "qwen-mt-lite",
    "qwen-mt-plus",
    "qwen-mt-turbo",
    "qwen-omni",
    "qwen-omni-turbo",
    "qwen-omni-turbo-realtime",
    "qwen-plus",
    "qwen-plus-character",
    "qwen-plus-character-ja",
    "qwen-tts",
    "qwen-tts-realtime",
    "qwen-turbo",
    "qwen-vl-max",
    "qwen-vl-ocr",
    "qwen-vl-plus",
    "qwen2.5",
    "qwen2.5-0.5b-instruct",
    "qwen2.5-1.5b-instruct",
    "qwen2.5-14b",
    "qwen2.5-14b-instruct",
    "qwen2.5-14b-instruct-1m",
    "qwen2.5-32b",
    "qwen2.5-32b-instruct",
    "qwen2.5-3b-instruct",
    "qwen2.5-72b-instruct",
    "qwen2.5-7b-instruct",
    "qwen2.5-7b-instruct-1m",
    "qwen2.5-coder-0.5b-instruct",
    "qwen2.5-coder-1.5b-instruct",
    "qwen2.5-coder-14b-instruct",
    "qwen2.5-coder-32b-instruct",
    "qwen2.5-coder-3b-instruct",
    "qwen2.5-coder-7b-instruct",
    "qwen2.5-math",
    "qwen2.5-math-1.5b",
    "qwen2.5-math-1.5b-instruct",
    "qwen2.5-math-72b-instruct",
    "qwen2.5-math-7b",
    "qwen2.5-math-7b-instruct",
    "qwen2.5-max",
    "qwen2.5-omni-7b",
    "qwen2.5-vl",
    "qwen2.5-vl-32b-instruct",
    "qwen2.5-vl-3b-instruct",
    "qwen2.5-vl-72b-instruct",
    "qwen2.5-vl-7b-instruct",
    "qwen2.5-vl-embedding",
    "qwen3",
    "qwen3-0.6b",
    "qwen3-1.7b",
    "qwen3-14b",
    "qwen3-235b-a22b",
    "qwen3-235b-a22b-instruct",
    "qwen3-235b-a22b-thinking",
    "qwen3-30b-a3b",
    "qwen3-30b-a3b-instruct",
    "qwen3-30b-a3b-thinking",
    "qwen3-32b",
    "qwen3-4b",
    "qwen3-8b",
    "qwen3-asr-flash",
    "qwen3-asr-flash-filetrans",
    "qwen3-asr-flash-realtime",
    "qwen3-coder",
    "qwen3-coder-30b-a3b-instruct",
    "qwen3-coder-480b-a35b-instruct",
    "qwen3-coder-flash",
    "qwen3-coder-next",
    "qwen3-coder-plus",
    "qwen3-embedding",
    "qwen3-livetranslate-flash",
    "qwen3-livetranslate-flash-realtime",
    "qwen3-max",
    "qwen3-max-preview",
    "qwen3-max-thinking",
    "qwen3-mt",
    "qwen3-next-80b-a3b-instruct",
    "qwen3-next-80b-a3b-thinking",
    "qwen3-omni",
    "qwen3-omni-30b-a3b-captioner",
    "qwen3-omni-c",
    "qwen3-omni-captioner",
    "qwen3-omni-flash",
    "qwen3-omni-flash-realtime",
    "qwen3-rerank",
    "qwen3-tts-flash",
    "qwen3-tts-flash-realtime",
    "qwen3-tts-instruct-flash",
    "qwen3-tts-instruct-flash-realtime",
    "qwen3-tts-vc",
    "qwen3-tts-vc-realtime",
    "qwen3-tts-vd",
    "qwen3-tts-vd-realtime",
    "qwen3-vl",
    "qwen3-vl-235b-a22b-instruct",
    "qwen3-vl-235b-a22b-thinking",
    "qwen3-vl-30b-a3b-instruct",
    "qwen3-vl-30b-a3b-thinking",
    "qwen3-vl-32b-instruct",
    "qwen3-vl-32b-thinking",
    "qwen3-vl-8b-instruct",
    "qwen3-vl-8b-thinking",
    "qwen3-vl-embedding",
    "qwen3-vl-flash",
    "qwen3-vl-plus",
    "qwen3-vl-rerank",
    "qwen3.5",
    "qwen3.5-122b-a10b",
    "qwen3.5-27b",
    "qwen3.5-35b-a3b",
    "qwen3.5-397b-a17b",
    "qwen3.5-flash",
    "qwen3.5-omni-flash",
    "qwen3.5-omni-flash-realtime",
    "qwen3.5-omni-plus",
    "qwen3.5-omni-plus-realtime",
    "qwen3.5-plus",
    "qwen3.6",
    "qwen3.6-27b",
    "qwen3.6-35b-a3b",
    "qwen3.6-flash",
    "qwen3.6-max-preview",
    "qwen3.6-plus",
    "sensevoice-v1",
    "text-embedding-async-v1",
    "text-embedding-async-v2",
    "text-embedding-v1",
    "text-embedding-v2",
    "text-embedding-v3",
    "text-embedding-v4",
    "wan-image-edit",
    "wan-pro",
    "wan-std",
    "wan2.1-i2v-plus",
    "wan2.1-i2v-turbo",
    "wan2.1-kf2v-plus",
    "wan2.1-t2i-plus",
    "wan2.1-t2i-turbo",
    "wan2.1-t2v-plus",
    "wan2.1-t2v-turbo",
    "wan2.1-vace-plus",
    "wan2.2-animate-mix",
    "wan2.2-animate-move",
    "wan2.2-i2v-flash",
    "wan2.2-i2v-plus",
    "wan2.2-kf2v-flash",
    "wan2.2-s2v",
    "wan2.2-s2v-detect",
    "wan2.2-t2i-flash",
    "wan2.2-t2i-plus",
    "wan2.2-t2v-plus",
    "wan2.5",
    "wan2.5-i2i-preview",
    "wan2.5-i2v-preview",
    "wan2.5-t2i-preview",
    "wan2.5-t2v-preview",
    "wan2.6",
    "wan2.6-china",
    "wan2.6-i2v",
    "wan2.6-i2v-flash",
    "wan2.6-image",
    "wan2.6-r2v",
    "wan2.6-r2v-flash",
    "wan2.6-t2i",
    "wan2.6-t2v",
    "wan2.7-i2v",
    "wan2.7-image",
    "wan2.7-image-pro",
    "wan2.7-r2v",
    "wan2.7-t2v",
    "wan2.7-videoedit",
    "wanx2.0-t2i-turbo",
    "wanx2.1-i2v-plus",
    "wanx2.1-i2v-turbo",
    "wanx2.1-imageedit",
    "wanx2.1-kf2v-plus",
    "wanx2.1-t2i-plus",
    "wanx2.1-t2i-turbo",
    "wanx2.1-t2v-plus",
    "wanx2.1-t2v-turbo",
    "wanx2.1-vace-plus",
)


def _format_model_display_name(model_name: str) -> str:
    label = model_name
    replacements = (
        ("qwen3.6", "Qwen3.6"),
        ("qwen3.5", "Qwen3.5"),
        ("qwen3", "Qwen3"),
        ("qwen2.5", "Qwen2.5"),
        ("qwen2", "Qwen2"),
        ("qwen1.5", "Qwen1.5"),
        ("qwen", "Qwen"),
        ("qvq", "QVQ"),
        ("wanx", "Wanx"),
        ("wan", "Wan"),
        ("cosyvoice", "CosyVoice"),
        ("sensevoice", "SenseVoice"),
        ("paraformer", "Paraformer"),
        ("text-embedding", "Text Embedding"),
        ("gte-rerank", "GTE Rerank"),
    )
    for source, target in replacements:
        if label.startswith(source):
            label = target + label[len(source) :]
            break

    token_map = {
        "vl": "VL",
        "ocr": "OCR",
        "tts": "TTS",
        "asr": "ASR",
        "mt": "MT",
        "omni": "Omni",
        "coder": "Coder",
        "math": "Math",
        "flash": "Flash",
        "plus": "Plus",
        "max": "Max",
        "turbo": "Turbo",
        "preview": "Preview",
        "thinking": "Thinking",
        "instruct": "Instruct",
        "realtime": "Realtime",
        "rerank": "Rerank",
        "embedding": "Embedding",
        "captioner": "Captioner",
        "lite": "Lite",
        "filetrans": "FileTrans",
        "audio": "Audio",
        "image": "Image",
        "edit": "Edit",
        "doc": "Doc",
        "character": "Character",
        "title": "Title",
        "china": "China",
        "vc": "VC",
        "vd": "VD",
        "i2v": "I2V",
        "t2i": "T2I",
        "t2v": "T2V",
        "r2v": "R2V",
        "s2v": "S2V",
        "kf2v": "KF2V",
        "vace": "VACE",
    }
    parts = []
    for raw_part in label.split("-"):
        lowered = raw_part.lower()
        parts.append(token_map.get(lowered, raw_part))
    return " ".join(parts)


def _unique_tags(tags: list[str]) -> tuple[str, ...]:
    unique: list[str] = []
    seen: set[str] = set()
    for tag in tags:
        if not tag or tag in seen:
            continue
        unique.append(tag)
        seen.add(tag)
    return tuple(unique)


def _infer_model_group(model_name: str) -> str:
    lowered = model_name.lower()

    if any(
        keyword in lowered
        for keyword in (
            "tts",
            "asr",
            "voice",
            "audio",
            "sensevoice",
            "cosyvoice",
            "paraformer",
        )
    ):
        return "语音"

    if "embedding" in lowered or "rerank" in lowered:
        return "向量"

    if "omni" in lowered:
        return "全模态"

    if "vl" in lowered or "ocr" in lowered:
        return "视觉理解"

    if lowered.startswith(("wan", "wanx")) or any(
        keyword in lowered
        for keyword in ("image", "t2i", "t2v", "i2v", "r2v", "s2v", "kf2v", "videoedit", "vace")
    ):
        return "图像与视频"

    return "大语言模型"


def _infer_model_tags(model_name: str) -> tuple[str, ...]:
    lowered = model_name.lower()
    tags: list[str] = []
    group = _infer_model_group(model_name)
    tags.append(group)

    if "coder" in lowered:
        tags.append("代码")
    if "math" in lowered or "thinking" in lowered:
        tags.append("推理")
    if "mt" in lowered or "translate" in lowered:
        tags.append("翻译")
    if "ocr" in lowered:
        tags.append("OCR")
    if "realtime" in lowered:
        tags.append("实时")
    if "captioner" in lowered:
        tags.append("描述")

    if "max" in lowered:
        tags.append("旗舰")
    elif "plus" in lowered:
        tags.append("均衡")
    elif "flash" in lowered or "turbo" in lowered or "lite" in lowered:
        tags.append("高速")

    if "preview" in lowered:
        tags.append("预览")

    return _unique_tags(tags)


def _resolve_dashscope_default_model() -> str:
    default_model = (
        os.getenv("QWEN_PRIMARY_MODEL", "").strip()
        or os.getenv("QWEN_MODEL", "").strip()
        or os.getenv("LLM_MODEL", "").strip()
        or DEFAULT_QWEN_PRIMARY_MODEL
    )
    if ":" in default_model:
        _, _, default_model = default_model.partition(":")
    return default_model.strip() or DEFAULT_QWEN_PRIMARY_MODEL


def _dashscope_is_configured() -> bool:
    if os.getenv("QWEN_API_KEY", "").strip():
        return True

    llm_api_key = os.getenv("LLM_API_KEY", "").strip()
    if not llm_api_key:
        return False

    provider_name = os.getenv("OMNIMEDIA_LLM_PROVIDER", "").strip().lower()
    llm_base_url = os.getenv("LLM_BASE_URL")
    return provider_name in {"qwen", "dashscope"} or _is_dashscope_compatible_base_url(
        llm_base_url,
    )


def _model_sort_key(model: RegisteredModel) -> tuple[int, int, str]:
    try:
        group_index = GROUP_ORDER.index(model.group)
    except ValueError:
        group_index = len(GROUP_ORDER)
    priority = MODEL_PRIORITY.get(model.model, 999)
    return (group_index, priority, model.name.lower())


def get_available_model_providers() -> tuple[RegisteredProvider, ...]:
    configured = _dashscope_is_configured()
    default_model = _resolve_dashscope_default_model()
    models = tuple(
        sorted(
            (
                RegisteredModel(
                    id=f"dashscope:{model_name}",
                    model=model_name,
                    name=_format_model_display_name(model_name),
                    group=_infer_model_group(model_name),
                    tags=_infer_model_tags(model_name),
                    is_default=model_name == default_model,
                )
                for model_name in _DASHSCOPE_MODEL_IDS
            ),
            key=_model_sort_key,
        ),
    )
    return (
        RegisteredProvider(
            provider_key="dashscope",
            provider="阿里百炼 (DashScope)",
            status="configured" if configured else "unconfigured",
            status_label="已配置" if configured else "需要配置",
            models=models,
        ),
    )
