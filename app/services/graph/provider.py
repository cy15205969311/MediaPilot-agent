import asyncio
import base64
import inspect
import json
import logging
import mimetypes
import os
import traceback
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TypedDict

import httpx
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from openai import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    BadRequestError,
    OpenAIError,
    RateLimitError,
)
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.config import load_environment
from app.db.models import Thread
from app.models.schemas import (
    CommentReplyArtifactPayload,
    CommentReplySuggestion,
    ContentGenerationArtifactPayload,
    HotPostAnalysisArtifactPayload,
    HotPostAnalysisDimension,
    MaterialInput,
    MaterialType,
    MediaChatRequest,
    TaskType,
    TopicPlanningArtifactPayload,
    TopicPlanningItem,
)
from app.services.oss_client import (
    build_delivery_url_from_stored_path,
    normalize_storage_reference,
    parse_stored_file_path,
)
from app.services.knowledge_base import (
    get_knowledge_base_service,
    normalize_knowledge_base_scope,
)
from app.services.persistence import extract_upload_relative_path
from app.services.providers import (
    BaseLLMProvider,
    CompatibleLLMProvider,
    MockLLMProvider,
    OpenAIProvider,
)
from app.services.tools import execute_business_tool, get_business_tools

logger = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[3]
UPLOADS_DIR = PROJECT_ROOT / "uploads"


def _build_http_timeout(seconds: float) -> httpx.Timeout:
    connect_timeout = min(seconds, 10.0)
    return httpx.Timeout(seconds, connect=connect_timeout)


REMOTE_IMAGE_FETCH_TIMEOUT = _build_http_timeout(20.0)
DRAFT_VISION_USER_MESSAGE_TEMPLATE = (
    "用户提供了一张图片，视觉感知系统已提取了以下图片内容详情：\n"
    "<image_context>\n"
    "{vision_clues}\n"
    "</image_context>\n\n"
    "请直接基于上述图片内容和用户的具体要求，直接输出最终的新媒体文案或回答，"
    "不要在开头做任何解释或说明。\n"
    "用户的具体要求是：{user_message}"
)
DRAFT_SEARCH_INSTRUCTION = (
    "请结合以下最新全网搜索结果，为用户生成具有时效性的新媒体文案或分析结论。"
)
DRAFT_FINAL_RESPONSE_INSTRUCTION = (
    "请直接基于上述上下文和用户的具体要求输出最终的新媒体文案或回答，"
    "不要在开头做任何解释或说明。"
)
BEIJING_TIMEZONE = timezone(timedelta(hours=8))


def _build_router_decision_system_prompt() -> str:
    current_datetime = datetime.now(BEIJING_TIMEZONE)
    current_date = current_datetime.strftime("%Y年%m月%d日")
    current_year = current_datetime.year
    current_month = current_datetime.strftime("%Y年%m月")
    return (
        "你是一个高级的 AI 意图识别与搜索词规划专家。\n"
        f"【系统时间】：今天是 {current_date}（北京时间）。\n"
        "【核心任务】：请根据用户的输入，判断是否需要进行全网搜索。"
        "如果需要，请提取出最精准、最适合搜索引擎使用的 search_query。\n"
        "【判断原则】：只有当外部搜索能显著提升答案的时效性、真实性、完整性或现实参考价值时，"
        "才把 needs_search 设为 true；否则必须返回 false。\n"
        "【时间强制约束】：如果用户任务具有明显时效性，例如最新资讯、爆款、趋势、探店、价格、"
        f"近期案例、政策变化或年度对比，你生成的 search_query 必须主动带上当前年份 {current_year} "
        f"或具体年月（例如 {current_month}）。\n"
        "【输出要求】：无论是否需要搜索，你都只能返回一个 JSON object，字段固定为 needs_search 和 search_query。"
    )


def _resolve_vision_model(explicit_model: str | None) -> str:
    if explicit_model and explicit_model.strip():
        return explicit_model.strip()

    compatible_api_key = os.getenv("LLM_API_KEY", "").strip()
    compatible_base_url = os.getenv("LLM_BASE_URL", "").strip()
    compatible_vision_model = os.getenv("LLM_VISION_MODEL", "").strip()
    if compatible_api_key and compatible_base_url:
        if not compatible_vision_model:
            raise RuntimeError(
                "LLM_VISION_MODEL must be set when using the compatible vision provider.",
            )
        return compatible_vision_model

    openai_vision_model = os.getenv("OPENAI_VISION_MODEL", "").strip()
    if openai_vision_model:
        return openai_vision_model

    return "gpt-4o-mini"


class GraphState(TypedDict, total=False):
    request: MediaChatRequest
    materials_parsed: list[str]
    ocr_clues: list[str]
    search_query: str
    search_results: str
    current_draft: str
    current_step: str
    validation_errors: list[str]
    retry_count: int
    artifact_candidate: dict[str, object] | None
    artifact: dict[str, object] | None
    error: dict[str, object] | None
    db: Session | None
    thread: Thread | None
    user_id: str | None
    needs_ocr: bool
    needs_search: bool
    next_route: str
    messages: list[BaseMessage]
    pending_tool_calls: list[dict[str, object]]
    business_tool_results: list[str]
    business_tool_iteration: int
    knowledge_base_scope: str
    knowledge_base_context: str


class SearchRouteDecision(BaseModel):
    needs_search: bool = False
    search_query: str = ""


def create_langgraph_inner_provider() -> BaseLLMProvider:
    provider_name = os.getenv("LANGGRAPH_INNER_PROVIDER", "").strip().lower()

    if provider_name == "mock":
        return MockLLMProvider()
    if provider_name == "openai" and os.getenv("OPENAI_API_KEY"):
        return OpenAIProvider()
    if provider_name in {"compatible", "qwen", "dashscope"}:
        if os.getenv("LLM_API_KEY") and os.getenv("LLM_BASE_URL"):
            return CompatibleLLMProvider()

    if os.getenv("LLM_API_KEY") and os.getenv("LLM_BASE_URL"):
        return CompatibleLLMProvider()
    if os.getenv("OPENAI_API_KEY"):
        return OpenAIProvider()
    return MockLLMProvider()


