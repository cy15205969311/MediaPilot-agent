from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from collections import Counter
from typing import Any

import httpx
from langchain_core.tools import BaseTool, tool
from openai import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    OpenAI,
    OpenAIError,
    RateLimitError,
)
from pydantic import BaseModel, Field, ValidationError

from app.config import load_environment

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
DEFAULT_SEARCH_TIMEOUT_SECONDS = 20.0
DEFAULT_MARKET_TREND_RESULTS = 5
DEFAULT_SKILL_DISCOVERY_RESULTS = 5
DEFAULT_SKILL_TEMPLATE_COUNT = 3

logger = logging.getLogger(__name__)

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


class PromptSkillSearchInput(BaseModel):
    keyword: str = Field(
        ...,
        description="想要扩展的模板主题或行业关键词，例如 福州文旅、闲鱼教辅、STM32 教程。",
    )
    category: str = Field(
        "",
        description="可选的模板行业分类，例如 美食文旅、数码科技、电商/闲鱼。",
    )

class SkillTemplateDraft(BaseModel):
    title: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=500)
    platform: str = Field(default="全平台", max_length=40)
    category: str = Field(default="云端发现", max_length=40)
    knowledge_base_scope: str | None = Field(default=None, max_length=120)
    system_prompt: str = Field(default="", max_length=6000)


class SkillTemplateList(BaseModel):
    templates: list[SkillTemplateDraft] = Field(default_factory=list)


class SkillExtractorConfig(BaseModel):
    api_key: str
    model: str
    base_url: str | None = None
    timeout_seconds: float = 60.0


SKILL_SYSTEM_PROMPT_TEMPLATE = """你是一位顶级的 Prompt 架构师。我将提供给你一份最新的全网搜索结果上下文。
请你基于这些搜索结果，提取并提炼出 3 个最适合“{category}”领域、针对“{query}”的高级提示词框架（例如：RTF框架、BROKE框架、ICEL框架、CREATE框架等）。

【严格要求】：
1. 不要写普通的营销文案！你需要写的是用来约束大模型的元提示词（Meta-Prompt）。
2. `system_prompt` 字段必须包含清晰的结构（如：Role, Task, Format, Constraints），并包含各种占位符 [变量]。
3. `description` 需要解释这个框架为什么能火，它解决了什么痛点（例如：“利用同龄人焦虑制造悬念”）。
4. 你必须分别输出 1 个 RTF、1 个 BROKE、1 个 CREATE 框架，不要重复，不要偷换成普通标题。

搜索结果上下文：
{search_context}
"""

SKILL_USER_PROMPT_TEMPLATE = """请严格输出一个 JSON object，顶层只有 `templates` 字段，且必须返回恰好 3 个模板。

每个模板对象必须包含以下字段：
- title
- description
- platform
- category
- knowledge_base_scope
- system_prompt

额外约束：
- 必须分别输出 RTF、BROKE、CREATE 三个不同框架，`title` 必须明确出现对应框架名
- `platform` 只能是：小红书、抖音、闲鱼、技术博客
- `category` 优先使用：{category}
- `knowledge_base_scope` 使用小写 snake_case；如果无法判断可返回 null
- `system_prompt` 必须显式包含 `[Role]:`、`[Task]:`、`[Format]:`、`[Constraints]:`、`[Variables]:` 五段
- `system_prompt` 中至少出现 3 个形如 `[变量]` 的占位符
- 不要输出 Markdown 代码块，不要解释，不要附加多余字段
"""

