import asyncio
import json

import pytest

import app.services.graph.provider as graph_provider_module
from app.db.models import Thread
from app.models.schemas import (
    ContentGenerationArtifactPayload,
    ImageGenerationArtifactPayload,
    MediaChatRequest,
)
from app.services import tools as business_tools
from app.services.graph import LangGraphProvider
from app.services.intent_routing import resolve_media_chat_task_type
from app.services.knowledge_base import KnowledgeDocument
from app.services.providers import BaseLLMProvider
from app.services.tools import execute_business_tool, get_openai_tool_specs


class BusinessToolRecordingProvider(BaseLLMProvider):
    def __init__(self) -> None:
        self.last_request_message = ""
        self.last_request_system_prompt = ""
        self.calls = 0

    async def generate_stream(self, request, **kwargs):
        self.calls += 1
        self.last_request_message = request.message
        self.last_request_system_prompt = request.system_prompt or ""
        yield {
            "event": "start",
            "thread_id": request.thread_id,
            "platform": request.platform.value,
            "task_type": request.task_type.value,
            "materials_count": len(request.materials),
        }
        yield {
            "event": "message",
            "delta": "business-tool enhanced draft with enough detail for review, including market keywords, user intent, title hooks, and a clear next-step call to action.",
            "index": 0,
        }
        yield {
            "event": "artifact",
            "artifact": {
                "artifact_type": "content_draft",
                "title": "Business Tool Draft",
                "title_candidates": ["A", "B", "C"],
                "body": "business-tool enhanced draft with enough detail for review, including market keywords, user intent, title hooks, and a clear next-step call to action.",
                "platform_cta": "save and iterate",
            },
        }
        yield {"event": "done", "thread_id": request.thread_id}


class StructuringFailureProvider(BaseLLMProvider):
    async def generate_stream(self, request, **kwargs):
        yield {
            "event": "start",
            "thread_id": request.thread_id,
            "platform": request.platform.value,
            "task_type": request.task_type.value,
            "materials_count": len(request.materials),
        }
        yield {
            "event": "message",
            "delta": "这是一段已经生成完成的改写正文，会在结构化失败时被保留下来继续交付给用户。",
            "index": 0,
        }
        yield {
            "event": "error",
            "code": "QWEN_ARTIFACT_VALIDATION_ERROR",
            "message": "Qwen 返回的结构化结果不符合契约，请稍后重试。",
        }
        yield {"event": "done", "thread_id": request.thread_id}


class ImageReadyProvider(BaseLLMProvider):
    async def generate_stream(self, request, **kwargs):
        yield {
            "event": "start",
            "thread_id": request.thread_id,
            "platform": request.platform.value,
            "task_type": request.task_type.value,
            "materials_count": len(request.materials),
        }
        yield {
            "event": "message",
            "delta": "这是已经完成结构化的正文草稿，会继续进入配图节点。",
            "index": 0,
        }
        yield {
            "event": "artifact",
            "artifact": {
                "artifact_type": "content_draft",
                "title": "图文成稿",
                "title_candidates": ["标题 A", "标题 B", "标题 C"],
                "body": "这里是一段适合继续生成封面图的正文草稿，包含明确主题和情绪线索。",
                "platform_cta": "欢迎继续把这版内容细化成最终发布稿。",
            },
        }
        yield {"event": "done", "thread_id": request.thread_id}


class DraftForbiddenProvider(BaseLLMProvider):
    async def generate_stream(self, request, **kwargs):
        raise AssertionError("direct image requests should bypass draft generation")
        yield {"event": "done", "thread_id": request.thread_id}  # pragma: no cover


async def collect_events(
    provider: LangGraphProvider,
    request: MediaChatRequest,
    *,
    thread: Thread | None = None,
):
    events: list[dict[str, object]] = []
    async for event in provider.generate_stream(request, thread=thread):
        events.append(event)
    return events


async def collect_graph_execution(
    provider: LangGraphProvider,
    request: MediaChatRequest,
    *,
    thread: Thread | None = None,
):
    custom_events: list[dict[str, object]] = []
    final_state: dict[str, object] | None = None

    async for mode, chunk in provider.graph.astream(
        provider._build_initial_state(request, thread=thread),
        stream_mode=["custom", "values"],
    ):
        if mode == "custom" and isinstance(chunk, dict):
            payload = chunk.get("payload")
            if isinstance(payload, dict):
                custom_events.append(payload)
        elif mode == "values" and isinstance(chunk, dict):
            final_state = chunk

    if final_state is None:
        raise AssertionError("graph execution should yield a final state")

    return custom_events, final_state


def test_langgraph_gracefully_degrades_when_inner_provider_artifact_validation_fails():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-graceful-degradation",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请基于当前结果改写到另一平台，并保留核心卖点。",
            "materials": [],
        }
    )
    provider = LangGraphProvider(inner_provider=StructuringFailureProvider())

    events = asyncio.run(collect_events(provider, request))

    error_events = [event for event in events if event["event"] == "error"]
    assert error_events == []

    message_text = "".join(
        str(event["delta"]) for event in events if event["event"] == "message"
    )
    assert "这是一段已经生成完成的改写正文" in message_text

    review_events = [
        event for event in events if event["event"] == "tool_call" and event["name"] == "review_draft"
    ]
    assert review_events[-1]["status"] == "fallback"

    artifact_event = next(event for event in events if event["event"] == "artifact")
    artifact = ContentGenerationArtifactPayload.model_validate(artifact_event["artifact"])
    assert artifact.artifact_type == "content_draft"
    assert artifact.title == "内容改写（格式降级）"
    assert "这是一段已经生成完成的改写正文" in artifact.body