class LangGraphProvider(BaseLLMProvider):
    def __init__(
        self,
        inner_provider: BaseLLMProvider | None = None,
        *,
        route_analyzer: Callable[[MediaChatRequest], Awaitable[SearchRouteDecision | dict[str, object]]] | None = None,
        vision_analyzer: Callable[[MediaChatRequest], Awaitable[list[str]]] | None = None,
        search_analyzer: Callable[..., Awaitable[object]] | None = None,
        vision_model: str | None = None,
        vision_timeout_seconds: float | None = None,
        search_timeout_seconds: float | None = None,
        business_tool_max_iterations: int = 2,
    ) -> None:
        load_environment()
        self.inner_provider = inner_provider or create_langgraph_inner_provider()
        self.route_analyzer = route_analyzer
        self.vision_analyzer = vision_analyzer
        self.search_analyzer = search_analyzer
        self.vision_model = _resolve_vision_model(vision_model)
        self.vision_api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
        self.vision_base_url = os.getenv("LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")
        self.vision_timeout_seconds = vision_timeout_seconds or float(
            os.getenv("LLM_TIMEOUT_SECONDS", os.getenv("OPENAI_TIMEOUT_SECONDS", "60")),
        )
        self.vision_request_timeout = _build_http_timeout(self.vision_timeout_seconds)
        self.search_api_key = os.getenv("TAVILY_API_KEY", "").strip()
        self.search_timeout_seconds = search_timeout_seconds or float(
            os.getenv("SEARCH_TIMEOUT_SECONDS", "20"),
        )
        self.search_request_timeout = _build_http_timeout(self.search_timeout_seconds)
        self.business_tools = get_business_tools()
        self.bound_business_tool_llm = self._bind_business_tool_llm()
        self.business_tool_max_iterations = business_tool_max_iterations
        self._vision_client: AsyncOpenAI | None = None
        logger.info(
            "LangGraph vision client configured vision_model=%s text_model=%s base_url=%s",
            self.vision_model,
            os.getenv("LLM_MODEL", "").strip() or "<unset>",
            self.vision_base_url or "<default>",
        )
        self.graph = self._build_graph()

    def _bind_business_tool_llm(self):
        if not self.business_tools:
            return None
        try:
            return self.inner_provider.bind_tools(self.business_tools)
        except NotImplementedError:
            logger.info(
                "Inner provider %s does not expose bind_tools; LangGraph business tools will use heuristic routing.",
                type(self.inner_provider).__name__,
            )
            return None
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning(
                "Failed to bind business tools on inner provider %s: %s",
                type(self.inner_provider).__name__,
                exc,
            )
            return None

    async def generate_stream(
        self,
        request: MediaChatRequest,
        *,
        db: Session | None = None,
        thread: Thread | None = None,
        user_id: str | None = None,
    ) -> AsyncGenerator[dict[str, object], None]:
        logger.info(
            "langgraph.stream start thread_id=%s task_type=%s materials=%s inner_provider=%s",
            request.thread_id,
            request.task_type.value,
            len(request.materials),
            type(self.inner_provider).__name__,
        )
        yield {
            "event": "start",
            "thread_id": request.thread_id,
            "platform": request.platform.value,
            "task_type": request.task_type.value,
            "materials_count": len(request.materials),
        }

        initial_state: GraphState = {
            "request": request,
            "materials_parsed": [],
            "ocr_clues": [],
            "search_query": "",
            "search_results": "",
            "current_draft": "",
            "current_step": "router",
            "validation_errors": [],
            "retry_count": 0,
            "artifact_candidate": None,
            "artifact": None,
            "error": None,
            "db": db,
            "thread": thread,
            "user_id": user_id,
            "needs_ocr": False,
            "needs_search": False,
            "next_route": "parse_materials_node",
            "messages": [],
            "pending_tool_calls": [],
            "business_tool_results": [],
            "business_tool_iteration": 0,
            "knowledge_base_scope": "",
            "knowledge_base_context": "",
        }

        try:
            async for mode, chunk in self.graph.astream(
                initial_state,
                stream_mode=["custom", "updates"],
            ):
                if mode != "custom" or not isinstance(chunk, dict):
                    continue

                payload = chunk.get("payload")
                if isinstance(payload, dict):
                    yield payload
        except Exception as exc:  # pragma: no cover - defensive boundary
            logger.exception("LangGraph workflow failed: %s", exc)
            yield {
                "event": "error",
                "code": "LANGGRAPH_RUNTIME_ERROR",
                "message": f"LangGraph 工作流执行失败：{exc}",
            }

        yield {"event": "done", "thread_id": request.thread_id}

    def _build_graph(self):
        graph = StateGraph(GraphState)
        graph.add_node("router", self._router_node)
        graph.add_node("parse_materials_node", self._parse_materials_node)
        graph.add_node("ocr_node", self._ocr_node)
        graph.add_node("search_node", self._search_node)
        graph.add_node("generate_draft_node", self._generate_draft_node)
        graph.add_node("tool_execution_node", self._tool_execution_node)
        graph.add_node("review_node", self._review_node)
        graph.add_node("format_artifact_node", self._format_artifact_node)

        graph.add_edge(START, "router")
        graph.add_conditional_edges(
            "router",
            self._route_from_router,
            {"parse_materials_node": "parse_materials_node"},
        )
        graph.add_conditional_edges(
            "parse_materials_node",
            self._route_after_parse,
            {
                "ocr_node": "ocr_node",
                "search_node": "search_node",
                "generate_draft_node": "generate_draft_node",
            },
        )
        graph.add_conditional_edges(
            "ocr_node",
            self._route_after_ocr,
            {
                "search_node": "search_node",
                "generate_draft_node": "generate_draft_node",
            },
        )
        graph.add_edge("search_node", "generate_draft_node")
        graph.add_conditional_edges(
            "generate_draft_node",
            self._route_after_generate_draft,
            {
                "tool_execution_node": "tool_execution_node",
                "review_node": "review_node",
            },
        )
        graph.add_edge("tool_execution_node", "generate_draft_node")
        graph.add_conditional_edges(
            "review_node",
            self._route_after_review,
            {
                "generate_draft_node": "generate_draft_node",
                "format_artifact_node": "format_artifact_node",
            },
        )
        graph.add_edge("format_artifact_node", END)

        return graph.compile()

    async def _router_node(self, state: GraphState) -> GraphState:
        request = state["request"]
        logger.info("langgraph node=router thread_id=%s", request.thread_id)
        decision = await self._decide_search_route(request)
        return {
            "needs_search": decision.needs_search,
            "search_query": decision.search_query,
            "next_route": "parse_materials_node",
            "current_step": "router:completed",
        }

    def _route_from_router(self, state: GraphState) -> str:
        return state.get("next_route", "parse_materials_node")

    async def _parse_materials_node(self, state: GraphState) -> GraphState:
        writer = get_stream_writer()
        _emit_tool_call(writer, name="parse_materials", status="processing")
        logger.info(
            "langgraph node=parse_materials thread_id=%s materials=%s",
            state["request"].thread_id,
            len(state["request"].materials),
        )

        parsed_materials, needs_ocr = _parse_materials(state["request"])
        return {
            "materials_parsed": parsed_materials,
            "needs_ocr": needs_ocr,
            "current_step": "parse_materials:completed",
        }

    def _route_after_parse(self, state: GraphState) -> str:
        if state.get("needs_ocr"):
            logger.info(
                "langgraph route=after_parse thread_id=%s next=%s needs_search=%s",
                state["request"].thread_id,
                "ocr_node",
                state.get("needs_search"),
            )
            return "ocr_node"
        if state.get("needs_search"):
            logger.info(
                "langgraph route=after_parse thread_id=%s next=%s needs_ocr=%s",
                state["request"].thread_id,
                "search_node",
                state.get("needs_ocr"),
            )
            return "search_node"
        logger.info(
            "langgraph route=after_parse thread_id=%s next=%s",
            state["request"].thread_id,
            "generate_draft_node",
        )
        return "generate_draft_node"

    def _route_after_ocr(self, state: GraphState) -> str:
        if state.get("needs_search"):
            logger.info(
                "langgraph route=after_ocr thread_id=%s next=%s",
                state["request"].thread_id,
                "search_node",
            )
            return "search_node"
        logger.info(
            "langgraph route=after_ocr thread_id=%s next=%s",
            state["request"].thread_id,
            "generate_draft_node",
        )
        return "generate_draft_node"

    async def _ocr_node(self, state: GraphState) -> GraphState:
        writer = get_stream_writer()
        _emit_tool_call(writer, name="ocr", status="processing")
        image_urls = [
            str(material.url)
            for material in state["request"].materials
            if material.type == MaterialType.IMAGE and material.url
        ]
        print(
            "==== 🚀 触发视觉解析节点，目标图片: "
            + (", ".join(image_urls) if image_urls else "<none>")
            + " ====",
        )
        logger.info(
            "langgraph node=ocr thread_id=%s vision_model=%s image_urls=%s",
            state["request"].thread_id,
            self.vision_model,
            image_urls,
        )

        try:
            async with asyncio.timeout(self.vision_timeout_seconds):
                ocr_clues = await self._extract_ocr_clues(state["request"], writer)
        except asyncio.TimeoutError as exc:
            traceback.print_exc()
            logger.warning(
                "Vision extraction timed out for thread_id=%s after %ss",
                state["request"].thread_id,
                self.vision_timeout_seconds,
            )
            _emit_tool_call(writer, name="ocr", status="timeout")
            raise RuntimeError(
                f"Vision extraction timed out after {self.vision_timeout_seconds}s",
            ) from exc
        except Exception as exc:  # pragma: no cover - defensive boundary
            traceback.print_exc()
            logger.exception("Vision extraction failed: %s", exc)
            _emit_tool_call(writer, name="ocr", status="failed")
            raise RuntimeError(
                f"Vision extraction failed for thread {state['request'].thread_id}: {exc}",
            ) from exc

        return {
            "materials_parsed": [*state.get("materials_parsed", []), *ocr_clues],
            "ocr_clues": ocr_clues,
            "current_step": "ocr:completed",
        }

    async def _search_node(self, state: GraphState) -> GraphState:
        writer = get_stream_writer()
        request = state["request"]
        search_query = (state.get("search_query") or "").strip() or _build_default_search_query(
            request
        )
        _emit_tool_call(
            writer,
            name="web_search",
            status="processing",
            message=f"正在搜索全网热点: {search_query}",
        )
        logger.info(
            "langgraph node=search thread_id=%s search_query=%s",
            request.thread_id,
            search_query,
        )

        try:
            async with asyncio.timeout(self.search_timeout_seconds):
                search_results = await self._collect_search_results(
                    request=request,
                    search_query=search_query,
                    writer=writer,
                )
        except asyncio.TimeoutError:
            logger.warning(
                "Search timed out for thread_id=%s after %ss",
                request.thread_id,
                self.search_timeout_seconds,
            )
            _emit_tool_call(writer, name="web_search", status="timeout")
            writer(
                {
                    "payload": {
                        "event": "error",
                        "code": "SEARCH_TIMEOUT",
                        "message": "联网检索超时，已自动跳过外部热点参考。",
                    }
                }
            )
            search_results = ""
        except Exception as exc:  # pragma: no cover - defensive boundary
            logger.exception("Search step failed: %s", exc)
            _emit_tool_call(writer, name="web_search", status="failed")
            writer(
                {
                    "payload": {
                        "event": "error",
                        "code": "SEARCH_RUNTIME_ERROR",
                        "message": f"联网检索失败，已自动跳过外部参考：{exc}",
                    }
                }
            )
            search_results = ""
        else:
            _emit_tool_call(writer, name="web_search", status="completed")

        return {
            "search_query": search_query,
            "search_results": search_results,
            "current_step": "search:completed",
        }

    async def _generate_draft_node(self, state: GraphState) -> GraphState:
        writer = get_stream_writer()
        _emit_tool_call(writer, name="generate_draft", status="processing")
        logger.info(
            "langgraph node=generate_draft thread_id=%s retry_count=%s validation_errors=%s business_tool_iteration=%s",
            state["request"].thread_id,
            state.get("retry_count", 0),
            len(state.get("validation_errors", [])),
            state.get("business_tool_iteration", 0),
        )

        request = state["request"]
        pending_tool_calls, planner_message = await self._request_business_tool_calls(state)
        updated_messages = list(state.get("messages", []))
        if planner_message is not None:
            updated_messages.append(planner_message)
        if pending_tool_calls:
            return {
                "pending_tool_calls": pending_tool_calls,
                "messages": updated_messages,
                "business_tool_iteration": state.get("business_tool_iteration", 0) + 1,
                "current_step": "generate_draft:tool_calls_requested",
            }

        knowledge_base_scope = _resolve_knowledge_base_scope_from_state(state)
        knowledge_base_context = str(state.get("knowledge_base_context", "") or "").strip()
        if knowledge_base_scope and not knowledge_base_context:
            _emit_tool_call(
                writer,
                name="retrieve_knowledge_base",
                status="processing",
                message=f"scope={knowledge_base_scope}",
            )
            try:
                knowledge_base_context = get_knowledge_base_service().retrieve_context(
                    knowledge_base_scope,
                    request.message,
                ).strip()
            except Exception as exc:  # pragma: no cover - defensive fallback
                logger.warning(
                    "knowledge base retrieval failed thread_id=%s scope=%s error=%s",
                    state["request"].thread_id,
                    knowledge_base_scope,
                    exc,
                )
                _emit_tool_call(
                    writer,
                    name="retrieve_knowledge_base",
                    status="failed",
                    message=f"scope={knowledge_base_scope}",
                )
                knowledge_base_context = ""
            else:
                _emit_tool_call(
                    writer,
                    name="retrieve_knowledge_base",
                    status="completed" if knowledge_base_context else "skipped",
                    message=f"scope={knowledge_base_scope}",
                )

        draft_system_prompt = _build_draft_system_prompt(
            state=state,
            knowledge_base_context=knowledge_base_context,
        )
        adapted_request = _build_enriched_draft_request(
            request=request,
            materials_parsed=state.get("materials_parsed", []),
            vision_clues=state.get("ocr_clues", []),
            search_results=state.get("search_results", ""),
            business_tool_results=state.get("business_tool_results", []),
            validation_errors=state.get("validation_errors", []),
            system_prompt=draft_system_prompt,
        )
        removed_image_materials = len(request.materials) - len(adapted_request.materials)
        logger.info(
            "langgraph draft request sanitized thread_id=%s removed_image_materials=%s remaining_materials=%s",
            state["request"].thread_id,
            removed_image_materials,
            len(adapted_request.materials),
        )

        draft_parts: list[str] = []
        latest_artifact: dict[str, object] | None = None
        latest_error: dict[str, object] | None = None

        async for event in self.inner_provider.generate_stream(
            adapted_request,
            db=state.get("db"),
            thread=None,
            user_id=state.get("user_id"),
        ):
            event_name = str(event.get("event", ""))

            if event_name in {"start", "done", "tool_call"}:
                continue

            if event_name == "message":
                draft_parts.append(str(event.get("delta", "")))
                continue

            if event_name == "artifact":
                artifact_payload = event.get("artifact")
                if isinstance(artifact_payload, dict):
                    latest_artifact = artifact_payload
                continue

            if event_name == "error":
                latest_error = event
                writer({"payload": event})

        return {
            "current_draft": "".join(draft_parts),
            "artifact_candidate": latest_artifact,
            "error": latest_error,
            "messages": updated_messages,
            "knowledge_base_scope": knowledge_base_scope,
            "knowledge_base_context": knowledge_base_context,
            "current_step": "generate_draft:completed",
        }

    def _route_after_generate_draft(self, state: GraphState) -> str:
        pending_tool_calls = state.get("pending_tool_calls") or _get_latest_ai_tool_calls(state)
        if pending_tool_calls:
            logger.info(
                "langgraph route=after_generate_draft thread_id=%s next=%s tool_calls=%s",
                state["request"].thread_id,
                "tool_execution_node",
                len(pending_tool_calls),
            )
            return "tool_execution_node"
        logger.info(
            "langgraph route=after_generate_draft thread_id=%s next=%s",
            state["request"].thread_id,
            "review_node",
        )
        return "review_node"

    async def _tool_execution_node(self, state: GraphState) -> GraphState:
        writer = get_stream_writer()
        pending_tool_calls = list(state.get("pending_tool_calls") or _get_latest_ai_tool_calls(state))
        tool_results = list(state.get("business_tool_results", []))
        messages = list(state.get("messages", []))

        logger.info(
            "langgraph node=tool_execution thread_id=%s tool_calls=%s",
            state["request"].thread_id,
            len(pending_tool_calls),
        )

        for tool_call in pending_tool_calls:
            tool_name = str(tool_call.get("name", ""))
            raw_args = tool_call.get("args", {})
            tool_args = raw_args if isinstance(raw_args, dict) else {}
            tool_call_id = str(tool_call.get("id") or f"call_{uuid.uuid4().hex}")
            _emit_tool_call(
                writer,
                name=tool_name,
                status="processing",
                message=f"\u6b63\u5728\u8c03\u7528\u4e1a\u52a1\u5de5\u5177: {tool_name}...",
            )
            try:
                result = await asyncio.to_thread(
                    execute_business_tool,
                    tool_name,
                    tool_args,
                )
                formatted_result = _format_business_tool_result(tool_name, result)
                tool_results.append(formatted_result)
                messages.append(
                    ToolMessage(
                        content=result,
                        tool_call_id=tool_call_id,
                        name=tool_name,
                    )
                )
                _emit_tool_call(
                    writer,
                    name=tool_name,
                    status="completed",
                    message=f"\u4e1a\u52a1\u5de5\u5177\u8c03\u7528\u5b8c\u6210: {tool_name}",
                )
            except Exception as exc:  # pragma: no cover - defensive path
                logger.exception("Business tool execution failed: %s", exc)
                error_text = f"\u4e1a\u52a1\u5de5\u5177 {tool_name} \u8c03\u7528\u5931\u8d25\uff1a{exc}"
                tool_results.append(_format_business_tool_result(tool_name, error_text))
                messages.append(
                    ToolMessage(
                        content=error_text,
                        tool_call_id=tool_call_id,
                        name=tool_name,
                    )
                )
                _emit_tool_call(
                    writer,
                    name=tool_name,
                    status="failed",
                    message=error_text,
                )

        return {
            "business_tool_results": tool_results,
            "messages": messages,
            "pending_tool_calls": [],
            "current_step": "tool_execution:completed",
        }

    async def _review_node(self, state: GraphState) -> GraphState:
        writer = get_stream_writer()
        logger.info(
            "langgraph node=review thread_id=%s retry_count=%s has_error=%s",
            state["request"].thread_id,
            state.get("retry_count", 0),
            state.get("error") is not None,
        )

        if state.get("error") is not None:
            _emit_tool_call(writer, name="review_draft", status="skipped")
            return {
                "next_route": "format_artifact_node",
                "current_step": "review:skipped",
            }

        _emit_tool_call(writer, name="review_draft", status="processing")
        review_issues = _review_draft(state)
        retry_count = state.get("retry_count", 0)

        if review_issues:
            merged_issues = _merge_validation_errors(
                state.get("validation_errors", []),
                review_issues,
            )
            if retry_count < 2:
                _emit_tool_call(writer, name="review_draft", status="retry")
                return {
                    "validation_errors": merged_issues,
                    "retry_count": retry_count + 1,
                    "next_route": "generate_draft_node",
                    "current_step": "review:retry",
                }

            _emit_tool_call(writer, name="review_draft", status="max_retries")
            _stream_message_chunks(writer, state.get("current_draft", ""))
            return {
                "validation_errors": merged_issues,
                "next_route": "format_artifact_node",
                "current_step": "review:max_retries",
            }

        _emit_tool_call(writer, name="review_draft", status="passed")
        _stream_message_chunks(writer, state.get("current_draft", ""))
        return {
            "next_route": "format_artifact_node",
            "current_step": "review:passed",
        }

    def _route_after_review(self, state: GraphState) -> str:
        next_route = state.get("next_route", "format_artifact_node")
        logger.info(
            "langgraph route=after_review thread_id=%s next=%s",
            state["request"].thread_id,
            next_route,
        )
        return next_route

    async def _format_artifact_node(self, state: GraphState) -> GraphState:
        if state.get("error") is not None:
            logger.info(
                "langgraph node=format_artifact thread_id=%s skipped_due_to_error=true",
                state["request"].thread_id,
            )
            return {"current_step": "format_artifact:skipped"}

        writer = get_stream_writer()
        _emit_tool_call(writer, name="format_artifact", status="processing")
        logger.info(
            "langgraph node=format_artifact thread_id=%s has_candidate=%s",
            state["request"].thread_id,
            isinstance(state.get("artifact_candidate"), dict),
        )

        request = state["request"]
        validation_errors = list(state.get("validation_errors", []))
        artifact_payload: dict[str, object] | None = None

        candidate = state.get("artifact_candidate")
        if isinstance(candidate, dict):
            try:
                artifact = _validate_artifact_candidate(request, candidate)
                artifact_payload = artifact.model_dump(mode="json")
            except ValidationError as exc:
                validation_errors.append(str(exc))
                _emit_tool_call(writer, name="format_artifact", status="fallback")

        if artifact_payload is None:
            artifact = _build_fallback_artifact(
                request=request,
                draft=state.get("current_draft", ""),
                materials_parsed=state.get("materials_parsed", []),
            )
            artifact_payload = artifact.model_dump(mode="json")

        writer(
            {
                "payload": {
                    "event": "artifact",
                    "artifact": artifact_payload,
                }
            }
        )

        return {
            "artifact": artifact_payload,
            "validation_errors": validation_errors,
            "current_step": "format_artifact:completed",
        }

    async def _request_business_tool_calls(
        self,
        state: GraphState,
    ) -> tuple[list[dict[str, object]], AIMessage | None]:
        request = state["request"]
        if not self.business_tools:
            return [], None
        if state.get("pending_tool_calls"):
            return [], None
        if state.get("retry_count", 0) > 0:
            return [], None
        if state.get("business_tool_iteration", 0) >= self.business_tool_max_iterations:
            return [], None
        if not _should_attempt_business_tool_loop(state):
            return [], None

        if self.bound_business_tool_llm is not None:
            try:
                tool_calls, ai_message = await self._request_llm_business_tool_calls(state)
                if tool_calls:
                    return tool_calls, ai_message
            except Exception as exc:  # pragma: no cover - model/tool fallback boundary
                logger.warning(
                    "Business tool LLM decision failed for thread_id=%s, falling back to heuristic: %s",
                    request.thread_id,
                    exc,
                )

        tool_calls = _infer_business_tool_calls(state)
        if not tool_calls:
            return [], None
        return tool_calls, _build_tool_call_ai_message(tool_calls)

    async def _request_llm_business_tool_calls(
        self,
        state: GraphState,
    ) -> tuple[list[dict[str, object]], AIMessage]:
        if self.bound_business_tool_llm is None:
            raise RuntimeError("Business tool LLM is not bound.")
        request = state["request"]
        ai_message = await self.bound_business_tool_llm.ainvoke(
            _build_business_tool_router_messages(state),
        )
        normalized_calls: list[dict[str, object]] = []
        for raw_call in ai_message.tool_calls or []:
            normalized_call = _normalize_business_tool_call(raw_call)
            if normalized_call is not None:
                normalized_calls.append(normalized_call)
        logger.info(
            "langgraph business tool decision thread_id=%s tool_calls=%s",
            request.thread_id,
            [call["name"] for call in normalized_calls],
        )
        return normalized_calls, ai_message

    async def _decide_search_route(self, request: MediaChatRequest) -> SearchRouteDecision:
        if self.route_analyzer is not None:
            result = await self.route_analyzer(request)
            return _coerce_search_route_decision(result, request)

        try:
            return await self._request_search_route_decision(request)
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning(
                "Search route LLM decision failed for thread_id=%s, falling back to heuristic: %s",
                request.thread_id,
                exc,
            )
            return _build_heuristic_search_route_decision(request)

    async def _request_search_route_decision(
        self,
        request: MediaChatRequest,
    ) -> SearchRouteDecision:
        if isinstance(self.inner_provider, CompatibleLLMProvider):
            if not self.inner_provider.api_key or not self.inner_provider.base_url:
                return _build_heuristic_search_route_decision(request)
            client = self.inner_provider._get_client()
            model = self.inner_provider.model
            timeout = self.inner_provider.request_timeout
        elif isinstance(self.inner_provider, OpenAIProvider):
            if not self.inner_provider.api_key:
                return _build_heuristic_search_route_decision(request)
            client = self.inner_provider._get_client()
            model = self.inner_provider.model
            timeout = self.inner_provider.request_timeout
        else:
            return _build_heuristic_search_route_decision(request)

        messages = [
            {"role": "system", "content": _build_router_decision_system_prompt()},
            {
                "role": "user",
                "content": (
                    f"任务类型：{request.task_type.value}\n"
                    f"目标平台：{request.platform.value}\n"
                    f"用户请求：{request.message}\n"
                    f"素材数量：{len(request.materials)}\n"
                    "请判断是否需要联网搜索最新信息，并生成一个适合搜索引擎使用的简洁查询词。"
                ),
            },
        ]

        request_kwargs: dict[str, object] = {
            "model": model,
            "messages": messages,
            "temperature": 0,
            "timeout": timeout,
        }

        try:
            response = await client.chat.completions.create(
                **request_kwargs,
                response_format={"type": "json_object"},
            )
        except BadRequestError:
            response = await client.chat.completions.create(**request_kwargs)

        content = response.choices[0].message.content or ""
        if not content.strip():
            return _build_heuristic_search_route_decision(request)
        return _coerce_search_route_decision(content, request)

    async def _extract_ocr_clues(
        self,
        request: MediaChatRequest,
        writer,
    ) -> list[str]:
        if self.vision_analyzer is not None:
            return await self.vision_analyzer(request)

        if not self.vision_api_key:
            writer(
                {
                    "payload": {
                        "event": "error",
                        "code": "VISION_API_KEY_MISSING",
                        "message": "未检测到视觉模型密钥，已跳过图片解析。",
                    }
                }
            )
            return []

        image_materials = [
            material for material in request.materials if material.type == MaterialType.IMAGE
        ]
        if not image_materials:
            return []

        clues: list[str] = []
        for index, material in enumerate(image_materials, start=1):
            try:
                prompt_content = await self._build_vision_prompt_content(material)
                response_text = await self._request_vision_analysis(prompt_content)
                logger.info(
                    "\u89c6\u89c9\u6a21\u578b\u63d0\u53d6\u7ed3\u679c: %s",
                    response_text,
                )
                clue = _normalize_vision_result(index=index, raw_text=response_text)
                if clue:
                    clues.append(clue)
            except Exception as exc:
                traceback.print_exc()
                logger.error(
                    "Vision analysis failed for image %s: url=%s, model=%s, error=%s",
                    index,
                    material.url,
                    self.vision_model,
                    exc,
                    exc_info=True,
                )
                raise RuntimeError(
                    f"Vision analysis failed for image {index} with model {self.vision_model}: {exc}",
                ) from exc

        return clues

    async def _collect_search_results(
        self,
        *,
        request: MediaChatRequest,
        search_query: str,
        writer,
    ) -> str:
        if self.search_analyzer is not None:
            analyzer_signature = inspect.signature(self.search_analyzer)
            if len(analyzer_signature.parameters) >= 2:
                payload = await self.search_analyzer(request, search_query)
            else:
                payload = await self.search_analyzer(request)
            return _coerce_search_results_text(payload)

        logger.info(
            "Running search collection for thread_id=%s, task_type=%s",
            request.thread_id,
            request.task_type.value,
        )
        if self.search_api_key:
            return await self._request_search_results(search_query)
        return _build_mock_search_results(request, search_query)

    async def _request_search_results(
        self,
        search_query: str,
    ) -> str:
        payload = {
            "api_key": self.search_api_key,
            "query": search_query,
            "topic": "general",
            "search_depth": "advanced",
            "max_results": 5,
            "include_answer": True,
            "include_raw_content": False,
        }

        async with httpx.AsyncClient(timeout=self.search_request_timeout) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json=payload,
            )
            response.raise_for_status()

        return _normalize_search_results(response.json())

    def _get_vision_client(self) -> AsyncOpenAI:
        if self._vision_client is None:
            client_kwargs: dict[str, object] = {
                "api_key": self.vision_api_key,
                "timeout": self.vision_request_timeout,
            }
            if self.vision_base_url:
                client_kwargs["base_url"] = self.vision_base_url
            self._vision_client = AsyncOpenAI(**client_kwargs)
        return self._vision_client

    async def _build_vision_prompt_content(
        self,
        material,
    ) -> list[dict[str, object]]:
        logger.info("Preparing vision prompt for material url=%s", material.url)
        image_part = await _build_image_content_part(material.url)
        if image_part is None:
            logger.error("Failed to build image content part for material url=%s", material.url)
            raise ValueError("无法读取图片素材。")

        return [
            {
                "type": "text",
                "text": (
                    "请提取图片中的核心文字，并描述主要画面内容。"
                    "请只返回 JSON 对象，字段包括 extracted_text、visual_summary、marketing_angles。"
                ),
            },
            image_part,
        ]

    async def _request_vision_analysis(
        self,
        content_parts: list[dict[str, object]],
    ) -> str:
        request_kwargs = {
            "model": self.vision_model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是一个擅长 OCR 和图像理解的多模态助手。"
                        "请始终使用简体中文，只返回 JSON object。"
                    ),
                },
                {
                    "role": "user",
                    "content": content_parts,
                },
            ],
            "temperature": 0.1,
            "timeout": self.vision_request_timeout,
        }

        try:
            logger.info("Requesting vision analysis with model=%s", self.vision_model)
            response = await self._get_vision_client().chat.completions.create(
                **request_kwargs,
                response_format={"type": "json_object"},
            )
        except BadRequestError as exc:
            logger.error(
                "Vision API rejected JSON response_format; retrying without it. model=%s, error=%s",
                self.vision_model,
                exc,
            )
            response = await self._get_vision_client().chat.completions.create(
                **request_kwargs,
            )
        except AuthenticationError as exc:
            logger.error("Vision API authentication failed. model=%s, error=%s", self.vision_model, exc)
            raise ValueError("视觉模型鉴权失败，请检查 API Key。") from exc
        except RateLimitError as exc:
            logger.error("Vision API rate limited. model=%s, error=%s", self.vision_model, exc)
            raise ValueError("视觉模型触发限流，请稍后重试。") from exc
        except APITimeoutError as exc:
            logger.error("Vision API request timed out. model=%s, error=%s", self.vision_model, exc)
            raise ValueError("视觉模型请求超时。") from exc
        except APIConnectionError as exc:
            logger.error("Vision API connection failed. model=%s, error=%s", self.vision_model, exc)
            raise ValueError("无法连接视觉模型服务。") from exc
        except (APIError, OpenAIError) as exc:
            logger.error("Vision API request failed. model=%s, error=%s", self.vision_model, exc)
            raise ValueError(f"视觉模型调用失败：{exc}") from exc

        content = response.choices[0].message.content or ""
        return content.strip()