SKILL_FALLBACK_FRAMEWORKS: tuple[dict[str, str], ...] = (
    {
        "code": "RTF",
        "name": "RTF 痛点转化框架",
        "description_hook": "用 Role-Task-Format 快速锁定角色、任务和输出样式，适合把用户焦虑转成可执行内容。",
    },
    {
        "code": "BROKE",
        "name": "BROKE 悬念破局框架",
        "description_hook": "先点破用户卡点，再给出结果承诺和执行边界，适合做高点击率的钩子型 Prompt。",
    },
    {
        "code": "CREATE",
        "name": "CREATE 结构化成交框架",
        "description_hook": "把场景、证据、行动路径和转化动作连成闭环，适合做需要强引导的内容模板。",
    },
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


async def _request_tavily_market_search_async(query: str) -> dict[str, Any]:
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
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(TAVILY_SEARCH_URL, json=payload)
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


async def analyze_market_trends_async(platform: str, category: str) -> str:
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
        live_payload = await _request_tavily_market_search_async(search_query)
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
    except asyncio.CancelledError:
        raise
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


SKILL_DISCOVERY_BLUEPRINTS: tuple[dict[str, str | None], ...] = (
    {
        "id": "skill-travel-emotion-route",
        "title": "在地情绪路线笔记",
        "description": "把路线、情绪价值、预算和出片点揉进同一篇文旅笔记，适合周末短途与 Citywalk 内容。",
        "platform": "小红书",
        "category": "美食文旅",
        "knowledge_base_scope": "travel_local_guides",
        "system_prompt": (
            "你是一名擅长本地生活内容策划的编辑。"
            "请围绕真实路线、情绪价值、预算感、交通便利和出片点输出内容，"
            "让读者既能感受到松弛氛围，也能立刻照着走。"
        ),
    },
    {
        "id": "skill-finance-budget-reset",
        "title": "工资到账预算重启卡",
        "description": "适合围绕精致穷、月度账单和理财回血的高共鸣表达，语气温和但不虚浮。",
        "platform": "小红书",
        "category": "职场金融",
        "knowledge_base_scope": "monthly_budget_reset",
        "system_prompt": (
            "你是一名懂预算管理也懂同龄人焦虑的理财内容顾问。"
            "请用克制、可信的口吻，帮助用户把工资到账后的预算、储蓄、回血动作重新排好节奏。"
        ),
    },
    {
        "id": "skill-tech-lab-markdown",
        "title": "实验室复盘 Markdown",
        "description": "适合 STM32、IoT、传感器联调等技术内容，强调结构清晰、实验可复现和问题闭环。",
        "platform": "技术博客",
        "category": "数码科技",
        "knowledge_base_scope": "iot_embedded_lab",
        "system_prompt": (
            "你是一名习惯写实验记录和工程复盘的技术作者。"
            "请用 Markdown 清晰呈现背景、环境、步骤、日志、异常、定位和结论，让读者能够完整复现。"
        ),
    },
    {
        "id": "skill-xianyu-recovery-close",
        "title": "闲鱼回血成交话术",
        "description": "适合二手闲置、电商副业和断舍离场景，强调真实成色、价格合理性和成交信任。",
        "platform": "闲鱼",
        "category": "电商/闲鱼",
        "knowledge_base_scope": "secondhand_trade_playbook",
        "system_prompt": (
            "你是一名擅长闲鱼成交文案的二手运营助手。"
            "请围绕商品成色、价格解释、使用场景和真实理由来组织内容，帮助用户更快建立信任。"
        ),
    },
    {
        "id": "skill-education-score-playbook",
        "title": "提分逆袭干货模板",
        "description": "适合教辅、学习规划和家长沟通内容，强调方法感、阶段目标和行动指令。",
        "platform": "抖音",
        "category": "教育/干货",
        "knowledge_base_scope": "education_score_boost",
        "system_prompt": (
            "你是一名擅长把学习方法讲清楚的教育内容编辑。"
            "请围绕提分、逆袭、执行节奏和家长焦虑给出具体、能立刻照做的内容结构。"
        ),
    },
    {
        "id": "skill-beauty-repair-comfort",
        "title": "熬夜急救安慰型文案",
        "description": "适合美妆护肤、健身恢复和高压状态自救表达，强调陪伴感和真实改善路径。",
        "platform": "小红书",
        "category": "美妆护肤",
        "knowledge_base_scope": "beauty_skin_repair_notes",
        "system_prompt": (
            "你是一名懂成分、也懂高压生活情绪的美妆编辑。"
            "请把护肤步骤、生活节奏提醒和安慰感表达结合起来，给读者一个真正能落地的急救方案。"
        ),
    },
)

SKILL_CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "美食文旅": ("文旅", "探店", "旅游", "citywalk", "路线", "周末", "本地"),
    "职场金融": ("理财", "预算", "职场", "面试", "薪资", "复盘", "合同"),
    "数码科技": ("stm32", "iot", "嵌入式", "开发板", "智能家居", "数码", "自动化"),
    "电商/闲鱼": ("闲鱼", "二手", "回血", "sku", "成交", "副业", "断舍离"),
    "教育/干货": ("提分", "教辅", "学习", "高考", "家长", "科普", "逆袭"),
    "美妆护肤": ("护肤", "美妆", "熬夜", "健身", "恢复", "成分", "平替"),
}

SKILL_CATEGORY_DEFAULT_PLATFORM: dict[str, str] = {
    "美食文旅": "小红书",
    "职场金融": "小红书",
    "数码科技": "技术博客",
    "电商/闲鱼": "闲鱼",
    "教育/干货": "抖音",
    "美妆护肤": "小红书",
}

SKILL_CATEGORY_DEFAULT_KB: dict[str, str] = {
    "美食文旅": "travel_local_guides",
    "职场金融": "finance_recovery_playbook",
    "数码科技": "iot_embedded_lab",
    "电商/闲鱼": "secondhand_trade_playbook",
    "教育/干货": "education_score_boost",
    "美妆护肤": "beauty_skin_repair_notes",
}


def _normalize_skill_keyword(keyword: str) -> str:
    normalized = keyword.strip()
    return normalized or "爆款提示词"


def _normalize_skill_category(category: str | None) -> str | None:
    if category is None:
        return None
    normalized = category.strip()
    return normalized or None


def _build_prompt_skill_query(keyword: str, category: str | None) -> str:
    scoped_category = f"{category} " if category else ""
    return (
        f"{scoped_category}{keyword} 爆款提示词框架 prompt framework RTF BROKE CREATE ICEL "
        "Meta Prompt 小红书 抖音 闲鱼 技术教程"
    )


