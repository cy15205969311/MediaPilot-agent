import asyncio
import json

import app.services.graph.provider as graph_provider_module
from app.db.models import Thread
from app.models.schemas import MediaChatRequest
from app.services import tools as business_tools
from app.services.graph import LangGraphProvider
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


def test_langgraph_injects_knowledge_base_context_before_final_generation(monkeypatch):
    inner_provider = BusinessToolRecordingProvider()

    async def no_search(_: MediaChatRequest) -> dict[str, object]:
        return {"needs_search": False, "search_query": ""}

    class StubKnowledgeBaseService:
        def retrieve_context(self, scope: str, query: str, top_k: int = 3) -> str:
            assert scope == "food_tourism_xhs"
            assert query == "帮我把这段文案改得更有代入感"
            assert top_k == 3
            return (
                "[1] Xiaohongshu food notes should mention price and regional contrast in the opening line.\n\n"
                "[2] Strong store notes should include route efficiency, real budget, and one avoid-pit reminder."
            )

    monkeypatch.setattr(
        graph_provider_module,
        "get_knowledge_base_service",
        lambda: StubKnowledgeBaseService(),
    )

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        route_analyzer=no_search,
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
