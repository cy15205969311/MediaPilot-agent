from __future__ import annotations

import json
import os
import re
from collections import Counter
from typing import Any

import httpx
from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field

from app.config import load_environment

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
DEFAULT_SEARCH_TIMEOUT_SECONDS = 20.0
DEFAULT_MARKET_TREND_RESULTS = 5

PLATFORM_LABELS = {
    "xiaohongshu": "小红书",
    "douyin": "抖音",
    "xianyu": "闲鱼",
}

CATEGORY_PROFILES: dict[str, dict[str, Any]] = {
    "地域文旅": {
        "hot_keywords": ["周末短途", "小众古镇", "地铁直达", "Citywalk", "亲子半日游"],
        "traffic_notes": [
            "收藏型攻略增长稳定",
            "带路线和预算的笔记更易转化",
            "本地口吻比泛旅游口吻更可信",
        ],
        "content_angles": ["一日动线", "避坑清单", "本地人私藏路线"],
    },
    "教辅资料": {
        "hot_keywords": ["初中同步", "期末冲刺", "错题整理", "教材全解", "家长省心"],
        "traffic_notes": [
            "开学季和考试季搜索意图强",
            "明确年级和版本能提升点击",
            "低价打包和真实使用痕迹会增强信任",
        ],
        "content_angles": ["适用年级", "资料成色", "提分场景"],
    },
}

DEFAULT_CATEGORY_PROFILE = {
    "hot_keywords": ["趋势洞察", "用户痛点", "高转化标题", "真实体验", "清单化表达"],
    "traffic_notes": [
        "明确使用场景更容易获得收藏",
        "标题中加入人群和结果会提升点击",
        "案例化表达比抽象卖点更可信",
    ],
    "content_angles": ["痛点切入", "步骤拆解", "结果对比"],
}

BUSINESS_KEYWORD_STOPWORDS = {
    "",
    "最新",
    "近期",
    "现在",
    "内容",
    "平台",
    "用户",
    "市场",
    "趋势",
    "热点",
    "爆款",
    "关键词",
    "搜索",
    "标题",
    "笔记",
    "攻略",
    "推荐",
    "值得",
    "如何",
    "什么",
    "哪些",
}


class MarketTrendInput(BaseModel):
    platform: str = Field(
        ...,
        description="目标内容或交易平台，例如 xiaohongshu、douyin、xianyu。",
    )
    category: str = Field(
        ...,
        description="需要分析的业务类目，例如 地域文旅、教辅资料、探店、本地生活。",
    )


class OutlineInput(BaseModel):
    topic: str = Field(..., description="用户希望策划或生成内容的主题。")
    audience: str = Field(
        "泛内容消费人群",
        description="目标受众画像，例如 初中家长、本地周末游客、职场新人。",
    )


def _resolve_market_profile(category: str) -> dict[str, Any]:
    return CATEGORY_PROFILES.get(category, DEFAULT_CATEGORY_PROFILE)


def _normalize_platform(platform: str) -> str:
    normalized = platform.strip().lower()
    return normalized or "xiaohongshu"


def _normalize_category(category: str) -> str:
    normalized = category.strip()
    return normalized or "内容运营"


def _platform_label(platform: str) -> str:
    return PLATFORM_LABELS.get(platform, platform or "内容平台")


def _dedupe_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        deduped.append(normalized)
        seen.add(normalized)
    return deduped


def _truncate_text(value: str, limit: int) -> str:
    normalized = value.strip()
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 1].rstrip() + "…"


def _load_tavily_api_key() -> str:
    load_environment()
    return os.getenv("TAVILY_API_KEY", "").strip()


def _load_search_timeout_seconds() -> float:
    load_environment()
    raw_value = os.getenv("SEARCH_TIMEOUT_SECONDS", "").strip()
    if not raw_value:
        return DEFAULT_SEARCH_TIMEOUT_SECONDS
    try:
        parsed = float(raw_value)
    except ValueError:
        return DEFAULT_SEARCH_TIMEOUT_SECONDS
    return parsed if parsed > 0 else DEFAULT_SEARCH_TIMEOUT_SECONDS


def _build_http_timeout(seconds: float) -> httpx.Timeout:
    connect_timeout = min(seconds, 10.0)
    return httpx.Timeout(seconds, connect=connect_timeout)


def _build_market_trend_query(platform: str, category: str) -> str:
    return (
        f"{_platform_label(platform)} {category} 热门关键词 热点 趋势 爆款 "
        "内容选题 用户关注"
    )


