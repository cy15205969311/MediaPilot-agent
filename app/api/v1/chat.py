import asyncio
import logging
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import suppress

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.cancel_manager import GlobalKillSwitchTriggered, cancel_manager
from app.core.context import (
    RequestCancellationContext,
    raise_if_cancelled,
    reset_request_cancellation_context,
    set_request_cancellation_context,
)
from app.db.database import get_db
from app.db.models import Material, Message, Thread, User
from app.models.schemas import MediaChatRequest, MediaChatStopRequest, MediaChatStopResponse
from app.services.agent import media_agent_workflow
from app.services.auth import get_current_user
from app.services.knowledge_base import normalize_knowledge_base_scope
from app.services.model_access import ensure_model_access
from app.services.persistence import (
    bind_material_uploads_to_thread,
    derive_thread_title,
    normalize_media_reference,
)

router = APIRouter(prefix="/api/v1/media", tags=["media-chat"])
logger = logging.getLogger(__name__)
INSUFFICIENT_TOKENS_DETAIL = "INSUFFICIENT_TOKENS"
TOKEN_BYPASS_ROLES = {"super_admin", "admin"}
STREAM_DISCONNECT_POLL_INTERVAL_SECONDS = 0.1
_STREAM_FORWARDER_END = object()


async def _cancel_background_task(task: asyncio.Task[object] | asyncio.Task[None]) -> None:
    if task.done():
        return

    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, GlobalKillSwitchTriggered):
        pass


async def _close_workflow_stream(workflow_stream: AsyncGenerator[str, None]) -> None:
    try:
        await workflow_stream.aclose()
    except (RuntimeError, StopAsyncIteration, GeneratorExit):
        pass
    except Exception:
        logger.debug("workflow stream close skipped due to cleanup error", exc_info=True)


async def _shutdown_workflow_stream(
    *,
    producer_task: asyncio.Task[None],
    workflow_stream: AsyncGenerator[str, None],
) -> None:
    await _cancel_background_task(producer_task)
    with suppress(asyncio.CancelledError):
        await _close_workflow_stream(workflow_stream)