def test_business_tool_registry_exports_openai_function_schema():
    specs = get_openai_tool_specs()

    trend_spec = next(
        spec for spec in specs if spec["function"]["name"] == "analyze_market_trends"
    )
    parameters = trend_spec["function"]["parameters"]

    assert trend_spec["type"] == "function"
    assert "platform" in parameters["properties"]
    assert "category" in parameters["properties"]
    assert set(parameters["required"]) == {"platform", "category"}


def test_langgraph_tool_execution_cancellation_bubbles_out(monkeypatch):
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-tool-execution-cancelled",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "先分析市场热点，然后我会立刻停止。",
            "materials": [],
        }
    )

    async def cancelled_business_tool(name: str, arguments: dict[str, object]) -> str:
        raise asyncio.CancelledError()

    provider = LangGraphProvider(inner_provider=BusinessToolRecordingProvider())
    monkeypatch.setattr(
        graph_provider_module,
        "get_stream_writer",
        lambda: (lambda payload: None),
    )
    monkeypatch.setattr(
        graph_provider_module,
        "execute_business_tool_async",
        cancelled_business_tool,
    )

    state = provider._build_initial_state(request)
    state["pending_tool_calls"] = [
        {
            "id": "tool-call-1",
            "name": "analyze_market_trends",
            "args": {"platform": "xiaohongshu", "category": "地域文旅"},
        }
    ]

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(provider._tool_execution_node(state))


def test_analyze_market_trends_tool_returns_structured_mock_json(monkeypatch):
    monkeypatch.setattr(business_tools, "_load_tavily_api_key", lambda: "")

    result = execute_business_tool(
        "analyze_market_trends",
        {"platform": "xiaohongshu", "category": "\u5730\u57df\u6587\u65c5"},
    )

    assert '"tool": "analyze_market_trends"' in result
    assert '"category": "\u5730\u57df\u6587\u65c5"' in result
    assert "\u5468\u672b\u77ed\u9014" in result
    assert '"data_mode": "mock"' in result


def test_analyze_market_trends_tool_uses_live_tavily_when_configured(monkeypatch):
    monkeypatch.setattr(business_tools, "_load_tavily_api_key", lambda: "test-key")
    monkeypatch.setattr(
        business_tools,
        "_request_tavily_market_search",
        lambda query: {
            "answer": "Citywalk 和周末短途仍然是小红书地域文旅内容里的核心高意图词。",
            "results": [
                {
                    "title": "福州 Citywalk 周末短途攻略持续升温",
                    "content": "用户更关注本地路线、地铁直达和一日游预算。",
                    "url": "https://example.com/fuzhou-citywalk",
                },
                {
                    "title": "亲子半日游与小众古镇成为收藏热点",
                    "content": "亲子半日游、小众古镇、避坑清单持续高频出现。",
                    "url": "https://example.com/family-trip",
                },
            ],
        },
    )

    payload = json.loads(
        execute_business_tool(
            "analyze_market_trends",
            {"platform": "xiaohongshu", "category": "\u5730\u57df\u6587\u65c5"},
        )
    )

    assert payload["data_mode"] == "live_tavily"
    assert payload["platform"] == "xiaohongshu"
    assert payload["category"] == "\u5730\u57df\u6587\u65c5"
    assert payload["source_count"] == 2
    assert payload["evidence_sources"][0]["url"] == "https://example.com/fuzhou-citywalk"
    assert "Citywalk" in payload["hot_keywords"]


def test_analyze_market_trends_tool_falls_back_to_mock_when_live_search_fails(monkeypatch):
    monkeypatch.setattr(business_tools, "_load_tavily_api_key", lambda: "test-key")

    def raise_live_search_error(_: str) -> dict[str, object]:
        raise RuntimeError("tavily boom")

    monkeypatch.setattr(
        business_tools,
        "_request_tavily_market_search",
        raise_live_search_error,
    )

    payload = json.loads(
        execute_business_tool(
            "analyze_market_trends",
            {"platform": "xiaohongshu", "category": "\u5730\u57df\u6587\u65c5"},
        )
    )

    assert payload["data_mode"] == "mock_fallback"
    assert payload["fallback_reason"] == "tavily boom"
    assert payload["hot_keywords"][0] == "\u5468\u672b\u77ed\u9014"