def _infer_skill_category(text: str, requested_category: str | None) -> str:
    if requested_category:
        return requested_category

    normalized = text.lower()
    for category, keywords in SKILL_CATEGORY_KEYWORDS.items():
        if any(keyword.lower() in normalized for keyword in keywords):
            return category
    return "美食文旅"


def _load_skill_extractor_config() -> SkillExtractorConfig | None:
    load_environment()

    compatible_api_key = os.getenv("LLM_API_KEY", "").strip()
    compatible_base_url = os.getenv("LLM_BASE_URL", "").strip()
    if compatible_api_key and compatible_base_url:
        model = os.getenv("LLM_MODEL", "qwen3.5-flash").strip() or "qwen3.5-flash"
        timeout_raw = os.getenv(
            "LLM_TIMEOUT_SECONDS",
            os.getenv("OPENAI_TIMEOUT_SECONDS", "60"),
        ).strip()
        try:
            timeout_seconds = float(timeout_raw or "60")
        except ValueError:
            timeout_seconds = 60.0
        return SkillExtractorConfig(
            api_key=compatible_api_key,
            base_url=compatible_base_url,
            model=model,
            timeout_seconds=timeout_seconds,
        )

    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_api_key:
        model = os.getenv("OPENAI_MODEL", "gpt-5-mini").strip() or "gpt-5-mini"
        timeout_raw = os.getenv("OPENAI_TIMEOUT_SECONDS", "60").strip()
        try:
            timeout_seconds = float(timeout_raw or "60")
        except ValueError:
            timeout_seconds = 60.0
        openai_base_url = os.getenv("OPENAI_BASE_URL", "").strip() or None
        return SkillExtractorConfig(
            api_key=openai_api_key,
            base_url=openai_base_url,
            model=model,
            timeout_seconds=timeout_seconds,
        )

    return None


def _request_tavily_skill_search(query: str) -> dict[str, Any]:
    api_key = _load_tavily_api_key()
    if not api_key:
        raise RuntimeError("TAVILY_API_KEY is not configured")

    payload = {
        "api_key": api_key,
        "query": query,
        "topic": "general",
        "search_depth": "advanced",
        "max_results": DEFAULT_SKILL_DISCOVERY_RESULTS,
        "include_answer": True,
        "include_raw_content": True,
    }

    timeout = _build_http_timeout(_load_search_timeout_seconds())
    with httpx.Client(timeout=timeout) as client:
        response = client.post(TAVILY_SEARCH_URL, json=payload)
        response.raise_for_status()

    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("Tavily returned a non-object payload")
    return data


async def _request_tavily_skill_search_async(query: str) -> dict[str, Any]:
    api_key = _load_tavily_api_key()
    if not api_key:
        raise RuntimeError("TAVILY_API_KEY is not configured")

    payload = {
        "api_key": api_key,
        "query": query,
        "topic": "general",
        "search_depth": "advanced",
        "max_results": DEFAULT_SKILL_DISCOVERY_RESULTS,
        "include_answer": True,
        "include_raw_content": True,
    }

    timeout = _build_http_timeout(_load_search_timeout_seconds())
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(TAVILY_SEARCH_URL, json=payload)
        response.raise_for_status()

    data = response.json()
    if not isinstance(data, dict):
        raise RuntimeError("Tavily returned a non-object payload")
    return data


def _build_skill_search_sources(payload: dict[str, Any]) -> list[dict[str, str]]:
    results = payload.get("results")
    if not isinstance(results, list):
        return []

    sources: list[dict[str, str]] = []
    for item in results[:DEFAULT_SKILL_DISCOVERY_RESULTS]:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        content = str(item.get("content", "")).strip()
        raw_content = str(item.get("raw_content", "")).strip()
        url = str(item.get("url", "")).strip()
        if not title and not content and not raw_content:
            continue
        sources.append(
            {
                "title": title or _truncate_text(content or raw_content, 48),
                "summary": _truncate_text(content or raw_content or title, 220),
                "raw_excerpt": _truncate_text(raw_content, 360) if raw_content else "",
                "url": url,
            }
        )
    return sources


def _build_skill_search_context(payload: dict[str, Any]) -> str:
    blocks: list[str] = []
    answer = str(payload.get("answer", "")).strip()
    if answer:
        blocks.append(f"[搜索总结]\n{_truncate_text(answer, 260)}")

    for index, source in enumerate(_build_skill_search_sources(payload), start=1):
        source_lines = [f"[来源{index}] 标题: {source['title']}"]
        if source["summary"]:
            source_lines.append(f"摘要: {source['summary']}")
        if source["raw_excerpt"]:
            source_lines.append(f"正文片段: {source['raw_excerpt']}")
        if source["url"]:
            source_lines.append(f"链接: {source['url']}")
        blocks.append("\n".join(source_lines))

    return "\n\n".join(blocks).strip()


def _extract_first_json_object(content: str) -> str:
    normalized = content.strip()
    if not normalized:
        raise ValueError("LLM returned empty content")

    if normalized.startswith("```"):
        normalized = re.sub(r"^```(?:json)?\s*", "", normalized)
        normalized = re.sub(r"\s*```$", "", normalized)
        normalized = normalized.strip()

    if normalized.startswith("{") and normalized.endswith("}"):
        return normalized

    start = normalized.find("{")
    if start < 0:
        raise ValueError("LLM response did not contain a JSON object")

    depth = 0
    for index in range(start, len(normalized)):
        char = normalized[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return normalized[start : index + 1]

    raise ValueError("LLM response JSON object was incomplete")


def _preview_log_text(value: str, limit: int = 600) -> str:
    normalized = re.sub(r"\s+", " ", value).strip()
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}..."