def _emit_tool_call(
    writer,
    *,
    name: str,
    status: str,
    message: str | None = None,
) -> None:
    payload: dict[str, object] = {
        "event": "tool_call",
        "name": name,
        "status": status,
    }
    if message:
        payload["message"] = message
    writer({"payload": payload})


def _stream_message_chunks(writer, draft: str, chunk_size: int = 32) -> None:
    if not draft.strip():
        return

    normalized = draft.strip()
    for index, start in enumerate(range(0, len(normalized), chunk_size)):
        writer(
            {
                "payload": {
                    "event": "message",
                    "delta": normalized[start : start + chunk_size],
                    "index": index,
                }
            }
        )


def _parse_materials(request: MediaChatRequest) -> tuple[list[str], bool]:
    if not request.materials:
        return ["未附带素材，本轮将基于用户输入直接生成。"], False

    parsed: list[str] = []
    needs_ocr = False

    for index, material in enumerate(request.materials, start=1):
        label = {
            MaterialType.IMAGE: "图片素材",
            MaterialType.VIDEO_URL: "视频素材",
            MaterialType.TEXT_LINK: "文本素材",
        }.get(material.type, "素材")

        if material.type == MaterialType.IMAGE:
            needs_ocr = True

        summary = material.text.strip()
        if not summary and material.url:
            summary = f"来源链接：{material.url}"
        if not summary:
            summary = "未提供额外说明，可按主题语境进行合理补全。"

        parsed.append(f"{index}. {label}：{summary}")

    return parsed, needs_ocr




