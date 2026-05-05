import asyncio
import base64
import inspect
import json
import logging
import mimetypes
import os
import traceback
import re
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TypedDict
from urllib.parse import unquote, urlparse

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
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import load_environment
from app.db.models import Thread, UploadRecord, User
from app.models.schemas import (
    CitationAuditItem,
    CommentReplyArtifactPayload,
    CommentReplySuggestion,
    ContentGenerationArtifactPayload,
    HotPostAnalysisArtifactPayload,
    HotPostAnalysisDimension,
    ImageGenerationArtifactPayload,
    MaterialInput,
    MaterialType,
    MediaChatRequest,
    Platform,
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
from app.services.image_generation import DashScopeImageGenerationService
from app.services.intent_routing import (
    normalize_media_chat_request,
    should_route_to_direct_image_generation,
)
from app.services.media_parser import (
    MediaParserError,
    parse_document,
    transcribe_video,
    validate_mimo_audio_material,
    validate_mimo_video_material,
)
from app.services.persistence import extract_upload_relative_path
from app.services.providers import (
    BaseLLMProvider,
    CompatibleLLMProvider,
    DeepSeekLLMProvider,
    MockLLMProvider,
    OpenAIProvider,
    ProxyGPTLLMProvider,
    QwenLLMProvider,
    _resolve_compatible_generation_model,
    _supports_native_audio_understanding,
    _is_dashscope_compatible_base_url,
    _supports_native_video_understanding,
)
from app.services.token_usage import (
    build_model_token_usage,
    extract_total_tokens,
    merge_model_token_usage,
    normalize_model_token_usage,
)
from app.services.tools import execute_business_tool_async, get_business_tools

logger = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[3]
UPLOADS_DIR = PROJECT_ROOT / "uploads"
ImagePromptBuilder = Callable[
    [MediaChatRequest, str, dict[str, object] | None],
    Awaitable[str] | str,
]
ImageGenerator = Callable[
    [MediaChatRequest, str, str | None, str],
    Awaitable[list[str]] | list[str],
]
ImageRouteAnalyzer = Callable[
    [MediaChatRequest, str, dict[str, object] | None],
    Awaitable["ImageRouteDecision | dict[str, object]"],
]


def _build_http_timeout(seconds: float) -> httpx.Timeout:
    connect_timeout = min(seconds, 10.0)
    return httpx.Timeout(seconds, connect=connect_timeout)


REMOTE_IMAGE_FETCH_TIMEOUT = _build_http_timeout(20.0)
IMAGE_PROGRESS_HEARTBEAT_SECONDS = 8.0
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


def _resolve_inner_provider_generation_model_for_request(
    inner_provider: BaseLLMProvider,
    request: MediaChatRequest,
    *,
    vision_model: str | None = None,
) -> str:
    model_name = str(getattr(inner_provider, "model", "") or "")
    if isinstance(inner_provider, CompatibleLLMProvider) and not isinstance(
        inner_provider,
        QwenLLMProvider,
    ):
        return _resolve_compatible_generation_model(
            request=request,
            active_model=model_name,
            multimodal_model=vision_model or getattr(inner_provider, "vision_model", ""),
        )
    return model_name


def _supports_native_video_material_passthrough(
    inner_provider: BaseLLMProvider,
    request: MediaChatRequest,
    *,
    vision_model: str | None = None,
) -> bool:
    resolved_model = _resolve_inner_provider_generation_model_for_request(
        inner_provider,
        request,
        vision_model=vision_model,
    )
    return _supports_native_video_understanding(resolved_model)


def _supports_native_audio_material_passthrough(
    inner_provider: BaseLLMProvider,
    request: MediaChatRequest,
    *,
    vision_model: str | None = None,
) -> bool:
    resolved_model = _resolve_inner_provider_generation_model_for_request(
        inner_provider,
        request,
        vision_model=vision_model,
    )
    return _supports_native_audio_understanding(resolved_model)


def _resolve_material_upload_metadata(
    material: MaterialInput,
    *,
    db: Session | None,
    user_id: str | None,
) -> tuple[int | None, str | None]:
    if db is None or not (material.url or "").strip():
        return None, None

    normalized_reference = normalize_storage_reference(material.url)
    if normalized_reference is None:
        return None, None

    statement = select(UploadRecord.file_size, UploadRecord.mime_type).where(
        UploadRecord.file_path == normalized_reference,
    )
    if user_id:
        statement = statement.where(UploadRecord.user_id == user_id)

    row = db.execute(statement).first()
    if row is None:
        return None, None

    file_size = int(row[0]) if row[0] is not None else None
    mime_type = str(row[1]) if row[1] is not None else None
    return file_size, mime_type


def _resolve_graph_user_context(
    *,
    db: Session | None,
    user_id: str | None,
) -> dict[str, object] | None:
    normalized_user_id = str(user_id or "").strip()
    if not normalized_user_id:
        return None

    normalized_role = ""
    if db is not None:
        user = db.get(User, normalized_user_id)
        if user is not None and getattr(user, "role", None):
            normalized_role = str(user.role).strip().lower()

    return {
        "id": normalized_user_id,
        "role": normalized_role or "user",
    }


class GraphState(TypedDict, total=False):
    request: MediaChatRequest
    token_usage: dict[str, int]
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
    user_role: str | None
    user_context: dict[str, object] | None
    needs_ocr: bool
    needs_search: bool
    needs_image: bool
    next_route: str
    messages: list[BaseMessage]
    pending_tool_calls: list[dict[str, object]]
    business_tool_results: list[str]
    business_tool_iteration: int
    knowledge_base_scope: str
    knowledge_base_context: str
    knowledge_base_citation_audit: list[dict[str, object]]
    artifact_fallback_reason: str | None
    image_generation_prompt: str
    generated_images: list[str]
    direct_image_mode: bool
    execution_plan: list[str]
    active_execution_step: str


class SearchRouteDecision(BaseModel):
    needs_search: bool = False
    search_query: str = ""


class ImageRouteDecision(BaseModel):
    needs_image: bool = False


EXECUTION_STEP_DRAFT_CONTENT = "draft_content"
EXECUTION_STEP_GENERATE_IMAGE = "generate_image"


def create_langgraph_inner_provider() -> BaseLLMProvider:
    provider_name = os.getenv("LANGGRAPH_INNER_PROVIDER", "").strip().lower()

    if provider_name == "mock":
        return MockLLMProvider()
    if provider_name == "openai" and os.getenv("OPENAI_API_KEY"):
        return OpenAIProvider()
    if provider_name == "deepseek" and os.getenv("DEEPSEEK_API_KEY"):
        return DeepSeekLLMProvider()
    if provider_name in {"proxy_gpt", "proxy-gpt"} and os.getenv("PROXY_GPT_API_KEY"):
        return ProxyGPTLLMProvider()
    if provider_name == "compatible":
        if os.getenv("LLM_API_KEY") and os.getenv("LLM_BASE_URL"):
            return CompatibleLLMProvider()
    if provider_name in {"qwen", "dashscope"}:
        if (
            os.getenv("QWEN_API_KEY")
            or os.getenv("QWEN_BASE_URL")
            or _is_dashscope_compatible_base_url(os.getenv("LLM_BASE_URL"))
        ):
            return QwenLLMProvider()

    if os.getenv("QWEN_API_KEY") or os.getenv("QWEN_BASE_URL"):
        return QwenLLMProvider()
    if _is_dashscope_compatible_base_url(os.getenv("LLM_BASE_URL")) and os.getenv("LLM_API_KEY"):
        return QwenLLMProvider()
    if os.getenv("LLM_API_KEY") and os.getenv("LLM_BASE_URL"):
        return CompatibleLLMProvider()
    if os.getenv("OPENAI_API_KEY"):
        return OpenAIProvider()
    if os.getenv("DEEPSEEK_API_KEY"):
        return DeepSeekLLMProvider()
    if os.getenv("PROXY_GPT_API_KEY"):
        return ProxyGPTLLMProvider()
    return MockLLMProvider()


class LangGraphProvider(BaseLLMProvider):
    def __init__(
        self,
        inner_provider: BaseLLMProvider | None = None,
        *,
        route_analyzer: Callable[[MediaChatRequest], Awaitable[SearchRouteDecision | dict[str, object]]] | None = None,
        image_route_analyzer: ImageRouteAnalyzer | None = None,
        vision_analyzer: Callable[[MediaChatRequest], Awaitable[list[str]]] | None = None,
        search_analyzer: Callable[..., Awaitable[object]] | None = None,
        image_prompt_builder: ImagePromptBuilder | None = None,
        image_generator: ImageGenerator | None = None,
        vision_model: str | None = None,
        vision_timeout_seconds: float | None = None,
        search_timeout_seconds: float | None = None,
        business_tool_max_iterations: int = 2,
    ) -> None:
        load_environment()
        self.inner_provider = inner_provider or create_langgraph_inner_provider()
        self.route_analyzer = route_analyzer
        self.image_route_analyzer = image_route_analyzer
        self.vision_analyzer = vision_analyzer
        self.search_analyzer = search_analyzer
        self.image_service = DashScopeImageGenerationService()
        self.image_prompt_builder = image_prompt_builder
        self.image_generator = image_generator
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

    def clone_with_model_override(self, model_override: str | None) -> BaseLLMProvider:
        normalized_model = (model_override or "").strip()
        if not normalized_model:
            return self

        next_inner_provider = self.inner_provider.clone_with_model_override(normalized_model)
        if next_inner_provider is self.inner_provider:
            return self

        return type(self)(
            inner_provider=next_inner_provider,
            route_analyzer=self.route_analyzer,
            image_route_analyzer=self.image_route_analyzer,
            vision_analyzer=self.vision_analyzer,
            search_analyzer=self.search_analyzer,
            image_prompt_builder=self.image_prompt_builder,
            image_generator=self.image_generator,
            vision_model=self.vision_model,
            vision_timeout_seconds=self.vision_timeout_seconds,
            search_timeout_seconds=self.search_timeout_seconds,
            business_tool_max_iterations=self.business_tool_max_iterations,
        )

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
        request, _ = normalize_media_chat_request(request)
        inner_model_name = getattr(self.inner_provider, "model", "") or "<unset>"
        logger.info(
            "langgraph.stream start thread_id=%s task_type=%s materials=%s inner_provider=%s (model=%s)",
            request.thread_id,
            request.task_type.value,
            len(request.materials),
            type(self.inner_provider).__name__,
            inner_model_name,
        )
        yield {
            "event": "start",
            "thread_id": request.thread_id,
            "platform": request.platform.value,
            "task_type": request.task_type.value,
            "materials_count": len(request.materials),
        }

        initial_state = self._build_initial_state(
            request,
            db=db,
            thread=thread,
            user_id=user_id,
        )
        state_token_usage = normalize_model_token_usage(initial_state.get("token_usage"))

        try:
            async for mode, chunk in self.graph.astream(
                initial_state,
                stream_mode=["custom", "updates"],
            ):
                if not isinstance(chunk, dict):
                    continue

                if mode == "updates":
                    for update in chunk.values():
                        if not isinstance(update, dict) or "token_usage" not in update:
                            continue
                        state_token_usage = normalize_model_token_usage(update.get("token_usage"))
                    continue

                if mode != "custom":
                    continue

                payload = chunk.get("payload")
                if isinstance(payload, dict):
                    yield payload
        except asyncio.CancelledError:
            logger.info(
                "LangGraph workflow cancelled thread_id=%s task_type=%s",
                request.thread_id,
                request.task_type.value,
            )
            raise
        except Exception as exc:  # pragma: no cover - defensive boundary
            logger.exception("LangGraph workflow failed: %s", exc)
            yield {
                "event": "error",
                "code": "LANGGRAPH_RUNTIME_ERROR",
                "message": f"LangGraph 工作流执行失败：{exc}",
            }

        yield {
            "event": "done",
            "thread_id": request.thread_id,
            "token_usage": state_token_usage,
        }

    def _build_initial_state(
        self,
        request: MediaChatRequest,
        *,
        db: Session | None = None,
        thread: Thread | None = None,
        user_id: str | None = None,
    ) -> GraphState:
        resolved_user_id = user_id or (thread.user_id if thread is not None else None)
        user_context = _resolve_graph_user_context(db=db, user_id=resolved_user_id)
        return {
            "request": request,
            "token_usage": {},
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
            "user_id": resolved_user_id,
            "user_role": str((user_context or {}).get("role") or "").strip().lower() or None,
            "user_context": user_context,
            "needs_ocr": False,
            "needs_search": False,
            "needs_image": False,
            "next_route": "parse_materials_node",
            "messages": [],
            "pending_tool_calls": [],
            "business_tool_results": [],
            "business_tool_iteration": 0,
            "knowledge_base_scope": "",
            "knowledge_base_context": "",
            "knowledge_base_citation_audit": [],
            "artifact_fallback_reason": None,
            "image_generation_prompt": "",
            "generated_images": [],
            "direct_image_mode": False,
            "execution_plan": [],
            "active_execution_step": "",
        }

    def _build_graph(self):
        graph = StateGraph(GraphState)
        graph.add_node("router", self._router_node)
        graph.add_node("parse_materials_node", self._parse_materials_node)
        graph.add_node("ocr_node", self._ocr_node)
        graph.add_node("search_node", self._search_node)
        graph.add_node("generate_draft_node", self._generate_draft_node)
        graph.add_node("tool_execution_node", self._tool_execution_node)
        graph.add_node("review_node", self._review_node)
        graph.add_node("generate_image_node", self._generate_image_node)
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
                "generate_image_node": "generate_image_node",
            },
        )
        graph.add_conditional_edges(
            "ocr_node",
            self._route_after_ocr,
            {
                "search_node": "search_node",
                "generate_draft_node": "generate_draft_node",
                "generate_image_node": "generate_image_node",
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
        graph.add_edge("generate_image_node", "format_artifact_node")
        graph.add_conditional_edges(
            "format_artifact_node",
            self._route_after_format_artifact,
            {
                "generate_image_node": "generate_image_node",
                "end": END,
            },
        )

        return graph.compile()

    async def _router_node(self, state: GraphState) -> GraphState:
        request = state["request"]
        normalized_request, routing_resolution = normalize_media_chat_request(request)
        state_updates: GraphState = {}
        if routing_resolution.overridden:
            logger.info(
                "langgraph smart_router override thread_id=%s requested=%s resolved=%s reason=%s",
                request.thread_id,
                routing_resolution.requested_task_type.value,
                routing_resolution.resolved_task_type.value,
                routing_resolution.reason,
            )
            request = normalized_request
            state_updates["request"] = normalized_request

        user_role = str((state.get("user_context") or {}).get("role") or "user").strip().lower()
        logger.info(
            "langgraph node=router thread_id=%s user_role=%s",
            request.thread_id,
            user_role or "user",
        )
        if _should_bypass_to_direct_image_generation(
            request,
            routing_resolution=routing_resolution,
        ):
            resolved_image_backend = self.image_service.resolve_backend(user_role=user_role)
            execution_plan = [EXECUTION_STEP_GENERATE_IMAGE]
            logger.info(
                "langgraph router bypass thread_id=%s next=%s reason=direct_image_request user_role=%s image_backend=%s execution_plan=%s",
                request.thread_id,
                "parse_materials_node",
                user_role or "user",
                resolved_image_backend,
                execution_plan,
            )
            return {
                **state_updates,
                "needs_search": False,
                "search_query": "",
                "needs_image": True,
                "direct_image_mode": True,
                "execution_plan": execution_plan,
                "active_execution_step": EXECUTION_STEP_GENERATE_IMAGE,
                "next_route": "parse_materials_node",
                "current_step": "router:direct_image_bypass",
            }
        decision = await self._decide_search_route(request)
        execution_plan = _build_router_execution_plan(request)
        active_execution_step = execution_plan[0] if execution_plan else ""
        logger.info(
            "langgraph router planned thread_id=%s execution_plan=%s needs_search=%s",
            request.thread_id,
            execution_plan,
            decision.needs_search,
        )
        return {
            **state_updates,
            "needs_search": decision.needs_search,
            "search_query": decision.search_query,
            "needs_image": EXECUTION_STEP_GENERATE_IMAGE in execution_plan,
            "direct_image_mode": False,
            "execution_plan": execution_plan,
            "active_execution_step": active_execution_step,
            "next_route": "parse_materials_node",
            "current_step": "router:completed",
        }

    def _route_from_router(self, state: GraphState) -> str:
        return state.get("next_route", "parse_materials_node")

    async def _parse_materials_node(self, state: GraphState) -> GraphState:
        writer = get_stream_writer()
        _emit_tool_call(
            writer,
            name="parse_materials",
            status="processing",
            message="正在整理并解析附件素材...",
        )
        logger.info(
            "langgraph node=parse_materials thread_id=%s materials=%s",
            state["request"].thread_id,
            len(state["request"].materials),
        )

        request = state["request"]
        parsed_materials, needs_ocr = _parse_materials(request)
        enriched_materials = list(parsed_materials)
        native_video_enabled = _supports_native_video_material_passthrough(
            self.inner_provider,
            request,
            vision_model=self.vision_model,
        )
        native_audio_enabled = _supports_native_audio_material_passthrough(
            self.inner_provider,
            request,
            vision_model=self.vision_model,
        )

        for material in request.materials:
            if material.type == MaterialType.TEXT_LINK and material.url:
                source_name = _resolve_material_source_name(material)
                _emit_tool_call(
                    writer,
                    name="parse_document",
                    status="processing",
                    message=f"正在解析文档素材：{source_name}",
                )
                try:
                    extracted_text = await parse_document(material.url)
                except MediaParserError as exc:
                    logger.warning(
                        "Document parsing failed thread_id=%s source=%s error=%s",
                        request.thread_id,
                        source_name,
                        exc,
                    )
                    _emit_tool_call(
                        writer,
                        name="parse_document",
                        status="failed",
                        message=f"文档解析失败：{source_name}，{exc}",
                    )
                    enriched_materials.append(f"文档素材《{source_name}》解析失败：{exc}")
                else:
                    _emit_tool_call(
                        writer,
                        name="parse_document",
                        status="completed",
                        message=f"文档解析完成：{source_name}",
                    )
                    escaped_source_name = _escape_context_attribute(source_name)
                    enriched_materials.append(
                        f'<document_context source="{escaped_source_name}">\n'
                        f"{extracted_text}\n"
                        "</document_context>"
                    )

            if material.type == MaterialType.VIDEO_URL and material.url:
                source_name = _resolve_material_source_name(material)
                if native_video_enabled:
                    file_size_bytes, mime_type = _resolve_material_upload_metadata(
                        material,
                        db=state.get("db"),
                        user_id=state.get("user_id"),
                    )
                    try:
                        validate_mimo_video_material(
                            material.url,
                            file_size_bytes=file_size_bytes,
                            mime_type=mime_type,
                        )
                    except MediaParserError as exc:
                        logger.warning(
                            "Native video validation failed thread_id=%s source=%s error=%s",
                            request.thread_id,
                            source_name,
                            exc,
                        )
                        _emit_tool_call(
                            writer,
                            name="video_validation",
                            status="failed",
                            message=f"Video material validation failed: {source_name}. {exc}",
                        )
                        raise
                    logger.info(
                        "Skipping video transcription, routing to native MiMo video engine. thread_id=%s source=%s model=%s",
                        request.thread_id,
                        source_name,
                        _resolve_inner_provider_generation_model_for_request(
                            self.inner_provider,
                            request,
                            vision_model=self.vision_model,
                        ),
                    )
                    _emit_tool_call(
                        writer,
                        name="video_transcription",
                        status="skipped",
                        message=(
                            f"\u5f53\u524d\u6a21\u578b\u652f\u6301\u539f\u751f\u89c6\u9891\u7406\u89e3\uff0c"
                            f"\u5df2\u8df3\u8fc7\u8f6c\u5199\u5e76\u76f4\u4f20\u89c6\u9891\uff1a{source_name}"
                        ),
                    )
                    continue
                _emit_tool_call(
                    writer,
                    name="video_transcription",
                    status="processing",
                    message=f"正在对视频素材进行语音转写：{source_name}",
                )
                try:
                    transcript = await transcribe_video(material.url)
                except MediaParserError as exc:
                    logger.warning(
                        "Video transcription failed thread_id=%s source=%s error=%s",
                        request.thread_id,
                        source_name,
                        exc,
                    )
                    _emit_tool_call(
                        writer,
                        name="video_transcription",
                        status="failed",
                        message=f"视频转写失败：{source_name}，{exc}",
                    )
                    enriched_materials.append(f"视频素材《{source_name}》转写失败：{exc}")
                else:
                    _emit_tool_call(
                        writer,
                        name="video_transcription",
                        status="completed",
                        message=f"视频转写完成：{source_name}",
                    )
                    escaped_source_name = _escape_context_attribute(source_name)
                    enriched_materials.append(
                        f'<video_transcript source="{escaped_source_name}">\n'
                        f"{transcript}\n"
                        "</video_transcript>"
                    )

            if material.type == MaterialType.AUDIO_URL and material.url:
                source_name = _resolve_material_source_name(material)
                if native_audio_enabled:
                    file_size_bytes, mime_type = _resolve_material_upload_metadata(
                        material,
                        db=state.get("db"),
                        user_id=state.get("user_id"),
                    )
                    try:
                        validate_mimo_audio_material(
                            material.url,
                            file_size_bytes=file_size_bytes,
                            mime_type=mime_type,
                        )
                    except MediaParserError as exc:
                        logger.warning(
                            "Native audio validation failed thread_id=%s source=%s error=%s",
                            request.thread_id,
                            source_name,
                            exc,
                        )
                        _emit_tool_call(
                            writer,
                            name="audio_validation",
                            status="failed",
                            message=f"Audio material validation failed: {source_name}. {exc}",
                        )
                        raise

                    logger.info(
                        "Skipping audio transcription, routing to native MiMo audio engine. thread_id=%s source=%s",
                        request.thread_id,
                        source_name,
                    )
                    _emit_tool_call(
                        writer,
                        name="audio_transcription",
                        status="skipped",
                        message=(
                            f"\u5f53\u524d\u6a21\u578b\u652f\u6301\u539f\u751f\u97f3\u9891\u7406\u89e3\uff0c"
                            f"\u5df2\u8df3\u8fc7\u8f6c\u5199\u5e76\u76f4\u4f20\u97f3\u9891\uff1a{source_name}"
                        ),
                    )
                    continue

                _emit_tool_call(
                    writer,
                    name="audio_transcription",
                    status="processing",
                    message=f"正在对音频素材进行语音转写：{source_name}",
                )
                try:
                    transcript = await transcribe_video(material.url)
                except MediaParserError as exc:
                    logger.warning(
                        "Audio transcription failed thread_id=%s source=%s error=%s",
                        request.thread_id,
                        source_name,
                        exc,
                    )
                    _emit_tool_call(
                        writer,
                        name="audio_transcription",
                        status="failed",
                        message=f"音频转写失败：{source_name}，{exc}",
                    )
                    enriched_materials.append(f"音频素材《{source_name}》转写失败：{exc}")
                else:
                    _emit_tool_call(
                        writer,
                        name="audio_transcription",
                        status="completed",
                        message=f"音频转写完成：{source_name}",
                    )
                    escaped_source_name = _escape_context_attribute(source_name)
                    enriched_materials.append(
                        f'<audio_transcript source="{escaped_source_name}">\n'
                        f"{transcript}\n"
                        "</audio_transcript>"
                    )

        _emit_tool_call(
            writer,
            name="parse_materials",
            status="completed",
            message="附件解析完成，正在组织生成上下文。",
        )
        return {
            "materials_parsed": enriched_materials,
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
        current_execution_step = _get_current_execution_step(state)
        if current_execution_step == EXECUTION_STEP_GENERATE_IMAGE:
            logger.info(
                "langgraph route=after_parse thread_id=%s next=%s execution_step=%s",
                state["request"].thread_id,
                "generate_image_node",
                current_execution_step,
            )
            return "generate_image_node"
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
        current_execution_step = _get_current_execution_step(state)
        if current_execution_step == EXECUTION_STEP_GENERATE_IMAGE:
            logger.info(
                "langgraph route=after_ocr thread_id=%s next=%s execution_step=%s",
                state["request"].thread_id,
                "generate_image_node",
                current_execution_step,
            )
            return "generate_image_node"
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
                ocr_clues, ocr_token_usage = await self._extract_ocr_clues(
                    state["request"],
                    writer,
                )
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
            "token_usage": _merge_state_token_usage(state, ocr_token_usage),
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
        knowledge_base_citation_audit = list(state.get("knowledge_base_citation_audit", []))
        if knowledge_base_scope and not knowledge_base_context:
            _emit_tool_call(
                writer,
                name="retrieve_knowledge_base",
                status="processing",
                message=f"scope={knowledge_base_scope}",
            )
            try:
                knowledge_service = get_knowledge_base_service()
                retrieved_chunk_count = 0
                if hasattr(knowledge_service, "retrieve_chunks"):
                    knowledge_documents = knowledge_service.retrieve_chunks(
                        state.get("user_id") or "",
                        knowledge_base_scope,
                        request.message,
                    )
                    retrieved_chunk_count = len(knowledge_documents)
                    knowledge_base_context = _build_knowledge_base_context_from_documents(
                        knowledge_documents,
                    ).strip()
                    knowledge_base_citation_audit = _build_citation_audit_from_documents(
                        knowledge_documents,
                    )
                else:  # pragma: no cover - backward compatibility path
                    retrieve_context = knowledge_service.retrieve_context
                    if len(inspect.signature(retrieve_context).parameters) >= 4:
                        knowledge_base_context = str(
                            retrieve_context(
                                state.get("user_id") or "",
                                knowledge_base_scope,
                                request.message,
                            )
                            or ""
                        ).strip()
                    else:
                        knowledge_base_context = str(
                            retrieve_context(
                                knowledge_base_scope,
                                request.message,
                            )
                            or ""
                        ).strip()
                    knowledge_base_context = _ensure_knowledge_base_context_has_source_registry(
                        knowledge_base_context,
                    )
                    retrieved_chunk_count = len(
                        [section for section in knowledge_base_context.split("\n\n") if section.strip()]
                    )
                    knowledge_base_citation_audit = []
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
                logger.info(
                    "RAG Activated for user %s, scope %s, retrieved %s chunks",
                    state.get("user_id") or "",
                    knowledge_base_scope,
                    retrieved_chunk_count,
                )
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
        artifact_fallback_reason: str | None = None
        draft_token_usage: dict[str, int] = {}

        async for event in self.inner_provider.generate_stream(
            adapted_request,
            db=state.get("db"),
            thread=None,
            user_id=state.get("user_id"),
        ):
            event_name = str(event.get("event", ""))

            if event_name in {"start", "tool_call"}:
                continue

            if event_name == "done":
                draft_token_usage = merge_model_token_usage(
                    draft_token_usage,
                    event.get("token_usage"),
                )
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
                if _is_retryable_provider_error(event):
                    logger.warning(
                        "langgraph transient provider error captured thread_id=%s code=%s retry_count=%s",
                        state["request"].thread_id,
                        event.get("code"),
                        state.get("retry_count", 0),
                    )
                    continue
                if _should_gracefully_degrade_provider_error(
                    event,
                    current_draft="".join(draft_parts),
                    artifact_candidate=latest_artifact,
                ):
                    artifact_fallback_reason = "provider_structuring_error"
                    logger.warning(
                        "langgraph provider structuring error degraded thread_id=%s code=%s",
                        state["request"].thread_id,
                        event.get("code"),
                    )
                else:
                    writer({"payload": event})

        return {
            "current_draft": "".join(draft_parts),
            "artifact_candidate": latest_artifact,
            "error": latest_error,
            "messages": updated_messages,
            "knowledge_base_scope": knowledge_base_scope,
            "knowledge_base_context": knowledge_base_context,
            "knowledge_base_citation_audit": knowledge_base_citation_audit,
            "artifact_fallback_reason": artifact_fallback_reason,
            "token_usage": _merge_state_token_usage(state, draft_token_usage),
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
                result = await execute_business_tool_async(tool_name, tool_args)
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
            if _is_retryable_provider_error(state.get("error")):
                retry_count = state.get("retry_count", 0)
                provider_error_text = _format_provider_error_for_validation(state.get("error"))
                if retry_count < 2:
                    retry_delay_seconds = _resolve_retryable_provider_delay_seconds(
                        state.get("error"),
                        retry_count=retry_count,
                    )
                    _emit_tool_call(
                        writer,
                        name="review_draft",
                        status="retry",
                        message=(
                            "模型生成过程中发生网络抖动，系统正在自动重试。"
                            if retry_delay_seconds <= 0
                            else f"模型生成过程中发生网络抖动，系统将在 {retry_delay_seconds:.0f} 秒后自动重试。"
                        ),
                    )
                    if retry_delay_seconds > 0:
                        await asyncio.sleep(retry_delay_seconds)
                    return await self._build_review_exit_update(
                        state,
                        next_route="generate_draft_node",
                        current_step="review:provider_retry",
                        extra_updates={
                            "retry_count": retry_count + 1,
                            "error": None,
                            "current_draft": "",
                            "artifact_candidate": None,
                            "artifact_fallback_reason": None,
                        },
                    )

                if state.get("current_draft", "").strip():
                    merged_issues = _merge_validation_errors(
                        state.get("validation_errors", []),
                        [provider_error_text] if provider_error_text else [],
                    )
                    _emit_tool_call(
                        writer,
                        name="review_draft",
                        status="max_retries",
                        message="模型生成网络异常且已达到重试上限，当前将保留已生成正文并降级整理产物。",
                    )
                    _stream_message_chunks(writer, state.get("current_draft", ""))
                    return await self._build_review_exit_update(
                        state,
                        next_route="format_artifact_node",
                        current_step="review:provider_retry_exhausted_fallback",
                        extra_updates={
                            "validation_errors": merged_issues,
                            "error": None,
                            "artifact_fallback_reason": state.get("artifact_fallback_reason")
                            or "provider_stream_retry_exhausted",
                        },
                    )

                _emit_tool_call(
                    writer,
                    name="review_draft",
                    status="max_retries",
                    message="模型生成网络异常且已达到重试上限，本次任务未能完成。",
                )
                writer({"payload": state["error"]})
                return await self._build_review_exit_update(
                    state,
                    next_route="format_artifact_node",
                    current_step="review:provider_retry_exhausted",
                )

            if _should_gracefully_degrade_provider_error(
                state.get("error"),
                current_draft=state.get("current_draft", ""),
                artifact_candidate=state.get("artifact_candidate"),
            ):
                provider_error_text = _format_provider_error_for_validation(state.get("error"))
                merged_issues = _merge_validation_errors(
                    state.get("validation_errors", []),
                    [provider_error_text] if provider_error_text else [],
                )
                _emit_tool_call(
                    writer,
                    name="review_draft",
                    status="fallback",
                    message="结构化结果校验失败，已保留正文并降级为基础产物。",
                )
                _stream_message_chunks(writer, state.get("current_draft", ""))
                return await self._build_review_exit_update(
                    state,
                    next_route="format_artifact_node",
                    current_step="review:provider_error_fallback",
                    extra_updates={
                        "validation_errors": merged_issues,
                        "error": None,
                        "artifact_fallback_reason": state.get("artifact_fallback_reason")
                        or "provider_structuring_error",
                    },
                )

            _emit_tool_call(writer, name="review_draft", status="skipped")
            return await self._build_review_exit_update(
                state,
                next_route="format_artifact_node",
                current_step="review:skipped",
            )

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
                return await self._build_review_exit_update(
                    state,
                    next_route="generate_draft_node",
                    current_step="review:retry",
                    extra_updates={
                        "validation_errors": merged_issues,
                        "retry_count": retry_count + 1,
                    },
                )

            _emit_tool_call(writer, name="review_draft", status="max_retries")
            _stream_message_chunks(writer, state.get("current_draft", ""))
            return await self._build_review_exit_update(
                state,
                next_route="format_artifact_node",
                current_step="review:max_retries",
                extra_updates={"validation_errors": merged_issues},
            )

        _emit_tool_call(writer, name="review_draft", status="passed")
        _stream_message_chunks(writer, state.get("current_draft", ""))
        return await self._build_review_exit_update(
            state,
            next_route="format_artifact_node",
            current_step="review:passed",
        )

    async def _build_review_exit_update(
        self,
        state: GraphState,
        *,
        next_route: str,
        current_step: str,
        extra_updates: dict[str, object] | None = None,
    ) -> GraphState:
        updates: GraphState = dict(extra_updates or {})
        updates["next_route"] = next_route
        updates["current_step"] = current_step
        if next_route == "format_artifact_node":
            remaining_plan = _pop_execution_step(
                state.get("execution_plan"),
                expected_step=EXECUTION_STEP_DRAFT_CONTENT,
            )
            should_append_image_step = EXECUTION_STEP_GENERATE_IMAGE not in remaining_plan
            if should_append_image_step and (await self._decide_image_route(state)).needs_image:
                remaining_plan.append(EXECUTION_STEP_GENERATE_IMAGE)
            updates["execution_plan"] = remaining_plan
            updates["active_execution_step"] = remaining_plan[0] if remaining_plan else ""
            updates["needs_image"] = bool(state.get("needs_image", False)) or (
                EXECUTION_STEP_GENERATE_IMAGE in remaining_plan
            )
        else:
            updates["needs_image"] = bool(state.get("needs_image", False))
        return updates

    def _route_after_review(self, state: GraphState) -> str:
        next_route = state.get("next_route", "format_artifact_node")
        logger.info(
            "langgraph route=after_review thread_id=%s next=%s execution_plan=%s needs_image=%s",
            state["request"].thread_id,
            next_route,
            state.get("execution_plan", []),
            state.get("needs_image", False),
        )
        return next_route

    def _route_after_format_artifact(self, state: GraphState) -> str:
        next_execution_step = _get_current_execution_step(state)
        if next_execution_step == EXECUTION_STEP_GENERATE_IMAGE:
            logger.info(
                "langgraph route=after_format_artifact thread_id=%s next=%s execution_plan=%s",
                state["request"].thread_id,
                "generate_image_node",
                state.get("execution_plan", []),
            )
            return "generate_image_node"

        logger.info(
            "langgraph route=after_format_artifact thread_id=%s next=%s execution_plan=%s",
            state["request"].thread_id,
            "end",
            state.get("execution_plan", []),
        )
        return "end"

    async def _generate_image_node(self, state: GraphState) -> GraphState:
        request = state["request"]
        user_role = str((state.get("user_context") or {}).get("role") or "user").strip().lower()
        direct_image_mode = bool(state.get("direct_image_mode"))
        image_step_updates = _complete_execution_step_updates(
            state,
            expected_step=EXECUTION_STEP_GENERATE_IMAGE,
        )
        if not state.get("needs_image", False) or not _is_image_generation_eligible(state):
            return {
                "current_step": "generate_image:ineligible",
                **image_step_updates,
            }

        writer = get_stream_writer()
        if not self._is_image_generation_available(user_role=user_role):
            return {
                "current_step": "generate_image:disabled",
                **image_step_updates,
            }

        if self.image_generator is not None:
            logger.info(
                "langgraph node=generate_image thread_id=%s backend=custom model=<injected>",
                request.thread_id,
            )
        else:
            logger.info(
                "langgraph node=generate_image thread_id=%s user_role=%s backend=%s model=%s",
                request.thread_id,
                user_role or "user",
                self.image_service.resolve_backend(user_role=user_role),
                self.image_service.resolve_model(user_role=user_role) or "<unset>",
            )

        draft_text = state.get("current_draft", "").strip() or str(
            (state.get("artifact_candidate") or {}).get("body", ""),
        ).strip()
        if not draft_text:
            draft_text = _resolve_image_prompt_seed_text(state)
        if not draft_text:
            return {
                "current_step": "generate_image:no_draft",
                **image_step_updates,
            }

        _emit_tool_call(
            writer,
            name="build_image_prompt",
            status="processing",
            message="正在提炼图片提示词..." if direct_image_mode else "正在提炼封面配图提示词...",
        )
        try:
            prompt = await self._build_image_prompt_for_state(state)
        except asyncio.CancelledError:
            logger.info(
                "Image prompt generation cancelled thread_id=%s user_role=%s",
                request.thread_id,
                user_role or "user",
            )
            raise
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning(
                "Image prompt generation failed for thread_id=%s: %s",
                request.thread_id,
                exc,
            )
            _emit_tool_call(
                writer,
                name="build_image_prompt",
                status="failed",
                message=(
                    f"图片提示词生成失败，请稍后重试：{exc}"
                    if direct_image_mode
                    else f"配图提示词生成失败，已跳过配图：{exc}"
                ),
            )
            return {
                "current_step": "generate_image:prompt_failed",
                **image_step_updates,
            }

        if not prompt.strip():
            _emit_tool_call(
                writer,
                name="build_image_prompt",
                status="skipped",
                message=(
                    "未生成有效的图片提示词，本次无法继续渲染。"
                    if direct_image_mode
                    else "未生成有效的配图提示词，已继续交付正文。"
                ),
            )
            return {
                "current_step": "generate_image:prompt_skipped",
                **image_step_updates,
            }

        _emit_tool_call(
            writer,
            name="build_image_prompt",
            status="completed",
            message="图片提示词已准备完成。" if direct_image_mode else "封面配图提示词已准备完成。",
        )
        generate_image_status_message = "正在生成内容配图..."
        if direct_image_mode:
            _stream_message_chunks(
                writer,
                _build_direct_image_preview_message(prompt),
                chunk_size=84,
            )
            initial_progress_message, initial_progress_percent = _build_image_progress_state(0.0)
            _emit_artifact(
                writer,
                _build_processing_image_artifact(
                    request=request,
                    prompt=prompt,
                    image_prompt_seed=draft_text,
                    progress_message=initial_progress_message,
                    progress_percent=initial_progress_percent,
                ),
            )
            generate_image_status_message = initial_progress_message
        _emit_tool_call(
            writer,
            name="generate_cover_images",
            status="processing",
            message=generate_image_status_message,
        )

        image_task = asyncio.create_task(
            self._generate_images_for_state(
                state,
                prompt=prompt,
            ),
        )
        loop = asyncio.get_running_loop()
        image_started_at = loop.time()
        try:
            while True:
                try:
                    generated_images = await asyncio.wait_for(
                        asyncio.shield(image_task),
                        timeout=IMAGE_PROGRESS_HEARTBEAT_SECONDS,
                    )
                    break
                except asyncio.TimeoutError:
                    elapsed_seconds = loop.time() - image_started_at
                    progress_message, progress_percent = _build_image_progress_state(
                        elapsed_seconds,
                    )
                    _emit_tool_call(
                        writer,
                        name="generate_cover_images",
                        status="processing",
                        message=progress_message,
                    )
                    if direct_image_mode:
                        _emit_artifact(
                            writer,
                            _build_processing_image_artifact(
                                request=request,
                                prompt=prompt,
                                image_prompt_seed=draft_text,
                                progress_message=progress_message,
                                progress_percent=progress_percent,
                            ),
                        )
        except asyncio.CancelledError:
            image_task.cancel()
            with suppress(asyncio.CancelledError):
                await image_task
            logger.info(
                "Image generation cancelled thread_id=%s user_role=%s",
                request.thread_id,
                user_role or "user",
            )
            raise
        except Exception as exc:  # pragma: no cover - provider fallback
            logger.warning(
                "Image generation failed for thread_id=%s: %s",
                request.thread_id,
                exc,
            )
            _emit_tool_call(
                writer,
                name="generate_cover_images",
                status="failed",
                message=(
                    f"图片生成失败，本次未返回可用结果：{exc}"
                    if direct_image_mode
                    else f"配图生成失败，正文已继续交付：{exc}"
                ),
            )
            return {
                "image_generation_prompt": prompt,
                "generated_images": [],
                "current_step": "generate_image:failed",
                **image_step_updates,
            }

        if not generated_images:
            _emit_tool_call(
                writer,
                name="generate_cover_images",
                status="skipped",
                message=(
                    "当前未生成到可用图片，可稍后重试或更换一种视觉风格。"
                    if direct_image_mode
                    else "当前未生成到可用配图，已继续交付正文。"
                ),
            )
            return {
                "image_generation_prompt": prompt,
                "generated_images": [],
                "current_step": "generate_image:empty",
                **image_step_updates,
            }

        _emit_tool_call(
            writer,
            name="generate_cover_images",
            status="completed",
            message=f"已生成 {len(generated_images)} 张内容配图。",
        )
        return {
            "image_generation_prompt": prompt,
            "generated_images": generated_images,
            "current_step": "generate_image:completed",
            **image_step_updates,
        }

    def _is_image_generation_available(self, *, user_role: str | None = None) -> bool:
        return self.image_generator is not None or self.image_service.is_enabled(
            user_role=user_role,
        )

    async def _build_image_prompt_for_state(self, state: GraphState) -> str:
        request = state["request"]
        builder = self.image_prompt_builder or self.image_service.build_prompt
        prompt = builder(
            request=request,
            draft=_resolve_image_prompt_seed_text(state),
            artifact_candidate=state.get("artifact_candidate"),
        )
        if inspect.isawaitable(prompt):
            prompt = await prompt
        return str(prompt or "").strip()

    async def _generate_images_for_state(
        self,
        state: GraphState,
        *,
        prompt: str,
    ) -> list[str]:
        request = state["request"]
        generator = self.image_generator or self.image_service.generate_images
        generator_kwargs: dict[str, object] = {
            "request": request,
            "prompt": prompt,
            "user_id": state.get("user_id"),
            "thread_id": request.thread_id,
        }
        try:
            generator_signature = inspect.signature(generator)
        except (TypeError, ValueError):
            generator_signature = None
        if generator_signature is None:
            generator_kwargs["user_role"] = state.get("user_role")
        else:
            parameters = generator_signature.parameters
            if "user_role" in parameters or any(
                parameter.kind == inspect.Parameter.VAR_KEYWORD
                for parameter in parameters.values()
            ):
                generator_kwargs["user_role"] = state.get("user_role")

        generated_images = generator(**generator_kwargs)
        if inspect.isawaitable(generated_images):
            generated_images = await generated_images

        normalized_urls: list[str] = []
        for item in generated_images or []:
            normalized = str(item or "").strip()
            if normalized:
                normalized_urls.append(normalized)
        return normalized_urls

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
        artifact_fallback_reason = str(state.get("artifact_fallback_reason") or "").strip()
        generated_images = _normalize_generated_images(state.get("generated_images"))
        image_prompt = str(state.get("image_generation_prompt") or "").strip()
        image_prompt_seed = _resolve_image_prompt_seed_text(state)
        citation_audit = _normalize_citation_audit_payload(
            state.get("knowledge_base_citation_audit", []),
        )

        candidate = state.get("artifact_candidate")
        if isinstance(candidate, dict):
            try:
                artifact = _validate_artifact_candidate(request, candidate)
                artifact_payload = artifact.model_dump(mode="json")
                if artifact_payload.get("artifact_type") in {"content_draft", "image_result"}:
                    artifact_payload["generated_images"] = _merge_generated_images(
                        artifact_payload.get("generated_images"),
                        generated_images,
                    )
                    if image_prompt:
                        artifact_payload["revised_prompt"] = image_prompt
                    if image_prompt_seed:
                        artifact_payload["original_prompt"] = image_prompt_seed
                if artifact_payload.get("artifact_type") == "image_result":
                    artifact_payload["prompt"] = (
                        image_prompt
                        or str(artifact_payload.get("prompt", "")).strip()
                        or image_prompt_seed
                    )
                    artifact_payload["status"] = "completed"
                    artifact_payload["progress_message"] = None
                    artifact_payload["progress_percent"] = None
            except ValidationError as exc:
                validation_errors.append(str(exc))
                _emit_tool_call(writer, name="format_artifact", status="fallback")

        if artifact_payload is None:
            if artifact_fallback_reason:
                _emit_tool_call(
                    writer,
                    name="format_artifact",
                    status="fallback",
                    message="结构化结果不可用，已保留原始正文并降级渲染。",
                )
            artifact = _build_fallback_artifact(
                request=request,
                draft=state.get("current_draft", ""),
                materials_parsed=state.get("materials_parsed", []),
                degraded_from_provider_error=bool(artifact_fallback_reason),
                generated_images=generated_images,
                direct_image_mode=bool(state.get("direct_image_mode")),
                image_prompt=image_prompt,
                image_prompt_seed=image_prompt_seed,
            )
            artifact_payload = artifact.model_dump(mode="json")

        if artifact_payload.get("artifact_type") in {"content_draft", "image_result"}:
            artifact_payload["generated_images"] = _merge_generated_images(
                artifact_payload.get("generated_images"),
                generated_images,
            )
            if image_prompt:
                artifact_payload["revised_prompt"] = image_prompt
            if image_prompt_seed:
                artifact_payload["original_prompt"] = image_prompt_seed
            if artifact_payload.get("artifact_type") == "image_result":
                artifact_payload["prompt"] = (
                    image_prompt
                    or str(artifact_payload.get("prompt", "")).strip()
                    or image_prompt_seed
                )
                artifact_payload["status"] = "completed"
                artifact_payload["progress_message"] = None
                artifact_payload["progress_percent"] = None

        if citation_audit:
            artifact_payload["citation_audit"] = citation_audit

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

    async def _decide_image_route(self, state: GraphState) -> ImageRouteDecision:
        if not _is_image_generation_eligible(state):
            return ImageRouteDecision(needs_image=False)

        request = state["request"]
        artifact_candidate = state.get("artifact_candidate")
        normalized_candidate = artifact_candidate if isinstance(artifact_candidate, dict) else None
        draft_text = state.get("current_draft", "").strip() or str(
            (normalized_candidate or {}).get("body", ""),
        ).strip()

        if self.image_route_analyzer is not None:
            result = await self.image_route_analyzer(
                request,
                draft_text,
                normalized_candidate,
            )
            return _coerce_image_route_decision(result, state)

        try:
            return await self._request_image_route_decision(
                state,
                draft_text=draft_text,
                artifact_candidate=normalized_candidate,
            )
        except Exception as exc:  # pragma: no cover - defensive fallback
            logger.warning(
                "Image route LLM decision failed for thread_id=%s, falling back to heuristic: %s",
                request.thread_id,
                exc,
            )
            return _build_heuristic_image_route_decision(state)

    async def _request_image_route_decision(
        self,
        state: GraphState,
        *,
        draft_text: str,
        artifact_candidate: dict[str, object] | None,
    ) -> ImageRouteDecision:
        if isinstance(self.inner_provider, CompatibleLLMProvider):
            if not self.inner_provider.api_key or not self.inner_provider.base_url:
                return _build_heuristic_image_route_decision(state)
            client = self.inner_provider._get_client()
            model = self.inner_provider.model
            timeout = self.inner_provider.request_timeout
        elif isinstance(self.inner_provider, OpenAIProvider):
            if not self.inner_provider.api_key:
                return _build_heuristic_image_route_decision(state)
            client = self.inner_provider._get_client()
            model = self.inner_provider.model
            timeout = self.inner_provider.request_timeout
        else:
            return _build_heuristic_image_route_decision(state)

        request = state["request"]
        review_prompt = _resolve_review_prompt(state)
        image_material_count = sum(
            1 for material in request.materials if material.type == MaterialType.IMAGE
        )
        material_summaries = [
            (
                f"- {material.type.value}: "
                f"{(material.text or '').strip()[:120] or (material.url or '').strip()[:120]}"
            )
            for material in request.materials[:3]
        ]
        generated_image_count = len(
            _normalize_generated_images(
                (artifact_candidate or {}).get("generated_images"),
            )
        )
        draft_preview = draft_text[:1200]
        title_preview = str((artifact_candidate or {}).get("title", "")).strip()[:200]

        messages = [
            {"role": "system", "content": _build_image_route_decision_system_prompt()},
            {
                "role": "user",
                "content": (
                    f"task_type: {request.task_type.value}\n"
                    f"platform: {request.platform.value}\n"
                    f"user_request: {request.message}\n"
                    f"review_prompt: {review_prompt}\n"
                    f"material_count: {len(request.materials)}\n"
                    f"image_material_count: {image_material_count}\n"
                    f"generated_image_count: {generated_image_count}\n"
                    f"artifact_title: {title_preview}\n"
                    f"draft_preview:\n{draft_preview}\n"
                    "material_preview:\n"
                    + ("\n".join(material_summaries) if material_summaries else "<none>")
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
            return _build_heuristic_image_route_decision(state)
        return _coerce_image_route_decision(content, state)

    async def _extract_ocr_clues(
        self,
        request: MediaChatRequest,
        writer,
    ) -> tuple[list[str], dict[str, int]]:
        if self.vision_analyzer is not None:
            return await self.vision_analyzer(request), {}

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
            return [], {}

        image_materials = [
            material for material in request.materials if material.type == MaterialType.IMAGE
        ]
        if not image_materials:
            return [], {}

        clues: list[str] = []
        token_usage: dict[str, int] = {}
        for index, material in enumerate(image_materials, start=1):
            try:
                prompt_content = await self._build_vision_prompt_content(material)
                response_text, response_token_usage = await self._request_vision_analysis(
                    prompt_content,
                )
                token_usage = merge_model_token_usage(token_usage, response_token_usage)
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

        return clues, token_usage

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
    ) -> tuple[str, dict[str, int]]:
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
        return (
            content.strip(),
            build_model_token_usage(
                getattr(response, "model", self.vision_model) or self.vision_model,
                extract_total_tokens(getattr(response, "usage", None)),
            ),
        )


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


def _emit_artifact(writer, artifact_payload: dict[str, object]) -> None:
    writer(
        {
            "payload": {
                "event": "artifact",
                "artifact": artifact_payload,
            }
        }
    )


def _build_direct_image_preview_message(prompt: str) -> str:
    return (
        "已为你整理出一版可直接渲染的美术方案：\n"
        f"{prompt.strip()}\n\n"
        "下方会先显示渲染占位图，旗舰图像引擎完成后会自动替换成真实图片。"
    )


def _build_image_progress_state(elapsed_seconds: float) -> tuple[str, int]:
    progress_percent = max(
        12,
        min(96, round((max(0.0, elapsed_seconds) / 120.0) * 84) + 12),
    )
    if elapsed_seconds < 20:
        return (
            "云端 GPU 正在分配算力，马上开始渲染首版画面。",
            progress_percent,
        )
    if elapsed_seconds < 60:
        return (
            "正在渲染光影、主体和构图细节，旗舰精绘模式通常需要 1-2 分钟。",
            progress_percent,
        )
    if elapsed_seconds < 100:
        return (
            "正在补全材质、氛围与版式层次，请再稍候片刻。",
            progress_percent,
        )
    return (
        "仍在进行高质量渲染，我们会优先等待旗舰结果返回。",
        progress_percent,
    )


def _build_processing_image_artifact(
    *,
    request: MediaChatRequest,
    prompt: str,
    image_prompt_seed: str,
    progress_message: str,
    progress_percent: int,
) -> dict[str, object]:
    request_summary = _compact_display_text(request.message, limit=42) or "图片生成结果"
    resolved_original_prompt = image_prompt_seed.strip() or request.message.strip()
    artifact = ImageGenerationArtifactPayload(
        title=request_summary,
        prompt=prompt.strip() or resolved_original_prompt or "图片生成中",
        generated_images=[],
        original_prompt=resolved_original_prompt or None,
        revised_prompt=prompt.strip() or None,
        status="processing",
        progress_message=progress_message,
        progress_percent=progress_percent,
    )
    return artifact.model_dump(mode="json")


def _merge_state_token_usage(
    state: GraphState,
    additional_usage: object,
) -> dict[str, int]:
    return merge_model_token_usage(
        state.get("token_usage"),
        additional_usage,
    )


def _escape_context_attribute(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _resolve_material_source_name(material: MaterialInput) -> str:
    display_name = material.text.strip()
    if display_name:
        return display_name

    raw_url = (material.url or "").strip()
    if not raw_url:
        return "未命名素材"

    normalized_reference = normalize_storage_reference(raw_url)
    if normalized_reference and not (
        normalized_reference.startswith("http://")
        or normalized_reference.startswith("https://")
    ):
        _, object_key = parse_stored_file_path(normalized_reference)
        candidate = Path(unquote(object_key)).name
        if candidate:
            return candidate

    parsed = urlparse(raw_url)
    candidate = Path(unquote(parsed.path or raw_url)).name
    return candidate or "未命名素材"


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
            MaterialType.AUDIO_URL: "音频素材",
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
            "请务必基于以上独家知识进行创作，切勿使用通用废话！\n"
            "当你使用上述知识库信息时，必须在对应句子末尾使用方括号来源编号引用，例如 [1]。\n"
            "如果多条知识片段来自同一份资料，请沿用同一个来源编号，不要杜撰新的编号或来源。\n"
            "回答结尾必须追加“参考资料：”小节，并逐行列出本次实际引用过的来源编号与文件名，例如：[1] 品牌手册.docx。"
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


def _build_image_route_decision_system_prompt() -> str:
    return (
        "You are an intent router for a multimodal publishing workflow.\n"
        "Decide whether the system should trigger NEW image generation after the draft review step.\n"
        "Return only a JSON object with one boolean field: needs_image.\n"
        "Set needs_image to true only when the user clearly wants a newly generated image, cover, "
        "illustration, poster, thumbnail, or a publish-ready visual asset.\n"
        "Set needs_image to false for translation, rewriting, proofreading, Q&A, calculations, "
        "summaries, analysis, comment replies, or other text-only editing tasks.\n"
        "If the user already supplied enough images and did not ask for a new generated image, prefer false.\n"
        "Be conservative. If uncertain, return false."
    )


def _should_bypass_to_direct_image_generation(
    request: MediaChatRequest,
    *,
    routing_resolution=None,
) -> bool:
    return should_route_to_direct_image_generation(
        request,
        resolution=routing_resolution,
    )

    if request.task_type != TaskType.CONTENT_GENERATION:
        return False

    normalized_message = " ".join(request.message.strip().lower().split())
    if not normalized_message:
        return False

    explicit_negative_keywords = (
        "不要图片",
        "无需配图",
        "只要文案",
        "纯文字",
        "text only",
        "no image",
        "no images",
        "without image",
    )
    if any(keyword in normalized_message for keyword in explicit_negative_keywords):
        return False

    direct_only_keywords = (
        "只要图片",
        "只要海报",
        "只要封面",
        "只出图",
        "只做图",
        "纯出图",
        "直接出图",
        "直接生成图片",
        "不要文案",
        "无需文案",
        "不要正文",
        "无需正文",
        "不要文章",
        "image only",
        "poster only",
    )
    if any(keyword in normalized_message for keyword in direct_only_keywords):
        return True

    text_generation_keywords = (
        "写一篇",
        "写一段",
        "文案",
        "正文",
        "草稿",
        "文章",
        "口播",
        "改写",
        "翻译",
        "评论",
        "回复",
        "选题",
        "分析",
        "拆解",
        "脚本",
        "图文",
        "内容",
        "润色",
        "总结",
        "提纲",
    )
    if any(keyword in normalized_message for keyword in text_generation_keywords):
        return False

    direct_image_patterns = (
        r"(帮我|请|直接)?(画|做|出|生成|设计)(一张|1张|个|幅)?(图片|图|海报|封面|封面图|宣传图|主视觉)",
        r"(请|帮我|直接)?(生成|做|出)(一张|1张)?(poster|cover|thumbnail|image)",
    )
    if any(re.search(pattern, normalized_message) for pattern in direct_image_patterns):
        return True

    direct_image_keywords = (
        "海报",
        "宣传图",
        "主视觉",
        "封面图",
        "poster",
        "thumbnail",
        "cover image",
    )
    if any(keyword in normalized_message for keyword in direct_image_keywords):
        supplemental_keywords = ("配图", "带图", "图文", "封面配图", "插图")
        return not any(keyword in normalized_message for keyword in supplemental_keywords)

    return False


def _resolve_image_prompt_seed_text(state: GraphState) -> str:
    artifact_candidate = state.get("artifact_candidate")
    if isinstance(artifact_candidate, dict):
        candidate_body = str(artifact_candidate.get("body", "")).strip()
        if candidate_body:
            return candidate_body

    current_draft = str(state.get("current_draft", "")).strip()
    if current_draft:
        return current_draft

    if not state.get("direct_image_mode"):
        return ""

    request = state["request"]
    base_message = request.message.strip()
    ocr_clues = [str(item).strip() for item in state.get("ocr_clues", []) if str(item).strip()]
    if not ocr_clues:
        return base_message

    joined_clues = "\n".join(f"- {clue}" for clue in ocr_clues[:3])
    return f"{base_message}\n参考素材线索：\n{joined_clues}".strip()


def _normalize_execution_plan(raw_plan: object) -> list[str]:
    normalized_plan: list[str] = []
    for item in raw_plan if isinstance(raw_plan, list) else []:
        normalized = str(item or "").strip()
        if normalized:
            normalized_plan.append(normalized)
    return normalized_plan


def _get_current_execution_step(state: GraphState) -> str:
    active_step = str(state.get("active_execution_step", "") or "").strip()
    if active_step:
        return active_step

    execution_plan = _normalize_execution_plan(state.get("execution_plan"))
    return execution_plan[0] if execution_plan else ""


def _pop_execution_step(
    raw_plan: object,
    *,
    expected_step: str | None = None,
) -> list[str]:
    execution_plan = _normalize_execution_plan(raw_plan)
    if not execution_plan:
        return []

    if expected_step and execution_plan[0] != expected_step:
        return execution_plan

    return execution_plan[1:]


def _complete_execution_step_updates(
    state: GraphState,
    *,
    expected_step: str,
) -> GraphState:
    remaining_plan = _pop_execution_step(
        state.get("execution_plan"),
        expected_step=expected_step,
    )
    return {
        "execution_plan": remaining_plan,
        "active_execution_step": remaining_plan[0] if remaining_plan else "",
    }


def _build_router_execution_plan(request: MediaChatRequest) -> list[str]:
    if request.task_type == TaskType.IMAGE_GENERATION:
        return [EXECUTION_STEP_GENERATE_IMAGE]

    execution_plan = [EXECUTION_STEP_DRAFT_CONTENT]
    preview_state: GraphState = {
        "request": request,
        "current_draft": request.message,
        "generated_images": [],
        "artifact_candidate": None,
        "direct_image_mode": False,
    }
    if _build_heuristic_image_route_decision(preview_state).needs_image:
        execution_plan.append(EXECUTION_STEP_GENERATE_IMAGE)
    return execution_plan


def _is_image_generation_eligible(state: GraphState) -> bool:
    request = state["request"]
    if request.task_type not in {TaskType.CONTENT_GENERATION, TaskType.IMAGE_GENERATION}:
        return False
    if request.platform not in {Platform.XIAOHONGSHU, Platform.DOUYIN}:
        return False

    existing_generated_images = _normalize_generated_images(state.get("generated_images"))
    if existing_generated_images:
        return False

    artifact_candidate = state.get("artifact_candidate")
    if isinstance(artifact_candidate, dict) and _normalize_generated_images(
        artifact_candidate.get("generated_images"),
    ):
        return False

    draft_text = _resolve_image_prompt_seed_text(state)
    return bool(draft_text)


def _build_heuristic_image_route_decision(state: GraphState) -> ImageRouteDecision:
    if not _is_image_generation_eligible(state):
        return ImageRouteDecision(needs_image=False)

    request = state["request"]
    message = request.message.strip().lower()
    explicit_negative_keywords = (
        "不要配图",
        "无需配图",
        "无图",
        "纯文字",
        "只要文案",
        "不要图片",
        "text only",
        "no image",
        "no images",
        "without image",
    )
    if any(keyword in message for keyword in explicit_negative_keywords):
        return ImageRouteDecision(needs_image=False)

    explicit_positive_keywords = (
        "配图",
        "图文",
        "带图",
        "封面",
        "首图",
        "插图",
        "海报",
        "画图",
        "出图",
        "生成图片",
        "生成一张图",
        "配一张图",
        "illustration",
        "cover",
        "thumbnail",
        "poster",
        "generate image",
        "draw",
    )
    if any(keyword in message for keyword in explicit_positive_keywords):
        return ImageRouteDecision(needs_image=True)

    image_material_count = sum(
        1 for material in request.materials if material.type == MaterialType.IMAGE
    )
    if image_material_count > 0:
        return ImageRouteDecision(needs_image=False)

    return ImageRouteDecision(needs_image=False)


def _coerce_image_route_decision(
    payload: ImageRouteDecision | dict[str, object] | str,
    state: GraphState,
) -> ImageRouteDecision:
    if isinstance(payload, ImageRouteDecision):
        decision = payload
    elif isinstance(payload, str):
        try:
            decision = ImageRouteDecision.model_validate_json(payload)
        except ValidationError:
            decision = ImageRouteDecision.model_validate(json.loads(payload))
    else:
        decision = ImageRouteDecision.model_validate(payload)

    if not _is_image_generation_eligible(state):
        return ImageRouteDecision(needs_image=False)

    return ImageRouteDecision(needs_image=decision.needs_image)


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


def _build_knowledge_base_context_from_documents(
    documents: list[object],
) -> str:
    if not documents:
        return ""

    source_index_map: dict[str, int] = {}
    chunk_sections: list[str] = []

    for document in documents:
        source_name = str(getattr(document, "source", "") or "").strip() or "uploaded_text"
        chunk_text = str(getattr(document, "text", "") or "").strip()
        if not chunk_text:
            continue

        source_index = source_index_map.setdefault(source_name, len(source_index_map) + 1)
        relevance_score = _coerce_relevance_score(getattr(document, "relevance_score", 0.0))
        score_label = f"{round(relevance_score * 100)}% 相关度"
        chunk_sections.append(f"[{source_index}] ({source_name}) {score_label}。{chunk_text}")

    if not chunk_sections:
        return ""

    reference_lines = [
        f"[{index}] {source_name}"
        for source_name, index in sorted(source_index_map.items(), key=lambda item: item[1])
    ]

    return (
        "【知识片段】\n"
        + "\n\n".join(chunk_sections)
        + "\n\n【引用来源】\n"
        + "\n".join(reference_lines)
    ).strip()


def _coerce_relevance_score(value: object) -> float:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return 0.0
    return round(max(0.0, min(1.0, score)), 4)


def _build_citation_audit_from_documents(
    documents: list[object],
) -> list[dict[str, object]]:
    source_index_map: dict[str, int] = {}
    audit_items: list[dict[str, object]] = []

    for document in documents:
        source_name = str(getattr(document, "source", "") or "").strip() or "uploaded_text"
        chunk_text = str(getattr(document, "text", "") or "").strip()
        if not chunk_text:
            continue

        citation_index = source_index_map.setdefault(source_name, len(source_index_map) + 1)
        audit_item = CitationAuditItem(
            citation_index=citation_index,
            source=source_name,
            snippet=chunk_text[:600],
            relevance_score=_coerce_relevance_score(
                getattr(document, "relevance_score", 0.0),
            ),
            chunk_index=max(0, int(getattr(document, "chunk_index", 0) or 0)),
            document_id=str(getattr(document, "document_id", "") or "") or None,
            scope=str(getattr(document, "scope", "") or "") or None,
        )
        audit_items.append(audit_item.model_dump(mode="json"))

    return audit_items


def _normalize_citation_audit_payload(raw_items: object) -> list[dict[str, object]]:
    if not isinstance(raw_items, list):
        return []

    normalized_items: list[dict[str, object]] = []
    for raw_item in raw_items:
        try:
            normalized_items.append(
                CitationAuditItem.model_validate(raw_item).model_dump(mode="json"),
            )
        except ValidationError:
            continue
    return normalized_items


def _ensure_knowledge_base_context_has_source_registry(context: str) -> str:
    normalized_context = context.strip()
    if not normalized_context:
        return ""

    if "【引用来源】" in normalized_context or "参考资料" in normalized_context:
        return normalized_context

    source_pairs = re.findall(r"\[(\d+)\]\s*\(([^)]+)\)", normalized_context)
    if not source_pairs:
        return normalized_context

    source_index_map: dict[str, str] = {}
    for index, source_name in source_pairs:
        normalized_source_name = source_name.strip()
        if normalized_source_name and normalized_source_name not in source_index_map:
            source_index_map[normalized_source_name] = index

    if not source_index_map:
        return normalized_context

    reference_lines = [
        f"[{index}] {source_name}"
        for source_name, index in sorted(
            source_index_map.items(),
            key=lambda item: int(item[1]) if item[1].isdigit() else 9999,
        )
    ]
    return normalized_context + "\n\n【引用来源】\n" + "\n".join(reference_lines)


def _validate_artifact_candidate(
    request: MediaChatRequest,
    candidate: dict[str, object],
) -> BaseModel:
    candidate_type = str(candidate.get("artifact_type", "")).strip()
    if candidate_type == "image_result":
        return ImageGenerationArtifactPayload.model_validate(candidate)
    if request.task_type == TaskType.TOPIC_PLANNING:
        return TopicPlanningArtifactPayload.model_validate(candidate)
    if request.task_type == TaskType.CONTENT_GENERATION:
        return ContentGenerationArtifactPayload.model_validate(candidate)
    if request.task_type == TaskType.IMAGE_GENERATION:
        return ImageGenerationArtifactPayload.model_validate(candidate)
    if request.task_type == TaskType.HOT_POST_ANALYSIS:
        return HotPostAnalysisArtifactPayload.model_validate(candidate)
    return CommentReplyArtifactPayload.model_validate(candidate)


def _normalize_generated_images(raw_urls: object) -> list[str]:
    if not isinstance(raw_urls, list):
        return []

    normalized_urls: list[str] = []
    for item in raw_urls:
        normalized = str(item or "").strip()
        if normalized:
            normalized_urls.append(normalized)
    return normalized_urls


def _merge_generated_images(existing: object, incoming: list[str]) -> list[str]:
    merged_urls: list[str] = []
    for source in (_normalize_generated_images(existing), incoming):
        for url in source:
            if url not in merged_urls:
                merged_urls.append(url)
    return merged_urls


def _compact_display_text(value: str, *, limit: int = 26) -> str:
    compact = " ".join(str(value or "").split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit].rstrip()}..."


def _build_fallback_artifact(
    *,
    request: MediaChatRequest,
    draft: str,
    materials_parsed: list[str],
    degraded_from_provider_error: bool = False,
    generated_images: list[str] | None = None,
    direct_image_mode: bool = False,
    image_prompt: str = "",
    image_prompt_seed: str = "",
) -> BaseModel:
    supporting_context = "；".join(materials_parsed[:2]) if materials_parsed else "无补充素材"

    if request.task_type == TaskType.IMAGE_GENERATION or direct_image_mode:
        request_summary = _compact_display_text(request.message, limit=42) or "图片生成结果"
        resolved_original_prompt = image_prompt_seed.strip() or request.message.strip()
        resolved_revised_prompt = image_prompt.strip()
        resolved_prompt = (
            resolved_revised_prompt
            or resolved_original_prompt
            or draft.strip()
            or request.message.strip()
        )
        return ImageGenerationArtifactPayload(
            title=request_summary,
            prompt=resolved_prompt,
            generated_images=list(generated_images or []),
            original_prompt=resolved_original_prompt or None,
            revised_prompt=resolved_revised_prompt or None,
            platform_cta="如果你愿意，我可以继续为这组图片补写发布文案，或调整整体视觉风格。",
        )

    if request.task_type == TaskType.TOPIC_PLANNING:
        return TopicPlanningArtifactPayload(
            title="内容选题池（格式降级）" if degraded_from_provider_error else "内容选题池",
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
            title=(
                "内容改写（格式降级）"
                if degraded_from_provider_error and "改写" in request.message
                else "内容草稿（格式降级）"
                if degraded_from_provider_error
                else "结构化内容草稿"
            ),
            title_candidates=[
                "别再把复盘写成流水账，读者真正想看到的是这 3 个结论",
                "同样是内容总结，为什么有的人能写出高收藏笔记",
                "一篇高质量复盘，关键不在文笔，而在结构有没有帮人做决定",
            ],
            body=body,
            platform_cta=(
                "当前结果来自格式降级兜底，如需更完整的结构化产物，建议切换更高级模型后重试。"
                if degraded_from_provider_error
                else "如果你愿意，我可以继续把这版草稿改写成小红书图文版或抖音口播版。"
            ),
            generated_images=list(generated_images or []),
        )

    if request.task_type == TaskType.HOT_POST_ANALYSIS:
        return HotPostAnalysisArtifactPayload(
            title="爆款内容拆解卡（格式降级）" if degraded_from_provider_error else "爆款内容拆解卡",
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
        title="评论回复建议（格式降级）" if degraded_from_provider_error else "评论回复建议",
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


RETRYABLE_PROVIDER_ERROR_CODES = {
    "PROVIDER_TRANSIENT_STREAM_ERROR",
}


GRACEFUL_ARTIFACT_ERROR_CODES = {
    "OPENAI_JSON_DECODE_ERROR",
    "OPENAI_ARTIFACT_VALIDATION_ERROR",
    "COMPATIBLE_JSON_DECODE_ERROR",
    "COMPATIBLE_ARTIFACT_VALIDATION_ERROR",
    "QWEN_JSON_DECODE_ERROR",
    "QWEN_ARTIFACT_VALIDATION_ERROR",
}


def _is_retryable_provider_error(error: dict[str, object] | None) -> bool:
    if not isinstance(error, dict):
        return False

    if bool(error.get("retriable")):
        return True

    error_code = str(error.get("code", "")).strip().upper()
    return error_code in RETRYABLE_PROVIDER_ERROR_CODES


def _resolve_retryable_provider_delay_seconds(
    error: dict[str, object] | None,
    *,
    retry_count: int,
) -> float:
    if not isinstance(error, dict):
        return 0.0

    raw_base_delay = error.get("retry_delay_seconds", 1.0)
    try:
        base_delay = float(raw_base_delay)
    except (TypeError, ValueError):
        base_delay = 1.0

    if base_delay <= 0:
        return 0.0

    return min(base_delay * (2 ** max(0, retry_count)), 2.0)


def _should_gracefully_degrade_provider_error(
    error: dict[str, object] | None,
    *,
    current_draft: str,
    artifact_candidate: dict[str, object] | None,
) -> bool:
    if not isinstance(error, dict):
        return False

    error_code = str(error.get("code", "")).strip().upper()
    if error_code not in GRACEFUL_ARTIFACT_ERROR_CODES:
        return False

    if current_draft.strip():
        return True

    return isinstance(artifact_candidate, dict)


def _format_provider_error_for_validation(error: dict[str, object] | None) -> str:
    if not isinstance(error, dict):
        return ""

    error_code = str(error.get("code", "")).strip()
    error_message = str(error.get("message", "")).strip()
    if error_code and error_message:
        return f"{error_code}: {error_message}"
    return error_code or error_message


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