def _normalize_generated_skill_platform(value: str, category: str) -> str:
    normalized = value.strip()
    alias_map = {
        "小红书": "小红书",
        "xiaohongshu": "小红书",
        "xhs": "小红书",
        "抖音": "抖音",
        "douyin": "抖音",
        "闲鱼": "闲鱼",
        "xianyu": "闲鱼",
        "技术博客": "技术博客",
        "techblog": "技术博客",
        "tech blog": "技术博客",
        "blog": "技术博客",
    }
    if normalized in alias_map:
        return alias_map[normalized]

    lowered = normalized.lower()
    if lowered in alias_map:
        return alias_map[lowered]

    return SKILL_CATEGORY_DEFAULT_PLATFORM.get(category, "小红书")


def _normalize_generated_skill_category(value: str, fallback: str) -> str:
    normalized = value.strip()
    if normalized in SKILL_CATEGORY_DEFAULT_PLATFORM:
        return normalized

    lowered = normalized.lower()
    alias_map = {
        "travel": "美食文旅",
        "food": "美食文旅",
        "lifestyle": "美食文旅",
        "finance": "职场金融",
        "career": "职场金融",
        "tech": "数码科技",
        "technology": "数码科技",
        "iot": "数码科技",
        "xianyu": "电商/闲鱼",
        "ecommerce": "电商/闲鱼",
        "education": "教育/干货",
        "study": "教育/干货",
        "beauty": "美妆护肤",
        "skincare": "美妆护肤",
    }
    if lowered in alias_map:
        return alias_map[lowered]
    return fallback


def _normalize_generated_scope(value: str | None, category: str) -> str | None:
    normalized = (value or "").strip().lower()
    if not normalized:
        return SKILL_CATEGORY_DEFAULT_KB.get(category)
    normalized = re.sub(r"[^a-z0-9_]+", "_", normalized)
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    return normalized or SKILL_CATEGORY_DEFAULT_KB.get(category)


def _default_framework_role(category: str) -> str:
    role_map = {
        "美食文旅": "你是一名擅长在地体验、情绪价值和收藏型表达的资深内容策划师。",
        "职场金融": "你是一名懂同龄人焦虑、预算管理和决策安抚的职场内容顾问。",
        "数码科技": "你是一名懂技术深度和新手语境转换的硬核教学结构师。",
        "电商/闲鱼": "你是一名懂二手成交心理和高转化话术的电商运营设计师。",
        "教育/干货": "你是一名懂提分焦虑、学习节奏和干货结构化表达的教育内容编辑。",
        "美妆护肤": "你是一名懂成分、情绪陪伴和生活场景转换的美妆护肤策划师。",
    }
    return role_map.get(category, "你是一名懂内容策划、人群洞察和结构化表达的高级 Prompt 设计师。")


def _default_framework_format(platform: str) -> str:
    if platform == "技术博客":
        return "Markdown 分级标题 + 要点列表 + 可复用占位符 [标题] [案例] [参数] [CTA]"
    if platform == "闲鱼":
        return "短句长块结合，先给名品量化信息，再给成色、价格、交付说明和 [成交动作]"
    if platform == "抖音":
        return "3 段式短文案 + 开头下钩子 + 中间给干货 + 结尾引导 [留言关键词]"
    return "小红书笔记结构：[标题] + [开场钩子] + [3 个观点] + [避坑提示] + [收藏/私信 CTA]"


def _build_meta_prompt_template(
    *,
    keyword: str,
    category: str,
    platform: str,
    framework_name: str,
    source_hint: str = "",
    extra_constraints: str = "",
) -> str:
    constraints = [
        "1. 开头必须指出一个目标人群在 2026 年仍然常见的误区或焦虑。",
        "2. 正文必须同时给出结构框架和可执行步骤，避免空泛鸡汤。",
        "3. 需要保留 3 个以上占位符，例如 [目标人群] [核心痛点] [转化动作] [案例]。",
        "4. 不得输出与题目无关的泛化口号，不得把元提示词写成普通广告文案。",
    ]
    if source_hint:
        constraints.append(f"5. 优先吸收以下实时信号：{source_hint}")
    if extra_constraints:
        constraints.append(extra_constraints)

    return "\n".join(
        [
            f"[Framework]: {framework_name}",
            f"[Role]: {_default_framework_role(category)}",
            (
                f"[Task]: 围绕[主题]={keyword}，为[目标人群]设计一套适用于{platform}的高级元提示词。"
                "开头必须制造具体悬念，中段给出结构化干货，结尾引导[转化动作]。"
            ),
            f"[Format]: {_default_framework_format(platform)}",
            "[Variables]: [目标人群] [核心痛点] [使用场景] [差异化证据] [转化动作] [禁用表达]",
            f"[Constraints]: {' '.join(constraints)}",
        ]
    )


