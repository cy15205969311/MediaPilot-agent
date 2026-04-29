import asyncio
import json
import logging
import os
import uuid
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator, Sequence
from json import JSONDecodeError
from typing import Any, Callable

import httpx
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import Runnable, RunnableLambda
from langchain_core.tools import BaseTool
from langchain_core.utils.function_calling import convert_to_openai_tool
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
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import load_environment
from app.db.models import Message, Thread
from app.models.schemas import (
    ArtifactPayloadModel,
    CommentReplyArtifactPayload,
    CommentReplySuggestion,
    ContentGenerationArtifactPayload,
    HotPostAnalysisArtifactPayload,
    HotPostAnalysisDimension,
    MediaChatRequest,
    TaskType,
    TopicPlanningArtifactPayload,
    TopicPlanningItem,
)

load_environment()

logger = logging.getLogger(__name__)

DEFAULT_SYSTEM_PROMPT = "你是一个通用型的智能助手，请始终使用简体中文回答。"
MAX_CONTEXT_MESSAGES = 12

ArtifactSchemaType = (
    type[TopicPlanningArtifactPayload]
    | type[ContentGenerationArtifactPayload]
    | type[HotPostAnalysisArtifactPayload]
    | type[CommentReplyArtifactPayload]
)


def _build_http_timeout(seconds: float) -> httpx.Timeout:
    connect_timeout = min(seconds, 10.0)
    return httpx.Timeout(seconds, connect=connect_timeout)


class _OpenAIToolBindingAdapter:
    def __init__(
        self,
        *,
        client_factory,
        model: str,
        timeout: httpx.Timeout,
    ) -> None:
        self._client_factory = client_factory
        self._model = model
        self._timeout = timeout

    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | Callable[..., Any] | BaseTool],
        *,
        tool_choice: str | None = None,
        **kwargs: Any,
    ) -> Runnable[Any, AIMessage]:
        tool_specs = [convert_to_openai_tool(tool) for tool in tools]
        temperature = kwargs.get("temperature", 0)

        def _invoke_sync(_: Any) -> AIMessage:
            raise RuntimeError(
                "This tool-bound chat model only supports async invocation. Use `ainvoke()`.",
            )

        async def _invoke(messages_input: Any) -> AIMessage:
            messages = _coerce_tool_binding_messages(messages_input)
            response = await self._client_factory().chat.completions.create(
                model=self._model,
                messages=[_serialize_tool_binding_message(message) for message in messages],
                tools=tool_specs,
                tool_choice=tool_choice or "auto",
                temperature=temperature,
                timeout=self._timeout,
            )
            return _normalize_tool_binding_response_message(response.choices[0].message)

        return RunnableLambda(
            _invoke_sync,
            afunc=_invoke,
            name=f"bound_tools_{self._model}",
        )


def _coerce_tool_binding_messages(messages_input: Any) -> list[BaseMessage]:
    if isinstance(messages_input, BaseMessage):
        return [messages_input]
    if (
        isinstance(messages_input, list)
        and all(isinstance(message, BaseMessage) for message in messages_input)
    ):
        return list(messages_input)
    raise TypeError("Tool-bound chat model expects LangChain BaseMessage inputs.")


def _serialize_tool_binding_message(message: BaseMessage) -> dict[str, object]:
    if isinstance(message, SystemMessage):
        return {"role": "system", "content": _coerce_message_content(message.content)}
    if isinstance(message, HumanMessage):
        return {"role": "user", "content": _coerce_message_content(message.content)}
    if isinstance(message, ToolMessage):
        return {
            "role": "tool",
            "content": _coerce_message_content(message.content),
            "tool_call_id": message.tool_call_id,
        }
    if isinstance(message, AIMessage):
        payload: dict[str, object] = {
            "role": "assistant",
            "content": _coerce_message_content(message.content),
        }
        serialized_tool_calls = []
        for tool_call in message.tool_calls or []:
            tool_name = str(tool_call.get("name", "")).strip()
            if not tool_name:
                continue
            serialized_tool_calls.append(
                {
                    "id": str(tool_call.get("id") or f"call_{uuid.uuid4().hex}"),
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": json.dumps(
                            tool_call.get("args", {}),
                            ensure_ascii=False,
                        ),
                    },
                }
            )
        if serialized_tool_calls:
            payload["tool_calls"] = serialized_tool_calls
        return payload
    raise TypeError(f"Unsupported LangChain message type for tool binding: {type(message)!r}")


