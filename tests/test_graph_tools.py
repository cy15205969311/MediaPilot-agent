import asyncio
import json

from app.models.schemas import MediaChatRequest
from app.services import tools as business_tools
from app.services.graph import LangGraphProvider
from app.services.providers import BaseLLMProvider
from app.services.tools import execute_business_tool, get_openai_tool_specs


class BusinessToolRecordingProvider(BaseLLMProvider):
    def __init__(self) -> None:
        self.last_request_message = ""
        self.calls = 0

    async def generate_stream(self, request, **kwargs):
        self.calls += 1
        self.last_request_message = request.message
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


async def collect_events(provider: LangGraphProvider, request: MediaChatRequest):
    events: list[dict[str, object]] = []
    async for event in provider.generate_stream(request):
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