def _build_mock_skill_items(
    *,
    keyword: str,
    category: str | None,
    data_mode: str,
) -> list[dict[str, str | None]]:
    resolved_category = _infer_skill_category(
        " ".join(filter(None, [keyword, category or ""])),
        category,
    )
    resolved_platform = SKILL_CATEGORY_DEFAULT_PLATFORM.get(resolved_category, "小红书")
    knowledge_base_scope = SKILL_CATEGORY_DEFAULT_KB.get(resolved_category)

    items: list[dict[str, str | None]] = []
    for index, framework in enumerate(SKILL_FALLBACK_FRAMEWORKS, start=1):
        items.append(
            {
                "id": f"skill-{data_mode}-{index}",
                "title": f"{framework['name']}（{resolved_category}）",
                "description": (
                    f"{framework['description_hook']} 围绕“{keyword}”时，它会强化 {resolved_category} 人群的身份认同、"
                    "场景决策和可复制结构，避免只剩“营销口水话”的伪深度。"
                ),
                "platform": resolved_platform,
                "category": resolved_category,
                "knowledge_base_scope": knowledge_base_scope,
                "system_prompt": _build_meta_prompt_template(
                    keyword=keyword,
                    category=resolved_category,
                    platform=resolved_platform,
                    framework_name=str(framework["code"]),
                ),
                "source_title": f"Structured Skill Fallback · {framework['code']}",
                "source_url": None,
                "data_mode": data_mode,
            }
        )
    return items


def _build_openai_client(config: SkillExtractorConfig) -> OpenAI:
    client_kwargs: dict[str, Any] = {
        "api_key": config.api_key,
        "timeout": _build_http_timeout(config.timeout_seconds),
    }
    if config.base_url:
        client_kwargs["base_url"] = config.base_url
    return OpenAI(**client_kwargs)


def _build_async_openai_client(config: SkillExtractorConfig) -> AsyncOpenAI:
    client_kwargs: dict[str, Any] = {
        "api_key": config.api_key,
        "timeout": _build_http_timeout(config.timeout_seconds),
    }
    if config.base_url:
        client_kwargs["base_url"] = config.base_url
    return AsyncOpenAI(**client_kwargs)


def _invoke_skill_extractor_llm(
    *,
    keyword: str,
    category: str,
    search_context: str,
) -> SkillTemplateList:
    config = _load_skill_extractor_config()
    if config is None:
        raise RuntimeError("No LLM extractor configuration available")

    client = _build_openai_client(config)
    system_prompt = SKILL_SYSTEM_PROMPT_TEMPLATE.format(
        category=category,
        query=keyword,
        search_context=search_context,
    )
    user_prompt = SKILL_USER_PROMPT_TEMPLATE.format(category=category)

    request_kwargs = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
        "timeout": _build_http_timeout(config.timeout_seconds),
    }

    try:
        response = client.chat.completions.create(
            **request_kwargs,
            response_format={"type": "json_object"},
        )
    except BadRequestError:
        response = client.chat.completions.create(**request_kwargs)

    content = response.choices[0].message.content or ""
    logger.info(
        "Skill extractor raw response keyword=%s category=%s preview=%s",
        keyword,
        category,
        _preview_log_text(content),
    )

    parsed_templates = SkillTemplateList.model_validate(
        json.loads(_extract_first_json_object(content))
    )
    logger.info(
        "Skill extractor parsed %s templates for keyword=%s category=%s",
        len(parsed_templates.templates),
        keyword,
        category,
    )
    if len(parsed_templates.templates) == 0:
        raise RuntimeError("LLM structured extractor returned an empty templates list")

    return parsed_templates


async def _invoke_skill_extractor_llm_async(
    *,
    keyword: str,
    category: str,
    search_context: str,
) -> SkillTemplateList:
    config = _load_skill_extractor_config()
    if config is None:
        raise RuntimeError("No LLM extractor configuration available")

    client = _build_async_openai_client(config)
    system_prompt = SKILL_SYSTEM_PROMPT_TEMPLATE.format(
        category=category,
        query=keyword,
        search_context=search_context,
    )
    user_prompt = SKILL_USER_PROMPT_TEMPLATE.format(category=category)

    request_kwargs = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.2,
        "timeout": _build_http_timeout(config.timeout_seconds),
    }

    try:
        response = await client.chat.completions.create(
            **request_kwargs,
            response_format={"type": "json_object"},
        )
    except BadRequestError:
        response = await client.chat.completions.create(**request_kwargs)

    content = response.choices[0].message.content or ""
    logger.info(
        "Skill extractor raw response keyword=%s category=%s preview=%s",
        keyword,
        category,
        _preview_log_text(content),
    )

    parsed_templates = SkillTemplateList.model_validate(
        json.loads(_extract_first_json_object(content))
    )
    logger.info(
        "Skill extractor parsed %s templates for keyword=%s category=%s",
        len(parsed_templates.templates),
        keyword,
        category,
    )
    if len(parsed_templates.templates) == 0:
        raise RuntimeError("LLM structured extractor returned an empty templates list")

    return parsed_templates