BUSINESS_TOOL_TRIGGER_KEYWORDS = (
    "\u5e02\u573a\u70ed\u8bcd",
    "\u7ade\u54c1\u70ed\u8bcd",
    "\u70ed\u8bcd",
    "\u6d41\u91cf\u6570\u636e",
    "\u5e02\u573a\u8d8b\u52bf",
    "\u4e1a\u52a1\u5de5\u5177",
    "\u5148\u62c9\u53d6",
    "\u62c9\u53d6\u4e00\u4e0b",
    "tool",
    "market trend",
    "keyword",
)

BUSINESS_TOOL_AUTONOMOUS_KEYWORDS = (
    "\u5c0f\u7ea2\u4e66",
    "\u95f2\u9c7c",
    "\u6587\u65c5",
    "\u63a2\u5e97",
    "\u6559\u8f85",
    "\u6807\u9898",
    "\u7b56\u5212",
    "\u7b14\u8bb0",
    "\u9009\u9898",
)

BUSINESS_TOOL_OUTLINE_KEYWORDS = (
    "\u7b56\u5212",
    "\u5927\u7eb2",
    "\u63d0\u7eb2",
    "\u7ed3\u6784",
    "\u7b14\u8bb0",
    "\u65b9\u6848",
    "\u5199\u4e00\u7bc7",
    "\u5185\u5bb9\u89c4\u5212",
)