def _coerce_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(item) for item in content)
    if content is None:
        return ""
    return str(content)


def _normalize_tool_binding_response_message(message: Any) -> AIMessage:
    content = _coerce_message_content(getattr(message, "content", ""))
    raw_tool_calls = getattr(message, "tool_calls", None) or []
    normalized_tool_calls: list[dict[str, object]] = []

    for raw_call in raw_tool_calls:
        function = getattr(raw_call, "function", None)
        if function is None and isinstance(raw_call, dict):
            function = raw_call.get("function")
        if function is None:
            continue

        if isinstance(function, dict):
            name = str(function.get("name", "")).strip()
            raw_arguments = function.get("arguments", {})
        else:
            name = str(getattr(function, "name", "")).strip()
            raw_arguments = getattr(function, "arguments", {})
        if not name:
            continue

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

        normalized_tool_calls.append(
            {
                "name": name,
                "args": arguments,
                "id": tool_call_id,
                "type": "tool_call",
            }
        )

    return AIMessage(content=content, tool_calls=normalized_tool_calls)


class BaseLLMProvider(ABC):
    @abstractmethod
    async def generate_stream(
        self,
        request: MediaChatRequest,
        *,
        db: Session | None = None,
        thread: Thread | None = None,
        user_id: str | None = None,
    ) -> AsyncGenerator[dict[str, object], None]:
        """Yield structured stream events before SSE formatting."""

    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | Callable[..., Any] | BaseTool],
        *,
        tool_choice: str | None = None,
        **kwargs: Any,
    ) -> Runnable[Any, AIMessage]:
        raise NotImplementedError(
            f"{type(self).__name__} does not support LangChain tool binding.",
        )


