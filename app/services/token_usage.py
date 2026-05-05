from __future__ import annotations

from typing import Any

from app.models.schemas import ArtifactPayloadModel

ESTIMATED_TOKENS_PER_CHARACTER = 1.35
LEGACY_MODEL_NAME = "legacy"
UNTRACKED_HISTORICAL_MODEL_LABEL = "Untracked (\u5386\u53f2\u6570\u636e)"


def normalize_model_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    if not normalized:
        return None

    if ":" in normalized:
        provider_key, _, model_name = normalized.partition(":")
        if provider_key.strip() and model_name.strip():
            return model_name.strip()

    return normalized


def coerce_token_count(value: Any) -> int:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, normalized)


def extract_total_tokens(raw_usage: Any) -> int:
    if raw_usage is None:
        return 0

    if isinstance(raw_usage, dict):
        if "total_tokens" in raw_usage:
            return coerce_token_count(raw_usage.get("total_tokens"))

        prompt_tokens = coerce_token_count(
            raw_usage.get("prompt_tokens", raw_usage.get("input_tokens")),
        )
        completion_tokens = coerce_token_count(
            raw_usage.get("completion_tokens", raw_usage.get("output_tokens")),
        )
        return prompt_tokens + completion_tokens

    total_tokens = getattr(raw_usage, "total_tokens", None)
    if total_tokens is not None:
        return coerce_token_count(total_tokens)

    prompt_tokens = coerce_token_count(
        getattr(raw_usage, "prompt_tokens", getattr(raw_usage, "input_tokens", 0)),
    )
    completion_tokens = coerce_token_count(
        getattr(
            raw_usage,
            "completion_tokens",
            getattr(raw_usage, "output_tokens", 0),
        ),
    )
    return prompt_tokens + completion_tokens


def build_model_token_usage(model_name: Any, total_tokens: Any) -> dict[str, int]:
    normalized_model_name = normalize_model_name(model_name) or LEGACY_MODEL_NAME
    normalized_total_tokens = coerce_token_count(total_tokens)
    if normalized_total_tokens <= 0:
        return {}
    return {normalized_model_name: normalized_total_tokens}


def normalize_model_token_usage(raw_usage: Any) -> dict[str, int]:
    if not isinstance(raw_usage, dict):
        return {}

    normalized_usage: dict[str, int] = {}
    for raw_model_name, raw_total_tokens in raw_usage.items():
        normalized_model_name = normalize_model_name(raw_model_name) or LEGACY_MODEL_NAME
        normalized_total_tokens = coerce_token_count(raw_total_tokens)
        if normalized_total_tokens <= 0:
            continue
        normalized_usage[normalized_model_name] = (
            normalized_usage.get(normalized_model_name, 0) + normalized_total_tokens
        )
    return normalized_usage


def merge_model_token_usage(*usage_maps: Any) -> dict[str, int]:
    merged_usage: dict[str, int] = {}

    for usage_map in usage_maps:
        for model_name, total_tokens in normalize_model_token_usage(usage_map).items():
            merged_usage[model_name] = merged_usage.get(model_name, 0) + total_tokens

    return merged_usage


def estimate_text_tokens(text: str | None) -> int:
    normalized = str(text or "").strip()
    if not normalized:
        return 0
    return int(round(len(normalized) * ESTIMATED_TOKENS_PER_CHARACTER))


def estimate_payload_tokens(payload: Any) -> int:
    text_size = _estimate_payload_text_size(payload)
    return int(round(text_size * ESTIMATED_TOKENS_PER_CHARACTER))


def estimate_generated_output_tokens(
    *,
    assistant_text: str | None,
    artifact: ArtifactPayloadModel | None,
) -> int:
    artifact_tokens = 0
    if artifact is not None:
        artifact_tokens = estimate_payload_tokens(artifact.model_dump(mode="json"))

    text_tokens = estimate_text_tokens(assistant_text)
    return max(text_tokens, artifact_tokens)


def _estimate_payload_text_size(payload: Any) -> int:
    if not isinstance(payload, dict):
        return 0

    artifact_type = str(payload.get("artifact_type", "")).strip()
    if artifact_type == "content_draft":
        body = payload.get("body")
        title_candidates = payload.get("title_candidates")
        cta = payload.get("platform_cta")
        return (
            len(str(body or "").strip())
            + _sum_string_list_lengths(title_candidates)
            + len(str(cta or "").strip())
        )

    if artifact_type == "image_result":
        return (
            len(str(payload.get("prompt", "")).strip())
            + len(str(payload.get("platform_cta", "")).strip())
            + len(str(payload.get("original_prompt", "")).strip())
            + len(str(payload.get("revised_prompt", "")).strip())
        )

    if artifact_type == "topic_list":
        topics = payload.get("topics")
        if isinstance(topics, list):
            return sum(
                len(str(item.get("title", "")).strip())
                + len(str(item.get("angle", "")).strip())
                + len(str(item.get("goal", "")).strip())
                for item in topics
                if isinstance(item, dict)
            )

    if artifact_type == "hot_post_analysis":
        dimensions = payload.get("analysis_dimensions")
        reusable_templates = payload.get("reusable_templates")
        dimension_text = 0
        if isinstance(dimensions, list):
            dimension_text = sum(
                len(str(item.get("dimension", "")).strip())
                + len(str(item.get("insight", "")).strip())
                for item in dimensions
                if isinstance(item, dict)
            )
        return dimension_text + _sum_string_list_lengths(reusable_templates)

    if artifact_type == "comment_reply":
        suggestions = payload.get("suggestions")
        if isinstance(suggestions, list):
            return sum(
                len(str(item.get("comment_type", "")).strip())
                + len(str(item.get("scenario", "")).strip())
                + len(str(item.get("reply", "")).strip())
                + len(str(item.get("compliance_note", "")).strip())
                for item in suggestions
                if isinstance(item, dict)
            )

    total = 0
    for value in payload.values():
        if isinstance(value, str):
            total += len(value.strip())
        elif isinstance(value, list):
            total += _sum_string_list_lengths(value)
    return total


def _sum_string_list_lengths(values: Any) -> int:
    if not isinstance(values, list):
        return 0
    return sum(len(str(item).strip()) for item in values)