def _should_consider_business_tools(request: MediaChatRequest) -> bool:
    message = request.message.lower()
    if any(keyword.lower() in message for keyword in BUSINESS_TOOL_TRIGGER_KEYWORDS):
        return True
    if request.task_type not in {TaskType.CONTENT_GENERATION, TaskType.TOPIC_PLANNING}:
        return False
    return any(keyword.lower() in message for keyword in BUSINESS_TOOL_AUTONOMOUS_KEYWORDS)


def _should_attempt_business_tool_loop(state: GraphState) -> bool:
    if _get_called_business_tool_names(state):
        return True
    return _should_consider_business_tools(state["request"])


def _infer_business_tool_calls(state: GraphState) -> list[dict[str, object]]:
    request = state["request"]
    called_tools = _get_called_business_tool_names(state)

    if "analyze_market_trends" not in called_tools and _should_consider_business_tools(request):
        return [
            {
                "id": f"call_{uuid.uuid4().hex}",
                "name": "analyze_market_trends",
                "args": {
                    "platform": _infer_business_platform(request),
                    "category": _infer_business_category(request),
                },
            }
        ]

    if "generate_content_outline" not in called_tools and _should_request_outline_tool(
        state,
        called_tools=called_tools,
    ):
        return [
            {
                "id": f"call_{uuid.uuid4().hex}",
                "name": "generate_content_outline",
                "args": {
                    "topic": _infer_business_topic(request),
                    "audience": _infer_business_audience(request),
                },
            }
        ]
    return []


def _infer_business_platform(request: MediaChatRequest) -> str:
    message = request.message
    if "\u95f2\u9c7c" in message or "xianyu" in message.lower():
        return "xianyu"
    if "\u6296\u97f3" in message or request.platform.value == "douyin":
        return "douyin"
    return request.platform.value


def _infer_business_category(request: MediaChatRequest) -> str:
    message = request.message
    if any(keyword in message for keyword in ("\u6587\u65c5", "\u63a2\u5e97", "\u5468\u8fb9", "\u798f\u5dde", "\u65c5\u6e38", "Citywalk")):
        return "\u5730\u57df\u6587\u65c5"
    if any(keyword in message for keyword in ("\u6559\u8f85", "\u521d\u4e2d", "\u8d44\u6599", "\u6559\u6750", "\u8bd5\u5377")):
        return "\u6559\u8f85\u8d44\u6599"
    if any(keyword in message for keyword in ("\u672c\u5730\u751f\u6d3b", "\u95e8\u5e97", "\u5230\u5e97")):
        return "\u672c\u5730\u751f\u6d3b"
    return "\u5185\u5bb9\u8fd0\u8425"


def _infer_business_topic(request: MediaChatRequest) -> str:
    message = request.message.strip()
    if message:
        return message
    return f"{request.platform.value} {request.task_type.value}"


def _infer_business_audience(request: MediaChatRequest) -> str:
    message = request.message
    if any(keyword in message for keyword in ("\u5bb6\u957f", "\u521d\u4e2d", "\u6559\u8f85", "\u6559\u6750")):
        return "\u521d\u4e2d\u5bb6\u957f\u4e0e\u6559\u8f85\u8d2d\u4e70\u4eba\u7fa4"
    if any(keyword in message for keyword in ("\u6587\u65c5", "\u63a2\u5e97", "\u5468\u8fb9", "Citywalk", "\u65c5\u6e38")):
        return "\u5468\u672b\u77ed\u9014\u6e38\u5ba2\u4e0e\u672c\u5730\u751f\u6d3b\u4eba\u7fa4"
    return "\u6cdb\u5185\u5bb9\u6d88\u8d39\u4eba\u7fa4"


def _should_request_outline_tool(
    state: GraphState,
    *,
    called_tools: set[str] | None = None,
) -> bool:
    request = state["request"]
    normalized_called_tools = called_tools or _get_called_business_tool_names(state)
    if "generate_content_outline" in normalized_called_tools:
        return False
    if request.task_type == TaskType.TOPIC_PLANNING:
        return True
    message = request.message.lower()
    if not any(keyword.lower() in message for keyword in BUSINESS_TOOL_OUTLINE_KEYWORDS):
        return False
    return "analyze_market_trends" in normalized_called_tools