def test_search_prompt_skills_extracts_structured_frameworks_from_live_search(monkeypatch):
    monkeypatch.setattr(business_tools, "_load_tavily_api_key", lambda: "test-key")
    monkeypatch.setattr(
        business_tools,
        "_load_skill_extractor_config",
        lambda: business_tools.SkillExtractorConfig(
            api_key="test-key",
            model="test-model",
        ),
    )
    monkeypatch.setattr(
        business_tools,
        "_request_tavily_skill_search",
        lambda query: {
            "answer": "RTF、BROKE 和 CREATE 是近期常见的提示词框架关键词。",
            "results": [
                {
                    "title": "BROKE prompt framework for training landing pages",
                    "content": "BROKE 用于制造悬念、给出结果承诺和执行边界。",
                    "raw_content": "BROKE 强调先点痛点，再给行动路径。",
                    "url": "https://example.com/broke",
                },
                {
                    "title": "RTF framework helps technical educators shape prompts",
                    "content": "RTF 会先锁角色、再锁任务、最后锁格式。",
                    "raw_content": "特别适合数码科技培训机构的课程引流。",
                    "url": "https://example.com/rtf",
                },
            ],
        },
    )
    monkeypatch.setattr(
        business_tools,
        "_invoke_skill_extractor_llm",
        lambda **kwargs: business_tools.SkillTemplateList.model_validate(
            {
                "templates": [
                    {
                        "title": "RTF 痛点转换框架（数码培训）",
                        "description": "用 RTF 框架放大学习焦虑，再引出课程价值和资料领取动作。",
                        "platform": "小红书",
                        "category": "数码科技",
                        "knowledge_base_scope": "tech_training_prompts",
                        "system_prompt": (
                            "[Role]: 你是一位资深嵌入式讲师。\n"
                            "[Task]: 围绕[主题]写培训机构引流内容。\n"
                            "[Format]: Markdown 列表 + [标题] + [案例]。\n"
                            "[Constraints]: 必须制造焦虑并给出领取资料动作。"
                        ),
                    },
                    {
                        "title": "BROKE 悬念破局框架",
                        "description": "利用同龄人焦虑制造悬念，适合课程转化型软文。",
                        "platform": "抖音",
                        "category": "数码科技",
                        "knowledge_base_scope": "tech_training_prompts",
                        "system_prompt": (
                            "[Role]: 你是一位课程增长策划师。\n"
                            "[Task]: 面向[目标人群]输出爆款短文案。\n"
                            "[Format]: 三段式 + [开头钩子] + [CTA]。\n"
                            "[Constraints]: 不要写空话，要有明确动作。"
                        ),
                    },
                    {
                        "title": "CREATE 结构化成交框架",
                        "description": "用证据、案例和行动路径做成交闭环，适合教育类 Prompt 模板。",
                        "platform": "技术博客",
                        "category": "数码科技",
                        "knowledge_base_scope": "tech_training_prompts",
                        "system_prompt": (
                            "[Role]: 你是一位技术内容总编。\n"
                            "[Task]: 输出一套可复用的课程引流 Meta-Prompt。\n"
                            "[Format]: [标题] [案例] [步骤] [CTA]。\n"
                            "[Constraints]: 必须保留变量占位符。"
                        ),
                    },
                ]
            }
        ),
    )

    result = business_tools.search_prompt_skills(
        keyword="培训机构",
        category="数码科技",
    )

    assert result["data_mode"] == "live_tavily"
    assert result["total"] == 3
    assert result["items"][0]["title"].startswith("RTF")
    assert result["items"][0]["source_url"] == "https://example.com/broke"
    assert "[Role]" in result["items"][0]["system_prompt"]
    assert "[Task]" in result["items"][0]["system_prompt"]
    assert result["items"][0]["knowledge_base_scope"] == "tech_training_prompts"


def test_search_prompt_skills_falls_back_to_llm_when_search_context_is_missing(monkeypatch):
    monkeypatch.setattr(business_tools, "_load_tavily_api_key", lambda: "")
    monkeypatch.setattr(
        business_tools,
        "_load_skill_extractor_config",
        lambda: business_tools.SkillExtractorConfig(
            api_key="test-key",
            model="test-model",
        ),
    )

    captured_context: dict[str, str] = {}

    def fake_llm(**kwargs):
        captured_context["search_context"] = kwargs["search_context"]
        return business_tools.SkillTemplateList.model_validate(
            {
                "templates": [
                    {
                        "title": "RTF 自知回退框架",
                        "description": "即使没有联网结果，也能基于框架知识输出结构化 Meta-Prompt。",
                        "platform": "小红书",
                        "category": "美食文旅",
                        "knowledge_base_scope": "travel_local_guides",
                        "system_prompt": (
                            "[Role]: 你是一位在地内容策划师。\n"
                            "[Task]: 围绕[主题]写探店框架。\n"
                            "[Format]: [标题] [路线] [避坑] [CTA]。\n"
                            "[Constraints]: 必须保留变量占位符。"
                        ),
                    },
                    {
                        "title": "BROKE 自知回退框架",
                        "description": "先提出旅途决策焦虑，再给路线与预算建议。",
                        "platform": "小红书",
                        "category": "美食文旅",
                        "knowledge_base_scope": "travel_local_guides",
                        "system_prompt": (
                            "[Role]: 你是一位旅行编辑。\n"
                            "[Task]: 面向[目标人群]输出收藏型文案。\n"
                            "[Format]: [开头钩子] [路线] [预算] [CTA]。\n"
                            "[Constraints]: 开头必须制造悬念。"
                        ),
                    },
                    {
                        "title": "CREATE 自知回退框架",
                        "description": "强调证据、案例和收藏动作，适合文旅内容种草。",
                        "platform": "抖音",
                        "category": "美食文旅",
                        "knowledge_base_scope": "travel_local_guides",
                        "system_prompt": (
                            "[Role]: 你是一位内容总编。\n"
                            "[Task]: 输出一套可复制的文旅 Prompt。\n"
                            "[Format]: [标题] [亮点] [案例] [CTA]。\n"
                            "[Constraints]: 必须让用户知道下一步做什么。"
                        ),
                    },
                ]
            }
        )

    monkeypatch.setattr(
        business_tools,
        "_invoke_skill_extractor_llm",
        fake_llm,
    )

    result = business_tools.search_prompt_skills(
        keyword="福州文旅",
        category="美食文旅",
    )

    assert result["data_mode"] == "llm_fallback"
    assert result["total"] == 3
    assert "No external search context is available" in captured_context["search_context"]
    assert result["items"][0]["source_title"] == "LLM Self-Knowledge Synthesis"
    assert result["items"][0]["category"] == "美食文旅"