def _request_tavily_market_search(query: str) -> dict[str, Any]:
    api_key = _load_tavily_api_key()
    if not api_key:
        raise RuntimeError("TAVILY_API_KEY is not configured")

    payload = {
        "api_key": api_key,
        "query": query,
        "topic": "general",
        "search_depth": "advanced",
        "max_results": DEFAULT_MARKET_TREND_RESULTS,
        "include_answer": True,
        "include_raw_content": False,
    }

    timeout = _build_http_timeout(_load_search_timeout_seconds())
    with httpx.Client(timeout=timeout) as client:
        response = client.post(TAVILY_SEARCH_URL, json=payload)
        response.raise_for_status()

    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("Tavily returned a non-object payload")
    return data


def _extract_keyword_candidates(text: str) -> list[str]:
    compact = re.sub(r"https?://\S+", " ", text)
    tokens = re.split(r"[\s,，。！？!?\|/:：;；、（）()\[\]【】<>《》\"“”'‘’·]+", compact)
    candidates: list[str] = []
    for token in tokens:
        normalized = token.strip("#*+-_")
        if not normalized:
            continue
        if normalized in BUSINESS_KEYWORD_STOPWORDS:
            continue
        if normalized.isdigit():
            continue
        if len(normalized) < 2 or len(normalized) > 16:
            continue
        candidates.append(normalized)
    return candidates


def _extract_live_hot_keywords(
    *,
    payload: dict[str, Any],
    profile: dict[str, Any],
    category: str,
) -> list[str]:
    answer = str(payload.get("answer", "")).strip()
    results = payload.get("results")
    if not isinstance(results, list):
        results = []

    source_text = "\n".join(
        [
            answer,
            *[
                " ".join(
                    [
                        str(item.get("title", "")).strip(),
                        str(item.get("content", "")).strip(),
                    ]
                )
                for item in results[:DEFAULT_MARKET_TREND_RESULTS]
                if isinstance(item, dict)
            ],
        ]
    )

    prioritized = [
        keyword
        for keyword in profile["hot_keywords"]
        if keyword.lower() in source_text.lower()
    ]

    counter: Counter[str] = Counter()
    for item in results[:DEFAULT_MARKET_TREND_RESULTS]:
        if not isinstance(item, dict):
            continue
        counter.update(_extract_keyword_candidates(str(item.get("title", ""))))
        counter.update(_extract_keyword_candidates(str(item.get("content", ""))))

    extracted = [
        token
        for token, _ in counter.most_common(20)
        if token not in prioritized and token != category
    ]
    combined = prioritized + extracted + list(profile["hot_keywords"])
    return _dedupe_preserve_order(combined)[:5]


def _extract_live_traffic_notes(
    *,
    payload: dict[str, Any],
    profile: dict[str, Any],
) -> list[str]:
    notes: list[str] = []

    answer = str(payload.get("answer", "")).strip()
    if answer:
        notes.append(_truncate_text(answer, 88))

    results = payload.get("results")
    if not isinstance(results, list):
        results = []

    for item in results[:2]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        content = str(item.get("content", "")).strip()
        if title:
            notes.append(f"外部热搜信号聚焦：{_truncate_text(title, 30)}")
        elif content:
            notes.append(f"外部结果补充：{_truncate_text(content, 42)}")

    return _dedupe_preserve_order(notes + list(profile["traffic_notes"]))[:3]


def _extract_live_content_angles(
    *,
    payload: dict[str, Any],
    profile: dict[str, Any],
) -> list[str]:
    angles = list(profile["content_angles"])

    results = payload.get("results")
    if not isinstance(results, list):
        results = []

    for item in results[:3]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        if not title:
            continue
        normalized_title = _truncate_text(title, 18)
        if normalized_title and normalized_title not in angles:
            angles.append(normalized_title)

    return _dedupe_preserve_order(angles)[:3]


def _build_evidence_sources(payload: dict[str, Any]) -> list[dict[str, str]]:
    results = payload.get("results")
    if not isinstance(results, list):
        return []

    evidence_sources: list[dict[str, str]] = []
    for item in results[:3]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        content = str(item.get("content", "")).strip()
        url = str(item.get("url", "")).strip()
        if not title and not content:
            continue
        evidence_sources.append(
            {
                "title": title or _truncate_text(content, 24),
                "summary": _truncate_text(content or title, 96),
                "url": url,
            }
        )
    return evidence_sources


def _build_mock_market_trend_result(
    *,
    platform: str,
    category: str,
    profile: dict[str, Any],
    data_mode: str,
    query: str | None = None,
    fallback_reason: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "tool": "analyze_market_trends",
        "platform": platform,
        "platform_label": _platform_label(platform),
        "category": category,
        "hot_keywords": profile["hot_keywords"],
        "traffic_notes": profile["traffic_notes"],
        "content_angles": profile["content_angles"],
        "recommended_next_action": "将热词自然嵌入标题、首段钩子和结构化小标题，避免机械堆砌。",
        "data_mode": data_mode,
    }
    if query:
        payload["query"] = query
    if fallback_reason:
        payload["fallback_reason"] = fallback_reason
    return payload