class MockLLMProvider(BaseLLMProvider):
    def __init__(self, chunk_size: int = 20) -> None:
        self.chunk_size = chunk_size

    async def generate_stream(
        self,
        request: MediaChatRequest,
        *,
        db: Session | None = None,
        thread: Thread | None = None,
        user_id: str | None = None,
    ) -> AsyncGenerator[dict[str, object], None]:
        yield _start_event(request)

        for index, chunk in enumerate(self._chunk_text(self._build_stream_text(request))):
            await asyncio.sleep(0.05)
            yield {
                "event": "message",
                "delta": chunk,
                "index": index,
            }

        await asyncio.sleep(0.03)
        yield {
            "event": "tool_call",
            "name": "content_structuring",
            "status": "processing",
        }

        await asyncio.sleep(0.03)
        yield {
            "event": "artifact",
            "artifact": self._build_artifact(request).model_dump(mode="json"),
        }

        yield {"event": "done", "thread_id": request.thread_id}

    def _build_stream_text(self, request: MediaChatRequest) -> str:
        if request.task_type == TaskType.TOPIC_PLANNING:
            return (
                "已收到选题策划任务，正在围绕目标平台和用户意图整理更适合收藏、转发与延展复用的内容方向，"
                "并补充清晰的切入角度与预期目标。"
            )
        if request.task_type == TaskType.CONTENT_GENERATION:
            return (
                "已收到内容生成任务，正在将当前需求整理为可直接继续编辑的中文草稿，"
                "会同步补充标题候选与平台收口动作，方便你快速进入发布流程。"
            )
        if request.task_type == TaskType.HOT_POST_ANALYSIS:
            return (
                "已收到爆款拆解任务，正在从标题钩子、情绪触发、信任建立和表达模板几个维度整理结构化分析结果。"
            )
        return (
            "已收到评论回复任务，正在按咨询、质疑和情绪表达等不同场景整理更稳妥的回复建议。"
        )

    def _build_artifact(self, request: MediaChatRequest) -> ArtifactPayloadModel:
        if request.task_type == TaskType.TOPIC_PLANNING:
            return TopicPlanningArtifactPayload(
                title="年度复盘内容选题池",
                topics=[
                    TopicPlanningItem(
                        title="一篇年度复盘内容为什么更容易被收藏",
                        angle="从读者最常见的总结焦虑切入，强调结构感和执行清单。",
                        goal="提升收藏率和后续私信咨询意愿。",
                    ),
                    TopicPlanningItem(
                        title="把年度复盘写成可复制模板的三步法",
                        angle="突出框架模板和落地方法，而不是空泛经验。",
                        goal="提高转发率和模板下载意愿。",
                    ),
                    TopicPlanningItem(
                        title="同样是复盘，为什么有人写完就能形成系列内容",
                        angle="从单篇内容延展到内容矩阵策划，强调长期运营价值。",
                        goal="带动用户关注后续更新。",
                    ),
                ],
            )

        if request.task_type == TaskType.CONTENT_GENERATION:
            return ContentGenerationArtifactPayload(
                title="年度复盘内容草稿",
                title_candidates=[
                    "年度复盘别再只写流水账，这样写更容易被收藏",
                    "把年度总结写成高质量内容，我建议先做这 3 步",
                    "为什么你的复盘没人看？问题通常不在文笔",
                ],
                body=(
                    "很多人做年度复盘时，第一反应是把发生过的事情按时间顺序列出来。"
                    "但真正更容易被读者记住的内容，往往不是事件清单，而是你如何从混乱里提炼出规律。\n\n"
                    "如果你想把年度复盘写成更有传播力的内容，可以先按三个问题重组：\n"
                    "1. 今年最值得保留的有效动作是什么？\n"
                    "2. 哪些投入没有产生对应结果，原因出在哪里？\n"
                    "3. 明年最应该重复和停止的事情分别是什么？\n\n"
                    "这样写出来的复盘会更像一份对他人有启发的行动笔记，而不是只属于自己的日记。"
                ),
                platform_cta="如果你愿意，我可以继续把这份草稿改写成小红书图文版或抖音口播版。",
            )

        if request.task_type == TaskType.HOT_POST_ANALYSIS:
            return HotPostAnalysisArtifactPayload(
                title="爆款内容拆解卡",
                analysis_dimensions=[
                    HotPostAnalysisDimension(
                        dimension="标题钩子",
                        insight="先指出读者常见误区，再给出更优解，能够快速建立点击动机。",
                    ),
                    HotPostAnalysisDimension(
                        dimension="情绪触发",
                        insight="正文不断强化“原来我也有这个问题”，让用户持续代入自己的处境。",
                    ),
                    HotPostAnalysisDimension(
                        dimension="信任建立",
                        insight="通过可执行步骤和真实场景，而不是夸张承诺，提升说服力。",
                    ),
                ],
                reusable_templates=[
                    "先别急着追求结果，先判断问题是不是出在方法顺序上。",
                    "真正有效的内容，不是信息越多越好，而是越能帮用户做决定越好。",
                    "如果你也卡在这一步，可以先从最小动作开始验证。",
                ],
            )

        return CommentReplyArtifactPayload(
            title="评论回复建议",
            suggestions=[
                CommentReplySuggestion(
                    comment_type="咨询类",
                    scenario="用户希望继续了解执行方法。",
                    reply="可以，我先帮你把这件事拆成更容易上手的 3 个动作，你也可以告诉我你现在卡在哪一步。",
                    compliance_note="优先收集信息，再给更具体建议。",
                ),
                CommentReplySuggestion(
                    comment_type="质疑类",
                    scenario="用户认为当前方案不适合自己。",
                    reply="这个担心很正常，不同阶段适合的方法确实不同。你可以补充一下你的目标和当前情况，我再帮你判断哪一步更值得先做。",
                    compliance_note="先回应疑虑，再补充判断依据。",
                ),
                CommentReplySuggestion(
                    comment_type="情绪类",
                    scenario="用户表达焦虑或挫败感。",
                    reply="先别急着否定自己，很多问题不是做不到，而是缺少一个更清晰的拆解路径。我们可以先从最容易推进的一步开始。",
                    compliance_note="先安抚情绪，再引导到具体动作。",
                ),
            ],
        )

    def _chunk_text(self, text: str) -> list[str]:
        return [
            text[index : index + self.chunk_size]
            for index in range(0, len(text), self.chunk_size)
        ]