def test_search_prompt_skills_falls_back_to_hardcoded_templates_when_llm_returns_empty(
    monkeypatch,
):
    monkeypatch.setattr(business_tools, "_load_tavily_api_key", lambda: "test-key")
    monkeypatch.setattr(
        business_tools,
        "_request_tavily_skill_search",
        lambda query: {
            "answer": "Recent prompt framework discussions mention RTF, PAS, and BROKE.",
            "results": [
                {
                    "title": "Prompt frameworks for training campaigns",
                    "content": "RTF and PAS are often used for educational landing pages.",
                    "raw_content": "Structured prompts outperform generic marketing copy.",
                    "url": "https://example.com/prompt-frameworks",
                }
            ],
        },
    )
    monkeypatch.setattr(
        business_tools,
        "_load_skill_extractor_config",
        lambda: business_tools.SkillExtractorConfig(
            api_key="test-key",
            model="test-model",
        ),
    )
    monkeypatch.setattr(
        business_tools,
        "_invoke_skill_extractor_llm",
        lambda **kwargs: business_tools.SkillTemplateList.model_validate(
            {"templates": []}
        ),
    )

    result = business_tools.search_prompt_skills(
        keyword="培训机构",
        category="数码科技",
    )

    assert result["data_mode"] == "mock_fallback"
    assert result["total"] == 3
    assert result["items"][0]["title"].startswith("RTF")
    assert result["items"][0]["system_prompt"]
    assert result["fallback_reason"]


def test_langgraph_executes_sequential_business_tools_before_final_draft():
    inner_provider = BusinessToolRecordingProvider()

    async def no_search(_: MediaChatRequest) -> dict[str, object]:
        return {"needs_search": False, "search_query": ""}

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        route_analyzer=no_search,
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-business-tool",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "\u8bf7\u5148\u62c9\u53d6\u798f\u5dde\u5468\u8fb9\u6587\u65c5\u63a2\u5e97\u5e02\u573a\u70ed\u8bcd\uff0c\u518d\u7b56\u5212\u4e00\u7bc7\u5c0f\u7ea2\u4e66\u7b14\u8bb0\u3002",
            "materials": [],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    tool_calls = [event for event in events if event["event"] == "tool_call"]
    tool_call_names = [str(event["name"]) for event in tool_calls]
    assert tool_call_names.count("generate_draft") == 3
    assert "analyze_market_trends" in tool_call_names
    assert "generate_content_outline" in tool_call_names
    assert tool_call_names.index("analyze_market_trends") < tool_call_names.index(
        "generate_content_outline"
    )
    assert tool_call_names.index("generate_content_outline") < tool_call_names.index("review_draft")
    assert tool_call_names.index("analyze_market_trends") < tool_call_names.index("review_draft")

    trend_statuses = [
        str(event["status"])
        for event in tool_calls
        if event["name"] == "analyze_market_trends"
    ]
    assert trend_statuses == ["processing", "completed"]
    outline_statuses = [
        str(event["status"])
        for event in tool_calls
        if event["name"] == "generate_content_outline"
    ]
    assert outline_statuses == ["processing", "completed"]
    assert any("\u6b63\u5728\u8c03\u7528\u4e1a\u52a1\u5de5\u5177" in str(event.get("message", "")) for event in tool_calls)

    assert inner_provider.calls == 1
    assert "<business_tool_context>" in inner_provider.last_request_message
    assert "analyze_market_trends" in inner_provider.last_request_message
    assert "generate_content_outline" in inner_provider.last_request_message
    assert "\u5730\u57df\u6587\u65c5" in inner_provider.last_request_message
    assert any(event["event"] == "artifact" for event in events)
    assert events[-1]["event"] == "done"


def test_langgraph_stops_after_market_tool_for_title_only_request():
    inner_provider = BusinessToolRecordingProvider()

    async def no_search(_: MediaChatRequest) -> dict[str, object]:
        return {"needs_search": False, "search_query": ""}

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        route_analyzer=no_search,
        image_prompt_builder=lambda **_: "",
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-business-tool-title",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "\u5e2e\u6211\u5199\u4e00\u4e2a\u95f2\u9c7c\u521d\u4e2d\u6559\u8f85\u8d44\u6599\u7684\u5f15\u6d41\u6807\u9898\uff0c\u4f60\u9700\u8981\u5148\u62c9\u53d6\u4e00\u4e0b\u76ee\u524d\u7684\u5e02\u573a\u70ed\u8bcd\u3002",
            "materials": [],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    tool_calls = [event for event in events if event["event"] == "tool_call"]
    tool_call_names = [str(event["name"]) for event in tool_calls]
    assert tool_call_names.count("generate_draft") == 2
    assert "analyze_market_trends" in tool_call_names
    assert "generate_content_outline" not in tool_call_names

    assert inner_provider.calls == 1
    assert "analyze_market_trends" in inner_provider.last_request_message
    assert "generate_content_outline" not in inner_provider.last_request_message
    assert "\u6559\u8f85\u8d44\u6599" in inner_provider.last_request_message