async def _forward_stream_with_disconnect_cancellation(
    *,
    workflow_stream: AsyncGenerator[str, None],
    disconnect_checker: Callable[[], Awaitable[bool]],
    thread_id: str,
    user_id: str,
) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue[object] = asyncio.Queue()
    cancel_manager.register_thread(thread_id, owner_user_id=user_id)
    cancellation_context = RequestCancellationContext(
        disconnect_checker=disconnect_checker,
        thread_id=thread_id,
    )
    context_token = set_request_cancellation_context(cancellation_context)

    async def produce() -> None:
        try:
            async for chunk in workflow_stream:
                queue.put_nowait(chunk)
        except asyncio.CancelledError:
            logger.info(
                "流式生产任务已取消 thread_id=%s user_id=%s",
                thread_id,
                user_id,
            )
            raise
        except BaseException as exc:
            queue.put_nowait(exc)
        finally:
            queue.put_nowait(_STREAM_FORWARDER_END)

    producer_task = asyncio.create_task(
        produce(),
        name=f"media-chat-stream-producer:{thread_id}",
    )
    cancel_manager.register_task(thread_id, producer_task)

    async def watch_for_disconnect() -> None:
        try:
            while True:
                if await cancellation_context.refresh_disconnect_state():
                    logger.warning(
                        "瀹㈡埛绔凡鏂紑杩炴帴锛屽噯澶囧己鍒跺彇娑?LangGraph 宸ヤ綔娴?thread_id=%s user_id=%s",
                        thread_id,
                        user_id,
                    )
                    cancellation_context.cancel("Client disconnected")
                    queue.put_nowait(asyncio.CancelledError("Client disconnected"))
                    await _shutdown_workflow_stream(
                        producer_task=producer_task,
                        workflow_stream=workflow_stream,
                    )
                    return
                await asyncio.sleep(STREAM_DISCONNECT_POLL_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:
            queue.put_nowait(exc)

    disconnect_task: asyncio.Task[None] | None = None

    try:
        while True:
            await raise_if_cancelled()
            if await cancellation_context.refresh_disconnect_state():
                logger.warning(
                    "客户端已断开连接，准备强制取消 LangGraph 工作流 thread_id=%s user_id=%s",
                    thread_id,
                    user_id,
                )
                cancellation_context.cancel("Client disconnected")
                await _shutdown_workflow_stream(
                    producer_task=producer_task,
                    workflow_stream=workflow_stream,
                )
                raise asyncio.CancelledError("Client disconnected")

            try:
                item = await asyncio.wait_for(
                    queue.get(),
                    timeout=STREAM_DISCONNECT_POLL_INTERVAL_SECONDS,
                )
            except asyncio.TimeoutError:
                continue

            if item is _STREAM_FORWARDER_END:
                await raise_if_cancelled()
                break
            if isinstance(item, BaseException):
                if isinstance(item, (asyncio.CancelledError, GlobalKillSwitchTriggered)):
                    cancellation_context.cancel(str(item) or "Client disconnected")
                raise item

            yield str(item)
            await asyncio.sleep(0)
    except (asyncio.CancelledError, GlobalKillSwitchTriggered) as exc:
        cancellation_context.cancel("Streaming response cancelled")
        logger.warning(
            "流式响应已显式取消，准备销毁后端执行链路 thread_id=%s user_id=%s",
            thread_id,
            user_id,
        )
        if isinstance(exc, GlobalKillSwitchTriggered):
            logger.info(
                "Agent process explicitly terminated by global kill switch thread_id=%s user_id=%s",
                thread_id,
                user_id,
            )
        await _shutdown_workflow_stream(
            producer_task=producer_task,
            workflow_stream=workflow_stream,
        )
        raise
    finally:
        if disconnect_task is not None:
            await _cancel_background_task(disconnect_task)
        await _shutdown_workflow_stream(
            producer_task=producer_task,
            workflow_stream=workflow_stream,
        )
        cancel_manager.cleanup_thread(thread_id)
        reset_request_cancellation_context(context_token)


def persist_chat_request(
    db: Session,
    request: MediaChatRequest,
    current_user: User,
) -> Thread:
    normalized_model_override = (request.model_override or "").strip() or None
    logger.info(
        "chat.persist start thread_id=%s user_id=%s materials=%s",
        request.thread_id,
        current_user.id,
        len(request.materials),
    )
    thread = db.scalar(
        select(Thread).where(
            Thread.id == request.thread_id,
            Thread.user_id == current_user.id,
        )
    )
    existing_thread = db.get(Thread, request.thread_id)

    if thread is None:
        if existing_thread is not None and existing_thread.user_id != current_user.id:
            raise HTTPException(status_code=404, detail="未找到对应会话。")

        thread = Thread(
            id=request.thread_id,
            user_id=current_user.id,
            title=(request.thread_title or "").strip() or derive_thread_title(request.message),
            system_prompt=(request.system_prompt or "").strip(),
            model_override=normalized_model_override,
            knowledge_base_scope=normalize_knowledge_base_scope(request.knowledge_base_scope),
        )
        db.add(thread)
    else:
        next_title = (request.thread_title or "").strip()
        if next_title:
            thread.title = next_title
        elif not thread.title.strip():
            thread.title = derive_thread_title(request.message)

        if request.system_prompt is not None:
            thread.system_prompt = request.system_prompt.strip()
        thread.model_override = normalized_model_override
        if request.knowledge_base_scope is not None:
            thread.knowledge_base_scope = normalize_knowledge_base_scope(
                request.knowledge_base_scope,
            )

        thread.touch()

    user_message = Message(
        thread_id=request.thread_id,
        role="user",
        content=request.message,
    )
    db.add(user_message)
    db.flush()

    persisted_materials: list[Material] = []
    normalized_material_urls: list[str | None] = []
    for material in request.materials:
        normalized_material_url = normalize_media_reference(
            str(material.url) if material.url else None,
        )
        normalized_material_urls.append(normalized_material_url)
        persisted_material = Material(
            thread_id=request.thread_id,
            message_id=user_message.id,
            type=material.type.value,
            url=normalized_material_url,
            text=material.text,
        )
        persisted_materials.append(persisted_material)
        db.add(persisted_material)

    bound_uploads = bind_material_uploads_to_thread(
        db,
        user_id=current_user.id,
        thread_id=request.thread_id,
        material_urls=normalized_material_urls,
        material_items=persisted_materials,
    )

    logger.info(
        "chat.persist before_commit thread_id=%s bound_uploads=%s",
        request.thread_id,
        bound_uploads,
    )
    db.commit()
    db.refresh(thread)
    logger.info("chat.persist committed thread_id=%s", request.thread_id)
    return thread


@router.post("/chat/stream")
async def stream_media_chat(
    request: MediaChatRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    if current_user.role not in TOKEN_BYPASS_ROLES and int(current_user.token_balance or 0) <= 0:
        raise HTTPException(status_code=402, detail=INSUFFICIENT_TOKENS_DETAIL)

    requested_provider_key, requested_model_name = media_agent_workflow.resolve_requested_model_target(
        request.model_override,
    )
    ensure_model_access(
        role=current_user.role,
        provider_key=requested_provider_key,
        model_name=requested_model_name,
    )

    logger.info(
        "chat.stream route entered thread_id=%s task_type=%s user_id=%s",
        request.thread_id,
        request.task_type.value,
        current_user.id,
    )
    logger.info(
        "收到 Chat 请求: thread_id=%s, task_type=%s",
        request.thread_id,
        request.task_type.value,
    )
    current_user_id = str(current_user.id)
    cancel_manager.register_thread(request.thread_id, owner_user_id=current_user_id)
    try:
        thread = persist_chat_request(db, request, current_user)
    except HTTPException:
        cancel_manager.cleanup_thread(request.thread_id)
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        cancel_manager.cleanup_thread(request.thread_id)
        raise HTTPException(
            status_code=500,
            detail="保存会话数据失败，请稍后重试。",
        ) from exc

    logger.info("chat.stream returning StreamingResponse thread_id=%s", request.thread_id)

    async def stream_events():
        async for chunk in _forward_stream_with_disconnect_cancellation(
            workflow_stream=media_agent_workflow.stream(
                request,
                db=db,
                thread=thread,
                user_id=current_user_id,
            ),
            disconnect_checker=http_request.is_disconnected,
            thread_id=request.thread_id,
            user_id=current_user_id,
        ):
            yield chunk

    return StreamingResponse(
        stream_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/chat/stop", response_model=MediaChatStopResponse)
async def stop_media_chat(
    request: MediaChatStopRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MediaChatStopResponse:
    normalized_thread_id = request.thread_id.strip()
    active_record = cancel_manager.get_record(normalized_thread_id)
    thread = db.scalar(select(Thread).where(Thread.id == normalized_thread_id))

    if thread is not None and thread.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Conversation thread not found")

    if thread is None:
        active_owner_user_id = active_record.owner_user_id if active_record is not None else None
        if active_owner_user_id and active_owner_user_id != current_user.id:
            raise HTTPException(status_code=404, detail="Conversation thread not found")
        if active_owner_user_id != current_user.id:
            logger.info(
                "chat.stop ignored because no active owned stream exists thread_id=%s user_id=%s",
                normalized_thread_id,
                current_user.id,
            )
            return MediaChatStopResponse(thread_id=normalized_thread_id, cancelled=False)

    if active_record is None:
        logger.info(
            "chat.stop found no active stream thread_id=%s user_id=%s",
            normalized_thread_id,
            current_user.id,
        )
        return MediaChatStopResponse(thread_id=normalized_thread_id, cancelled=False)

    logger.warning(
        "chat.stop triggered task cancellation thread_id=%s user_id=%s",
        normalized_thread_id,
        current_user.id,
    )
    cancel_manager.cancel_thread(
        normalized_thread_id,
        "User manually stopped generation",
    )
    return MediaChatStopResponse(thread_id=normalized_thread_id, cancelled=True)