class OpenAIProvider(BaseLLMProvider):
    def __init__(
        self,
        *,
        model: str | None = None,
        artifact_model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-5-mini")
        self.artifact_model = artifact_model or os.getenv("OPENAI_ARTIFACT_MODEL", self.model)
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.base_url = base_url or os.getenv("OPENAI_BASE_URL")
        self.timeout_seconds = timeout_seconds or float(
            os.getenv("OPENAI_TIMEOUT_SECONDS", "60"),
        )
        self.request_timeout = _build_http_timeout(self.timeout_seconds)
        self._client: AsyncOpenAI | None = None

    async def generate_stream(
        self,
        request: MediaChatRequest,
        *,
        db: Session | None = None,
        thread: Thread | None = None,
        user_id: str | None = None,
    ) -> AsyncGenerator[dict[str, object], None]:
        yield _start_event(request)

        if not self.api_key:
            yield _error_event(
                code="OPENAI_API_KEY_MISSING",
                message="未检测到 OPENAI_API_KEY，无法启用 OpenAIProvider。",
            )
            yield {"event": "done", "thread_id": request.thread_id}
            return

        streamed_text = ""
        message_index = 0

        try:
            messages = _build_conversation_messages(
                request,
                db=db,
                thread=thread,
                user_id=user_id,
            )
            stream = await self._get_client().chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                stream=True,
                timeout=self.request_timeout,
            )

            async for chunk in stream:
                for choice in chunk.choices:
                    delta = choice.delta.content or ""
                    if not delta:
                        continue
                    streamed_text += delta
                    yield {
                        "event": "message",
                        "delta": delta,
                        "index": message_index,
                    }
                    message_index += 1

            yield {
                "event": "tool_call",
                "name": "artifact_structuring",
                "status": "processing",
            }

            artifact = await self._build_structured_artifact(
                request,
                streamed_text=streamed_text,
                db=db,
                thread=thread,
                user_id=user_id,
            )
            yield {
                "event": "artifact",
                "artifact": artifact.model_dump(mode="json"),
            }
        except JSONDecodeError:
            yield _error_event(
                code="OPENAI_JSON_DECODE_ERROR",
                message="结构化结果解析失败，请稍后重试。",
            )
        except ValidationError:
            yield _error_event(
                code="OPENAI_ARTIFACT_VALIDATION_ERROR",
                message="结构化结果不符合契约，请稍后重试。",
            )
        except AuthenticationError:
            yield _error_event(
                code="OPENAI_AUTH_ERROR",
                message="OpenAI 鉴权失败，请检查密钥或网关配置。",
            )
        except RateLimitError:
            yield _error_event(
                code="OPENAI_RATE_LIMIT",
                message="OpenAI 请求触发限流，请稍后重试。",
            )
        except APITimeoutError:
            yield _error_event(
                code="OPENAI_TIMEOUT",
                message="OpenAI 请求超时，请稍后重试。",
            )
        except APIConnectionError:
            yield _error_event(
                code="OPENAI_CONNECTION_ERROR",
                message="无法连接 OpenAI 服务，请检查网络或网关地址。",
            )
        except (APIError, OpenAIError) as exc:
            logger.exception("OpenAI provider request failed: %s", exc)
            yield _error_event(
                code="OPENAI_API_ERROR",
                message="OpenAI 服务调用失败，请稍后重试。",
            )
        except Exception as exc:  # pragma: no cover - defensive boundary
            logger.exception("Unexpected OpenAI provider failure: %s", exc)
            yield _error_event(
                code="PROVIDER_INTERNAL_ERROR",
                message="模型提供者执行失败，请稍后重试。",
            )
        finally:
            yield {"event": "done", "thread_id": request.thread_id}

    def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            client_kwargs: dict[str, object] = {
                "api_key": self.api_key,
                "timeout": self.request_timeout,
            }
            if self.base_url:
                client_kwargs["base_url"] = self.base_url
            self._client = AsyncOpenAI(**client_kwargs)
        return self._client

    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | Callable[..., Any] | BaseTool],
        *,
        tool_choice: str | None = None,
        **kwargs: Any,
    ) -> Runnable[Any, AIMessage]:
        adapter = _OpenAIToolBindingAdapter(
            client_factory=self._get_client,
            model=self.model,
            timeout=self.request_timeout,
        )
        return adapter.bind_tools(
            tools,
            tool_choice=tool_choice,
            **kwargs,
        )

    async def _build_structured_artifact(
        self,
        request: MediaChatRequest,
        *,
        streamed_text: str,
        db: Session | None,
        thread: Thread | None,
        user_id: str | None,
    ) -> ArtifactPayloadModel:
        schema_type = _resolve_artifact_schema(request.task_type)
        raw_json = await self._request_json_artifact(
            request,
            streamed_text=streamed_text,
            db=db,
            thread=thread,
            user_id=user_id,
        )
        return schema_type.model_validate(json.loads(raw_json))

    async def _request_json_artifact(
        self,
        request: MediaChatRequest,
        *,
        streamed_text: str,
        db: Session | None,
        thread: Thread | None,
        user_id: str | None,
    ) -> str:
        request_kwargs = {
            "model": self.artifact_model,
            "messages": _build_artifact_messages(
                request,
                streamed_text=streamed_text,
                db=db,
                thread=thread,
                user_id=user_id,
            ),
            "temperature": 0.2,
            "timeout": self.request_timeout,
        }

        try:
            response = await self._get_client().chat.completions.create(
                **request_kwargs,
                response_format={"type": "json_object"},
            )
        except BadRequestError:
            response = await self._get_client().chat.completions.create(**request_kwargs)

        content = response.choices[0].message.content or ""
        return content.strip()