def _coerce_skill_template_item(
    *,
    template: SkillTemplateDraft,
    keyword: str,
    fallback_category: str,
    source: dict[str, str] | None,
    data_mode: str,
    index: int,
) -> dict[str, str | None]:
    framework_code = str(
        SKILL_FALLBACK_FRAMEWORKS[(index - 1) % len(SKILL_FALLBACK_FRAMEWORKS)]["code"]
    )
    resolved_category = _normalize_generated_skill_category(
        template.category,
        fallback_category,
    )
    resolved_platform = _normalize_generated_skill_platform(
        template.platform,
        resolved_category,
    )
    normalized_scope = _normalize_generated_scope(
        template.knowledge_base_scope,
        resolved_category,
    )
    normalized_title = template.title.strip() or f"{framework_code} {keyword} Framework"
    if framework_code not in normalized_title.upper():
        normalized_title = f"{framework_code} {normalized_title}"

    normalized_description = template.description.strip()
    if framework_code not in normalized_description.upper():
        normalized_description = (
            f"基于 {framework_code} 框架，{normalized_description or '突出目标人群痛点、结构边界与转化动作。'}"
        )

    normalized_prompt = template.system_prompt.strip()
    if (
        "[Role]:" not in normalized_prompt
        or "[Task]:" not in normalized_prompt
        or "[Format]:" not in normalized_prompt
        or "[Constraints]:" not in normalized_prompt
        or "[Variables]:" not in normalized_prompt
        or len(re.findall(r"\[[^\]]+\]", normalized_prompt)) < 3
    ):
        normalized_prompt = _build_meta_prompt_template(
            keyword=keyword,
            category=resolved_category,
            platform=resolved_platform,
            framework_name=framework_code,
            source_hint=source["summary"] if source is not None else "",
            extra_constraints="6. 在原始框架意图基础上补足结构字段，确保提示词可直接复用。",
        )

    source_title = (
        source["title"]
        if source is not None and source.get("title")
        else (
            "LLM Self-Knowledge Synthesis"
            if data_mode == "llm_fallback"
            else "Tavily Prompt Synthesis"
        )
    )
    source_url = source.get("url") if source is not None else None

    return {
        "id": f"skill-{data_mode}-{index}",
        "title": _truncate_text(normalized_title, 100),
        "description": _truncate_text(normalized_description, 280),
        "platform": resolved_platform,
        "category": resolved_category,
        "knowledge_base_scope": normalized_scope,
        "system_prompt": normalized_prompt,
        "source_title": source_title,
        "source_url": source_url,
        "data_mode": data_mode,
    }


def _build_structured_skill_items(
    *,
    keyword: str,
    category: str,
    templates: SkillTemplateList,
    sources: list[dict[str, str]],
    data_mode: str,
) -> list[dict[str, str | None]]:
    normalized_templates = templates.templates[:DEFAULT_SKILL_TEMPLATE_COUNT]
    if len(normalized_templates) < DEFAULT_SKILL_TEMPLATE_COUNT:
        raise RuntimeError("LLM returned fewer than 3 structured skill templates")

    items: list[dict[str, str | None]] = []
    for index, template in enumerate(normalized_templates, start=1):
        source = sources[index - 1] if index - 1 < len(sources) else None
        items.append(
            _coerce_skill_template_item(
                template=template,
                keyword=keyword,
                fallback_category=category,
                source=source,
                data_mode=data_mode,
                index=index,
            )
        )
    return items


