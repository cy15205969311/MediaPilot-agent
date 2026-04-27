import asyncio

from app.models.schemas import MediaChatRequest
from app.services.graph import LangGraphProvider
from app.services.providers import BaseLLMProvider


class SearchRecordingProvider(BaseLLMProvider):
    def __init__(self) -> None:
        self.last_request_message = ""

    async def generate_stream(self, request, **kwargs):
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
            "delta": "search-enhanced draft",
            "index": 0,
        }
        if request.task_type.value == "topic_planning":
            yield {
                "event": "artifact",
                "artifact": {
                    "artifact_type": "topic_list",
                    "title": "Topic plan",
                    "topics": [
                        {
                            "title": "Trend-based topic",
                            "angle": "Leverage recent search context",
                            "goal": "Improve topic freshness",
                        }
                    ],
                },
            }
        elif request.task_type.value == "hot_post_analysis":
            yield {
                "event": "artifact",
                "artifact": {
                    "artifact_type": "hot_post_analysis",
                    "title": "Hot post analysis",
                    "analysis_dimensions": [
                        {
                            "dimension": "Hook",
                            "insight": "Recent search trend validates the opening angle.",
                        }
                    ],
                    "reusable_templates": [
                        "Use current trend evidence before giving the breakdown."
                    ],
                },
            }
        else:
            yield {
                "event": "artifact",
                "artifact": {
                    "artifact_type": "content_draft",
                    "title": "Draft",
                    "title_candidates": ["A", "B", "C"],
                    "body": "search-enhanced draft",
                    "platform_cta": "continue",
                },
            }
        yield {"event": "done", "thread_id": request.thread_id}


async def collect_events(provider: LangGraphProvider, request: MediaChatRequest):
    events: list[dict[str, object]] = []
    async for event in provider.generate_stream(request):
        events.append(event)
    return events


def test_langgraph_provider_routes_topic_planning_through_search():
    inner_provider = SearchRecordingProvider()

    async def fake_route(_: MediaChatRequest) -> dict[str, object]:
        return {
            "needs_search": True,
            "search_query": "2026 理财内容趋势 小红书 热点",
        }

    async def fake_search(request: MediaChatRequest, search_query: str) -> list[str]:
        assert request.task_type.value == "topic_planning"
        assert search_query == "2026 理财内容趋势 小红书 热点"
        return [
            "Search summary: creators are discussing tax-season portfolio reviews.",
            "1. April portfolio review trend | People want actionable checklists.",
        ]

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        route_analyzer=fake_route,
        search_analyzer=fake_search,
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-search-topic",
            "platform": "xiaohongshu",
            "task_type": "topic_planning",
            "message": "Plan several fresh finance content topics for this week.",
            "materials": [],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    tool_call_names = [
        str(event["name"])
        for event in events
        if event["event"] == "tool_call"
    ]
    assert "web_search" in tool_call_names
    assert tool_call_names.index("parse_materials") < tool_call_names.index("web_search")
    assert tool_call_names.index("web_search") < tool_call_names.index("generate_draft")
    assert "<search_context>" in inner_provider.last_request_message
    assert "Search summary:" in inner_provider.last_request_message
    assert any(event["event"] == "artifact" for event in events)
    web_search_event = next(
        event
        for event in events
        if event["event"] == "tool_call" and event.get("name") == "web_search"
    )
    assert web_search_event["message"] == "正在搜索全网热点: 2026 理财内容趋势 小红书 热点"


def test_langgraph_provider_routes_hot_post_analysis_through_search():
    inner_provider = SearchRecordingProvider()

    async def fake_route(_: MediaChatRequest) -> dict[str, object]:
        return {
            "needs_search": True,
            "search_query": "近期 投资类爆款内容 传播趋势",
        }

    async def fake_search(request: MediaChatRequest, search_query: str) -> list[str]:
        assert request.task_type.value == "hot_post_analysis"
        assert "投资类爆款内容" in search_query
        return [
            "Search summary: short-form investing explainers are trending again.",
        ]

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        route_analyzer=fake_route,
        search_analyzer=fake_search,
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-search-hot-post",
            "platform": "xiaohongshu",
            "task_type": "hot_post_analysis",
            "message": "Analyze why a recent investing post performed well.",
            "materials": [],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    assert "<search_context>" in inner_provider.last_request_message
    assert "short-form investing explainers" in inner_provider.last_request_message
    assert any(
        event["event"] == "tool_call" and event.get("name") == "web_search"
        for event in events
    )
    assert any(event["event"] == "artifact" for event in events)


def test_langgraph_provider_degrades_gracefully_when_search_fails():
    inner_provider = SearchRecordingProvider()

    async def fake_route(_: MediaChatRequest) -> dict[str, object]:
        return {
            "needs_search": True,
            "search_query": "失败搜索回退测试",
        }

    async def failing_search(_: MediaChatRequest, __: str) -> list[str]:
        raise ValueError("search boom")

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        route_analyzer=fake_route,
        search_analyzer=failing_search,
    )
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-search-fallback",
            "platform": "xiaohongshu",
            "task_type": "topic_planning",
            "message": "Plan fresh topics even if search fails.",
            "materials": [],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    error_event = next(event for event in events if event["event"] == "error")
    assert error_event["code"] == "SEARCH_RUNTIME_ERROR"
    assert any(event["event"] == "artifact" for event in events)
    assert events[-1] == {"event": "done", "thread_id": "thread-search-fallback"}


def test_langgraph_provider_uses_mock_search_results_when_api_key_is_missing():
    inner_provider = SearchRecordingProvider()
    async def fake_route(_: MediaChatRequest) -> dict[str, object]:
        return {
            "needs_search": True,
            "search_query": "未配置真实搜索服务时的模拟热点",
        }

    provider = LangGraphProvider(
        inner_provider=inner_provider,
        route_analyzer=fake_route,
    )
    provider.search_api_key = ""
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-search-skip",
            "platform": "xiaohongshu",
            "task_type": "topic_planning",
            "message": "Plan topics even without external search configuration.",
            "materials": [],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    search_statuses = [
        str(event["status"])
        for event in events
        if event["event"] == "tool_call" and event.get("name") == "web_search"
    ]
    assert "processing" in search_statuses
    assert "completed" in search_statuses
    assert not any(event["event"] == "error" for event in events)
    assert any(event["event"] == "artifact" for event in events)
    assert "<search_context>" in inner_provider.last_request_message
    assert "模拟联网检索上下文" in inner_provider.last_request_message


def test_langgraph_provider_heuristic_router_can_trigger_search_for_latest_requests():
    inner_provider = SearchRecordingProvider()
    provider = LangGraphProvider(inner_provider=inner_provider)
    provider.search_api_key = ""
    request = MediaChatRequest.model_validate(
        {
            "thread_id": "thread-search-latest",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "帮我写一篇关于今天最新发布手机的小红书评测",
            "materials": [],
        }
    )

    events = asyncio.run(collect_events(provider, request))

    assert any(
        event["event"] == "tool_call" and event.get("name") == "web_search"
        for event in events
    )
    assert "<search_context>" in inner_provider.last_request_message