class CompatibleLLMProvider(BaseLLMProvider):
    def __init__(
        self,
        *,
        model: str | None = None,
        artifact_model: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        self.model = model or os.getenv("LLM_MODEL", "qwen3.5-flash")
        self.artifact_model = artifact_model or os.getenv("LLM_ARTIFACT_MODEL", self.model)
        self.api_key = api_key or os.getenv("LLM_API_KEY")
        self.base_url = base_url or os.getenv("LLM_BASE_URL")
        self.timeout_seconds = timeout_seconds or float(
            os.getenv("LLM_TIMEOUT_SECONDS", os.getenv("OPENAI_TIMEOUT_SECONDS", "60")),
        )
        self.request_timeout = _build_http_timeout(self.timeout_seconds)
        self._client: AsyncOpenAI | None = None

    async def generate_stream(
        self,
        request: MediaChatRequest,
        *,
        db: Session | None = None,
        thread: Thread | None = None,
        user_id: str | None = None,
    ) -> AsyncGenerator[dict[str, object], None]:
        yield _start_event(request)

        if not self.api_key:
            yield _error_event(
                code="LLM_API_KEY_MISSING",
                message="未检测到 LLM_API_KEY，无法启用兼容模型提供者。",
            )
            yield {"event": "done", "thread_id": request.thread_id}
            return

        if not self.base_url:
            yield _error_event(
                code="LLM_BASE_URL_MISSING",
                message="未检测到 LLM_BASE_URL，无法连接兼容模型网关。",
            )
            yield {"event": "done", "thread_id": request.thread_id}
            return

        streamed_text = ""
        message_index = 0

        try:
            messages = _build_conversation_messages(
                request,
                db=db,
                thread=thread,
                user_id=user_id,
            )
            stream = await self._get_client().chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                stream=True,
                timeout=self.request_timeout,
            )

            async for chunk in stream:
                for choice in chunk.choices:
                    delta = choice.delta.content or ""
                    if not delta:
                        continue
                    streamed_text += delta
                    yield {
                        "event": "message",
                        "delta": delta,
                        "index": message_index,
                    }
                    message_index += 1

            yield {
                "event": "tool_call",
                "name": "artifact_structuring",
                "status": "processing",
            }

            artifact = await self._build_structured_artifact(
                request,
                streamed_text=streamed_text,
                db=db,
                thread=thread,
                user_id=user_id,
            )
            yield {
                "event": "artifact",
                "artifact": artifact.model_dump(mode="json"),
            }
        except JSONDecodeError:
            yield _error_event(
                code="COMPATIBLE_JSON_DECODE_ERROR",
                message="结构化结果解析失败，请稍后重试。",
            )
        except ValidationError:
            yield _error_event(
                code="COMPATIBLE_ARTIFACT_VALIDATION_ERROR",
                message="结构化结果不符合契约，请稍后重试。",
            )
        except AuthenticationError:
            yield _error_event(
                code="COMPATIBLE_AUTH_ERROR",
                message="兼容模型鉴权失败，请检查密钥或网关配置。",
            )
        except RateLimitError:
            yield _error_event(
                code="COMPATIBLE_RATE_LIMIT",
                message="兼容模型请求触发限流，请稍后重试。",
            )
        except APITimeoutError:
            yield _error_event(
                code="COMPATIBLE_TIMEOUT",
                message="兼容模型请求超时，请稍后重试。",
            )
        except APIConnectionError:
            yield _error_event(
                code="COMPATIBLE_CONNECTION_ERROR",
                message="无法连接兼容模型服务，请检查网络或网关地址。",
            )
        except (APIError, OpenAIError) as exc:
            logger.exception("Compatible provider request failed: %s", exc)
            yield _error_event(
                code="COMPATIBLE_API_ERROR",
                message="兼容模型服务调用失败，请稍后重试。",
            )
        except Exception as exc:  # pragma: no cover - defensive boundary
            logger.exception("Unexpected compatible provider failure: %s", exc)
            yield _error_event(
                code="PROVIDER_INTERNAL_ERROR",
                message="模型提供者执行失败，请稍后重试。",
            )
        finally:
            yield {"event": "done", "thread_id": request.thread_id}

    def _get_client(self) -> AsyncOpenAI:
        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.request_timeout,
            )
        return self._client

    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | Callable[..., Any] | BaseTool],
        *,
        tool_choice: str | None = None,
        **kwargs: Any,
    ) -> Runnable[Any, AIMessage]:
        adapter = _OpenAIToolBindingAdapter(
            client_factory=self._get_client,
            model=self.model,
            timeout=self.request_timeout,
        )
        return adapter.bind_tools(
            tools,
            tool_choice=tool_choice,
            **kwargs,
        )

    async def _build_structured_artifact(
        self,
        request: MediaChatRequest,
        *,
        streamed_text: str,
        db: Session | None,
        thread: Thread | None,
        user_id: str | None,
    ) -> ArtifactPayloadModel:
        schema_type = _resolve_artifact_schema(request.task_type)
        raw_json = await self._request_json_artifact(
            request,
            streamed_text=streamed_text,
            db=db,
            thread=thread,
            user_id=user_id,
        )
        return schema_type.model_validate(json.loads(raw_json))

    async def _request_json_artifact(
        self,
        request: MediaChatRequest,
        *,
        streamed_text: str,
        db: Session | None,
        thread: Thread | None,
        user_id: str | None,
    ) -> str:
        request_kwargs = {
            "model": self.artifact_model,
            "messages": _build_artifact_messages(
                request,
                streamed_text=streamed_text,
                db=db,
                thread=thread,
                user_id=user_id,
            ),
            "temperature": 0.2,
            "timeout": self.request_timeout,
        }

        try:
            response = await self._get_client().chat.completions.create(
                **request_kwargs,
                response_format={"type": "json_object"},
            )
        except BadRequestError:
            response = await self._get_client().chat.completions.create(**request_kwargs)

        content = response.choices[0].message.content or ""
        return content.strip()