def search_prompt_skills(keyword: str, category: str | None = None) -> dict[str, Any]:
    normalized_keyword = _normalize_skill_keyword(keyword)
    normalized_category = _normalize_skill_category(category)
    search_query = _build_prompt_skill_query(normalized_keyword, normalized_category)
    resolved_category = _infer_skill_category(
        " ".join(filter(None, [normalized_keyword, normalized_category or ""])),
        normalized_category,
    )

    logger.info(
        "Skill discovery started keyword=%s category=%s query=%s",
        normalized_keyword,
        resolved_category,
        search_query,
    )

    fallback_reason: str | None = None
    search_sources: list[dict[str, str]] = []
    search_context = ""

    api_key = _load_tavily_api_key()
    if api_key:
        try:
            live_payload = _request_tavily_skill_search(search_query)
            search_sources = _build_skill_search_sources(live_payload)
            search_context = _build_skill_search_context(live_payload)
            logger.info(
                "Tavily skill discovery succeeded query=%s sources=%s context_preview=%s",
                search_query,
                len(search_sources),
                _preview_log_text(search_context),
            )
            if not search_context:
                fallback_reason = "Tavily returned an empty search context"
                logger.warning(
                    "Tavily skill discovery returned empty context query=%s payload_preview=%s",
                    search_query,
                    _preview_log_text(json.dumps(live_payload, ensure_ascii=False)),
                )
        except Exception as exc:  # pragma: no cover - network/runtime fallback
            fallback_reason = str(exc)
            logger.exception(
                "Prompt skill discovery search failed for query=%s: %s",
                search_query,
                exc,
            )
    else:
        logger.info(
            "Skill discovery has no Tavily API key; query=%s will use fallback paths",
            search_query,
        )

    extractor_config = _load_skill_extractor_config()
    if extractor_config is None:
        logger.info(
            "Skill discovery has no extractor model configured query=%s",
            search_query,
        )

    if search_context and extractor_config is not None:
        try:
            extracted_templates = _invoke_skill_extractor_llm(
                keyword=normalized_keyword,
                category=resolved_category,
                search_context=search_context,
            )
            items = _build_structured_skill_items(
                keyword=normalized_keyword,
                category=resolved_category,
                templates=extracted_templates,
                sources=search_sources,
                data_mode="live_tavily",
            )
            return {
                "query": search_query,
                "category": normalized_category,
                "items": items,
                "templates": items,
                "total": len(items),
                "data_mode": "live_tavily",
                "fallback_reason": fallback_reason,
            }
        except (
            APIConnectionError,
            APIError,
            APITimeoutError,
            AuthenticationError,
            OpenAIError,
            RateLimitError,
            ValidationError,
            ValueError,
            RuntimeError,
            json.JSONDecodeError,
        ) as exc:
            fallback_reason = str(exc)
            logger.exception(
                "Prompt skill structured extraction failed for query=%s: %s",
                search_query,
                exc,
            )

    if extractor_config is not None:
        fallback_context_override = (
            "No external search context is available. Use internal knowledge of high-performing "
            "prompt frameworks such as RTF, BROKE, CREATE, ICEL, and PAS to synthesize reusable "
            f"meta-prompts for the {resolved_category} category and the query '{normalized_keyword}'."
        )
        fallback_context = (
            search_context
            or (
                "当前外部搜索上下文不可用。请基于你对流行 Prompt framework（RTF/BROKE/CREATE/ICEL）的已有知识，"
                f"专注于 {resolved_category} 领域，针对“{normalized_keyword}”输出 3 个高级元提示词模板。"
            )
        )
        if not search_context:
            fallback_context = fallback_context_override
        logger.info(
            "Skill discovery invoking LLM fallback query=%s context_preview=%s",
            search_query,
            _preview_log_text(fallback_context),
        )
        try:
            extracted_templates = _invoke_skill_extractor_llm(
                keyword=normalized_keyword,
                category=resolved_category,
                search_context=fallback_context,
            )
            items = _build_structured_skill_items(
                keyword=normalized_keyword,
                category=resolved_category,
                templates=extracted_templates,
                sources=[],
                data_mode="llm_fallback",
            )
            return {
                "query": search_query,
                "category": normalized_category,
                "items": items,
                "templates": items,
                "total": len(items),
                "data_mode": "llm_fallback",
                "fallback_reason": fallback_reason,
            }
        except (
            APIConnectionError,
            APIError,
            APITimeoutError,
            AuthenticationError,
            OpenAIError,
            RateLimitError,
            ValidationError,
            ValueError,
            RuntimeError,
            json.JSONDecodeError,
        ) as exc:
            fallback_reason = str(exc)
            logger.exception(
                "Prompt skill LLM fallback extraction failed for query=%s: %s",
                search_query,
                exc,
            )

    response_mode = "mock_fallback" if fallback_reason else "mock"
    logger.error(
        "Skill discovery fell back to hardcoded templates query=%s mode=%s reason=%s",
        search_query,
        response_mode,
        fallback_reason or "no_live_or_llm_path",
    )
    items = _build_mock_skill_items(
        keyword=normalized_keyword,
        category=resolved_category,
        data_mode=response_mode,
    )
    return {
        "query": search_query,
        "category": normalized_category,
        "items": items,
        "templates": items,
        "total": len(items),
        "data_mode": response_mode,
        "fallback_reason": fallback_reason,
    }