def test_langgraph_autonomously_considers_business_tools_for_planning_requests():
    inner_provider = BusinessToolRecordingProvider()

    async def no_search(_: MediaChatRequest) -> dict[str, object]:
        return {"needs_search": False, "search_query": ""}

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        route_analyzer=no_search,
        image_prompt_builder=lambda **_: "",
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-business-tool-autonomous",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "\u5e2e\u6211\u7b56\u5212\u4e00\u7bc7\u798f\u5dde\u5468\u8fb9\u7684\u6587\u65c5\u63a2\u5e97\u7b14\u8bb0\u3002",
            "materials": [],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    tool_call_names = [
        str(event["name"]) for event in events if event["event"] == "tool_call"
    ]
    assert "analyze_market_trends" in tool_call_names
    assert "generate_content_outline" in tool_call_names
    assert inner_provider.calls == 1
    assert "analyze_market_trends" in inner_provider.last_request_message
    assert "generate_content_outline" in inner_provider.last_request_message


def test_langgraph_router_builds_two_step_execution_plan_for_mixed_content_request():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-router-two-step-plan",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "帮我写一篇北京文旅种草图文，并配一张首页海报。",
            "materials": [],
        }
    )

    async def no_search(_: MediaChatRequest) -> dict[str, object]:
        return {"needs_search": False, "search_query": ""}

    provider = LangGraphProvider(
        inner_provider=ImageReadyProvider(),
        route_analyzer=no_search,
        image_prompt_builder=lambda **_: "",
    )

    state = provider._build_initial_state(request)
    updates = asyncio.run(provider._router_node(state))

    assert updates["execution_plan"] == ["draft_content", "generate_image"]
    assert updates["active_execution_step"] == "draft_content"
    assert updates["needs_image"] is True
    assert updates["direct_image_mode"] is False


def test_langgraph_router_builds_single_step_plan_for_direct_image_request():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-router-direct-image-plan",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "Generate a poster only for a summer tea launch. Image only, no copy.",
            "materials": [],
        }
    )

    async def no_search(_: MediaChatRequest) -> dict[str, object]:
        return {"needs_search": False, "search_query": ""}

    provider = LangGraphProvider(
        inner_provider=ImageReadyProvider(),
        route_analyzer=no_search,
        image_prompt_builder=lambda **_: "",
    )

    state = provider._build_initial_state(request)
    updates = asyncio.run(provider._router_node(state))

    assert updates["execution_plan"] == ["generate_image"]
    assert updates["active_execution_step"] == "generate_image"
    assert updates["needs_image"] is True
    assert updates["direct_image_mode"] is True


def test_langgraph_injects_knowledge_base_context_before_final_generation(monkeypatch):
    inner_provider = BusinessToolRecordingProvider()

    async def no_search(_: MediaChatRequest) -> dict[str, object]:
        return {"needs_search": False, "search_query": ""}

    class StubKnowledgeBaseService:
        def retrieve_chunks(
            self,
            user_id: str,
            scope: str,
            query: str,
            top_k: int = 3,
        ) -> list[KnowledgeDocument]:
            assert user_id == "user-rag"
            assert scope == "food_tourism_xhs"
            assert query == "帮我把这段文案改得更有代入感"
            assert top_k == 3
            return [
                KnowledgeDocument(
                    document_id="rag-1",
                    user_id=user_id,
                    scope=scope,
                    source="餐饮探店方法论.docx",
                    text="Xiaohongshu food notes should mention price and regional contrast in the opening line.",
                    created_at="2026-04-30T12:00:00Z",
                    chunk_index=0,
                    relevance_score=0.92,
                ),
                KnowledgeDocument(
                    document_id="rag-2",
                    user_id=user_id,
                    scope=scope,
                    source="餐饮探店方法论.docx",
                    text="Strong store notes should include route efficiency, real budget, and one avoid-pit reminder.",
                    created_at="2026-04-30T12:00:00Z",
                    chunk_index=1,
                    relevance_score=0.87,
                ),
                KnowledgeDocument(
                    document_id="rag-3",
                    user_id=user_id,
                    scope=scope,
                    source="品牌语气手册.md",
                    text="Use immersive sensory verbs before moving into the call to action.",
                    created_at="2026-04-30T12:00:00Z",
                    chunk_index=0,
                    relevance_score=0.74,
                ),
            ]

    monkeypatch.setattr(
        graph_provider_module,
        "get_knowledge_base_service",
        lambda: StubKnowledgeBaseService(),
    )

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        route_analyzer=no_search,
        image_prompt_builder=lambda **_: "",
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-rag-injection",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "帮我把这段文案改得更有代入感",
            "materials": [],
        }
    )
    thread = Thread(
        id="thread-rag-injection",
        user_id="user-rag",
        title="RAG thread",
        system_prompt="You are a Xiaohongshu lifestyle editor.",
        knowledge_base_scope="food_tourism_xhs",
    )

    events = asyncio.run(collect_events(provider, request, thread=thread))

    tool_call_names = [
        str(event["name"]) for event in events if event["event"] == "tool_call"
    ]
    assert "retrieve_knowledge_base" in tool_call_names
    assert inner_provider.calls == 1
    assert "专属外挂知识库检索结果" in inner_provider.last_request_system_prompt
    assert "price and regional contrast" in inner_provider.last_request_system_prompt
    assert "avoid-pit reminder" in inner_provider.last_request_system_prompt
    assert "当你使用上述知识库信息时，必须在对应句子末尾使用方括号来源编号引用" in inner_provider.last_request_system_prompt
    assert "【引用来源】" in inner_provider.last_request_system_prompt
    assert "[1] 餐饮探店方法论.docx" in inner_provider.last_request_system_prompt
    assert "[2] 品牌语气手册.md" in inner_provider.last_request_system_prompt
    assert inner_provider.last_request_system_prompt.count("[1] (餐饮探店方法论.docx)") == 2
    assert "92% 相关度" in inner_provider.last_request_system_prompt

    artifact_event = next(event for event in events if event["event"] == "artifact")
    artifact = ContentGenerationArtifactPayload.model_validate(artifact_event["artifact"])
    assert artifact.citation_audit[0].source == "餐饮探店方法论.docx"
    assert artifact.citation_audit[0].relevance_score == 0.92
    assert artifact.citation_audit[0].citation_index == 1
    assert artifact.citation_audit[1].chunk_index == 1
    assert artifact.citation_audit[2].source == "品牌语气手册.md"