def _build_live_market_trend_result(
    *,
    platform: str,
    category: str,
    query: str,
    profile: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    evidence_sources = _build_evidence_sources(payload)
    answer = str(payload.get("answer", "")).strip()
    if not answer and not evidence_sources:
        raise RuntimeError("Tavily returned no usable market evidence")

    return {
        "tool": "analyze_market_trends",
        "platform": platform,
        "platform_label": _platform_label(platform),
        "category": category,
        "query": query,
        "hot_keywords": _extract_live_hot_keywords(
            payload=payload,
            profile=profile,
            category=category,
        ),
        "traffic_notes": _extract_live_traffic_notes(payload=payload, profile=profile),
        "content_angles": _extract_live_content_angles(payload=payload, profile=profile),
        "recommended_next_action": (
            "优先把实时热搜里重复出现的人群、场景和结果词写进标题与首屏钩子，"
            "再用来源摘要补强正文可信度。"
        ),
        "data_mode": "live_tavily",
        "search_answer": answer,
        "evidence_sources": evidence_sources,
        "source_count": len(evidence_sources),
    }


@tool(args_schema=MarketTrendInput)
def analyze_market_trends(platform: str, category: str) -> str:
    """Analyze platform/category market trends and return hot keywords, traffic signals, and opportunities as JSON, preferring live Tavily search when configured."""
    normalized_platform = _normalize_platform(platform)
    normalized_category = _normalize_category(category)
    profile = _resolve_market_profile(normalized_category)
    search_query = _build_market_trend_query(normalized_platform, normalized_category)

    api_key = _load_tavily_api_key()
    if not api_key:
        return json.dumps(
            _build_mock_market_trend_result(
                platform=normalized_platform,
                category=normalized_category,
                profile=profile,
                data_mode="mock",
                query=search_query,
            ),
            ensure_ascii=False,
        )

    try:
        live_payload = _request_tavily_market_search(search_query)
        return json.dumps(
            _build_live_market_trend_result(
                platform=normalized_platform,
                category=normalized_category,
                query=search_query,
                profile=profile,
                payload=live_payload,
            ),
            ensure_ascii=False,
        )
    except Exception as exc:  # pragma: no cover - network/runtime fallback
        return json.dumps(
            _build_mock_market_trend_result(
                platform=normalized_platform,
                category=normalized_category,
                profile=profile,
                data_mode="mock_fallback",
                query=search_query,
                fallback_reason=str(exc),
            ),
            ensure_ascii=False,
        )


@tool(args_schema=OutlineInput)
def generate_content_outline(topic: str, audience: str = "泛内容消费人群") -> str:
    """Generate a concise business-oriented content outline for a topic and audience as JSON."""
    normalized_topic = topic.strip() or "内容选题"
    normalized_audience = audience.strip() or "泛内容消费人群"
    return json.dumps(
        {
            "tool": "generate_content_outline",
            "topic": normalized_topic,
            "audience": normalized_audience,
            "outline": [
                "用目标人群正在关心的问题开场",
                "给出可验证的场景或数据线索",
                "拆成 3 个可执行步骤或看点",
                "用收藏、咨询或下单动作收尾",
            ],
            "data_mode": "mock",
        },
        ensure_ascii=False,
    )


BUSINESS_TOOLS: list[BaseTool] = [analyze_market_trends, generate_content_outline]
BUSINESS_TOOL_REGISTRY: dict[str, BaseTool] = {
    tool_item.name: tool_item for tool_item in BUSINESS_TOOLS
}


def get_business_tools() -> list[BaseTool]:
    return list(BUSINESS_TOOLS)


def get_openai_tool_specs() -> list[dict[str, object]]:
    specs: list[dict[str, object]] = []
    for tool_item in BUSINESS_TOOLS:
        args_schema = tool_item.args_schema
        parameters = (
            args_schema.model_json_schema()
            if args_schema is not None and hasattr(args_schema, "model_json_schema")
            else {"type": "object", "properties": tool_item.args}
        )
        specs.append(
            {
                "type": "function",
                "function": {
                    "name": tool_item.name,
                    "description": tool_item.description,
                    "parameters": parameters,
                },
            }
        )
    return specs


def execute_business_tool(name: str, arguments: dict[str, Any]) -> str:
    tool_item = BUSINESS_TOOL_REGISTRY.get(name)
    if tool_item is None:
        raise ValueError(f"Unknown business tool: {name}")
    return str(tool_item.invoke(arguments))