def _start_event(request: MediaChatRequest) -> dict[str, object]:
    return {
        "event": "start",
        "thread_id": request.thread_id,
        "platform": request.platform.value,
        "task_type": request.task_type.value,
        "materials_count": len(request.materials),
    }


def _error_event(*, code: str, message: str) -> dict[str, object]:
    return {
        "event": "error",
        "code": code,
        "message": message,
    }


def _resolve_system_prompt(request: MediaChatRequest, thread: Thread | None) -> str:
    if thread is not None and thread.system_prompt.strip():
        return thread.system_prompt.strip()
    if request.system_prompt is not None and request.system_prompt.strip():
        return request.system_prompt.strip()
    return DEFAULT_SYSTEM_PROMPT


def _build_conversation_messages(
    request: MediaChatRequest,
    *,
    db: Session | None,
    thread: Thread | None,
    user_id: str | None,
) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = [
        {"role": "system", "content": _resolve_system_prompt(request, thread)},
        {"role": "system", "content": _build_task_instruction(request)},
    ]

    history = _load_thread_history(
        db=db,
        thread_id=request.thread_id,
        user_id=user_id,
    )

    if history:
        for item in history:
            messages.append({"role": item.role, "content": item.content})
        _replace_or_append_current_user_message(
            messages=messages,
            history=history,
            request=request,
        )
    else:
        messages.append({"role": "user", "content": request.message})

    if request.materials:
        messages.append(
            {
                "role": "user",
                "content": "当前请求附带素材如下：\n" + _serialize_materials(request),
            }
        )

    return messages