def test_langgraph_attaches_generated_images_to_content_artifact():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-image-generation",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请把这段内容整理成适合小红书发布的图文草稿。",
            "materials": [],
        }
    )

    async def fake_prompt_builder(*, request, draft, artifact_candidate):
        assert request.platform.value == "xiaohongshu"
        assert draft
        assert artifact_candidate is not None
        return "为这篇小红书内容生成一张明亮、真实、有点击欲的封面图。"

    async def fake_image_generator(*, request, prompt, user_id, thread_id):
        assert request.thread_id == thread_id
        assert user_id is None
        assert "封面图" in prompt
        return [
            "https://example.com/generated-cover-1.png",
            "https://example.com/generated-cover-2.png",
        ]

    async def always_generate_images(request, draft, artifact_candidate):
        assert request.task_type.value == "content_generation"
        assert draft
        assert artifact_candidate is not None
        return {"needs_image": True}

    provider = LangGraphProvider(
        inner_provider=ImageReadyProvider(),
        image_route_analyzer=always_generate_images,
        image_prompt_builder=fake_prompt_builder,
        image_generator=fake_image_generator,
    )

    events = asyncio.run(collect_events(provider, request))

    tool_call_names = [
        str(event["name"]) for event in events if event["event"] == "tool_call"
    ]
    assert "build_image_prompt" in tool_call_names
    assert "generate_cover_images" in tool_call_names

    artifact_events = [event for event in events if event["event"] == "artifact"]
    assert len(artifact_events) >= 2

    first_artifact = ContentGenerationArtifactPayload.model_validate(artifact_events[0]["artifact"])
    assert first_artifact.generated_images == []

    artifact = ContentGenerationArtifactPayload.model_validate(artifact_events[-1]["artifact"])
    assert artifact.generated_images == [
        "https://example.com/generated-cover-1.png",
        "https://example.com/generated-cover-2.png",
    ]


def test_langgraph_semantic_translation_request_keeps_needs_image_false():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-semantic-translation",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请帮我把下面这段英文翻译成中文：A calm weekly reset helps me focus on what matters most.",
            "materials": [],
        }
    )

    async def unexpected_prompt_builder(*, request, draft, artifact_candidate):
        raise AssertionError("translation requests should not build an image prompt")

    async def unexpected_image_generator(*, request, prompt, user_id, thread_id):
        raise AssertionError("translation requests should not trigger image generation")

    provider = LangGraphProvider(
        inner_provider=ImageReadyProvider(),
        image_prompt_builder=unexpected_prompt_builder,
        image_generator=unexpected_image_generator,
    )

    custom_events, final_state = asyncio.run(collect_graph_execution(provider, request))

    assert final_state["needs_image"] is False
    tool_call_names = [
        str(event["name"]) for event in custom_events if event.get("event") == "tool_call"
    ]
    assert "build_image_prompt" not in tool_call_names
    assert "generate_cover_images" not in tool_call_names


def test_langgraph_semantic_visual_request_sets_needs_image_true():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-semantic-visual",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "帮我写一篇小红书种草图文，并在开头配一张极具赛博朋克风格的极客桌面图。",
            "materials": [],
        }
    )

    async def fake_prompt_builder(*, request, draft, artifact_candidate):
        assert "赛博朋克" in request.message
        assert draft
        assert artifact_candidate is not None
        return "生成一张赛博朋克风格的极客桌面图，适合作为小红书图文开头配图。"

    async def fake_image_generator(*, request, prompt, user_id, thread_id):
        assert request.thread_id == thread_id
        assert "赛博朋克" in prompt
        return ["https://example.com/cyberpunk-geek-desk.png"]

    provider = LangGraphProvider(
        inner_provider=ImageReadyProvider(),
        image_prompt_builder=fake_prompt_builder,
        image_generator=fake_image_generator,
    )

    custom_events, final_state = asyncio.run(collect_graph_execution(provider, request))

    assert final_state["needs_image"] is True
    assert final_state["generated_images"] == ["https://example.com/cyberpunk-geek-desk.png"]
    tool_call_names = [
        str(event["name"]) for event in custom_events if event.get("event") == "tool_call"
    ]
    assert "build_image_prompt" in tool_call_names
    assert "generate_cover_images" in tool_call_names


