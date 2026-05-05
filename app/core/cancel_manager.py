from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable
from contextlib import suppress
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

DEFAULT_KILL_SWITCH_POLL_INTERVAL_SECONDS = 0.1


class GlobalKillSwitchTriggered(BaseException):
    """Raised when a thread-scoped stop signal must pierce normal exception handlers."""


@dataclass(slots=True)
class ThreadCancellationRecord:
    event: asyncio.Event = field(default_factory=asyncio.Event)
    reason: str = "Request cancelled"
    tasks: set[asyncio.Task[object] | asyncio.Task[None]] = field(default_factory=set)
    owner_user_id: str | None = None


class CancelManager:
    def __init__(self) -> None:
        self._cancellations: dict[str, ThreadCancellationRecord] = {}

    @staticmethod
    def _normalize_identifier(value: str | None) -> str:
        return str(value or "").strip()

    @staticmethod
    def _prune_completed_tasks(record: ThreadCancellationRecord) -> None:
        if not record.tasks:
            return
        record.tasks = {task for task in record.tasks if not task.done()}

    def get_record(self, thread_id: str) -> ThreadCancellationRecord | None:
        normalized_thread_id = self._normalize_identifier(thread_id)
        if not normalized_thread_id:
            return None
        record = self._cancellations.get(normalized_thread_id)
        if record is not None:
            self._prune_completed_tasks(record)
        return record

    def get_owner_user_id(self, thread_id: str) -> str | None:
        record = self.get_record(thread_id)
        if record is None:
            return None
        return record.owner_user_id

    def register_thread(
        self,
        thread_id: str,
        owner_user_id: str | None = None,
    ) -> ThreadCancellationRecord | None:
        normalized_thread_id = self._normalize_identifier(thread_id)
        normalized_owner_user_id = self._normalize_identifier(owner_user_id) or None
        if not normalized_thread_id:
            return None

        record = self.get_record(normalized_thread_id)
        if record is None or (record.event.is_set() and not record.tasks):
            record = ThreadCancellationRecord(owner_user_id=normalized_owner_user_id)
            self._cancellations[normalized_thread_id] = record
            return record

        if normalized_owner_user_id and not record.owner_user_id:
            record.owner_user_id = normalized_owner_user_id

        if normalized_owner_user_id and record.owner_user_id != normalized_owner_user_id:
            logger.warning(
                "Ignoring mismatched cancellation owner thread_id=%s current_owner=%s attempted_owner=%s",
                normalized_thread_id,
                record.owner_user_id,
                normalized_owner_user_id,
            )

        return record

    def register_task(
        self,
        thread_id: str,
        task: asyncio.Task[object] | asyncio.Task[None],
    ) -> None:
        record = self.register_thread(thread_id)
        if record is None:
            return

        record.tasks.add(task)

        def _discard_task(_completed_task: asyncio.Task[object] | asyncio.Task[None]) -> None:
            record.tasks.discard(_completed_task)

        task.add_done_callback(_discard_task)

        if record.event.is_set() and not task.done():
            task.cancel()

    def cancel_thread(self, thread_id: str, reason: str = "Request cancelled") -> None:
        normalized_thread_id = self._normalize_identifier(thread_id)
        if not normalized_thread_id:
            return

        record = self.get_record(normalized_thread_id)
        if record is None:
            return

        if not record.event.is_set():
            logger.warning(
                "Triggering global kill switch thread_id=%s reason=%s",
                normalized_thread_id,
                reason,
            )
        record.reason = reason or record.reason
        record.event.set()
        for task in list(record.tasks):
            if not task.done():
                task.cancel()

    def is_cancelled(self, thread_id: str) -> bool:
        normalized_thread_id = self._normalize_identifier(thread_id)
        if not normalized_thread_id:
            return False
        record = self.get_record(normalized_thread_id)
        return bool(record is not None and record.event.is_set())

    def get_reason(self, thread_id: str) -> str:
        normalized_thread_id = self._normalize_identifier(thread_id)
        if not normalized_thread_id:
            return "Request cancelled"
        record = self.get_record(normalized_thread_id)
        if record is None:
            return "Request cancelled"
        return record.reason

    async def raise_if_cancelled(self, thread_id: str) -> None:
        if self.is_cancelled(thread_id):
            raise asyncio.CancelledError(self.get_reason(thread_id))

    def cleanup_thread(self, thread_id: str) -> None:
        normalized_thread_id = self._normalize_identifier(thread_id)
        if not normalized_thread_id:
            return
        self._cancellations.pop(normalized_thread_id, None)


cancel_manager = CancelManager()


async def raise_if_cancelled(thread_id: str) -> None:
    await cancel_manager.raise_if_cancelled(thread_id)


async def execute_with_kill_switch(
    thread_id: str,
    coro: Awaitable[object],
    *,
    poll_interval_seconds: float = DEFAULT_KILL_SWITCH_POLL_INTERVAL_SECONDS,
    task_name: str | None = None,
) -> object:
    normalized_thread_id = str(thread_id or "").strip()
    if not normalized_thread_id:
        return await coro

    task = asyncio.create_task(
        coro,
        name=task_name or f"kill-switch-target:{normalized_thread_id}",
    )
    cancel_manager.register_task(normalized_thread_id, task)

    async def _monitor_cancellation() -> None:
        while not task.done():
            if cancel_manager.is_cancelled(normalized_thread_id):
                reason = cancel_manager.get_reason(normalized_thread_id)
                logger.warning(
                    "Active kill switch triggered thread_id=%s reason=%s",
                    normalized_thread_id,
                    reason,
                )
                task.cancel(reason)
                with suppress(asyncio.CancelledError, asyncio.TimeoutError, Exception):
                    await asyncio.wait_for(task, timeout=poll_interval_seconds)
                raise GlobalKillSwitchTriggered(reason)
            await asyncio.sleep(poll_interval_seconds)

    monitor_task = asyncio.create_task(
        _monitor_cancellation(),
        name=f"kill-switch-monitor:{normalized_thread_id}",
    )

    try:
        done, _pending = await asyncio.wait(
            {task, monitor_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if monitor_task in done:
            monitor_exception = monitor_task.exception()
            if monitor_exception is not None:
                raise monitor_exception
        if task in done:
            if task.cancelled():
                if cancel_manager.is_cancelled(normalized_thread_id):
                    raise GlobalKillSwitchTriggered(
                        cancel_manager.get_reason(normalized_thread_id),
                    )
                raise asyncio.CancelledError()
            task_exception = task.exception()
            if task_exception is not None:
                raise task_exception
            return task.result()

        return await task
    finally:
        if not monitor_task.done():
            monitor_task.cancel()
            with suppress(asyncio.CancelledError):
                await monitor_task
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError, asyncio.TimeoutError, Exception):
                await asyncio.wait_for(task, timeout=poll_interval_seconds)
