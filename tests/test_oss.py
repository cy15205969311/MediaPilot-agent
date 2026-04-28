import asyncio
import shutil
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

import app.api.v1.chat as chat_module
import app.api.v1.oss as oss_module
import app.services.oss_client as storage_module
import app.services.persistence as persistence_module
from app.db.database import Base, get_db
from app.db.models import Material, Message, Thread, UploadRecord, User
from app.main import app
from app.models.schemas import MediaChatRequest


def register_user(
    client: TestClient,
    *,
    username: str,
    password: str = "super-secret-123",
) -> tuple[dict[str, str], dict[str, object]]:
    response = client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    payload = response.json()
    token = payload["access_token"]
    return {"Authorization": f"Bearer {token}"}, payload["user"]


@pytest.fixture()
def uploads_dir(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    test_uploads_dir = tmp_path / "uploads"
    test_uploads_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(storage_module, "LOCAL_UPLOADS_DIR", test_uploads_dir)
    yield test_uploads_dir
    shutil.rmtree(test_uploads_dir, ignore_errors=True)


@pytest.fixture()
def session_factory(tmp_path: Path):
    database_path = tmp_path / "test_oss.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    yield testing_session_local

    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def client(session_factory, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OMNIMEDIA_STORAGE_BACKEND", "local")
    monkeypatch.delenv("OSS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("OSS_ACCESS_KEY_SECRET", raising=False)
    monkeypatch.delenv("OSS_ENDPOINT", raising=False)
    monkeypatch.delenv("OSS_BUCKET_NAME", raising=False)
    monkeypatch.delenv("OSS_REGION", raising=False)
    monkeypatch.delenv("OSS_PUBLIC_BASE_URL", raising=False)

    def override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def test_upload_media_requires_authentication(client: TestClient):
    response = client.post(
        "/api/v1/media/upload",
        files={"file": ("avatar.jpg", BytesIO(b"tiny-jpg"), "image/jpeg")},
    )

    assert response.status_code == 401


def test_upload_retention_summary_requires_authentication(client: TestClient):
    response = client.get("/api/v1/media/retention")

    assert response.status_code == 401


def test_upload_media_tracks_avatar_record_metadata(
    client: TestClient,
    uploads_dir: Path,
    session_factory,
):
    headers, user = register_user(client, username="alice-upload")
    file_bytes = b"tiny-jpg"

    response = client.post(
        "/api/v1/media/upload",
        headers=headers,
        data={"purpose": "avatar"},
        files={"file": ("avatar.jpg", BytesIO(file_bytes), "image/jpeg")},
    )

    assert response.status_code == 200
    payload = response.json()
    user_upload_dir = uploads_dir / str(user["id"])

    assert payload["url"].startswith(f"/uploads/{user['id']}/")
    assert payload["filename"].endswith(".jpg")
    assert payload["filename"] != "avatar.jpg"
    assert payload["original_filename"] == "avatar.jpg"
    assert payload["purpose"] == "avatar"
    assert payload["thread_id"] is None
    assert (user_upload_dir / payload["filename"]).exists()

    with session_factory() as db:
        record = db.scalar(
            select(UploadRecord).where(
                UploadRecord.user_id == user["id"],
                UploadRecord.filename == payload["filename"],
            )
        )

    assert record is not None
    assert record.file_path == f"{user['id']}/{payload['filename']}"
    assert record.mime_type == "image/jpeg"
    assert record.file_size == len(file_bytes)
    assert record.purpose == "avatar"
    assert record.thread_id is None


def test_upload_retention_summary_is_user_scoped(
    client: TestClient,
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("OMNIMEDIA_STORAGE_BACKEND", "oss")
    monkeypatch.setenv("OSS_AUTO_SETUP_LIFECYCLE", "true")
    monkeypatch.setenv("OSS_SIGNED_URL_EXPIRE_SECONDS", "1800")
    monkeypatch.setenv("OSS_TMP_UPLOAD_EXPIRE_DAYS", "5")
    monkeypatch.setenv("OSS_THREAD_UPLOAD_TRANSITION_DAYS", "45")
    monkeypatch.setenv("OSS_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS", "Archive")
    headers, user = register_user(client, username="alice-retention")
    _, other_user = register_user(client, username="bob-retention")
    user_id = str(user["id"])
    other_user_id = str(other_user["id"])
    now = datetime.now(timezone.utc)

    with session_factory() as db:
        db.add_all(
            [
                UploadRecord(
                    user_id=user_id,
                    filename="tmp.png",
                    file_path=f"oss://uploads/tmp/{user_id}/tmp.png",
                    mime_type="image/png",
                    file_size=100,
                    purpose="material",
                    thread_id=None,
                    created_at=now - timedelta(days=2),
                ),
                UploadRecord(
                    user_id=user_id,
                    filename="thread.png",
                    file_path=f"oss://uploads/{user_id}/thread.png",
                    mime_type="image/png",
                    file_size=200,
                    purpose="material",
                    thread_id="thread-retention",
                    created_at=now,
                ),
                UploadRecord(
                    user_id=user_id,
                    filename="avatar.jpg",
                    file_path=f"oss://uploads/{user_id}/avatar.jpg",
                    mime_type="image/jpeg",
                    file_size=50,
                    purpose="avatar",
                    thread_id=None,
                    created_at=now,
                ),
                UploadRecord(
                    user_id=other_user_id,
                    filename="other.png",
                    file_path=f"oss://uploads/{other_user_id}/other.png",
                    mime_type="image/png",
                    file_size=999,
                    purpose="material",
                    thread_id="other-thread",
                    created_at=now,
                ),
            ]
        )
        db.commit()

    response = client.get("/api/v1/media/retention", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["storage_backend"] == "oss"
    assert payload["total_files"] == 3
    assert payload["total_bytes"] == 350
    assert payload["temporary_files"] == 1
    assert payload["temporary_bytes"] == 100
    assert payload["thread_material_files"] == 1
    assert payload["thread_material_bytes"] == 200
    assert payload["avatar_files"] == 1
    assert payload["avatar_bytes"] == 50
    assert payload["stale_unbound_material_files"] == 1
    assert payload["signed_url_expires_seconds"] == 1800
    assert payload["lifecycle_auto_rollout_enabled"] is True
    assert payload["tmp_upload_expire_days"] == 5
    assert payload["thread_upload_transition_days"] == 45
    assert payload["thread_upload_transition_storage_class"] == "Archive"


def test_upload_media_persists_thread_id_when_provided(
    client: TestClient,
    session_factory,
):
    headers, user = register_user(client, username="alice-upload-thread")

    with session_factory() as db:
        db.add(
            Thread(
                id="thread-upload-binding",
                user_id=str(user["id"]),
                title="Upload binding",
                system_prompt="",
            )
        )
        db.commit()

    response = client.post(
        "/api/v1/media/upload",
        headers=headers,
        data={"purpose": "material", "thread_id": "thread-upload-binding"},
        files={"file": ("brief.md", BytesIO(b"# brief"), "text/markdown")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["purpose"] == "material"
    assert payload["thread_id"] == "thread-upload-binding"

    with session_factory() as db:
        record = db.scalar(
            select(UploadRecord).where(
                UploadRecord.user_id == str(user["id"]),
                UploadRecord.filename == payload["filename"],
            )
        )

    assert record is not None
    assert record.thread_id == "thread-upload-binding"


def test_upload_media_uses_oss_storage_backend_when_configured(
    client: TestClient,
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
):
    headers, user = register_user(client, username="alice-upload-oss")
    captured: dict[str, object] = {}

    class FakeOSSStorageClient:
        backend_name = "oss"

        def build_temporary_object_key(self, *, user_id: str, filename: str) -> str:
            return f"uploads/tmp/{user_id}/{filename}"

        async def upload_file_stream(
            self,
            *,
            user_id: str,
            filename: str,
            content_type: str,
            file_stream,
            object_key: str | None = None,
        ):
            captured["upload"] = {
                "user_id": user_id,
                "filename": filename,
                "content_type": content_type,
                "data": file_stream.read(),
                "object_key": object_key,
            }
            return storage_module.StoredUpload(
                backend_name="oss",
                object_key=object_key or f"uploads/{user_id}/{filename}",
                public_url=f"https://media-bucket.oss-cn-hangzhou.aliyuncs.com/{object_key or f'uploads/{user_id}/{filename}'}",
            )

        async def delete_file(self, object_key: str) -> None:
            captured["deleted"] = object_key

        def build_delivery_url(self, object_key: str, *, expires_in: int | None = None) -> str:
            resolved_expires = expires_in or 3600
            return f"https://signed-media.example.com/{object_key}?Expires={resolved_expires}"

    monkeypatch.setattr(oss_module, "create_storage_client", lambda: FakeOSSStorageClient())

    response = client.post(
        "/api/v1/media/upload",
        headers=headers,
        files={"file": ("cover.png", BytesIO(b"oss-image"), "image/png")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["url"].startswith("https://signed-media.example.com/uploads/tmp/")
    assert captured["upload"] == {
        "user_id": str(user["id"]),
        "filename": payload["filename"],
        "content_type": "image/png",
        "data": b"oss-image",
        "object_key": f"uploads/tmp/{user['id']}/{payload['filename']}",
    }

    with session_factory() as db:
        record = db.scalar(
            select(UploadRecord).where(
                UploadRecord.user_id == str(user["id"]),
                UploadRecord.filename == payload["filename"],
            )
        )

    assert record is not None
    assert record.file_path == f"oss://uploads/tmp/{user['id']}/{payload['filename']}"


def test_upload_media_rejects_unsupported_type(client: TestClient):
    headers, _ = register_user(client, username="alice-upload-type")

    response = client.post(
        "/api/v1/media/upload",
        headers=headers,
        files={"file": ("payload.exe", BytesIO(b"not-allowed"), "application/octet-stream")},
    )

    assert response.status_code == 415
    assert "仅支持上传" in response.json()["detail"]


def test_upload_media_rejects_oversized_file(
    client: TestClient,
    uploads_dir: Path,
):
    headers, user = register_user(client, username="alice-upload-size")
    oversized_file = BytesIO(b"a" * (oss_module.MAX_UPLOAD_SIZE + 1))

    response = client.post(
        "/api/v1/media/upload",
        headers=headers,
        files={"file": ("oversized.pdf", oversized_file, "application/pdf")},
    )

    assert response.status_code == 413
    assert "15MB" in response.json()["detail"]

    user_upload_dir = uploads_dir / str(user["id"])
    if user_upload_dir.exists():
        assert list(user_upload_dir.iterdir()) == []


def test_profile_update_cleans_orphaned_avatar_uploads(
    client: TestClient,
    uploads_dir: Path,
    session_factory,
):
    headers, user = register_user(client, username="alice-avatar-cleanup")
    user_id = str(user["id"])
    user_dir = uploads_dir / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    old_avatar_path = user_dir / "old-avatar.webp"
    current_avatar_path = user_dir / "current-avatar.webp"
    old_avatar_path.write_bytes(b"old")
    current_avatar_path.write_bytes(b"current")

    stale_time = datetime.now(timezone.utc) - timedelta(hours=2)

    with session_factory() as db:
        db.add_all(
            [
                UploadRecord(
                    user_id=user_id,
                    filename="old-avatar.webp",
                    file_path=f"{user_id}/old-avatar.webp",
                    mime_type="image/webp",
                    file_size=3,
                    purpose="avatar",
                    created_at=stale_time,
                ),
                UploadRecord(
                    user_id=user_id,
                    filename="current-avatar.webp",
                    file_path=f"{user_id}/current-avatar.webp",
                    mime_type="image/webp",
                    file_size=7,
                    purpose="avatar",
                    created_at=stale_time,
                ),
            ]
        )
        db.commit()

    response = client.patch(
        "/api/v1/auth/profile",
        json={"avatar_url": f"/uploads/{user_id}/current-avatar.webp"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json()["avatar_url"] == f"/uploads/{user_id}/current-avatar.webp"
    assert not old_avatar_path.exists()
    assert current_avatar_path.exists()

    with session_factory() as db:
        records = list(
            db.scalars(select(UploadRecord).where(UploadRecord.user_id == user_id)).all()
        )
        refreshed_user = db.get(User, user_id)

    assert len(records) == 1
    assert records[0].filename == "current-avatar.webp"
    assert refreshed_user is not None
    assert refreshed_user.avatar_url == f"{user_id}/current-avatar.webp"


def test_thread_history_returns_signed_oss_material_url(
    client: TestClient,
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
):
    headers, user = register_user(client, username="alice-history-oss-signed")
    user_id = str(user["id"])

    class FakeOSSStorageClient:
        backend_name = "oss"

        def build_delivery_url(self, object_key: str, *, expires_in: int | None = None) -> str:
            resolved_expires = expires_in or 3600
            return f"https://signed-media.example.com/{object_key}?Expires={resolved_expires}"

    monkeypatch.setattr(
        storage_module,
        "create_storage_client",
        lambda preferred_backend=None: FakeOSSStorageClient()
        if preferred_backend == "oss"
        else storage_module.LocalStorageClient(),
    )

    with session_factory() as db:
        db.add(
            Thread(
                id="thread-oss-history",
                user_id=user_id,
                title="OSS History",
                system_prompt="",
            )
        )
        message = Message(
            thread_id="thread-oss-history",
            role="user",
            content="请分析这张图",
        )
        db.add(message)
        db.flush()
        db.add(
            Material(
                thread_id="thread-oss-history",
                message_id=message.id,
                type="image",
                url=f"oss://uploads/{user_id}/cover.png",
                text="cover.png",
            )
        )
        db.commit()

    response = client.get(
        "/api/v1/media/threads/thread-oss-history/messages",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    material = payload["messages"][0]["materials"][0]
    assert material["url"] == f"https://signed-media.example.com/uploads/{user_id}/cover.png?Expires=3600"


def test_cleanup_abandoned_materials_removes_stale_unbound_uploads(
    client: TestClient,
    uploads_dir: Path,
    session_factory,
):
    _, user = register_user(client, username="alice-material-cleanup")
    user_id = str(user["id"])
    user_dir = uploads_dir / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    stale_file = user_dir / "stale-material.pdf"
    stale_file.write_bytes(b"data")
    stale_time = (
        datetime.now(timezone.utc)
        - persistence_module.MATERIAL_RETENTION_WINDOW
        - timedelta(minutes=5)
    )

    with session_factory() as db:
        db.add(
            UploadRecord(
                user_id=user_id,
                filename="stale-material.pdf",
                file_path=f"{user_id}/stale-material.pdf",
                mime_type="application/pdf",
                file_size=4,
                purpose="material",
                thread_id=None,
                created_at=stale_time,
            )
        )
        db.commit()

    with session_factory() as db:
        deleted_count = asyncio.run(persistence_module.cleanup_abandoned_materials(db))

    assert deleted_count == 1
    assert not stale_file.exists()

    with session_factory() as db:
        remaining = list(db.scalars(select(UploadRecord)).all())

    assert remaining == []


def test_cleanup_abandoned_materials_deletes_oss_objects_via_storage_backend(
    client: TestClient,
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
):
    _, user = register_user(client, username="alice-oss-material-cleanup")
    user_id = str(user["id"])
    stale_time = (
        datetime.now(timezone.utc)
        - persistence_module.MATERIAL_RETENTION_WINDOW
        - timedelta(minutes=5)
    )
    deleted_keys: list[str] = []

    class FakeOSSStorageClient:
        async def delete_file(self, object_key: str) -> None:
            deleted_keys.append(object_key)

    def fake_create_storage_client(preferred_backend: str | None = None):
        assert preferred_backend == "oss"
        return FakeOSSStorageClient()

    monkeypatch.setattr(
        persistence_module,
        "create_storage_client",
        fake_create_storage_client,
    )

    with session_factory() as db:
        db.add(
            UploadRecord(
                user_id=user_id,
                filename="stale-material.pdf",
                file_path=f"oss://uploads/{user_id}/stale-material.pdf",
                mime_type="application/pdf",
                file_size=4,
                purpose="material",
                thread_id=None,
                created_at=stale_time,
            )
        )
        db.commit()

    with session_factory() as db:
        deleted_count = asyncio.run(persistence_module.cleanup_abandoned_materials(db))

    assert deleted_count == 1
    assert deleted_keys == [f"uploads/{user_id}/stale-material.pdf"]

    with session_factory() as db:
        remaining = list(db.scalars(select(UploadRecord)).all())

    assert remaining == []


def test_delete_thread_cleans_up_linked_material_uploads_immediately(
    client: TestClient,
    uploads_dir: Path,
    session_factory,
):
    headers, user = register_user(client, username="alice-thread-gc")
    user_id = str(user["id"])
    user_dir = uploads_dir / user_id
    user_dir.mkdir(parents=True, exist_ok=True)

    material_file = user_dir / "thread-material.png"
    material_file.write_bytes(b"png")

    with session_factory() as db:
        db.add(
            Thread(
                id="thread-delete-gc",
                user_id=user_id,
                title="To delete",
                system_prompt="",
            )
        )
        db.add(
            UploadRecord(
                user_id=user_id,
                filename="thread-material.png",
                file_path=f"{user_id}/thread-material.png",
                mime_type="image/png",
                file_size=3,
                purpose="material",
                thread_id="thread-delete-gc",
                created_at=datetime.now(timezone.utc),
            )
        )
        db.commit()

    response = client.delete("/api/v1/media/threads/thread-delete-gc", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"id": "thread-delete-gc", "deleted": True}
    assert not material_file.exists()

    with session_factory() as db:
        record = db.scalar(
            select(UploadRecord).where(
                UploadRecord.user_id == user_id,
                UploadRecord.filename == "thread-material.png",
            )
        )

    assert record is None


def test_persist_chat_request_backfills_material_upload_thread_id(session_factory):
    engine_session = session_factory()
    try:
        user = User(
            username="alice-bind-upload",
            hashed_password="hashed-password",
        )
        engine_session.add(user)
        engine_session.flush()
        user_id = user.id

        engine_session.add(
            UploadRecord(
                user_id=user_id,
                filename="brief.md",
                file_path=f"{user_id}/brief.md",
                mime_type="text/markdown",
                file_size=8,
                purpose="material",
                thread_id=None,
                created_at=datetime.now(timezone.utc),
            )
        )
        engine_session.commit()

        request = MediaChatRequest.model_validate(
            {
                "thread_id": "thread-bind-after-chat",
                "platform": "xiaohongshu",
                "task_type": "content_generation",
                "message": "请根据素材生成内容草稿",
                "materials": [
                    {
                        "type": "text_link",
                        "url": f"http://testserver/uploads/{user_id}/brief.md",
                        "text": "素材摘要",
                    }
                ],
            }
        )

        persisted_user = engine_session.get(User, user_id)
        assert persisted_user is not None

        chat_module.persist_chat_request(engine_session, request, persisted_user)

        record = engine_session.scalar(
            select(UploadRecord).where(
                UploadRecord.user_id == user_id,
                UploadRecord.filename == "brief.md",
            )
        )
        thread = engine_session.get(Thread, "thread-bind-after-chat")

        assert record is not None
        assert record.thread_id == "thread-bind-after-chat"
        assert thread is not None
        assert thread.user_id == user_id
    finally:
        engine_session.close()


def test_persist_chat_request_backfills_oss_material_upload_thread_id(
    session_factory,
    monkeypatch: pytest.MonkeyPatch,
):
    engine_session = session_factory()
    try:
        user = User(
            username="alice-bind-oss-upload",
            hashed_password="hashed-password",
        )
        engine_session.add(user)
        engine_session.flush()
        user_id = user.id

        monkeypatch.setenv("OSS_ACCESS_KEY_ID", "test-key-id")
        monkeypatch.setenv("OSS_ACCESS_KEY_SECRET", "test-key-secret")
        monkeypatch.setenv("OSS_ENDPOINT", "https://oss-cn-hangzhou.aliyuncs.com")
        monkeypatch.setenv("OSS_BUCKET_NAME", "media-bucket")
        monkeypatch.setenv("OSS_REGION", "cn-hangzhou")
        monkeypatch.setenv(
            "OSS_PUBLIC_BASE_URL",
            "https://media-bucket.oss-cn-hangzhou.aliyuncs.com",
        )
        copied_objects: list[tuple[str, str]] = []

        class FakeOSSStorageClient:
            backend_name = "oss"

            def build_object_key(self, *, user_id: str, filename: str) -> str:
                return f"uploads/{user_id}/{filename}"

            def copy_file_sync(
                self,
                source_object_key: str,
                destination_object_key: str,
            ) -> None:
                copied_objects.append((source_object_key, destination_object_key))

        monkeypatch.setattr(
            persistence_module,
            "create_storage_client",
            lambda preferred_backend=None: FakeOSSStorageClient(),
        )

        engine_session.add(
            UploadRecord(
                user_id=user_id,
                filename="brief.md",
                file_path=f"oss://uploads/tmp/{user_id}/brief.md",
                mime_type="text/markdown",
                file_size=8,
                purpose="material",
                thread_id=None,
                created_at=datetime.now(timezone.utc),
            )
        )
        engine_session.commit()

        request = MediaChatRequest.model_validate(
            {
                "thread_id": "thread-bind-after-oss-chat",
                "platform": "xiaohongshu",
                "task_type": "content_generation",
                "message": "请根据素材生成内容草稿",
                "materials": [
                    {
                        "type": "text_link",
                        "url": f"https://media-bucket.oss-cn-hangzhou.aliyuncs.com/uploads/tmp/{user_id}/brief.md?Expires=3600&Signature=test",
                        "text": "素材摘要",
                    }
                ],
            }
        )

        persisted_user = engine_session.get(User, user_id)
        assert persisted_user is not None

        chat_module.persist_chat_request(engine_session, request, persisted_user)

        record = engine_session.scalar(
            select(UploadRecord).where(
                UploadRecord.user_id == user_id,
                UploadRecord.filename == "brief.md",
            )
        )
        thread = engine_session.get(Thread, "thread-bind-after-oss-chat")

        assert record is not None
        assert record.thread_id == "thread-bind-after-oss-chat"
        assert record.file_path == f"oss://uploads/{user_id}/brief.md"
        assert thread is not None
        assert thread.user_id == user_id
        assert copied_objects == [
            (f"uploads/tmp/{user_id}/brief.md", f"uploads/{user_id}/brief.md")
        ]
    finally:
        engine_session.close()