def _get_called_business_tool_names(state: GraphState) -> set[str]:
    names: set[str] = set()
    for message in state.get("messages", []):
        if isinstance(message, ToolMessage) and message.name:
            names.add(str(message.name))
    return names


def _get_latest_ai_tool_calls(state: GraphState) -> list[dict[str, object]]:
    messages = state.get("messages", [])
    if not messages:
        return []
    message = messages[-1]
    if isinstance(message, AIMessage) and message.tool_calls:
        normalized_calls: list[dict[str, object]] = []
        for raw_call in message.tool_calls:
            normalized_call = _normalize_business_tool_call(raw_call)
            if normalized_call is not None:
                normalized_calls.append(normalized_call)
        return normalized_calls
    return []


def _build_tool_call_ai_message(tool_calls: list[dict[str, object]]) -> AIMessage:
    normalized_tool_calls = [
        {
            "name": str(call["name"]),
            "args": call.get("args", {}),
            "id": str(call["id"]),
            "type": "tool_call",
        }
        for call in tool_calls
    ]
    return AIMessage(content="", tool_calls=normalized_tool_calls)


def _build_business_tool_router_messages(state: GraphState) -> list[BaseMessage]:
    return [
        SystemMessage(
            content=(
                "You are the business-tool router inside the MediaPilot LangGraph workflow. "
                "Call a tool only when the user explicitly needs market keywords, competitor trends, "
                "category traffic signals, or outline planning data. "
                "If a prior tool result already answers the need, stop calling tools."
            )
        ),
        HumanMessage(content=_build_business_tool_decision_prompt(state)),
        *state.get("messages", []),
    ]


def _build_business_tool_decision_prompt(state: GraphState) -> str:
    request = state["request"]
    sections = [
        f"\u5e73\u53f0\uff1a{request.platform.value}",
        f"\u4efb\u52a1\u7c7b\u578b\uff1a{request.task_type.value}",
        f"\u7528\u6237\u8bf7\u6c42\uff1a{request.message}",
    ]
    materials = state.get("materials_parsed", [])
    if materials:
        sections.append("\u7d20\u6750\u89e3\u6790\uff1a\n" + "\n".join(materials))
    search_results = state.get("search_results", "").strip()
    if search_results:
        sections.append("\u641c\u7d22\u4e0a\u4e0b\u6587\uff1a\n" + search_results)
    return "\n\n".join(sections)


def _normalize_business_tool_call(raw_call: object) -> dict[str, object] | None:
    if isinstance(raw_call, dict) and "name" in raw_call and "args" in raw_call:
        tool_call_id = str(raw_call.get("id", "")) or f"call_{uuid.uuid4().hex}"
        return {
            "id": tool_call_id,
            "name": str(raw_call.get("name", "")).strip(),
            "args": raw_call.get("args", {}) if isinstance(raw_call.get("args", {}), dict) else {},
        }

    function = getattr(raw_call, "function", None)
    if function is None and isinstance(raw_call, dict):
        function = raw_call.get("function")
    if function is None:
        return None

    if isinstance(function, dict):
        name = str(function.get("name", "")).strip()
        raw_arguments = function.get("arguments", {})
    else:
        name = str(getattr(function, "name", "")).strip()
        raw_arguments = getattr(function, "arguments", {})
    if not name:
        return None

    if isinstance(raw_arguments, str):
        try:
            arguments = json.loads(raw_arguments) if raw_arguments.strip() else {}
        except json.JSONDecodeError:
            arguments = {}
    elif isinstance(raw_arguments, dict):
        arguments = raw_arguments
    else:
        arguments = {}

    tool_call_id = ""
    if isinstance(raw_call, dict):
        tool_call_id = str(raw_call.get("id", ""))
    else:
        tool_call_id = str(getattr(raw_call, "id", ""))
    if not tool_call_id:
        tool_call_id = f"call_{uuid.uuid4().hex}"

    return {"id": tool_call_id, "name": name, "args": arguments}


def _format_business_tool_result(tool_name: str, result: str) -> str:
    return (
        f"<business_tool_result name=\"{tool_name}\">\n"
        f"{result.strip()}\n"
        "</business_tool_result>"
    )

def _build_enriched_request(
    *,
    request: MediaChatRequest,
    materials_parsed: list[str],
    search_results: str,
    business_tool_results: list[str],
    validation_errors: list[str],
    system_prompt: str | None,
) -> MediaChatRequest:
    sections: list[str] = []

    if materials_parsed:
        sections.append("已解析素材要点：\n" + "\n".join(materials_parsed))
    if search_results.strip():
        sections.append(
            "请结合以下最新全网搜索结果：\n"
            "<search_context>\n"
            f"{search_results.strip()}\n"
            "</search_context>"
        )
    if validation_errors:
        sections.append(
            "上一轮审查建议（本轮必须修正）：\n"
            + "\n".join(f"- {item}" for item in validation_errors)
        )

    if not sections:
        return request

    enriched_message = f"{request.message}\n\n" + "\n\n".join(sections)
    return request.model_copy(update={"message": enriched_message})


def _build_enriched_draft_request(
    *,
    request: MediaChatRequest,
    materials_parsed: list[str],
    vision_clues: list[str],
    search_results: str,
    business_tool_results: list[str],
    validation_errors: list[str],
    system_prompt: str | None,
) -> MediaChatRequest:
    sections: list[str] = []

    if materials_parsed:
        sections.append("\u5df2\u89e3\u6790\u7d20\u6750\u8981\u70b9\uff1a\n" + "\n".join(materials_parsed))
    if business_tool_results:
        sections.append(
            "\u4e1a\u52a1\u5de5\u5177\u8fd4\u56de\u7ed3\u679c\uff1a\n"
            "<business_tool_context>\n"
            + "\n".join(business_tool_results)
            + "\n</business_tool_context>"
        )
    if validation_errors:
        sections.append(
            "\u4e0a\u4e00\u8f6e\u5ba1\u67e5\u5efa\u8bae\uff08\u672c\u8f6e\u5fc5\u987b\u4fee\u6b63\uff09\uff1a\n"
            + "\n".join(f"- {item}" for item in validation_errors)
        )

    updates: dict[str, object] = {}
    effective_message = _rewrite_draft_user_message(
        user_message=request.message,
        vision_clues=vision_clues,
        search_results=search_results,
    )
    cleaned_materials = _remove_image_materials(request)
    if sections:
        updates["message"] = f"{effective_message}\n\n" + "\n\n".join(sections)
    elif effective_message != request.message:
        updates["message"] = effective_message
    if system_prompt is not None:
        updates["system_prompt"] = system_prompt
    if len(cleaned_materials) != len(request.materials):
        updates["materials"] = cleaned_materials

    if not updates:
        return request
    return request.model_copy(deep=True, update=updates)


def _build_draft_system_prompt(
    *,
    state: GraphState,
    knowledge_base_context: str,
) -> str | None:
    base_prompt = _resolve_review_prompt(state).strip()
    prompt_sections = [base_prompt] if base_prompt else []

    if knowledge_base_context.strip():
        prompt_sections.append(
            "【专属外挂知识库检索结果】：\n"
            f"{knowledge_base_context.strip()}\n"
            "请务必基于以上独家知识进行创作，切勿使用通用废话！"
        )

    if not prompt_sections:
        return None
    return "\n\n".join(prompt_sections)


def _rewrite_draft_user_message(
    *,
    user_message: str,
    vision_clues: list[str],
    search_results: str,
) -> str:
    if not vision_clues and not search_results.strip():
        return user_message

    sections: list[str] = []

    if vision_clues:
        sections.append(
            "用户提供了图片，视觉感知系统已提取以下图片内容详情：\n"
            "<image_context>\n"
            + "\n".join(vision_clues)
            + "\n</image_context>"
        )

    if search_results.strip():
        sections.append(
            DRAFT_SEARCH_INSTRUCTION
            + "\n"
            + "<search_context>\n"
            + search_results.strip()
            + "\n</search_context>"
        )

    sections.append(DRAFT_FINAL_RESPONSE_INSTRUCTION)
    sections.append(f"用户的具体要求是：{user_message}")
    return "\n\n".join(sections)


def _remove_image_materials(request: MediaChatRequest) -> list[MaterialInput]:
    return [
        material.model_copy(deep=True)
        for material in request.materials
        if material.type != MaterialType.IMAGE
    ]


def _build_default_search_query(request: MediaChatRequest) -> str:
    current_datetime = datetime.now(BEIJING_TIMEZONE)
    current_year = current_datetime.year
    current_month = current_datetime.strftime("%Y年%m月")
    task_hint = {
        TaskType.TOPIC_PLANNING: "请检索最新行业趋势、用户讨论和高热选题方向",
        TaskType.HOT_POST_ANALYSIS: "请检索最新热点内容、爆款案例和传播讨论",
        TaskType.CONTENT_GENERATION: "请检索最新热点话题、观点切口和用户讨论",
        TaskType.COMMENT_REPLY: "请检索相关热点背景和近期舆情讨论",
    }.get(request.task_type, "请检索相关外部信息")
    return (
        f"{request.message}\n"
        f"{task_hint}\n"
        f"目标平台：{request.platform.value}\n"
        f"优先检索时间范围：{current_year} 年最新信息，必要时带上 {current_month}"
    )