def test_langgraph_direct_image_request_bypasses_search_and_draft_generation():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-direct-image-bypass",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "Generate a poster only for a summer collab launch. Image only, no copy.",
            "materials": [],
        }
    )

    async def fake_prompt_builder(*, request, draft, artifact_candidate):
        assert artifact_candidate is None
        assert "image only" in draft.lower()
        return "A bright and minimal summer collaboration poster with generous white space."

    async def fake_image_generator(*, request, prompt, user_id, thread_id):
        assert request.thread_id == thread_id
        assert user_id is None
        assert "summer collaboration poster" in prompt.lower()
        return ["https://example.com/summer-collab-poster.png"]

    provider = LangGraphProvider(
        inner_provider=DraftForbiddenProvider(),
        image_prompt_builder=fake_prompt_builder,
        image_generator=fake_image_generator,
    )

    custom_events, final_state = asyncio.run(collect_graph_execution(provider, request))

    assert final_state["direct_image_mode"] is True
    assert final_state["needs_search"] is False
    assert final_state["request"].task_type.value == "image_generation"
    assert final_state["generated_images"] == ["https://example.com/summer-collab-poster.png"]

    tool_call_names = [
        str(event["name"]) for event in custom_events if event.get("event") == "tool_call"
    ]
    assert "web_search" not in tool_call_names
    assert "generate_draft" not in tool_call_names
    assert "build_image_prompt" in tool_call_names
    assert "generate_cover_images" in tool_call_names

    message_text = "".join(
        str(event["delta"]) for event in custom_events if event["event"] == "message"
    )
    assert "已为你整理出一版可直接渲染的美术方案" in message_text
    assert "summer collaboration poster" in message_text.lower()

    artifact_events = [event for event in custom_events if event["event"] == "artifact"]
    processing_artifact = ImageGenerationArtifactPayload.model_validate(
        artifact_events[0]["artifact"]
    )
    artifact = ImageGenerationArtifactPayload.model_validate(artifact_events[-1]["artifact"])
    assert processing_artifact.status == "processing"
    assert processing_artifact.generated_images == []
    assert processing_artifact.progress_message
    assert artifact.artifact_type == "image_result"
    assert artifact.status == "completed"
    assert artifact.generated_images == ["https://example.com/summer-collab-poster.png"]
    assert "summer collaboration poster" in artifact.prompt.lower()


def test_langgraph_dedicated_image_generation_task_skips_search_and_draft_generation():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-dedicated-image-generation",
            "platform": "xiaohongshu",
            "task_type": "image_generation",
            "message": "Create a clean fruit tea launch poster with bright lighting and premium white space.",
            "materials": [],
        }
    )

    async def fake_prompt_builder(*, request, draft, artifact_candidate):
        assert request.task_type.value == "image_generation"
        assert artifact_candidate is None
        assert "fruit tea" in draft.lower()
        return "A clean fruit tea launch poster with bright lighting and premium white space."

    async def fake_image_generator(*, request, prompt, user_id, thread_id):
        assert request.thread_id == thread_id
        assert user_id is None
        assert "fruit tea" in prompt.lower()
        return ["https://example.com/fruit-tea-poster.png"]

    provider = LangGraphProvider(
        inner_provider=DraftForbiddenProvider(),
        image_prompt_builder=fake_prompt_builder,
        image_generator=fake_image_generator,
    )

    custom_events, final_state = asyncio.run(collect_graph_execution(provider, request))

    assert final_state["direct_image_mode"] is True
    assert final_state["needs_search"] is False
    assert final_state["generated_images"] == ["https://example.com/fruit-tea-poster.png"]

    tool_call_names = [
        str(event["name"]) for event in custom_events if event.get("event") == "tool_call"
    ]
    assert "web_search" not in tool_call_names
    assert "generate_draft" not in tool_call_names
    assert "build_image_prompt" in tool_call_names
    assert "generate_cover_images" in tool_call_names

    message_text = "".join(
        str(event["delta"]) for event in custom_events if event["event"] == "message"
    )
    assert "已为你整理出一版可直接渲染的美术方案" in message_text
    assert "fruit tea" in message_text.lower()

    artifact_events = [event for event in custom_events if event["event"] == "artifact"]
    processing_artifact = ImageGenerationArtifactPayload.model_validate(
        artifact_events[0]["artifact"]
    )
    artifact = ImageGenerationArtifactPayload.model_validate(artifact_events[-1]["artifact"])
    assert processing_artifact.status == "processing"
    assert processing_artifact.generated_images == []
    assert processing_artifact.progress_message
    assert artifact.artifact_type == "image_result"
    assert artifact.status == "completed"
    assert artifact.generated_images == ["https://example.com/fruit-tea-poster.png"]
    assert "fruit tea" in artifact.prompt.lower()


def test_smart_task_resolution_demotes_image_task_with_image_analysis_prompt():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-smart-router-image-analysis",
            "platform": "xiaohongshu",
            "task_type": "image_generation",
            "message": "Analyze this image and write a short Xiaohongshu caption.",
            "materials": [
                {
                    "type": "image",
                    "url": "https://example.com/reference.png",
                }
            ],
        }
    )

    resolution = resolve_media_chat_task_type(request)

    assert resolution.requested_task_type.value == "image_generation"
    assert resolution.resolved_task_type.value == "content_generation"
    assert resolution.direct_image_mode is False
    assert resolution.reason == "image_materials_requested_for_text_or_analysis"


def test_langgraph_router_normalizes_wrong_image_task_back_to_content_generation():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-smart-router-text-request",
            "platform": "xiaohongshu",
            "task_type": "image_generation",
            "message": "Write a short Xiaohongshu caption for a fruit tea launch. No image.",
            "materials": [],
        }
    )

    async def no_search_route(_request):
        return {"needs_search": False, "search_query": ""}

    provider = LangGraphProvider(
        inner_provider=DraftForbiddenProvider(),
        route_analyzer=no_search_route,
    )

    router_state = asyncio.run(provider._router_node(provider._build_initial_state(request)))

    assert router_state["request"].task_type.value == "content_generation"
    assert router_state["direct_image_mode"] is False
    assert router_state["needs_search"] is False