async def search_prompt_skills_async(
    keyword: str,
    category: str | None = None,
) -> dict[str, Any]:
    normalized_keyword = _normalize_skill_keyword(keyword)
    normalized_category = _normalize_skill_category(category)
    search_query = _build_prompt_skill_query(normalized_keyword, normalized_category)
    resolved_category = _infer_skill_category(
        " ".join(filter(None, [normalized_keyword, normalized_category or ""])),
        normalized_category,
    )

    logger.info(
        "Skill discovery started keyword=%s category=%s query=%s",
        normalized_keyword,
        resolved_category,
        search_query,
    )

    fallback_reason: str | None = None
    search_sources: list[dict[str, str]] = []
    search_context = ""

    api_key = _load_tavily_api_key()
    if api_key:
        try:
            live_payload = await _request_tavily_skill_search_async(search_query)
            search_sources = _build_skill_search_sources(live_payload)
            search_context = _build_skill_search_context(live_payload)
            logger.info(
                "Tavily skill discovery succeeded query=%s sources=%s context_preview=%s",
                search_query,
                len(search_sources),
                _preview_log_text(search_context),
            )
            if not search_context:
                fallback_reason = "Tavily returned an empty search context"
                logger.warning(
                    "Tavily skill discovery returned empty context query=%s payload_preview=%s",
                    search_query,
                    _preview_log_text(json.dumps(live_payload, ensure_ascii=False)),
                )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - network/runtime fallback
            fallback_reason = str(exc)
            logger.exception(
                "Prompt skill discovery search failed for query=%s: %s",
                search_query,
                exc,
            )
    else:
        logger.info(
            "Skill discovery has no Tavily API key; query=%s will use fallback paths",
            search_query,
        )

    extractor_config = _load_skill_extractor_config()
    if extractor_config is None:
        logger.info(
            "Skill discovery has no extractor model configured query=%s",
            search_query,
        )

    if search_context and extractor_config is not None:
        try:
            extracted_templates = await _invoke_skill_extractor_llm_async(
                keyword=normalized_keyword,
                category=resolved_category,
                search_context=search_context,
            )
            items = _build_structured_skill_items(
                keyword=normalized_keyword,
                category=resolved_category,
                templates=extracted_templates,
                sources=search_sources,
                data_mode="live_tavily",
            )
            return {
                "query": search_query,
                "category": normalized_category,
                "items": items,
                "templates": items,
                "total": len(items),
                "data_mode": "live_tavily",
                "fallback_reason": fallback_reason,
            }
        except asyncio.CancelledError:
            raise
        except (
            APIConnectionError,
            APIError,
            APITimeoutError,
            AuthenticationError,
            OpenAIError,
            RateLimitError,
            ValidationError,
            ValueError,
            RuntimeError,
            json.JSONDecodeError,
        ) as exc:
            fallback_reason = str(exc)
            logger.exception(
                "Prompt skill structured extraction failed for query=%s: %s",
                search_query,
                exc,
            )

    if extractor_config is not None:
        fallback_context_override = (
            "No external search context is available. Use internal knowledge of high-performing "
            "prompt frameworks such as RTF, BROKE, CREATE, ICEL, and PAS to synthesize reusable "
            f"meta-prompts for the {resolved_category} category and the query '{normalized_keyword}'."
        )
        fallback_context = (
            search_context
            or (
                "当前外部搜索上下文不可用。请基于你对流行 Prompt framework（RTF/BROKE/CREATE/ICEL）的已有知识，"
                f"专注于 {resolved_category} 领域，针对“{normalized_keyword}”输出 3 个高级元提示词模板。"
            )
        )
        if not search_context:
            fallback_context = fallback_context_override
        logger.info(
            "Skill discovery invoking LLM fallback query=%s context_preview=%s",
            search_query,
            _preview_log_text(fallback_context),
        )
        try:
            extracted_templates = await _invoke_skill_extractor_llm_async(
                keyword=normalized_keyword,
                category=resolved_category,
                search_context=fallback_context,
            )
            items = _build_structured_skill_items(
                keyword=normalized_keyword,
                category=resolved_category,
                templates=extracted_templates,
                sources=[],
                data_mode="llm_fallback",
            )
            return {
                "query": search_query,
                "category": normalized_category,
                "items": items,
                "templates": items,
                "total": len(items),
                "data_mode": "llm_fallback",
                "fallback_reason": fallback_reason,
            }
        except asyncio.CancelledError:
            raise
        except (
            APIConnectionError,
            APIError,
            APITimeoutError,
            AuthenticationError,
            OpenAIError,
            RateLimitError,
            ValidationError,
            ValueError,
            RuntimeError,
            json.JSONDecodeError,
        ) as exc:
            fallback_reason = str(exc)
            logger.exception(
                "Prompt skill LLM fallback extraction failed for query=%s: %s",
                search_query,
                exc,
            )

    response_mode = "mock_fallback" if fallback_reason else "mock"
    logger.error(
        "Skill discovery fell back to hardcoded templates query=%s mode=%s reason=%s",
        search_query,
        response_mode,
        fallback_reason or "no_live_or_llm_path",
    )
    items = _build_mock_skill_items(
        keyword=normalized_keyword,
        category=resolved_category,
        data_mode=response_mode,
    )
    return {
        "query": search_query,
        "category": normalized_category,
        "items": items,
        "templates": items,
        "total": len(items),
        "data_mode": response_mode,
        "fallback_reason": fallback_reason,
    }


@tool(args_schema=PromptSkillSearchInput)
def discover_prompt_skills(keyword: str, category: str = "") -> str:
    """Discover reusable prompt structures and skill-like template ideas as JSON, preferring live Tavily search when configured."""
    result = search_prompt_skills(keyword=keyword, category=category or None)
    return json.dumps(result, ensure_ascii=False)


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


BUSINESS_TOOLS: list[BaseTool] = [
    analyze_market_trends,
    discover_prompt_skills,
    generate_content_outline,
]
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


async def execute_business_tool_async(name: str, arguments: dict[str, Any]) -> str:
    if name == analyze_market_trends.name:
        return await analyze_market_trends_async(
            platform=str(arguments.get("platform", "")),
            category=str(arguments.get("category", "")),
        )

    if name == discover_prompt_skills.name:
        result = await search_prompt_skills_async(
            keyword=str(arguments.get("keyword", "")),
            category=str(arguments.get("category", "")).strip() or None,
        )
        return json.dumps(result, ensure_ascii=False)

    if name == generate_content_outline.name:
        return execute_business_tool(name, arguments)

    return execute_business_tool(name, arguments)