def _replace_or_append_current_user_message(
    *,
    messages: list[dict[str, str]],
    history: list[Message],
    request: MediaChatRequest,
) -> None:
    current_message = request.message.strip()
    if not current_message:
        return

    last_history_item = history[-1]
    last_history_role = str(last_history_item.role).strip().lower()
    last_history_content = last_history_item.content.strip()

    if last_history_role == "user":
        if last_history_content != current_message:
            messages[-1] = {"role": "user", "content": request.message}
        return

    messages.append({"role": "user", "content": request.message})


def _build_artifact_messages(
    request: MediaChatRequest,
    *,
    streamed_text: str,
    db: Session | None,
    thread: Thread | None,
    user_id: str | None,
) -> list[dict[str, str]]:
    system_prompt = _resolve_system_prompt(request, thread)
    return [
        {"role": "system", "content": system_prompt},
        {
            "role": "system",
            "content": (
                "你现在只负责输出一个合法 JSON object。"
                "字段名必须与要求完全一致，不要输出 Markdown，不要补充解释。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"任务类型：{request.task_type.value}\n"
                f"目标平台：{request.platform.value}\n"
                f"原始需求：{request.message}\n"
                f"历史上下文摘要：{_history_summary(db=db, thread_id=request.thread_id, user_id=user_id)}\n"
                f"模型正文：{streamed_text.strip() or request.message}\n"
                f"请输出如下结构的 JSON：\n{_artifact_schema_prompt(request.task_type)}"
            ),
        },
    ]


def _load_thread_history(
    *,
    db: Session | None,
    thread_id: str,
    user_id: str | None,
) -> list[Message]:
    if db is None:
        return []

    statement = (
        select(Message)
        .join(Thread, Thread.id == Message.thread_id)
        .where(Message.thread_id == thread_id)
        .order_by(Message.created_at.asc())
    )
    if user_id is not None:
        statement = statement.where(Thread.user_id == user_id)

    history = list(db.scalars(statement).all())
    if len(history) <= MAX_CONTEXT_MESSAGES:
        return history
    return history[-MAX_CONTEXT_MESSAGES:]


def _history_summary(
    *,
    db: Session | None,
    thread_id: str,
    user_id: str | None,
) -> str:
    history = _load_thread_history(db=db, thread_id=thread_id, user_id=user_id)
    if not history:
        return "无"

    preview_lines = [
        f"{item.role}: {' '.join(item.content.split())[:80]}"
        for item in history[-4:]
    ]
    return "\n".join(preview_lines)


