import asyncio

import app.services.scheduler as scheduler_module


class DummySession:
    def __init__(self) -> None:
        self.rolled_back = False
        self.closed = False

    def rollback(self) -> None:
        self.rolled_back = True

    def close(self) -> None:
        self.closed = True


def test_run_material_cleanup_job_executes_cleanup_and_closes_session(
    monkeypatch,
):
    dummy_session = DummySession()
    observed: dict[str, object] = {}

    async def fake_cleanup(db) -> int:
        observed["db"] = db
        return 5

    monkeypatch.setattr(scheduler_module, "SessionLocal", lambda: dummy_session)
    monkeypatch.setattr(
        scheduler_module,
        "cleanup_abandoned_materials",
        fake_cleanup,
    )

    asyncio.run(scheduler_module.run_material_cleanup_job())

    assert observed["db"] is dummy_session
    assert dummy_session.closed is True
    assert dummy_session.rolled_back is False


def test_create_scheduler_registers_cleanup_job() -> None:
    scheduler = scheduler_module.create_scheduler()
    try:
        job = scheduler.get_job("cleanup_abandoned_materials")
        assert job is not None
    finally:
        if scheduler.running:
            scheduler.shutdown(wait=False)