def test_langgraph_keeps_text_artifact_when_image_generation_fails():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-image-generation-failure",
            "platform": "douyin",
            "task_type": "content_generation",
            "message": "帮我整理成抖音图文草稿。",
            "materials": [],
        }
    )

    async def fake_prompt_builder(*, request, draft, artifact_candidate):
        return "一张适合抖音首屏的高冲击封面图。"

    async def failing_image_generator(*, request, prompt, user_id, thread_id):
        raise RuntimeError("image provider boom")

    async def always_generate_images(request, draft, artifact_candidate):
        assert request.platform.value == "douyin"
        assert draft
        assert artifact_candidate is not None
        return {"needs_image": True}

    provider = LangGraphProvider(
        inner_provider=ImageReadyProvider(),
        image_route_analyzer=always_generate_images,
        image_prompt_builder=fake_prompt_builder,
        image_generator=failing_image_generator,
    )

    events = asyncio.run(collect_events(provider, request))

    assert not any(event["event"] == "error" for event in events)
    failed_image_events = [
        event
        for event in events
        if event["event"] == "tool_call" and event["name"] == "generate_cover_images"
    ]
    assert failed_image_events[-1]["status"] == "failed"

    artifact_event = next(event for event in events if event["event"] == "artifact")
    artifact = ContentGenerationArtifactPayload.model_validate(artifact_event["artifact"])
    assert artifact.artifact_type == "content_draft"
    assert artifact.generated_images == []


def test_langgraph_direct_image_generation_cancellation_bubbles_out(
    monkeypatch,
):
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-image-generation-cancelled",
            "platform": "xiaohongshu",
            "task_type": "image_generation",
            "message": "Create a luxury skincare poster and then cancel it.",
            "materials": [],
        }
    )

    async def fake_prompt_builder(*, request, draft, artifact_candidate):
        return "A luxury skincare poster with soft highlights and premium packaging."

    async def cancelled_image_generator(*, request, prompt, user_id, thread_id):
        raise asyncio.CancelledError()

    provider = LangGraphProvider(
        inner_provider=DraftForbiddenProvider(),
        image_prompt_builder=fake_prompt_builder,
        image_generator=cancelled_image_generator,
    )

    monkeypatch.setattr(
        graph_provider_module,
        "get_stream_writer",
        lambda: (lambda payload: None),
    )
    state = provider._build_initial_state(request)
    state["needs_image"] = True
    state["direct_image_mode"] = True

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(provider._generate_image_node(state))


def test_langgraph_direct_image_generation_emits_processing_updates(monkeypatch):
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-image-progress-updates",
            "platform": "xiaohongshu",
            "task_type": "image_generation",
            "message": "Create a premium camping poster with warm sunset lighting.",
            "materials": [],
        }
    )

    async def fake_prompt_builder(*, request, draft, artifact_candidate):
        return "A premium camping poster with warm sunset lighting and layered outdoor textures."

    async def slow_image_generator(*, request, prompt, user_id, thread_id):
        await asyncio.sleep(0.03)
        return ["https://example.com/camping-poster.png"]

    monkeypatch.setattr(graph_provider_module, "IMAGE_PROGRESS_HEARTBEAT_SECONDS", 0.01)
    provider = LangGraphProvider(
        inner_provider=DraftForbiddenProvider(),
        image_prompt_builder=fake_prompt_builder,
        image_generator=slow_image_generator,
    )

    custom_events, final_state = asyncio.run(collect_graph_execution(provider, request))

    assert final_state["generated_images"] == ["https://example.com/camping-poster.png"]
    processing_artifacts = [
        ImageGenerationArtifactPayload.model_validate(event["artifact"])
        for event in custom_events
        if event["event"] == "artifact"
        and isinstance(event.get("artifact"), dict)
        and event["artifact"].get("artifact_type") == "image_result"
        and event["artifact"].get("status") == "processing"
    ]
    assert len(processing_artifacts) >= 2
    assert all(artifact.progress_message for artifact in processing_artifacts)
    assert processing_artifacts[-1].progress_percent >= processing_artifacts[0].progress_percent


def test_langgraph_skips_image_generation_for_text_only_publishing_requests():
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-image-generation-skip",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "Please translate this copy into Chinese with no image and text only output.",
            "materials": [],
        }
    )

    async def unexpected_prompt_builder(*, request, draft, artifact_candidate):
        raise AssertionError("text-only requests should not build an image prompt")

    async def unexpected_image_generator(*, request, prompt, user_id, thread_id):
        raise AssertionError("text-only requests should not trigger image generation")

    provider = LangGraphProvider(
        inner_provider=ImageReadyProvider(),
        image_prompt_builder=unexpected_prompt_builder,
        image_generator=unexpected_image_generator,
    )

    events = asyncio.run(collect_events(provider, request))

    tool_call_names = [
        str(event["name"]) for event in events if event["event"] == "tool_call"
    ]
    assert "build_image_prompt" not in tool_call_names
    assert "generate_cover_images" not in tool_call_names

    artifact_event = next(event for event in events if event["event"] == "artifact")
    artifact = ContentGenerationArtifactPayload.model_validate(artifact_event["artifact"])
    assert artifact.generated_images == []