def _build_heuristic_search_route_decision(
    request: MediaChatRequest,
) -> SearchRouteDecision:
    task_requires_search = request.task_type in {
        TaskType.TOPIC_PLANNING,
        TaskType.HOT_POST_ANALYSIS,
    }
    keyword_triggers = (
        "最新",
        "最近",
        "今日",
        "今天",
        "本周",
        "近期",
        "热搜",
        "热点",
        "爆款",
        "趋势",
        "新闻",
        "发布",
        "上市",
        "上新",
        "实时",
        "current",
        "latest",
        "today",
        "recent",
        "trend",
        "trending",
        "news",
    )
    message = request.message.strip()
    needs_search = task_requires_search or any(keyword in message.lower() for keyword in keyword_triggers)
    search_query = _build_default_search_query(request) if needs_search else ""
    return SearchRouteDecision(needs_search=needs_search, search_query=search_query)


def _coerce_search_route_decision(
    payload: SearchRouteDecision | dict[str, object] | str,
    request: MediaChatRequest,
) -> SearchRouteDecision:
    if isinstance(payload, SearchRouteDecision):
        decision = payload
    elif isinstance(payload, str):
        try:
            decision = SearchRouteDecision.model_validate_json(payload)
        except ValidationError:
            decision = SearchRouteDecision.model_validate(json.loads(payload))
    else:
        decision = SearchRouteDecision.model_validate(payload)

    normalized_query = decision.search_query.strip() if decision.search_query else ""
    if decision.needs_search and not normalized_query:
        normalized_query = _build_default_search_query(request)
    if not decision.needs_search:
        normalized_query = ""
    return SearchRouteDecision(
        needs_search=decision.needs_search,
        search_query=normalized_query,
    )


def _coerce_search_results_text(payload: object) -> str:
    if isinstance(payload, str):
        return payload.strip()

    if isinstance(payload, list):
        normalized_lines: list[str] = []
        for item in payload:
            if isinstance(item, str):
                line = item.strip()
            elif isinstance(item, dict):
                line = _normalize_search_results({"results": [item]}).strip()
            else:
                line = str(item).strip()
            if line:
                normalized_lines.append(line)
        return "\n".join(normalized_lines).strip()

    if isinstance(payload, dict):
        return _normalize_search_results(payload)

    return str(payload).strip()


def _normalize_search_results(payload: object) -> str:
    if not isinstance(payload, dict):
        return ""

    context: list[str] = []

    answer = str(payload.get("answer", "")).strip()
    if answer:
        context.append(f"搜索总结：{answer}")

    results = payload.get("results")
    if not isinstance(results, list):
        return "\n".join(context).strip()

    for index, item in enumerate(results[:5], start=1):
        if not isinstance(item, dict):
            continue

        title = str(item.get("title", "")).strip()
        content = str(item.get("content", "")).strip()
        url = str(item.get("url", "")).strip()
        segments = [segment for segment in [title, content, url] if segment]
        if segments:
            context.append(f"{index}. " + " | ".join(segments))

    return "\n".join(context).strip()


def _build_mock_search_results(
    request: MediaChatRequest,
    search_query: str,
) -> str:
    today = datetime.now(BEIJING_TIMEZONE).date().isoformat()
    platform_label = request.platform.value

    topic_map = {
        TaskType.TOPIC_PLANNING: (
            "平台内容团队正在集中讨论更强时效性的话题切口，偏好“热点事件 + 可执行建议 + 明确受众”结构。",
            [
                "选题趋势 | 用户更关注可立即落地的清单式内容，而不是泛泛观点。",
                "讨论热词 | 真实体验、避坑总结、情绪价值、成本对比仍然是高频点击词。",
                "内容机会 | 将行业新闻和个人经验结合，更容易形成收藏与转发。",
            ],
        ),
        TaskType.HOT_POST_ANALYSIS: (
            "近期高表现内容普遍使用“热词切入 + 具体案例 + 结论前置”的表达方式。",
            [
                "传播结构 | 标题先给冲突感，再在正文前 3 句明确收益点。",
                "读者反馈 | 用户更愿意互动那些能快速验证、并带有时间窗口感的内容。",
                "复用建议 | 可把热点观点改写成『原因拆解 / 方法复盘 / 适用人群』三段式。",
            ],
        ),
        TaskType.CONTENT_GENERATION: (
            "当前相关内容的高频表达强调“最新消息、明确结论、实测体验”和“是否值得跟进”。",
            [
                "写法偏好 | 标题更强调结论先行，例如“刚发布值不值得买/学/试”。",
                "用户关注 | 常见问题集中在价格、体验差异、适用人群和替代方案。",
                "转化动作 | 结尾加入观点总结和评论区互动问题，更容易放大讨论。",
            ],
        ),
        TaskType.COMMENT_REPLY: (
            "近期相关话题下，用户更在意回应是否及时、真诚，并且能给出明确下一步。",
            [
                "回复策略 | 先确认情绪或诉求，再补充一条具体可执行动作。",
                "风险提示 | 涉及判断类表述时，先说明适用前提，避免绝对化承诺。",
                "互动方向 | 以追问场景或邀请补充信息的方式结尾，更利于继续沟通。",
            ],
        ),
    }

    summary, highlights = topic_map.get(
        request.task_type,
        (
            "当前热点结果显示，用户更偏好具有时效性、结论明确且能快速执行的内容形式。",
            [
                "内容结构 | 结论前置、信息压缩、场景明确。",
                "用户需求 | 希望快速判断值不值得继续看、继续做、继续买。",
                "传播机会 | 结合当下讨论词和真实案例，更容易形成扩散。",
            ],
        ),
    )

    lines = [
        f"搜索总结：{summary}",
        (
            f"1. 模拟热点快照 | 日期：{today} | 平台：{platform_label} | "
            f"查询：{search_query}"
        ),
    ]
    lines.extend(f"{index + 1}. {item}" for index, item in enumerate(highlights, start=1))
    lines.append("5. 说明 | 当前未配置外部搜索服务，以上为与真实搜索结果格式一致的模拟联网检索上下文。")
    return "\n".join(lines)


def _merge_validation_errors(
    existing: list[str],
    new_errors: list[str],
) -> list[str]:
    merged = list(existing)
    for item in new_errors:
        if item not in merged:
            merged.append(item)
    return merged


def _review_draft(state: GraphState) -> list[str]:
    draft = state.get("current_draft", "").strip()
    if not draft:
        return ["当前草稿为空，需要重新生成。"]

    request = state["request"]
    issues: list[str] = []

    minimum_length = {
        TaskType.TOPIC_PLANNING: 28,
        TaskType.CONTENT_GENERATION: 40,
        TaskType.HOT_POST_ANALYSIS: 36,
        TaskType.COMMENT_REPLY: 28,
    }[request.task_type]
    if len(draft) < minimum_length:
        issues.append("草稿信息密度不足，需要补充更完整的中文表达。")

    system_prompt = _resolve_review_prompt(state)
    if system_prompt:
        risk_prompt_keywords = ("风控", "风险提示", "合规", "免责声明")
        risk_draft_markers = ("风险", "仅供参考", "不构成", "谨慎", "需结合实际")
        if any(keyword in system_prompt for keyword in risk_prompt_keywords) and not any(
            marker in draft for marker in risk_draft_markers
        ):
            issues.append("当前草稿没有体现系统提示词要求的风险或合规提醒。")

        list_prompt_keywords = ("分点", "条列", "列表", "要点", "编号")
        list_draft_markers = ("1.", "2.", "1、", "一、", "第一", "•", "- ")
        if any(keyword in system_prompt for keyword in list_prompt_keywords) and not any(
            marker in draft for marker in list_draft_markers
        ):
            issues.append("当前草稿没有按系统提示词要求呈现清晰的分点结构。")

    return issues


def _resolve_review_prompt(state: GraphState) -> str:
    thread = state.get("thread")
    if thread is not None and thread.system_prompt.strip():
        return thread.system_prompt.strip()

    request = state["request"]
    if request.system_prompt is not None and request.system_prompt.strip():
        return request.system_prompt.strip()

    return ""


def _resolve_knowledge_base_scope_from_state(state: GraphState) -> str:
    thread = state.get("thread")
    if thread is not None:
        normalized_thread_scope = normalize_knowledge_base_scope(
            thread.knowledge_base_scope,
        )
        if normalized_thread_scope:
            return normalized_thread_scope

    request = state["request"]
    normalized_request_scope = normalize_knowledge_base_scope(
        request.knowledge_base_scope,
    )
    if normalized_request_scope:
        return normalized_request_scope

    return ""


