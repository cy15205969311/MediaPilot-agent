from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import BaseTool, tool
from pydantic import BaseModel, Field


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


@tool(args_schema=MarketTrendInput)
def analyze_market_trends(platform: str, category: str) -> str:
    """Analyze platform/category market trends and return hot keywords, user intent, and content opportunities as JSON."""
    normalized_platform = platform.strip() or "xiaohongshu"
    normalized_category = category.strip() or "内容运营"

    category_profiles: dict[str, dict[str, Any]] = {
        "地域文旅": {
            "hot_keywords": ["周末短途", "小众古镇", "地铁直达", "Citywalk", "亲子半日游"],
            "traffic_notes": ["收藏型攻略增长稳定", "带路线和预算的笔记更易转化", "本地口吻比泛旅游口吻更可信"],
            "content_angles": ["一日动线", "避坑清单", "本地人私藏路线"],
        },
        "教辅资料": {
            "hot_keywords": ["初中同步", "期末冲刺", "错题整理", "教材全解", "家长省心"],
            "traffic_notes": ["开学季和考试季搜索意图强", "明确年级和版本能提升点击", "低价打包和真实使用痕迹会增强信任"],
            "content_angles": ["适用年级", "资料成色", "提分场景"],
        },
    }
    profile = category_profiles.get(
        normalized_category,
        {
            "hot_keywords": ["趋势洞察", "用户痛点", "高转化标题", "真实体验", "清单化表达"],
            "traffic_notes": ["明确使用场景更容易获得收藏", "标题中加入人群和结果会提升点击", "案例化表达比抽象卖点更可信"],
            "content_angles": ["痛点切入", "步骤拆解", "结果对比"],
        },
    )

    return json.dumps(
        {
            "tool": "analyze_market_trends",
            "platform": normalized_platform,
            "category": normalized_category,
            "hot_keywords": profile["hot_keywords"],
            "traffic_notes": profile["traffic_notes"],
            "content_angles": profile["content_angles"],
            "recommended_next_action": "将热词自然嵌入标题、首段钩子和结构化小标题，避免机械堆砌。",
            "data_mode": "mock",
        },
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
BUSINESS_TOOL_REGISTRY: dict[str, BaseTool] = {tool_item.name: tool_item for tool_item in BUSINESS_TOOLS}


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
