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
        lifecycle_job = scheduler.get_job("oss_lifecycle_rollout")
        assert lifecycle_job is not None
    finally:
        if scheduler.running:
            scheduler.shutdown(wait=False)


def test_run_oss_lifecycle_rollout_job_skips_when_disabled(monkeypatch):
    observed: dict[str, object] = {}

    def fake_create_storage_client(preferred_backend=None):
        observed["backend"] = preferred_backend
        raise AssertionError("storage client should not be created when disabled")

    monkeypatch.delenv("OSS_AUTO_SETUP_LIFECYCLE", raising=False)
    monkeypatch.setattr(scheduler_module, "create_storage_client", fake_create_storage_client)

    asyncio.run(scheduler_module.run_oss_lifecycle_rollout_job())

    assert observed == {}


def test_run_oss_lifecycle_rollout_job_sets_lifecycle_when_enabled(monkeypatch):
    observed: dict[str, object] = {}

    class FakeStorageClient:
        def setup_bucket_lifecycle(self) -> None:
            observed["setup_called"] = True

    def fake_create_storage_client(preferred_backend=None):
        observed["backend"] = preferred_backend
        return FakeStorageClient()

    monkeypatch.setenv("OSS_AUTO_SETUP_LIFECYCLE", "true")
    monkeypatch.setattr(scheduler_module, "create_storage_client", fake_create_storage_client)

    asyncio.run(scheduler_module.run_oss_lifecycle_rollout_job())

    assert observed == {"backend": "oss", "setup_called": True}