def _validate_artifact_candidate(
    request: MediaChatRequest,
    candidate: dict[str, object],
) -> BaseModel:
    if request.task_type == TaskType.TOPIC_PLANNING:
        return TopicPlanningArtifactPayload.model_validate(candidate)
    if request.task_type == TaskType.CONTENT_GENERATION:
        return ContentGenerationArtifactPayload.model_validate(candidate)
    if request.task_type == TaskType.HOT_POST_ANALYSIS:
        return HotPostAnalysisArtifactPayload.model_validate(candidate)
    return CommentReplyArtifactPayload.model_validate(candidate)


def _build_fallback_artifact(
    *,
    request: MediaChatRequest,
    draft: str,
    materials_parsed: list[str],
) -> BaseModel:
    supporting_context = "；".join(materials_parsed[:2]) if materials_parsed else "无补充素材"

    if request.task_type == TaskType.TOPIC_PLANNING:
        return TopicPlanningArtifactPayload(
            title="内容选题池",
            topics=[
                TopicPlanningItem(
                    title="从一次复盘里提炼出 3 个长期可复用的方法论",
                    angle=(
                        f"围绕“{request.message[:18]}”拆出步骤感，并结合素材线索：{supporting_context}"
                    ),
                    goal="提升收藏率和后续私信咨询意愿。",
                ),
                TopicPlanningItem(
                    title="把抽象经验改写成可执行清单",
                    angle="让读者能够直接照着做，而不是只停留在观点层。",
                    goal="增强内容完读率和转发价值。",
                ),
                TopicPlanningItem(
                    title="用一个真实场景证明这套方法为什么有效",
                    angle="优先呈现决策前后对比，建立可信度。",
                    goal="提高评论互动与深度交流转化。",
                ),
            ],
        )

    if request.task_type == TaskType.CONTENT_GENERATION:
        body = draft.strip() or (
            "很多内容之所以没有形成传播，不是因为观点不够多，而是因为表达没有帮助读者完成决策。\n\n"
            "建议先交代问题，再给出拆解框架，最后补上可执行动作，这样更容易被记住和收藏。"
        )
        return ContentGenerationArtifactPayload(
            title="结构化内容草稿",
            title_candidates=[
                "别再把复盘写成流水账，读者真正想看到的是这 3 个结论",
                "同样是内容总结，为什么有的人能写出高收藏笔记",
                "一篇高质量复盘，关键不在文笔，而在结构有没有帮人做决定",
            ],
            body=body,
            platform_cta="如果你愿意，我可以继续把这版草稿改写成小红书图文版或抖音口播版。",
        )

    if request.task_type == TaskType.HOT_POST_ANALYSIS:
        return HotPostAnalysisArtifactPayload(
            title="爆款内容拆解卡",
            analysis_dimensions=[
                HotPostAnalysisDimension(
                    dimension="标题钩子机制",
                    insight="先指出常见误区，再抛出更优解，能够快速建立点击动机。",
                ),
                HotPostAnalysisDimension(
                    dimension="情绪触发点",
                    insight="通过“原来我也踩过这个坑”的代入感，把读者带进自己的处境。",
                ),
                HotPostAnalysisDimension(
                    dimension="信任建立方式",
                    insight="用明确步骤和真实情境代替夸张承诺，更容易形成信服。",
                ),
            ],
            reusable_templates=[
                "先别急着追求结果，先判断问题是不是出在顺序上。",
                "真正有效的方法，不是信息更多，而是能帮助用户更快决策。",
                "如果你也卡在这一步，可以先从最小动作开始验证。",
            ],
        )

    return CommentReplyArtifactPayload(
        title="评论回复建议",
        suggestions=[
            CommentReplySuggestion(
                comment_type="咨询类",
                scenario="用户想进一步了解执行步骤。",
                reply=(
                    "可以，我先把这件事拆成 3 个最容易上手的动作，"
                    "你也可以告诉我你现在卡在哪一步。"
                ),
                compliance_note="优先收集信息，再给更具体建议。",
            ),
            CommentReplySuggestion(
                comment_type="质疑类",
                scenario="用户担心方案不适合自己。",
                reply=(
                    "这个顾虑很正常，不同阶段适合的方法确实不同。"
                    "你可以补充一下目标和当前情况，我再帮你判断哪一步更值得先做。"
                ),
                compliance_note="先回应疑虑，再补充判断依据。",
            ),
            CommentReplySuggestion(
                comment_type="情绪类",
                scenario="用户表达焦虑或挫败感。",
                reply=(
                    "先别急着否定自己，很多问题不是做不到，"
                    "而是缺少一条更清晰的拆解路径。我们可以先从最容易推进的一步开始。"
                ),
                compliance_note="先安抚情绪，再引导到具体动作。",
            ),
        ],
    )


def _build_data_image_url_part(*, mime_type: str, image_bytes: bytes) -> dict[str, object]:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return {
        "type": "image_url",
        "image_url": {
            "url": f"data:{mime_type};base64,{encoded}",
        },
    }


def _resolve_image_mime_type(*, source_name: str, content_type_header: str | None = None) -> str:
    normalized_header = (content_type_header or "").split(";", 1)[0].strip().lower()
    if normalized_header.startswith("image/"):
        return normalized_header

    guessed_type = mimetypes.guess_type(source_name.split("?", 1)[0])[0]
    if guessed_type and guessed_type.startswith("image/"):
        return guessed_type
    return "image/jpeg"


async def _build_remote_image_content_part(raw_url: str) -> dict[str, object]:
    async with httpx.AsyncClient(
        timeout=REMOTE_IMAGE_FETCH_TIMEOUT,
        follow_redirects=True,
    ) as client:
        response = await client.get(raw_url)
        response.raise_for_status()

    image_bytes = response.content
    if not image_bytes:
        raise ValueError("Remote image download returned empty content.")

    mime_type = _resolve_image_mime_type(
        source_name=raw_url,
        content_type_header=response.headers.get("content-type"),
    )
    logger.info(
        "Downloaded remote image for vision analysis: url=%s mime_type=%s bytes=%s",
        raw_url,
        mime_type,
        len(image_bytes),
    )
    return _build_data_image_url_part(mime_type=mime_type, image_bytes=image_bytes)


async def _build_image_content_part(url: object | None) -> dict[str, object] | None:
    if url is None:
        return None

    raw_url = str(url).strip()
    if not raw_url:
        return None

    normalized_reference = normalize_storage_reference(raw_url)
    if normalized_reference and (
        normalized_reference.startswith("http://")
        or normalized_reference.startswith("https://")
    ):
        logger.info("Downloading remote image for vision analysis: %s", normalized_reference)
        return await _build_remote_image_content_part(normalized_reference)

    if normalized_reference and not (
        normalized_reference.startswith("http://")
        or normalized_reference.startswith("https://")
    ):
        backend_name, object_key = parse_stored_file_path(normalized_reference)
        if backend_name == "oss":
            signed_url = build_delivery_url_from_stored_path(normalized_reference)
            logger.info(
                "Resolved OSS image for vision analysis: raw_url=%s object_key=%s signed_url=%s",
                raw_url,
                object_key,
                signed_url,
            )
            return await _build_remote_image_content_part(signed_url)

    relative_path = extract_upload_relative_path(normalized_reference or raw_url)
    if relative_path:
        file_path = UPLOADS_DIR / relative_path
        logger.info(
            "Resolved upload image for vision analysis: raw_url=%s, relative_path=%s, file_path=%s",
            raw_url,
            relative_path,
            file_path,
        )
        if not file_path.exists():
            logger.error(
                "Local upload image missing for vision analysis: raw_url=%s, file_path=%s",
                raw_url,
                file_path,
            )
            raise ValueError(f"本地图片不存在：{file_path.name}")

        mime_type = _resolve_image_mime_type(source_name=file_path.name)
        try:
            image_bytes = file_path.read_bytes()
        except OSError as exc:
            logger.exception(
                "Failed to read local upload image for vision analysis: raw_url=%s, file_path=%s",
                raw_url,
                file_path,
            )
            raise ValueError("无法读取本地图片素材。") from exc
        return _build_data_image_url_part(mime_type=mime_type, image_bytes=image_bytes)

    logger.error("Unsupported image material url for vision analysis: %s", raw_url)
    return None


def _normalize_vision_result(*, index: int, raw_text: str) -> str:
    extracted_text = ""
    visual_summary = ""
    marketing_angles: list[str] = []

    normalized = raw_text.strip()
    if not normalized:
        return ""

    try:
        payload = json.loads(normalized)
        if isinstance(payload, dict):
            extracted_text = str(payload.get("extracted_text", "")).strip()
            visual_summary = str(payload.get("visual_summary", "")).strip()
            angles = payload.get("marketing_angles")
            if isinstance(angles, list):
                marketing_angles = [str(item).strip() for item in angles if str(item).strip()]
    except json.JSONDecodeError:
        visual_summary = normalized

    parts = [f"视觉解析#{index}"]
    if extracted_text:
        parts.append(f"提取文字：{extracted_text}")
    if visual_summary:
        parts.append(f"画面描述：{visual_summary}")
    if marketing_angles:
        parts.append(f"可用角度：{'；'.join(marketing_angles[:3])}")

    return "；".join(parts)