def _build_task_instruction(request: MediaChatRequest) -> str:
    if request.task_type == TaskType.TOPIC_PLANNING:
        return (
            f"当前任务是选题策划，目标平台是 {request.platform.value}。"
            "请优先给出可执行、可收藏、可延展为系列内容的方向。"
        )
    if request.task_type == TaskType.CONTENT_GENERATION:
        return (
            f"当前任务是内容生成，目标平台是 {request.platform.value}。"
            "请输出完整、可编辑、结构清晰的中文草稿。"
        )
    if request.task_type == TaskType.HOT_POST_ANALYSIS:
        return (
            f"当前任务是爆款分析，目标平台是 {request.platform.value}。"
            "请拆解钩子、情绪机制、信任建立与可复用表达。"
        )
    return (
        f"当前任务是评论回复建议，目标平台是 {request.platform.value}。"
        "请输出稳妥、清晰、适合继续沟通的回复建议。"
    )


def _serialize_materials(request: MediaChatRequest) -> str:
    if not request.materials:
        return "无"

    lines = []
    for index, material in enumerate(request.materials, start=1):
        lines.append(
            f"{index}. type={material.type.value}; "
            f"url={material.url or 'none'}; "
            f"text={material.text or 'none'}"
        )
    return "\n".join(lines)


def _resolve_artifact_schema(task_type: TaskType) -> ArtifactSchemaType:
    if task_type == TaskType.TOPIC_PLANNING:
        return TopicPlanningArtifactPayload
    if task_type == TaskType.CONTENT_GENERATION:
        return ContentGenerationArtifactPayload
    if task_type == TaskType.HOT_POST_ANALYSIS:
        return HotPostAnalysisArtifactPayload
    return CommentReplyArtifactPayload


def _artifact_schema_prompt(task_type: TaskType) -> str:
    if task_type == TaskType.TOPIC_PLANNING:
        return json.dumps(
            {
                "artifact_type": "topic_list",
                "title": "string",
                "topics": [
                    {
                        "title": "string",
                        "angle": "string",
                        "goal": "string",
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        )

    if task_type == TaskType.CONTENT_GENERATION:
        return json.dumps(
            {
                "artifact_type": "content_draft",
                "title": "string",
                "title_candidates": ["string", "string", "string"],
                "body": "string",
                "platform_cta": "string",
            },
            ensure_ascii=False,
            indent=2,
        )

    if task_type == TaskType.HOT_POST_ANALYSIS:
        return json.dumps(
            {
                "artifact_type": "hot_post_analysis",
                "title": "string",
                "analysis_dimensions": [
                    {
                        "dimension": "string",
                        "insight": "string",
                    }
                ],
                "reusable_templates": ["string", "string"],
            },
            ensure_ascii=False,
            indent=2,
        )

    return json.dumps(
        {
            "artifact_type": "comment_reply",
            "title": "string",
            "suggestions": [
                {
                    "comment_type": "string",
                    "scenario": "string",
                    "reply": "string",
                    "compliance_note": "string",
                }
            ],
        },
        ensure_ascii=False,
        indent=2,
    )


def create_provider_from_env() -> BaseLLMProvider:
    provider_name = os.getenv("OMNIMEDIA_LLM_PROVIDER", "mock").strip().lower()

    if provider_name == "openai":
        return OpenAIProvider()
    if provider_name in {"compatible", "qwen", "dashscope"}:
        return CompatibleLLMProvider()
    if provider_name in {"langgraph", "graph"}:
        from app.services.graph import LangGraphProvider

        return LangGraphProvider()
    if provider_name == "auto":
        if os.getenv("OPENAI_API_KEY"):
            return OpenAIProvider()
        if os.getenv("LLM_API_KEY") and os.getenv("LLM_BASE_URL"):
            return CompatibleLLMProvider()
        return MockLLMProvider()
    if provider_name != "mock":
        logger.warning(
            "Unknown OMNIMEDIA_LLM_PROVIDER value '%s', falling back to MockLLMProvider.",
            provider_name,
        )

    return MockLLMProvider()
