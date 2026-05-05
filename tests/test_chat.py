import asyncio
import json
import logging
from pathlib import Path
from asyncio import tasks as asyncio_tasks

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker

import app.api.v1.chat as chat_api_module
import app.core.cancel_manager as cancel_manager_module
import app.services.agent as agent_module
import app.api.v1.knowledge as knowledge_api_module
import app.services.knowledge_base as knowledge_base_module
import app.services.persistence as persistence_module
import app.services.providers as providers_module
from app.db.database import Base, get_db
from app.db.models import (
    AccessTokenBlacklist,
    AuditLog,
    ArtifactRecord,
    Message,
    SystemNotification,
    Thread,
    TokenTransaction,
    UploadRecord,
    User,
)
from app.main import app
from app.models.schemas import (
    AdminTemplatePlatform,
    CommentReplyArtifactPayload,
    ContentGenerationArtifactPayload,
    HotPostAnalysisArtifactPayload,
    ImageGenerationArtifactPayload,
    TemplateCategory,
    TemplatePlatform,
    TopicPlanningArtifactPayload,
)
from app.services.auth import ACCESS_TOKEN_TYPE, create_access_token, decode_token_payload
from app.services.graph import LangGraphProvider
from app.services.model_access import PREMIUM_MODEL_ACCESS_DENIED_DETAIL
from app.services.tools import get_business_tools


def parse_sse_events(raw_stream: str) -> list[dict[str, object]]:
    events: list[dict[str, object]] = []

    for block in raw_stream.replace("\r\n", "\n").split("\n\n"):
        if not block.strip():
            continue

        event_name = ""
        data_payload = ""

        for line in block.split("\n"):
            if line.startswith("event:"):
                event_name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data_payload += line.split(":", 1)[1].strip()

        if not event_name or not data_payload:
            continue

        payload = json.loads(data_payload)
        payload["event"] = event_name
        events.append(payload)

    return events


def register_user(
    client: TestClient,
    *,
    username: str,
    password: str = "super-secret-123",
) -> dict[str, str]:
    payload = register_auth_response(client, username=username, password=password)
    token = payload["access_token"]
    return {"Authorization": f"Bearer {token}"}


def register_admin_user(
    client: TestClient,
    *,
    username: str,
    password: str = "super-secret-123",
    role: str = "admin",
) -> dict[str, str]:
    headers = register_user(client, username=username, password=password)

    with client.app.state.testing_session_local() as db:
        user = db.scalar(select(User).where(User.username == username))
        assert user is not None
        user.role = role
        db.commit()

    return headers


def register_auth_response(
    client: TestClient,
    *,
    username: str,
    password: str = "super-secret-123",
) -> dict[str, object]:
    response = client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return response.json()


def login_user(
    client: TestClient,
    *,
    username: str,
    password: str = "super-secret-123",
) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        data={"username": username, "password": password},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def decode_access_token(token: str):
    return decode_token_payload(token=token, expected_token_type=ACCESS_TOKEN_TYPE)


def collect_stream_events(
    client: TestClient,
    payload: dict[str, object],
    *,
    headers: dict[str, str],
) -> list[dict[str, object]]:
    with client.stream(
        "POST",
        "/api/v1/media/chat/stream",
        json=payload,
        headers=headers,
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        raw_stream = "".join(response.iter_text())

    events = parse_sse_events(raw_stream)
    event_names = [str(event["event"]) for event in events]
    assert event_names
    assert event_names[0] == "start"
    assert event_names[-1] == "done"
    assert "message" in event_names
    assert "error" not in event_names

    return events


def collect_raw_stream_events(
    client: TestClient,
    payload: dict[str, object],
    *,
    headers: dict[str, str],
) -> list[dict[str, object]]:
    with client.stream(
        "POST",
        "/api/v1/media/chat/stream",
        json=payload,
        headers=headers,
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        raw_stream = "".join(response.iter_text())

    return parse_sse_events(raw_stream)


def assert_artifact_matches_schema(
    client: TestClient,
    payload: dict[str, object],
    *,
    headers: dict[str, str],
    schema: type[BaseModel],
    expected_artifact_type: str,
) -> BaseModel:
    events = collect_stream_events(client, payload, headers=headers)
    artifact_event = next(event for event in events if event["event"] == "artifact")
    artifact = schema.model_validate(artifact_event["artifact"])
    assert getattr(artifact, "artifact_type") == expected_artifact_type
    return artifact


def create_artifact_draft(
    client: TestClient,
    *,
    headers: dict[str, str],
    thread_id: str,
    platform: str = "xiaohongshu",
    task_type: str = "content_generation",
    message: str = "Create a saved artifact draft for regression coverage.",
    system_prompt: str = "You are a helpful media copilot.",
    thread_title: str = "Artifact regression thread",
) -> None:
    collect_stream_events(
        client,
        {
            "thread_id": thread_id,
            "platform": platform,
            "task_type": task_type,
            "message": message,
            "materials": [],
            "system_prompt": system_prompt,
            "thread_title": thread_title,
        },
        headers=headers,
    )


@pytest.fixture()
def no_sleep(monkeypatch: pytest.MonkeyPatch):
    async def immediate_sleep(_: float) -> None:
        return None

    monkeypatch.setattr(providers_module.asyncio, "sleep", immediate_sleep)


@pytest.fixture()
def client(tmp_path: Path, no_sleep: None):
    database_path = tmp_path / "test_chat.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False, "timeout": 20},
    )
    testing_session_local = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = testing_session_local()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    original_provider = agent_module.media_agent_workflow.provider
    agent_module.media_agent_workflow.provider = providers_module.MockLLMProvider()

    try:
        with TestClient(app) as test_client:
            test_client.app.state.testing_session_local = testing_session_local
            yield test_client
    finally:
        agent_module.media_agent_workflow.provider = original_provider
        app.dependency_overrides.clear()


@pytest.fixture()
def isolated_knowledge_base(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    knowledge_dir = tmp_path / "knowledge-base"
    monkeypatch.setenv("OMNIMEDIA_KNOWLEDGE_BASE_DIR", str(knowledge_dir))
    knowledge_base_module._knowledge_base_service = None
    try:
        yield knowledge_dir
    finally:
        knowledge_base_module._knowledge_base_service = None


def test_auth_register_and_login(client: TestClient):
    register_response = client.post(
        "/api/v1/auth/register",
        json={"username": "alice", "password": "super-secret-123"},
    )
    assert register_response.status_code == 200
    register_payload = register_response.json()
    assert register_payload["token_type"] == "bearer"
    assert isinstance(register_payload["access_token"], str)
    assert isinstance(register_payload["refresh_token"], str)
    assert register_payload["user"]["username"] == "alice"
    assert register_payload["user"]["nickname"] is None
    assert register_payload["user"]["bio"] is None
    assert register_payload["user"]["token_balance"] == 10_000_000
    assert register_payload["user"]["created_at"].endswith("Z")

    with client.app.state.testing_session_local() as db:
        user = db.scalar(select(User).where(User.username == "alice"))
        assert user is not None
        assert user.token_balance == 10_000_000

        transaction = db.scalar(
            select(TokenTransaction).where(TokenTransaction.user_id == user.id)
        )
        assert transaction is not None
        assert transaction.amount == 10_000_000
        assert transaction.transaction_type == "grant"
        assert transaction.remark == "新用户注册千万算力福利"

    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "alice", "password": "super-secret-123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert login_response.status_code == 200
    assert isinstance(login_response.json()["refresh_token"], str)
    assert login_response.json()["user"]["username"] == "alice"


def test_admin_settings_update_bonus_affects_register_and_admin_provisioning(
    client: TestClient,
):
    headers = register_admin_user(
        client,
        username="super-admin-settings",
        role="super_admin",
    )

    get_response = client.get("/api/v1/admin/settings", headers=headers)
    assert get_response.status_code == 200
    grouped_payload = get_response.json()["categories"]
    token_settings = {
        item["key"]: item for item in grouped_payload["token"]
    }
    assert token_settings["new_user_bonus"]["value"] == 10_000_000
    assert token_settings["token_price"]["value"] == 0.008

    update_response = client.put(
        "/api/v1/admin/settings",
        headers=headers,
        json={
            "system_name": "MediaPilot Console",
            "new_user_bonus": "5000",
            "two_factor_auth": False,
        },
    )
    assert update_response.status_code == 200
    updated_payload = update_response.json()["categories"]
    updated_basic_settings = {
        item["key"]: item for item in updated_payload["basic"]
    }
    updated_token_settings = {
        item["key"]: item for item in updated_payload["token"]
    }
    updated_security_settings = {
        item["key"]: item for item in updated_payload["security"]
    }
    assert updated_basic_settings["system_name"]["value"] == "MediaPilot Console"
    assert updated_token_settings["new_user_bonus"]["value"] == 5000
    assert updated_security_settings["two_factor_auth"]["value"] is False

    with client.app.state.testing_session_local() as db:
        audit_log = db.scalar(
            select(AuditLog)
            .where(AuditLog.action_type == "update_system_settings")
            .order_by(AuditLog.created_at.desc())
        )
        assert audit_log is not None
        assert audit_log.target_name == "系统配置"
        assert set(audit_log.details["changed_keys"]) == {
            "system_name",
            "new_user_bonus",
            "two_factor_auth",
        }

    register_response = client.post(
        "/api/v1/auth/register",
        json={"username": "alice-settings-bonus", "password": "super-secret-123"},
    )
    assert register_response.status_code == 200
    assert register_response.json()["user"]["token_balance"] == 5000

    create_response = client.post(
        "/api/v1/admin/users",
        headers=headers,
        json={
            "username": "managed-settings-bonus",
            "password": "super-secret-123",
            "role": "user",
        },
    )
    assert create_response.status_code == 201
    assert create_response.json()["token_balance"] == 5000

    with client.app.state.testing_session_local() as db:
        managed_user = db.scalar(
            select(User).where(User.username == "managed-settings-bonus")
        )
        assert managed_user is not None
        grant_transactions = list(
            db.scalars(
                select(TokenTransaction).where(
                    TokenTransaction.user_id == managed_user.id,
                    TokenTransaction.transaction_type == "grant",
                )
            ).all()
        )
        assert len(grant_transactions) == 1
        assert grant_transactions[0].amount == 5000


def test_admin_settings_security_controls_apply_dynamic_expiry_and_ip_whitelist(
    client: TestClient,
):
    headers = register_admin_user(
        client,
        username="super-admin-security-settings",
        role="super_admin",
    )

    update_response = client.put(
        "/api/v1/admin/settings",
        headers={**headers, "X-Forwarded-For": "10.0.0.1"},
        json={
            "ip_whitelist_enabled": True,
            "ip_whitelist_ips": "10.0.0.1, 10.0.0.3",
            "session_timeout_enabled": True,
            "session_timeout_minutes": 5,
        },
    )
    assert update_response.status_code == 200
    security_settings = {
        item["key"]: item for item in update_response.json()["categories"]["security"]
    }
    assert security_settings["ip_whitelist_enabled"]["value"] is True
    assert security_settings["ip_whitelist_ips"]["value"] == "10.0.0.1, 10.0.0.3"
    assert security_settings["session_timeout_minutes"]["value"] == 5

    blocked_response = client.get(
        "/api/v1/admin/settings",
        headers={**headers, "X-Forwarded-For": "10.0.0.2"},
    )
    assert blocked_response.status_code == 403
    assert blocked_response.json()["detail"] == "您的 IP 地址不在安全访问白名单内"

    allowed_response = client.get(
        "/api/v1/admin/settings",
        headers={**headers, "X-Forwarded-For": "10.0.0.1"},
    )
    assert allowed_response.status_code == 200

    register_response = client.post(
        "/api/v1/auth/register",
        json={"username": "alice-security-expiry", "password": "super-secret-123"},
        headers={"X-Forwarded-For": "10.0.0.9"},
    )
    assert register_response.status_code == 200
    access_token_payload = decode_access_token(register_response.json()["access_token"])
    access_token_duration_seconds = (
        access_token_payload.expires_at - access_token_payload.issued_at
    ).total_seconds()
    assert 295 <= access_token_duration_seconds <= 305


def test_admin_settings_rollback_restores_snapshot_and_writes_audit_log(
    client: TestClient,
):
    headers = register_admin_user(
        client,
        username="super-admin-settings-rollback",
        role="super_admin",
    )

    update_response = client.put(
        "/api/v1/admin/settings",
        headers=headers,
        json={
            "token_price": "0.009",
            "new_user_bonus": "7777",
        },
    )
    assert update_response.status_code == 200

    with client.app.state.testing_session_local() as db:
        snapshot_log = db.scalar(
            select(AuditLog)
            .where(AuditLog.action_type == "update_system_settings")
            .order_by(AuditLog.created_at.desc())
        )
        assert snapshot_log is not None
        assert snapshot_log.details["changes"]["token_price"]["previous_value"] == 0.008
        assert snapshot_log.details["changes"]["new_user_bonus"]["previous_value"] == 10_000_000

    rollback_response = client.post(
        f"/api/v1/admin/settings/rollback/{snapshot_log.id}",
        headers=headers,
    )
    assert rollback_response.status_code == 200
    rollback_payload = rollback_response.json()
    assert rollback_payload["snapshot_audit_log_id"] == snapshot_log.id
    assert set(rollback_payload["rolled_back_keys"]) == {"token_price", "new_user_bonus"}

    settings_response = client.get("/api/v1/admin/settings", headers=headers)
    assert settings_response.status_code == 200
    token_settings = {
        item["key"]: item for item in settings_response.json()["categories"]["token"]
    }
    assert token_settings["token_price"]["value"] == 0.008
    assert token_settings["new_user_bonus"]["value"] == 10_000_000

    with client.app.state.testing_session_local() as db:
        rollback_log = db.scalar(
            select(AuditLog)
            .where(AuditLog.action_type == "rollback_system_settings")
            .order_by(AuditLog.created_at.desc())
        )
        assert rollback_log is not None
        assert rollback_log.details["snapshot_audit_log_id"] == snapshot_log.id
        assert set(rollback_log.details["changed_keys"]) == {"token_price", "new_user_bonus"}
        assert rollback_log.details["changes"]["token_price"]["previous_value"] == 0.009
        assert rollback_log.details["changes"]["token_price"]["next_value"] == 0.008

    duplicate_rollback_response = client.post(
        f"/api/v1/admin/settings/rollback/{snapshot_log.id}",
        headers=headers,
    )
    assert duplicate_rollback_response.status_code == 400
    assert duplicate_rollback_response.json()["detail"] == "当前配置已是该状态，无需回滚。"


def test_admin_notifications_and_pending_tasks_workflow(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("OMNIMEDIA_STORAGE_CAPACITY_BYTES", "1000")
    headers = register_admin_user(
        client,
        username="super-admin-notifications",
        role="super_admin",
    )

    create_response = client.post(
        "/api/v1/admin/users",
        headers=headers,
        json={
            "username": "ops-notification-user",
            "password": "super-secret-123",
            "role": "user",
        },
    )
    assert create_response.status_code == 201
    created_user = create_response.json()

    freeze_response = client.post(
        f"/api/v1/admin/users/{created_user['id']}/status",
        headers=headers,
        json={"status": "frozen"},
    )
    assert freeze_response.status_code == 200

    with client.app.state.testing_session_local() as db:
        db.add(
            UploadRecord(
                user_id=created_user["id"],
                filename="warning-video.mp4",
                file_path="/tmp/warning-video.mp4",
                mime_type="video/mp4",
                file_size=950,
                purpose="material",
            )
        )
        db.commit()

    notifications_response = client.get(
        "/api/v1/admin/notifications?limit=5",
        headers=headers,
    )
    assert notifications_response.status_code == 200
    notifications_payload = notifications_response.json()
    assert notifications_payload["unread_count"] >= 2
    assert len(notifications_payload["items"]) >= 2
    notification_titles = {item["title"] for item in notifications_payload["items"]}
    assert "新建用户成功" in notification_titles
    assert "用户状态已更新" in notification_titles
    assert any(item["is_read"] is False for item in notifications_payload["items"])

    pending_response = client.get(
        "/api/v1/admin/dashboard/pending-tasks",
        headers=headers,
    )
    assert pending_response.status_code == 200
    assert pending_response.json() == {
        "abnormal_users": 1,
        "storage_warnings": 1,
    }

    read_all_response = client.put(
        "/api/v1/admin/notifications/read_all",
        headers=headers,
    )
    assert read_all_response.status_code == 200
    assert read_all_response.json()["unread_count"] == 0

    with client.app.state.testing_session_local() as db:
        unread_count = db.scalar(
            select(func.count(SystemNotification.id)).where(
                SystemNotification.is_read.is_(False)
            )
        )
        assert unread_count == 0


def test_admin_user_list_supports_status_filter(client: TestClient):
    headers = register_admin_user(
        client,
        username="super-admin-filter-status",
        role="super_admin",
    )

    first_user_response = client.post(
        "/api/v1/admin/users",
        headers=headers,
        json={
            "username": "filter-frozen-user",
            "password": "super-secret-123",
            "role": "user",
        },
    )
    assert first_user_response.status_code == 201
    first_user = first_user_response.json()

    second_user_response = client.post(
        "/api/v1/admin/users",
        headers=headers,
        json={
            "username": "filter-active-user",
            "password": "super-secret-123",
            "role": "user",
        },
    )
    assert second_user_response.status_code == 201

    freeze_response = client.post(
        f"/api/v1/admin/users/{first_user['id']}/status",
        headers=headers,
        json={"status": "frozen"},
    )
    assert freeze_response.status_code == 200

    filtered_response = client.get(
        "/api/v1/admin/users?status=frozen",
        headers=headers,
    )
    assert filtered_response.status_code == 200
    filtered_payload = filtered_response.json()
    assert filtered_payload["total"] == 1
    assert len(filtered_payload["items"]) == 1
    assert filtered_payload["items"][0]["username"] == "filter-frozen-user"
    assert filtered_payload["items"][0]["status"] == "frozen"


def test_refresh_token_issues_new_session_tokens(client: TestClient):
    register_payload = register_auth_response(client, username="alice-refresh")

    refresh_response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": register_payload["refresh_token"]},
    )

    assert refresh_response.status_code == 200
    refresh_payload = refresh_response.json()
    assert refresh_payload["token_type"] == "bearer"
    assert refresh_payload["user"]["username"] == "alice-refresh"
    assert refresh_payload["access_token"] != register_payload["access_token"]
    assert refresh_payload["refresh_token"] != register_payload["refresh_token"]


def test_refresh_endpoint_rejects_access_token(client: TestClient):
    register_payload = register_auth_response(client, username="alice-refresh-invalid")

    refresh_response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": register_payload["access_token"]},
    )

    assert refresh_response.status_code == 401


def test_refresh_token_rotation_revokes_previous_session(client: TestClient):
    register_payload = register_auth_response(client, username="alice-rotation")

    first_refresh_response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": register_payload["refresh_token"]},
    )
    assert first_refresh_response.status_code == 200
    rotated_payload = first_refresh_response.json()

    reused_refresh_response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": register_payload["refresh_token"]},
    )
    assert reused_refresh_response.status_code == 401

    latest_refresh_response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": rotated_payload["refresh_token"]},
    )
    assert latest_refresh_response.status_code == 200


def test_logout_revokes_refresh_session(client: TestClient):
    register_payload = register_auth_response(client, username="alice-logout")
    access_token_payload = decode_access_token(register_payload["access_token"])

    logout_response = client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": register_payload["refresh_token"]},
        headers={"Authorization": f"Bearer {register_payload['access_token']}"},
    )

    assert logout_response.status_code == 200
    assert logout_response.json() == {"logged_out": True}

    refresh_response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": register_payload["refresh_token"]},
    )
    assert refresh_response.status_code == 401

    access_response = client.get(
        "/api/v1/media/threads",
        headers={"Authorization": f"Bearer {register_payload['access_token']}"},
    )
    assert access_response.status_code == 401

    with client.app.state.testing_session_local() as db:
        blacklist_entry = db.scalar(
            select(AccessTokenBlacklist).where(
                AccessTokenBlacklist.jti == access_token_payload.jti
            )
        )
        assert blacklist_entry is not None


def test_session_listing_marks_current_device_and_supports_targeted_revoke(
    client: TestClient,
):
    register_response = client.post(
        "/api/v1/auth/register",
        json={"username": "alice-sessions", "password": "super-secret-123"},
        headers={
            "User-Agent": "Mozilla/5.0 Chrome/123.0 Windows",
            "X-Forwarded-For": "10.0.0.1",
        },
    )
    assert register_response.status_code == 200
    first_payload = register_response.json()
    first_access_token = first_payload["access_token"]

    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "alice-sessions", "password": "super-secret-123"},
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 Firefox/124.0 Mac OS X",
            "X-Forwarded-For": "10.0.0.2",
        },
    )
    assert login_response.status_code == 200
    second_payload = login_response.json()
    second_access_token = second_payload["access_token"]

    sessions_response = client.get(
        "/api/v1/auth/sessions",
        headers={"Authorization": f"Bearer {second_access_token}"},
    )
    assert sessions_response.status_code == 200
    sessions_payload = sessions_response.json()
    assert len(sessions_payload["items"]) == 2

    current_session = next(
        item for item in sessions_payload["items"] if item["is_current"] is True
    )
    revoked_candidate = next(
        item for item in sessions_payload["items"] if item["is_current"] is False
    )

    assert current_session["ip_address"] == "10.0.0.2"
    assert "Firefox" in (current_session["device_info"] or "")
    assert revoked_candidate["ip_address"] == "10.0.0.1"
    assert "Chrome" in (revoked_candidate["device_info"] or "")

    revoke_response = client.delete(
        f"/api/v1/auth/sessions/{revoked_candidate['id']}",
        headers={"Authorization": f"Bearer {second_access_token}"},
    )
    assert revoke_response.status_code == 200
    assert revoke_response.json() == {
        "id": revoked_candidate["id"],
        "revoked": True,
    }

    sessions_after_revoke = client.get(
        "/api/v1/auth/sessions",
        headers={"Authorization": f"Bearer {second_access_token}"},
    )
    assert sessions_after_revoke.status_code == 200
    remaining_items = sessions_after_revoke.json()["items"]
    assert len(remaining_items) == 1
    assert remaining_items[0]["id"] == current_session["id"]
    assert remaining_items[0]["is_current"] is True

    revoked_session_response = client.get(
        "/api/v1/media/threads",
        headers={"Authorization": f"Bearer {first_access_token}"},
    )
    assert revoked_session_response.status_code == 401

    revoked_access_payload = decode_access_token(first_access_token)
    with client.app.state.testing_session_local() as db:
        blacklist_entry = db.scalar(
            select(AccessTokenBlacklist).where(
                AccessTokenBlacklist.jti == revoked_access_payload.jti
            )
        )
        assert blacklist_entry is not None


def test_reset_password_revokes_other_sessions_and_rotates_login_secret(
    client: TestClient,
):
    register_response = client.post(
        "/api/v1/auth/register",
        json={"username": "alice-password-reset", "password": "super-secret-123"},
        headers={
            "User-Agent": "Mozilla/5.0 Chrome/123.0 Windows",
            "X-Forwarded-For": "10.0.0.1",
        },
    )
    assert register_response.status_code == 200
    first_payload = register_response.json()
    first_access_token = first_payload["access_token"]

    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "alice-password-reset", "password": "super-secret-123"},
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 Firefox/124.0 Mac OS X",
            "X-Forwarded-For": "10.0.0.2",
        },
    )
    assert login_response.status_code == 200
    second_payload = login_response.json()
    second_access_token = second_payload["access_token"]
    second_access_token_payload = decode_access_token(second_access_token)

    reset_response = client.post(
        "/api/v1/auth/reset-password",
        json={
            "old_password": "super-secret-123",
            "new_password": "new-secret-456",
        },
        headers={"Authorization": f"Bearer {second_access_token}"},
    )
    assert reset_response.status_code == 200
    assert reset_response.json() == {
        "password_reset": True,
        "revoked_sessions": 1,
    }

    current_access_response = client.get(
        "/api/v1/media/threads",
        headers={"Authorization": f"Bearer {second_access_token}"},
    )
    assert current_access_response.status_code == 401

    refresh_response = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": second_payload["refresh_token"]},
    )
    assert refresh_response.status_code == 200
    refreshed_access_token = refresh_response.json()["access_token"]

    sessions_response = client.get(
        "/api/v1/auth/sessions",
        headers={"Authorization": f"Bearer {refreshed_access_token}"},
    )
    assert sessions_response.status_code == 200
    sessions_payload = sessions_response.json()
    assert len(sessions_payload["items"]) == 1
    assert sessions_payload["items"][0]["is_current"] is True

    revoked_device_response = client.get(
        "/api/v1/media/threads",
        headers={"Authorization": f"Bearer {first_access_token}"},
    )
    assert revoked_device_response.status_code == 401

    old_password_login = client.post(
        "/api/v1/auth/login",
        data={"username": "alice-password-reset", "password": "super-secret-123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert old_password_login.status_code == 401

    new_password_login = client.post(
        "/api/v1/auth/login",
        data={"username": "alice-password-reset", "password": "new-secret-456"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert new_password_login.status_code == 200

    with client.app.state.testing_session_local() as db:
        blacklist_entry = db.scalar(
            select(AccessTokenBlacklist).where(
                AccessTokenBlacklist.jti == second_access_token_payload.jti
            )
        )
        user = db.scalar(select(User).where(User.username == "alice-password-reset"))
        assert blacklist_entry is not None
        assert user is not None
        assert user.password_changed_at is not None
        assert user.password_changed_at > second_access_token_payload.issued_at


def test_reset_password_rejects_wrong_current_password(client: TestClient):
    register_payload = register_auth_response(
        client,
        username="alice-password-reset-invalid",
    )

    reset_response = client.post(
        "/api/v1/auth/reset-password",
        json={
            "old_password": "wrong-secret-000",
            "new_password": "new-secret-456",
        },
        headers={"Authorization": f"Bearer {register_payload['access_token']}"},
    )
    assert reset_response.status_code == 400

    login_response = client.post(
        "/api/v1/auth/login",
        data={
            "username": "alice-password-reset-invalid",
            "password": "super-secret-123",
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert login_response.status_code == 200


def test_password_reset_request_and_token_reset_revoke_all_sessions(
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
):
    register_response = client.post(
        "/api/v1/auth/register",
        json={"username": "alice-password-forgot", "password": "super-secret-123"},
        headers={
            "User-Agent": "Mozilla/5.0 Chrome/123.0 Windows",
            "X-Forwarded-For": "10.0.0.1",
        },
    )
    assert register_response.status_code == 200
    user_id = register_response.json()["user"]["id"]
    first_access_token = register_response.json()["access_token"]
    detached_access_token = create_access_token(subject=user_id).token
    detached_access_token_payload = decode_access_token(detached_access_token)

    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "alice-password-forgot", "password": "super-secret-123"},
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 Firefox/124.0 Mac OS X",
            "X-Forwarded-For": "10.0.0.2",
        },
    )
    assert login_response.status_code == 200
    second_access_token = login_response.json()["access_token"]

    caplog.set_level(logging.INFO)
    request_response = client.post(
        "/api/v1/auth/password-reset-request",
        json={"username": "alice-password-forgot"},
    )
    assert request_response.status_code == 200
    assert request_response.json() == {
        "accepted": True,
        "expires_in_minutes": 15,
    }

    reset_log = next(
        record.getMessage()
        for record in caplog.records
        if "Password reset requested username=alice-password-forgot reset_link=" in record.getMessage()
    )
    reset_link = reset_log.split("reset_link=", 1)[1]
    reset_token = reset_link.split("token=", 1)[1]

    reset_response = client.post(
        "/api/v1/auth/password-reset",
        json={
            "token": reset_token,
            "new_password": "new-secret-456",
        },
    )
    assert reset_response.status_code == 200
    assert reset_response.json() == {
        "password_reset": True,
        "revoked_sessions": 2,
    }

    first_device_response = client.get(
        "/api/v1/media/threads",
        headers={"Authorization": f"Bearer {first_access_token}"},
    )
    assert first_device_response.status_code == 401

    second_device_response = client.get(
        "/api/v1/media/threads",
        headers={"Authorization": f"Bearer {second_access_token}"},
    )
    assert second_device_response.status_code == 401

    detached_token_response = client.get(
        "/api/v1/media/threads",
        headers={"Authorization": f"Bearer {detached_access_token}"},
    )
    assert detached_token_response.status_code == 401

    old_password_login = client.post(
        "/api/v1/auth/login",
        data={"username": "alice-password-forgot", "password": "super-secret-123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert old_password_login.status_code == 401

    new_password_login = client.post(
        "/api/v1/auth/login",
        data={"username": "alice-password-forgot", "password": "new-secret-456"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert new_password_login.status_code == 200

    with client.app.state.testing_session_local() as db:
        user = db.scalar(select(User).where(User.username == "alice-password-forgot"))
        assert user is not None
        assert user.password_changed_at is not None
        assert user.password_changed_at > detached_access_token_payload.issued_at


def test_password_reset_request_for_unknown_user_is_still_accepted(
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
):
    caplog.set_level(logging.INFO)
    response = client.post(
        "/api/v1/auth/password-reset-request",
        json={"username": "missing-user"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "accepted": True,
        "expires_in_minutes": 15,
    }
    assert any(
        "Password reset requested for unknown username=missing-user" in record.getMessage()
        for record in caplog.records
    )


def test_password_reset_rejects_invalid_reset_token(client: TestClient):
    register_auth_response(client, username="alice-password-reset-token-invalid")

    response = client.post(
        "/api/v1/auth/password-reset",
        json={
            "token": "not-a-valid-reset-token",
            "new_password": "new-secret-456",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "重置令牌无效或已过期。"

    login_response = client.post(
        "/api/v1/auth/login",
        data={
            "username": "alice-password-reset-token-invalid",
            "password": "super-secret-123",
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert login_response.status_code == 200


def test_profile_update_returns_updated_user_payload(client: TestClient):
    headers = register_user(client, username="alice-profile")

    response = client.patch(
        "/api/v1/auth/profile",
        json={
            "nickname": "Ada Planner",
            "bio": "专注高净值客户资产配置与内容运营。",
        },
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["username"] == "alice-profile"
    assert payload["nickname"] == "Ada Planner"
    assert payload["bio"] == "专注高净值客户资产配置与内容运营。"
    assert payload["created_at"].endswith("Z")


def test_profile_update_can_store_avatar_url(client: TestClient):
    headers = register_user(client, username="alice-avatar")

    response = client.patch(
        "/api/v1/auth/profile",
        json={"avatar_url": "/uploads/alice-avatar/avatar.webp"},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["username"] == "alice-avatar"
    assert payload["avatar_url"] == "/uploads/alice-avatar/avatar.webp"


def test_protected_chat_requires_token(client: TestClient):
    payload = {
        "thread_id": "thread-without-token",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "没有 token 时不应允许访问。",
        "materials": [],
    }

    response = client.post("/api/v1/media/chat/stream", json=payload)
    assert response.status_code == 401


def test_media_chat_stop_endpoint_cancels_owned_active_thread(client: TestClient):
    auth_payload = register_auth_response(client, username="alice-stop-owned")
    headers = {"Authorization": f"Bearer {auth_payload['access_token']}"}
    user_id = str(auth_payload["user"]["id"])
    thread_id = "thread-stop-owned-active"

    cancel_manager_module.cancel_manager.register_thread(
        thread_id,
        owner_user_id=user_id,
    )

    try:
        response = client.post(
            "/api/v1/media/chat/stop",
            json={"thread_id": thread_id},
            headers=headers,
        )

        assert response.status_code == 200
        assert response.json() == {"thread_id": thread_id, "cancelled": True}
        assert cancel_manager_module.cancel_manager.is_cancelled(thread_id)
    finally:
        cancel_manager_module.cancel_manager.cleanup_thread(thread_id)


def test_media_chat_stop_endpoint_rejects_other_users_active_thread(client: TestClient):
    alice_auth = register_auth_response(client, username="alice-stop-owner")
    bob_auth = register_auth_response(client, username="bob-stop-owner")
    alice_user_id = str(alice_auth["user"]["id"])
    thread_id = "thread-stop-foreign-active"

    cancel_manager_module.cancel_manager.register_thread(
        thread_id,
        owner_user_id=alice_user_id,
    )

    try:
        response = client.post(
            "/api/v1/media/chat/stop",
            json={"thread_id": thread_id},
            headers={"Authorization": f"Bearer {bob_auth['access_token']}"},
        )

        assert response.status_code == 404
        assert not cancel_manager_module.cancel_manager.is_cancelled(thread_id)
    finally:
        cancel_manager_module.cancel_manager.cleanup_thread(thread_id)


def test_media_chat_stop_endpoint_returns_false_for_inactive_thread(client: TestClient):
    headers = register_user(client, username="alice-stop-inactive")

    response = client.post(
        "/api/v1/media/chat/stop",
        json={"thread_id": "thread-stop-inactive"},
        headers=headers,
    )

    assert response.status_code == 200
    assert response.json() == {
        "thread_id": "thread-stop-inactive",
        "cancelled": False,
    }


def test_media_chat_stream_rejects_when_token_balance_is_exhausted(client: TestClient):
    headers = register_user(client, username="alice-no-tokens")

    with client.app.state.testing_session_local() as db:
        user = db.scalar(select(User).where(User.username == "alice-no-tokens"))
        assert user is not None
        user.token_balance = 0
        db.commit()

    payload = {
        "thread_id": "thread-no-balance",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "余额不足时应在调用模型前阻断。",
        "materials": [],
    }

    response = client.post(
        "/api/v1/media/chat/stream",
        json=payload,
        headers=headers,
    )

    assert response.status_code == 402
    assert response.json()["detail"] == "INSUFFICIENT_TOKENS"


def test_media_chat_stream_allows_admin_with_zero_balance_and_skips_billing(
    client: TestClient,
):
    register_payload = register_auth_response(client, username="alice-admin-bypass")
    headers = {"Authorization": f"Bearer {register_payload['access_token']}"}

    with client.app.state.testing_session_local() as db:
        user = db.scalar(select(User).where(User.username == "alice-admin-bypass"))
        assert user is not None
        user.role = "admin"
        user.token_balance = 0
        db.commit()

    payload = {
        "thread_id": "thread-admin-bypass",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "管理员应享有无限算力，不受余额限制。",
        "materials": [],
    }

    events = collect_stream_events(client, payload, headers=headers)
    assert any(event["event"] == "done" for event in events)

    with client.app.state.testing_session_local() as db:
        user = db.scalar(select(User).where(User.username == "alice-admin-bypass"))
        assert user is not None
        assert user.token_balance == 0

        transactions = list(
            db.scalars(
                select(TokenTransaction).where(TokenTransaction.user_id == user.id)
            ).all()
        )
        assert len(transactions) == 1
        assert transactions[0].transaction_type == "grant"


def test_media_chat_stream_logs_request_entry(
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
):
    headers = register_user(client, username="alice-log")
    payload = {
        "thread_id": "thread-log-entry",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "请记录一次流式聊天请求日志",
        "materials": [],
    }

    with caplog.at_level(logging.INFO):
        collect_stream_events(client, payload, headers=headers)

    stderr = capsys.readouterr().err
    assert any(
        record.message
        == "收到 Chat 请求: thread_id=thread-log-entry, task_type=content_generation"
        for record in caplog.records
    )


def test_media_chat_stream_logs_request_lifecycle(
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
):
    headers = register_user(client, username="alice-log-lifecycle")
    payload = {
        "thread_id": "thread-log-lifecycle",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "trace the request lifecycle",
        "materials": [],
    }

    with caplog.at_level(logging.INFO):
        collect_stream_events(client, payload, headers=headers)

    stderr = capsys.readouterr().err
    assert any(
        record.message.startswith("request.start method=POST path=/api/v1/media/chat/stream")
        for record in caplog.records
    )
    assert any(
        record.message.startswith(
            "chat.stream route entered thread_id=thread-log-lifecycle task_type=content_generation user_id="
        )
        for record in caplog.records
    )
    assert any(
        record.message.startswith(
            "request.response method=POST path=/api/v1/media/chat/stream status=200 elapsed_ms="
        )
        for record in caplog.records
    )


def test_cancel_manager_cancel_thread_cancels_registered_tasks():
    async def exercise() -> None:
        manager = cancel_manager_module.CancelManager()
        started = asyncio.Event()
        cancelled = asyncio.Event()
        thread_id = "thread-cancel-manager-task"

        async def blocking_task() -> None:
            started.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                cancelled.set()
                raise

        task = asyncio.create_task(blocking_task())
        manager.register_thread(thread_id, owner_user_id="user-cancel-manager-task")
        manager.register_task(thread_id, task)

        await started.wait()
        manager.cancel_thread(thread_id, "User manually stopped generation")

        with pytest.raises(asyncio.CancelledError):
            await task

        assert cancelled.is_set()
        assert manager.is_cancelled(thread_id)
        assert manager.get_owner_user_id(thread_id) == "user-cancel-manager-task"

    asyncio.run(exercise())


def test_stream_disconnect_forwarder_cancels_workflow_task(
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    cancelled = asyncio.Event()
    disconnect_checks = 0
    chunks: list[str] = []

    async def fake_workflow_stream():
        started.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            cancelled.set()
            raise
        yield "unreachable"

    async def fake_disconnect_checker() -> bool:
        nonlocal disconnect_checks
        disconnect_checks += 1
        if disconnect_checks == 1:
            await started.wait()
            return False
        return True

    monkeypatch.setattr(
        chat_api_module,
        "STREAM_DISCONNECT_POLL_INTERVAL_SECONDS",
        0.001,
    )

    async def collect_chunks() -> list[str]:
        async for chunk in chat_api_module._forward_stream_with_disconnect_cancellation(
            workflow_stream=fake_workflow_stream(),
            disconnect_checker=fake_disconnect_checker,
            thread_id="thread-disconnect-cancel",
            user_id="user-disconnect-cancel",
        ):
            chunks.append(chunk)
        return chunks

    with pytest.raises(asyncio.CancelledError, match="Client disconnected"):
        asyncio.run(collect_chunks())

    assert chunks == []
    assert started.is_set()
    assert cancelled.is_set()
    assert disconnect_checks >= 2


def test_stream_disconnect_forwarder_cancels_after_emitting_a_chunk(
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    cancelled = asyncio.Event()
    disconnect_checks = 0
    chunks: list[str] = []

    async def fake_workflow_stream():
        yield "chunk-1"
        started.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            cancelled.set()
            raise

    async def fake_disconnect_checker() -> bool:
        nonlocal disconnect_checks
        disconnect_checks += 1
        if disconnect_checks <= 2:
            return False
        await started.wait()
        return True

    monkeypatch.setattr(
        chat_api_module,
        "STREAM_DISCONNECT_POLL_INTERVAL_SECONDS",
        0.001,
    )

    async def collect_chunks() -> list[str]:
        async for chunk in chat_api_module._forward_stream_with_disconnect_cancellation(
            workflow_stream=fake_workflow_stream(),
            disconnect_checker=fake_disconnect_checker,
            thread_id="thread-disconnect-after-chunk",
            user_id="user-disconnect-after-chunk",
        ):
            chunks.append(chunk)
        return chunks

    with pytest.raises(asyncio.CancelledError, match="Client disconnected"):
        asyncio.run(collect_chunks())

    assert len(chunks) <= 1
    assert all(chunk == "chunk-1" for chunk in chunks)
    assert started.is_set()
    assert cancelled.is_set()
    assert disconnect_checks >= 2


def test_stream_disconnect_forwarder_closes_workflow_stream_on_disconnect(
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    closed = asyncio.Event()
    disconnect_checks = 0

    class FakeWorkflowStream:
        def __aiter__(self):
            return self

        async def __anext__(self):
            started.set()
            await asyncio.Future()
            raise StopAsyncIteration

        async def aclose(self):
            closed.set()

    async def fake_disconnect_checker() -> bool:
        nonlocal disconnect_checks
        disconnect_checks += 1
        if disconnect_checks == 1:
            await started.wait()
            return False
        return True

    monkeypatch.setattr(
        chat_api_module,
        "STREAM_DISCONNECT_POLL_INTERVAL_SECONDS",
        0.001,
    )

    async def collect_chunks() -> None:
        async for _chunk in chat_api_module._forward_stream_with_disconnect_cancellation(
            workflow_stream=FakeWorkflowStream(),
            disconnect_checker=fake_disconnect_checker,
            thread_id="thread-disconnect-close",
            user_id="user-disconnect-close",
        ):
            pass

    with pytest.raises(asyncio.CancelledError, match="Client disconnected"):
        asyncio.run(collect_chunks())

    assert started.is_set()
    assert closed.is_set()
    assert disconnect_checks >= 2


def test_stream_disconnect_forwarder_exposes_global_kill_switch_to_workflow(
    monkeypatch: pytest.MonkeyPatch,
):
    started = asyncio.Event()
    cancelled = asyncio.Event()
    disconnect_checks = 0
    thread_id = "thread-disconnect-kill-switch"

    async def fake_workflow_stream():
        started.set()
        try:
            while True:
                await cancel_manager_module.raise_if_cancelled(thread_id)
                await asyncio.sleep(0.001)
        except asyncio.CancelledError:
            cancelled.set()
            raise

        if False:
            yield "unreachable"

    async def fake_disconnect_checker() -> bool:
        nonlocal disconnect_checks
        disconnect_checks += 1
        if disconnect_checks == 1:
            await started.wait()
            return False
        return True

    monkeypatch.setattr(
        chat_api_module,
        "STREAM_DISCONNECT_POLL_INTERVAL_SECONDS",
        0.001,
    )

    async def collect_chunks() -> None:
        async for _chunk in chat_api_module._forward_stream_with_disconnect_cancellation(
            workflow_stream=fake_workflow_stream(),
            disconnect_checker=fake_disconnect_checker,
            thread_id=thread_id,
            user_id="user-disconnect-kill-switch",
        ):
            pass

    with pytest.raises(asyncio.CancelledError, match="Client disconnected"):
        asyncio.run(collect_chunks())

    assert started.is_set()
    assert cancelled.is_set()
    assert disconnect_checks >= 2


def test_providers_create_clients_with_strict_http_timeouts(monkeypatch: pytest.MonkeyPatch):
    captured_kwargs: list[dict[str, object]] = []

    class DummyAsyncOpenAI:
        def __init__(self, **kwargs):
            captured_kwargs.append(kwargs)

    monkeypatch.setattr(providers_module, "AsyncOpenAI", DummyAsyncOpenAI)

    openai_provider = providers_module.OpenAIProvider(
        api_key="openai-key",
        timeout_seconds=42.0,
    )
    compatible_provider = providers_module.CompatibleLLMProvider(
        api_key="compatible-key",
        base_url="https://example.com/v1",
        timeout_seconds=55.0,
    )

    openai_provider._get_client()
    compatible_provider._get_client()

    assert len(captured_kwargs) == 2

    openai_timeout = captured_kwargs[0]["timeout"]
    compatible_timeout = captured_kwargs[1]["timeout"]

    assert isinstance(openai_timeout, providers_module.httpx.Timeout)
    assert openai_timeout.connect == 10.0
    assert openai_timeout.read == 42.0

    assert isinstance(compatible_timeout, providers_module.httpx.Timeout)
    assert compatible_timeout.connect == 10.0
    assert compatible_timeout.read == 55.0


def test_compatible_provider_bind_tools_returns_async_runnable():
    provider = providers_module.CompatibleLLMProvider(
        api_key="compatible-key",
        base_url="https://example.com/v1",
    )

    runnable = provider.bind_tools(get_business_tools())

    assert type(runnable).__name__ == "RunnableLambda"
    assert hasattr(runnable, "ainvoke")


def test_media_chat_stream_emits_content_generation_artifact(client: TestClient):
    headers = register_user(client, username="alice-content")
    payload = {
        "thread_id": "thread-content-generation",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "请帮我策划一篇年度财务复盘的小红书笔记",
        "materials": [],
    }

    artifact = assert_artifact_matches_schema(
        client,
        payload,
        headers=headers,
        schema=ContentGenerationArtifactPayload,
        expected_artifact_type="content_draft",
    )

    assert len(artifact.title_candidates) == 3
    assert "年度复盘" in artifact.body


def test_media_chat_stream_preserves_requested_task_type_before_persist_and_stream(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    headers = register_user(client, username="alice-smart-router-api")
    captured: dict[str, str] = {}

    def fake_persist_chat_request(db, request, current_user):
        captured["persist_task_type"] = request.task_type.value
        return Thread(
            id=request.thread_id,
            user_id=current_user.id,
            title="smart-router-thread",
        )

    async def fake_stream(request, *, db, thread, user_id):
        captured["stream_task_type"] = request.task_type.value
        yield (
            'event: start\ndata: '
            f'{{"thread_id":"{request.thread_id}","platform":"{request.platform.value}",'
            f'"task_type":"{request.task_type.value}","materials_count":{len(request.materials)}}}\n\n'
        )
        yield f'event: done\ndata: {{"thread_id":"{request.thread_id}"}}\n\n'

    monkeypatch.setattr(chat_api_module, "persist_chat_request", fake_persist_chat_request)
    monkeypatch.setattr(chat_api_module.media_agent_workflow, "stream", fake_stream)

    payload = {
        "thread_id": "thread-smart-router-api",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "Generate a poster only for a summer fruit tea launch. Image only, no copy.",
        "materials": [],
    }

    events = collect_raw_stream_events(client, payload, headers=headers)

    assert captured["persist_task_type"] == "content_generation"
    assert captured["stream_task_type"] == "content_generation"
    assert events[0]["task_type"] == "content_generation"


def test_media_chat_stream_emits_image_generation_artifact_and_persists_history(
    client: TestClient,
):
    headers = register_user(client, username="alice-image-generation")
    thread_id = "thread-image-generation"
    payload = {
        "thread_id": thread_id,
        "platform": "xiaohongshu",
        "task_type": "image_generation",
        "message": "Create a bright summer drinks poster for Xiaohongshu.",
        "materials": [],
    }

    events = collect_stream_events(client, payload, headers=headers)
    artifact_events = [event for event in events if event["event"] == "artifact"]
    artifact = ImageGenerationArtifactPayload.model_validate(artifact_events[-1]["artifact"])

    assert artifact.artifact_type == "image_result"
    assert artifact.status == "completed"
    assert artifact.prompt
    assert len(artifact.generated_images) >= 1
    if len(artifact_events) > 1:
        processing_artifact = ImageGenerationArtifactPayload.model_validate(
            artifact_events[0]["artifact"]
        )
        assert processing_artifact.status == "processing"
        assert processing_artifact.generated_images == []
        assert processing_artifact.progress_message

    history_response = client.get(
        f"/api/v1/media/threads/{thread_id}/messages",
        headers=headers,
    )
    assert history_response.status_code == 200
    history_payload = history_response.json()
    history_artifact_message = next(
        item for item in history_payload["messages"] if item["message_type"] == "artifact"
    )
    assert history_artifact_message["artifact"]["artifact_type"] == "image_result"

    artifacts_response = client.get("/api/v1/media/artifacts", headers=headers)
    assert artifacts_response.status_code == 200
    artifact_list_item = next(
        item
        for item in artifacts_response.json()["items"]
        if item["thread_id"] == thread_id
    )
    assert artifact_list_item["artifact"]["artifact_type"] == "image_result"


def test_media_chat_stream_routes_image_generation_by_user_role(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    standard_headers = register_user(client, username="alice-image-standard")
    privileged_headers = register_admin_user(
        client,
        username="alice-image-super-admin",
        role="super_admin",
    )

    monkeypatch.setenv("IMAGE_GENERATION_BACKEND", "openai")
    monkeypatch.setenv("OPENAI_IMAGE_API_KEY", "test-image-key")
    monkeypatch.setenv("OPENAI_IMAGE_BASE_URL", "https://www.onetopai.asia/v1")
    monkeypatch.setenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    monkeypatch.setenv("IMAGE_GENERATION_API_KEY", "test-dashscope-key")
    monkeypatch.setenv("IMAGE_GENERATION_BASE_URL", "https://dashscope.aliyuncs.com/api/v1")
    monkeypatch.setenv("IMAGE_GENERATION_MODEL", "wanx-v1")

    original_provider = agent_module.media_agent_workflow.provider

    async def fake_prompt_builder(*, request, draft, artifact_candidate):
        return "A polished beverage launch poster with strong contrast and clean typography."

    async def fake_openai(*, request, prompt: str):
        return ["https://example.com/openai-premium-cover.png"]

    async def fake_dashscope(*, request, prompt: str):
        return ["https://example.com/dashscope-standard-cover.png"]

    async def fake_persist_generated_images(*, urls, user_id, thread_id):
        return urls

    provider = LangGraphProvider(
        inner_provider=providers_module.MockLLMProvider(chunk_size=24),
        image_prompt_builder=fake_prompt_builder,
    )
    monkeypatch.setattr(
        provider.image_service,
        "_generate_images_with_openai_with_fallback",
        fake_openai,
    )
    monkeypatch.setattr(
        provider.image_service,
        "_generate_images_with_dashscope",
        fake_dashscope,
    )
    monkeypatch.setattr(
        provider.image_service,
        "_persist_generated_images",
        fake_persist_generated_images,
    )
    agent_module.media_agent_workflow.provider = provider

    try:
        standard_events = collect_raw_stream_events(
            client,
            {
                "thread_id": "thread-image-standard-user",
                "platform": "xiaohongshu",
                "task_type": "image_generation",
                "message": "Create a bright summer fruit tea poster.",
                "materials": [],
            },
            headers=standard_headers,
        )
        privileged_events = collect_raw_stream_events(
            client,
            {
                "thread_id": "thread-image-super-admin",
                "platform": "xiaohongshu",
                "task_type": "image_generation",
                "message": "Create a bright summer fruit tea poster.",
                "materials": [],
            },
            headers=privileged_headers,
        )
    finally:
        agent_module.media_agent_workflow.provider = original_provider

    standard_artifact_events = [
        event for event in standard_events if event["event"] == "artifact"
    ]
    privileged_artifact_events = [
        event for event in privileged_events if event["event"] == "artifact"
    ]
    standard_artifact = ImageGenerationArtifactPayload.model_validate(
        standard_artifact_events[-1]["artifact"]
    )
    privileged_artifact = ImageGenerationArtifactPayload.model_validate(
        privileged_artifact_events[-1]["artifact"]
    )

    assert standard_artifact.generated_images == [
        "https://example.com/dashscope-standard-cover.png"
    ]
    assert privileged_artifact.generated_images == [
        "https://example.com/openai-premium-cover.png"
    ]


def test_media_chat_stream_emits_topic_planning_artifact(client: TestClient):
    headers = register_user(client, username="alice-topic")
    payload = {
        "thread_id": "thread-topic-planning",
        "platform": "xiaohongshu",
        "task_type": "topic_planning",
        "message": "请给我一组选题策划方向",
        "materials": [],
    }

    artifact = assert_artifact_matches_schema(
        client,
        payload,
        headers=headers,
        schema=TopicPlanningArtifactPayload,
        expected_artifact_type="topic_list",
    )

    assert len(artifact.topics) >= 1
    assert artifact.topics[0].title


def test_media_chat_stream_emits_hot_post_analysis_artifact(client: TestClient):
    headers = register_user(client, username="alice-analysis")
    payload = {
        "thread_id": "thread-hot-post-analysis",
        "platform": "xiaohongshu",
        "task_type": "hot_post_analysis",
        "message": "请拆解一篇爆款内容",
        "materials": [],
    }

    artifact = assert_artifact_matches_schema(
        client,
        payload,
        headers=headers,
        schema=HotPostAnalysisArtifactPayload,
        expected_artifact_type="hot_post_analysis",
    )

    assert len(artifact.analysis_dimensions) >= 1
    assert len(artifact.reusable_templates) >= 1


def test_media_chat_stream_emits_comment_reply_artifact(client: TestClient):
    headers = register_user(client, username="alice-reply")
    payload = {
        "thread_id": "thread-comment-reply",
        "platform": "xiaohongshu",
        "task_type": "comment_reply",
        "message": "请给我一组合规的评论回复话术",
        "materials": [],
    }

    artifact = assert_artifact_matches_schema(
        client,
        payload,
        headers=headers,
        schema=CommentReplyArtifactPayload,
        expected_artifact_type="comment_reply",
    )

    assert len(artifact.suggestions) >= 1
    assert artifact.suggestions[0].reply


def test_langgraph_provider_emits_review_step_without_ocr_for_text_materials(
    client: TestClient,
):
    headers = register_user(client, username="alice-langgraph")
    original_provider = agent_module.media_agent_workflow.provider
    agent_module.media_agent_workflow.provider = LangGraphProvider(
        inner_provider=providers_module.MockLLMProvider(chunk_size=24),
    )

    payload = {
        "thread_id": "thread-langgraph",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "请基于已上传素材整理一篇适合内容运营复盘的草稿",
        "materials": [
            {
                "type": "text_link",
                "url": "https://example.com/report",
                "text": "素材重点：目标用户为 28-35 岁，希望兼顾稳健与流动性。",
            }
        ],
    }

    try:
        events = collect_raw_stream_events(client, payload, headers=headers)
    finally:
        agent_module.media_agent_workflow.provider = original_provider

    assert events[0]["event"] == "start"
    assert events[-1]["event"] == "done"

    tool_calls = [event for event in events if event["event"] == "tool_call"]
    tool_call_names = [str(event["name"]) for event in tool_calls]
    assert "ocr" not in tool_call_names
    assert tool_call_names.count("generate_draft") == 1
    assert tool_call_names.index("parse_materials") < tool_call_names.index("generate_draft")
    assert tool_call_names.index("generate_draft") < tool_call_names.index("review_draft")
    assert tool_call_names.index("review_draft") < tool_call_names.index("format_artifact")

    review_statuses = [
        str(event["status"])
        for event in tool_calls
        if event["name"] == "review_draft"
    ]
    assert review_statuses[-1] == "passed"

    message_events = [event for event in events if event["event"] == "message"]
    assert len(message_events) >= 1

    artifact_event = next(event for event in events if event["event"] == "artifact")
    artifact = ContentGenerationArtifactPayload.model_validate(artifact_event["artifact"])
    assert artifact.artifact_type == "content_draft"


def test_langgraph_provider_branches_to_ocr_and_retries_on_review_failure(
    client: TestClient,
):
    headers = register_user(client, username="alice-langgraph-ocr")
    original_provider = agent_module.media_agent_workflow.provider

    async def fake_vision(_: object) -> list[str]:
        return ["视觉解析#1：提取文字：年度复盘；画面描述：资产配置四象限封面。"]

    agent_module.media_agent_workflow.provider = LangGraphProvider(
        inner_provider=providers_module.MockLLMProvider(chunk_size=24),
        vision_analyzer=fake_vision,
    )

    payload = {
        "thread_id": "thread-langgraph-ocr-retry",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "请基于图片素材整理一篇适合复盘分享的内容草稿",
        "system_prompt": "请务必加入风险提示，并以分点形式输出。",
        "materials": [
            {
                "type": "image",
                "url": "https://example.com/cover.png",
                "text": "封面图展示了资产配置四象限和年度复盘关键词",
            }
        ],
    }

    try:
        events = collect_raw_stream_events(client, payload, headers=headers)
    finally:
        agent_module.media_agent_workflow.provider = original_provider

    tool_calls = [event for event in events if event["event"] == "tool_call"]
    tool_call_names = [str(event["name"]) for event in tool_calls]
    assert "ocr" in tool_call_names
    assert tool_call_names.index("parse_materials") < tool_call_names.index("ocr")
    assert tool_call_names.index("ocr") < tool_call_names.index("generate_draft")
    assert tool_call_names.count("generate_draft") == 3

    review_statuses = [
        str(event["status"])
        for event in tool_calls
        if event["name"] == "review_draft"
    ]
    assert "retry" in review_statuses
    assert review_statuses[-1] == "max_retries"

    message_events = [event for event in events if event["event"] == "message"]
    assert len(message_events) >= 1

    artifact_event = next(event for event in events if event["event"] == "artifact")
    artifact = ContentGenerationArtifactPayload.model_validate(artifact_event["artifact"])
    assert artifact.artifact_type == "content_draft"


def test_langgraph_provider_degrades_gracefully_when_ocr_times_out(
    client: TestClient,
):
    headers = register_user(client, username="alice-langgraph-timeout")
    original_provider = agent_module.media_agent_workflow.provider

    async def slow_vision(_: object) -> list[str]:
        await asyncio_tasks.sleep(0.02)
        return ["unexpected"]

    agent_module.media_agent_workflow.provider = LangGraphProvider(
        inner_provider=providers_module.MockLLMProvider(chunk_size=24),
        vision_analyzer=slow_vision,
        vision_timeout_seconds=0.001,
    )

    payload = {
        "thread_id": "thread-langgraph-timeout",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "请在视觉提取超时时继续完成内容生成",
        "materials": [
            {
                "type": "image",
                "url": "https://example.com/timeout.png",
                "text": "一张用于模拟 OCR 超时的图片素材",
            }
        ],
    }

    try:
        events = collect_raw_stream_events(client, payload, headers=headers)
    finally:
        agent_module.media_agent_workflow.provider = original_provider

    assert events[0]["event"] == "start"
    assert events[-1]["event"] == "done"

    ocr_statuses = [
        str(event["status"])
        for event in events
        if event["event"] == "tool_call" and event["name"] == "ocr"
    ]
    assert "processing" in ocr_statuses
    assert "timeout" in ocr_statuses

    timeout_error = next(event for event in events if event["event"] == "error")
    assert timeout_error["code"] == "LANGGRAPH_RUNTIME_ERROR"
    assert "timed out" in str(timeout_error["message"]).lower()
    assert not any(event["event"] == "artifact" for event in events)


def test_history_endpoints_are_isolated_by_user_and_store_system_prompt(client: TestClient):
    alice_headers = register_user(client, username="alice-history")
    bob_headers = register_user(client, username="bob-history")

    payload = {
        "thread_id": "thread-history",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "请生成一篇关于年度复盘的内容草稿",
        "materials": [
            {
                "type": "text_link",
                "url": "https://example.com/report",
                "text": "年度复盘素材",
            }
        ],
        "system_prompt": "你是一名理财规划师品牌顾问，输出风格要稳重可信。",
        "thread_title": "年度复盘工作台",
    }

    payload["knowledge_base_scope"] = "finance_recovery_playbook"
    collect_stream_events(client, payload, headers=alice_headers)

    alice_threads_response = client.get("/api/v1/media/threads", headers=alice_headers)
    assert alice_threads_response.status_code == 200
    alice_threads_payload = alice_threads_response.json()
    assert alice_threads_payload["total"] == 1
    assert (
        alice_threads_payload["items"][0]["knowledge_base_scope"]
        == "finance_recovery_playbook"
    )
    assert alice_threads_payload["items"][0]["title"] == "年度复盘工作台"
    assert alice_threads_payload["items"][0]["updated_at"].endswith("Z")

    bob_threads_response = client.get("/api/v1/media/threads", headers=bob_headers)
    assert bob_threads_response.status_code == 200
    assert bob_threads_response.json()["total"] == 0

    alice_messages_response = client.get(
        "/api/v1/media/threads/thread-history/messages",
        headers=alice_headers,
    )
    assert alice_messages_response.status_code == 200
    alice_messages_payload = alice_messages_response.json()
    assert alice_messages_payload["thread_id"] == "thread-history"
    assert (
        alice_messages_payload["knowledge_base_scope"]
        == "finance_recovery_playbook"
    )
    assert alice_messages_payload["title"] == "年度复盘工作台"
    assert alice_messages_payload["system_prompt"] == payload["system_prompt"]
    assert alice_messages_payload["materials"] == []
    user_message = alice_messages_payload["messages"][0]
    assert user_message["created_at"].endswith("Z")
    assert len(user_message["materials"]) == 1
    assert user_message["materials"][0]["type"] == "text_link"
    assert user_message["materials"][0]["message_id"] == user_message["id"]
    assert user_message["materials"][0]["created_at"].endswith("Z")

    artifact_messages = [
        item
        for item in alice_messages_payload["messages"]
        if item["message_type"] == "artifact"
    ]
    assert len(artifact_messages) == 1
    artifact = ContentGenerationArtifactPayload.model_validate(
        artifact_messages[0]["artifact"],
    )
    assert artifact.artifact_type == "content_draft"

    bob_messages_response = client.get(
        "/api/v1/media/threads/thread-history/messages",
        headers=bob_headers,
    )
    assert bob_messages_response.status_code == 404


def test_artifact_list_endpoint_returns_newest_user_drafts(client: TestClient):
    alice_headers = register_user(client, username="alice-drafts")
    bob_headers = register_user(client, username="bob-drafts")

    collect_stream_events(
        client,
        {
            "thread_id": "thread-draft-content",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请生成一篇适合小红书发布的福州周边探店草稿",
            "materials": [],
            "system_prompt": "你是一名小红书本地生活内容策划。",
            "thread_title": "福州周边探店",
        },
        headers=alice_headers,
    )

    collect_stream_events(
        client,
        {
            "thread_id": "thread-draft-topic",
            "platform": "douyin",
            "task_type": "topic_planning",
            "message": "请帮我整理一组适合抖音知识口播的初中教辅选题",
            "materials": [],
            "system_prompt": "你是一名抖音教育带货编导。",
            "thread_title": "教辅选题池",
        },
        headers=alice_headers,
    )

    collect_stream_events(
        client,
        {
            "thread_id": "thread-draft-bob",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "给我一篇个人使用的草稿",
            "materials": [],
            "system_prompt": "你是一名小红书创作者。",
            "thread_title": "Bob 私有草稿",
        },
        headers=bob_headers,
    )

    response = client.get("/api/v1/media/artifacts", headers=alice_headers)
    assert response.status_code == 200
    payload = response.json()

    assert payload["total"] == 2
    assert [item["thread_id"] for item in payload["items"]] == [
        "thread-draft-topic",
        "thread-draft-content",
    ]

    newest_item = payload["items"][0]
    assert newest_item["thread_title"] == "教辅选题池"
    assert newest_item["artifact_type"] == "topic_list"
    assert newest_item["platform"] == "douyin"
    assert newest_item["excerpt"]
    assert newest_item["created_at"].endswith("Z")
    assert newest_item["artifact"]["artifact_type"] == "topic_list"

    older_item = payload["items"][1]
    assert older_item["thread_title"] == "福州周边探店"
    assert older_item["artifact_type"] == "content_draft"
    assert older_item["platform"] == "xiaohongshu"
    assert older_item["excerpt"]
    artifact = ContentGenerationArtifactPayload.model_validate(older_item["artifact"])
    assert artifact.artifact_type == "content_draft"


def legacy_template_list_endpoint_returns_builtin_templates(client: TestClient):
    headers = register_user(client, username="alice-templates")

    response = client.get("/api/v1/media/templates", headers=headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["total"] >= 100
    ids = {item["id"] for item in payload["items"]}
    assert "template-preset-travel-hotflow" in ids
    assert "template-preset-finance-recovery" in ids
    assert "template-preset-beauty-overnight-repair" in ids
    assert "template-preset-tech-iot-markdown" in ids
    assert "template-preset-xianyu-secondhand-sku" in ids
    assert "template-preset-education-score-boost" in ids


def test_template_list_endpoint_returns_preset_templates(client: TestClient):
    headers = register_user(client, username="alice-templates")

    response = client.get("/api/v1/media/templates", headers=headers)
    assert response.status_code == 200

    payload = response.json()
    assert payload["total"] >= 100
    ids = {item["id"] for item in payload["items"]}
    assert "template-preset-citywalk-weekend" in ids
    assert "template-preset-legal-risk-qa" in ids
    assert "template-preset-medical-pop-science" in ids

    categories: dict[str, int] = {}
    for item in payload["items"]:
        categories[item["category"]] = categories.get(item["category"], 0) + 1

    assert categories["美妆护肤"] >= 10
    assert categories["美食文旅"] >= 10
    assert categories["职场金融"] >= 10
    assert categories["数码科技"] >= 10
    assert categories["电商/闲鱼"] >= 10
    assert categories["教育/干货"] >= 10
    assert categories["房产/家居"] >= 10
    assert categories["汽车/出行"] >= 10
    assert categories["母婴/宠物"] >= 10
    assert categories["情感/心理"] >= 10

    travel_item = next(
        item for item in payload["items"] if item["id"] == "template-preset-travel-hotflow"
    )
    assert travel_item["title"] == "文旅探店爆款流"
    assert "周末短途游" in travel_item["description"]
    assert "[Role]" in travel_item["system_prompt"]
    assert travel_item["knowledge_base_scope"] == "travel_local_guides"

    housing_item = next(
        item
        for item in payload["items"]
        if item["id"] == "template-preset-housing-foreclosure-guide"
    )
    assert housing_item["platform"] in {"小红书", "双平台"}
    assert housing_item["category"] == "房产/家居"
    assert "法拍房" in housing_item["title"]
    assert housing_item["knowledge_base_scope"] == "housing_home_revival"

    emotion_item = next(
        item
        for item in payload["items"]
        if item["id"] == "template-preset-emotion-peer-anxiety"
    )
    assert emotion_item["category"] == "情感/心理"
    assert "[Variables]" in emotion_item["system_prompt"]
    assert all(item["is_preset"] is True for item in payload["items"])
    assert all(item["created_at"].endswith("Z") for item in payload["items"])


def test_template_list_endpoint_supports_pagination_and_filters(client: TestClient):
    headers = register_user(client, username="alice-template-pagination")

    response = client.get(
        "/api/v1/media/templates",
        headers=headers,
        params={
            "page": 1,
            "page_size": 9,
            "category": TemplateCategory.TECH.value,
            "view_mode": "preset",
            "search": "IoT",
        },
    )
    assert response.status_code == 200

    payload = response.json()
    assert payload["page"] == 1
    assert payload["page_size"] == 9
    assert payload["total_pages"] >= 1
    assert payload["total"] >= 1
    assert payload["preset_total"] >= payload["total"]
    assert payload["custom_total"] == 0
    assert 1 <= len(payload["items"]) <= 9
    assert all(item["category"] == TemplateCategory.TECH.value for item in payload["items"])
    assert all(item["is_preset"] is True for item in payload["items"])


def test_template_create_endpoint_persists_user_template(client: TestClient):
    headers = register_user(client, username="alice-template-create")

    create_response = client.post(
        "/api/v1/media/templates",
        headers=headers,
        json={
            "title": "我的理财复盘模板",
            "description": "适合 28-35 岁女性做月度预算复盘。",
            "platform": "小红书",
            "category": "职场金融",
            "knowledge_base_scope": "finance_recovery_playbook",
            "system_prompt": "请围绕精致穷、预算焦虑、温柔理财建议输出内容。",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["id"].startswith("template-user-")
    assert created["title"] == "我的理财复盘模板"
    assert created["platform"] == "小红书"
    assert created["category"] == "职场金融"
    assert created["knowledge_base_scope"] == "finance_recovery_playbook"
    assert created["is_preset"] is False
    assert created["created_at"].endswith("Z")

    list_response = client.get("/api/v1/media/templates", headers=headers)
    assert list_response.status_code == 200
    items = list_response.json()["items"]
    assert len(items) >= 101
    assert any(item["id"] == created["id"] for item in items)


def test_template_skills_search_endpoint_returns_discoveries(client: TestClient):
    headers = register_user(client, username="alice-template-skills")

    response = client.get(
        "/api/v1/media/skills/search?q=福州文旅&category=美食文旅",
        headers=headers,
    )
    assert response.status_code == 200

    payload = response.json()
    assert payload["query"]
    assert payload["category"] == "美食文旅"
    assert payload["total"] >= 1
    assert payload["data_mode"] in {"mock", "mock_fallback", "live_tavily", "llm_fallback"}
    assert len(payload["templates"]) == len(payload["items"])
    assert payload["templates"][0]["title"] == payload["items"][0]["title"]
    first_item = payload["items"][0]
    assert first_item["title"]
    assert first_item["platform"] in {"小红书", "抖音", "双平台", "闲鱼", "技术博客"}
    assert first_item["category"] == "美食文旅"
    assert first_item["system_prompt"]
    assert "[Role]" in first_item["system_prompt"]
    assert "[Task]" in first_item["system_prompt"]
    assert "data_mode" in first_item


def test_template_delete_endpoint_removes_only_owned_custom_template(
    client: TestClient,
):
    alice_headers = register_user(client, username="alice-template-delete")
    bob_headers = register_user(client, username="bob-template-delete")

    create_response = client.post(
        "/api/v1/media/templates",
        headers=alice_headers,
        json={
            "title": "Alice 自定义模板",
            "description": "Alice only",
            "platform": "小红书",
            "category": "美食文旅",
            "system_prompt": "Alice prompt",
        },
    )
    template_id = create_response.json()["id"]

    delete_response = client.delete(
        f"/api/v1/media/templates/{template_id}",
        headers=alice_headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json() == {
        "deleted_count": 1,
        "deleted_ids": [template_id],
    }

    alice_list = client.get("/api/v1/media/templates", headers=alice_headers)
    assert alice_list.status_code == 200
    assert all(item["id"] != template_id for item in alice_list.json()["items"])

    bob_delete = client.delete(
        f"/api/v1/media/templates/{template_id}",
        headers=bob_headers,
    )
    assert bob_delete.status_code == 404


def test_template_update_endpoint_updates_only_owned_custom_template(
    client: TestClient,
):
    alice_headers = register_user(client, username="alice-template-update")
    bob_headers = register_user(client, username="bob-template-update")

    create_response = client.post(
        "/api/v1/media/templates",
        headers=alice_headers,
        json={
            "title": "Alice 鏈湴妯℃澘",
            "description": "Original description",
            "platform": TemplatePlatform.XIAOHONGSHU.value,
            "category": TemplateCategory.TRAVEL.value,
            "knowledge_base_scope": "travel_scope",
            "system_prompt": "Original prompt",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()

    update_response = client.patch(
        f"/api/v1/media/templates/{created['id']}",
        headers=alice_headers,
        json={
            "title": "Alice 鏇存柊鍚庢ā鏉?",
            "description": "",
            "platform": TemplatePlatform.DOUYIN.value,
            "prompt_content": "Updated prompt",
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["id"] == created["id"]
    assert updated["title"] == "Alice 鏇存柊鍚庢ā鏉?"
    assert updated["description"] == ""
    assert updated["platform"] == TemplatePlatform.DOUYIN.value
    assert updated["category"] == TemplateCategory.TRAVEL.value
    assert updated["knowledge_base_scope"] == "travel_scope"
    assert updated["system_prompt"] == "Updated prompt"

    bob_update = client.patch(
        f"/api/v1/media/templates/{created['id']}",
        headers=bob_headers,
        json={"title": "Bob should not update"},
    )
    assert bob_update.status_code == 404


def test_template_batch_delete_endpoint_removes_selected_custom_templates(
    client: TestClient,
):
    headers = register_user(client, username="alice-template-batch-delete")

    created_ids: list[str] = []
    for title, category in [
        ("模板 A", "美食文旅"),
        ("模板 B", "职场金融"),
        ("模板 C", "教育/干货"),
    ]:
        response = client.post(
            "/api/v1/media/templates",
            headers=headers,
            json={
                "title": title,
                "description": f"{title} description",
                "platform": "小红书",
                "category": category,
                "system_prompt": f"{title} prompt",
            },
        )
        assert response.status_code == 201
        created_ids.append(response.json()["id"])

    delete_response = client.request(
        "DELETE",
        "/api/v1/media/templates",
        headers=headers,
        json={"template_ids": created_ids[:2]},
    )
    assert delete_response.status_code == 200
    delete_payload = delete_response.json()
    assert delete_payload["deleted_count"] == 2
    assert set(delete_payload["deleted_ids"]) == set(created_ids[:2])

    list_response = client.get("/api/v1/media/templates", headers=headers)
    assert list_response.status_code == 200
    remaining_ids = {item["id"] for item in list_response.json()["items"]}
    assert created_ids[0] not in remaining_ids
    assert created_ids[1] not in remaining_ids
    assert created_ids[2] in remaining_ids


def test_template_delete_rejects_preset_templates(client: TestClient):
    headers = register_user(client, username="alice-template-preset-guard")

    preset_patch = client.patch(
        "/api/v1/media/templates/template-preset-travel-hotflow",
        headers=headers,
        json={"title": "Should fail"},
    )
    assert preset_patch.status_code == 403

    single_delete = client.delete(
        "/api/v1/media/templates/template-preset-travel-hotflow",
        headers=headers,
    )
    assert single_delete.status_code == 403

    batch_delete = client.request(
        "DELETE",
        "/api/v1/media/templates",
        headers=headers,
        json={"template_ids": ["template-preset-travel-hotflow"]},
    )
    assert batch_delete.status_code == 403


def test_admin_template_crud_endpoints_manage_shared_templates(client: TestClient):
    headers = register_admin_user(client, username="admin-template-crud")

    create_response = client.post(
        "/api/v1/admin/templates",
        headers=headers,
        json={
            "title": "鍏变韩鎺㈠簵妯℃澘",
            "platform": AdminTemplatePlatform.XIAOHONGSHU.value,
            "description": "Shared template",
            "prompt_content": "Original shared prompt",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["id"].startswith("template-admin-")
    assert created["is_preset"] is False

    update_response = client.patch(
        f"/api/v1/admin/templates/{created['id']}",
        headers=headers,
        json={
            "title": "鏇存柊鍚庡叡浜ā鏉?",
            "platform": AdminTemplatePlatform.GENERAL.value,
            "description": "",
            "prompt_content": "Updated shared prompt",
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["title"] == "鏇存柊鍚庡叡浜ā鏉?"
    assert updated["platform"] == AdminTemplatePlatform.GENERAL.value
    assert updated["description"] == ""
    assert updated["prompt_content"] == "Updated shared prompt"

    delete_response = client.delete(
        f"/api/v1/admin/templates/{created['id']}",
        headers=headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json() == {
        "deleted_count": 1,
        "deleted_ids": [created["id"]],
    }


def test_admin_template_batch_delete_endpoint_removes_selected_shared_templates(
    client: TestClient,
):
    headers = register_admin_user(client, username="admin-template-batch-delete")

    created_ids: list[str] = []
    for title, platform in [
        ("鍏变韩妯℃澘 A", AdminTemplatePlatform.XIAOHONGSHU.value),
        ("鍏变韩妯℃澘 B", AdminTemplatePlatform.DOUYIN.value),
        ("鍏变韩妯℃澘 C", AdminTemplatePlatform.GENERAL.value),
    ]:
        response = client.post(
            "/api/v1/admin/templates",
            headers=headers,
            json={
                "title": title,
                "platform": platform,
                "description": f"{title} description",
                "prompt_content": f"{title} prompt",
            },
        )
        assert response.status_code == 201
        created_ids.append(response.json()["id"])

    delete_response = client.request(
        "DELETE",
        "/api/v1/admin/templates",
        headers=headers,
        json={"template_ids": created_ids[:2]},
    )
    assert delete_response.status_code == 200
    delete_payload = delete_response.json()
    assert delete_payload["deleted_count"] == 2
    assert set(delete_payload["deleted_ids"]) == set(created_ids[:2])

    list_response = client.get("/api/v1/admin/templates", headers=headers)
    assert list_response.status_code == 200
    remaining_ids = {item["id"] for item in list_response.json()["items"]}
    assert created_ids[0] not in remaining_ids
    assert created_ids[1] not in remaining_ids
    assert created_ids[2] in remaining_ids


def test_admin_template_mutations_allow_preset_templates(client: TestClient):
    headers = register_admin_user(client, username="admin-template-preset-guard")

    preset_patch = client.patch(
        "/api/v1/admin/templates/template-preset-travel-hotflow",
        headers=headers,
        json={
            "title": "后台改写后的官方模板",
            "prompt_content": "Admin updated preset prompt",
            "is_preset": True,
        },
    )
    assert preset_patch.status_code == 200
    patched_payload = preset_patch.json()
    assert patched_payload["title"] == "后台改写后的官方模板"
    assert patched_payload["prompt_content"] == "Admin updated preset prompt"
    assert patched_payload["is_preset"] is True

    single_delete = client.delete(
        "/api/v1/admin/templates/template-preset-travel-hotflow",
        headers=headers,
    )
    assert single_delete.status_code == 200
    assert single_delete.json() == {
        "deleted_count": 1,
        "deleted_ids": ["template-preset-travel-hotflow"],
    }

    list_after_single_delete = client.get("/api/v1/admin/templates", headers=headers)
    assert list_after_single_delete.status_code == 200
    ids_after_single_delete = {
        item["id"] for item in list_after_single_delete.json()["items"]
    }
    assert "template-preset-travel-hotflow" not in ids_after_single_delete

    batch_delete = client.request(
        "DELETE",
        "/api/v1/admin/templates",
        headers=headers,
        json={"template_ids": ["template-preset-finance-recovery"]},
    )
    assert batch_delete.status_code == 200
    assert batch_delete.json() == {
        "deleted_count": 1,
        "deleted_ids": ["template-preset-finance-recovery"],
    }

    list_after_batch_delete = client.get("/api/v1/admin/templates", headers=headers)
    assert list_after_batch_delete.status_code == 200
    ids_after_batch_delete = {
        item["id"] for item in list_after_batch_delete.json()["items"]
    }
    assert "template-preset-finance-recovery" not in ids_after_batch_delete


def test_topic_create_and_list_endpoint_supports_status_filtering(client: TestClient):
    headers = register_user(client, username="alice-topics")

    first_create = client.post(
        "/api/v1/media/topics",
        headers=headers,
        json={
            "title": "福州 citywalk 夜游路线",
            "inspiration": "结合本地人视角和地铁可达路线。",
            "platform": "小红书",
        },
    )
    assert first_create.status_code == 201
    first_topic = first_create.json()
    assert first_topic["status"] == "idea"
    assert first_topic["platform"] == "小红书"
    assert first_topic["thread_id"] is None

    second_create = client.post(
        "/api/v1/media/topics",
        headers=headers,
        json={
            "title": "法拍房避坑指南",
            "inspiration": "把第一次看房流程和风险清单拆开讲。",
            "platform": "双平台",
        },
    )
    assert second_create.status_code == 201
    second_topic = second_create.json()

    patch_response = client.patch(
        f"/api/v1/media/topics/{second_topic['id']}",
        headers=headers,
        json={"status": "drafting", "thread_id": "thread-topic-drafting-001"},
    )
    assert patch_response.status_code == 200
    assert patch_response.json()["status"] == "drafting"
    assert patch_response.json()["thread_id"] == "thread-topic-drafting-001"

    list_response = client.get("/api/v1/media/topics", headers=headers)
    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload["total"] == 2
    assert payload["items"][0]["id"] == second_topic["id"]
    assert payload["items"][1]["id"] == first_topic["id"]

    filtered_response = client.get(
        "/api/v1/media/topics?status=drafting",
        headers=headers,
    )
    assert filtered_response.status_code == 200
    filtered_payload = filtered_response.json()
    assert filtered_payload["total"] == 1
    assert filtered_payload["items"][0]["id"] == second_topic["id"]
    assert filtered_payload["items"][0]["thread_id"] == "thread-topic-drafting-001"


def test_topic_patch_endpoint_updates_owned_topic_fields(client: TestClient):
    alice_headers = register_user(client, username="alice-topic-update")
    bob_headers = register_user(client, username="bob-topic-update")

    create_response = client.post(
        "/api/v1/media/topics",
        headers=alice_headers,
        json={
            "title": "旧标题",
            "inspiration": "旧备注",
            "platform": "抖音",
        },
    )
    assert create_response.status_code == 201
    topic_id = create_response.json()["id"]

    update_response = client.patch(
        f"/api/v1/media/topics/{topic_id}",
        headers=alice_headers,
        json={
            "title": "更新后的选题标题",
            "inspiration": "补充了更明确的角度和受众。",
            "platform": "小红书",
            "status": "published",
            "thread_id": "thread-topic-published-001",
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["title"] == "更新后的选题标题"
    assert updated["inspiration"] == "补充了更明确的角度和受众。"
    assert updated["platform"] == "小红书"
    assert updated["status"] == "published"
    assert updated["thread_id"] == "thread-topic-published-001"

    forbidden_response = client.patch(
        f"/api/v1/media/topics/{topic_id}",
        headers=bob_headers,
        json={"status": "drafting"},
    )
    assert forbidden_response.status_code == 404


def test_topic_delete_endpoint_removes_only_owned_topic(client: TestClient):
    alice_headers = register_user(client, username="alice-topic-delete")
    bob_headers = register_user(client, username="bob-topic-delete")

    create_response = client.post(
        "/api/v1/media/topics",
        headers=alice_headers,
        json={
            "title": "待删除选题",
            "inspiration": "这条灵感已经废弃。",
            "platform": "小红书",
        },
    )
    assert create_response.status_code == 201
    topic_id = create_response.json()["id"]

    bob_delete = client.delete(
        f"/api/v1/media/topics/{topic_id}",
        headers=bob_headers,
    )
    assert bob_delete.status_code == 404

    delete_response = client.delete(
        f"/api/v1/media/topics/{topic_id}",
        headers=alice_headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json() == {"id": topic_id, "deleted": True}


def test_knowledge_scope_upload_list_delete_and_retrieval_are_user_scoped(
    client: TestClient,
    isolated_knowledge_base: Path,
):
    _ = isolated_knowledge_base
    alice_auth = register_auth_response(client, username="alice-knowledge")
    bob_auth = register_auth_response(client, username="bob-knowledge")
    alice_headers = {"Authorization": f"Bearer {alice_auth['access_token']}"}
    bob_headers = {"Authorization": f"Bearer {bob_auth['access_token']}"}
    alice_user_id = str(alice_auth["user"]["id"])
    bob_user_id = str(bob_auth["user"]["id"])

    alice_upload = client.post(
        "/api/v1/media/knowledge/upload",
        headers=alice_headers,
        data={"scope": "brand_guide_2026"},
        files={
            "file": (
                "brand-guide.md",
                "# Brand tone\nWe emphasize a natural, relaxed, premium voice with calm wording.",
                "text/markdown",
            )
        },
    )
    assert alice_upload.status_code == 201
    assert alice_upload.json()["scope"] == "brand_guide_2026"
    assert alice_upload.json()["chunk_count"] >= 1

    bob_upload = client.post(
        "/api/v1/media/knowledge/upload",
        headers=bob_headers,
        data={"scope": "brand_guide_2026"},
        files={
            "file": (
                "brand-guide.md",
                "# Sales tone\nWe use urgency, quick decisions, and strong conversion pressure.",
                "text/markdown",
            )
        },
    )
    assert bob_upload.status_code == 201
    assert bob_upload.json()["scope"] == "brand_guide_2026"

    alice_scopes = client.get("/api/v1/media/knowledge/scopes", headers=alice_headers)
    assert alice_scopes.status_code == 200
    alice_payload = alice_scopes.json()
    assert alice_payload["total"] == 1
    assert alice_payload["items"][0]["scope"] == "brand_guide_2026"
    assert alice_payload["items"][0]["chunk_count"] >= 1
    assert alice_payload["items"][0]["source_count"] == 1

    bob_scopes = client.get("/api/v1/media/knowledge/scopes", headers=bob_headers)
    assert bob_scopes.status_code == 200
    bob_payload = bob_scopes.json()
    assert bob_payload["total"] == 1
    assert bob_payload["items"][0]["scope"] == "brand_guide_2026"

    service = knowledge_base_module.get_knowledge_base_service()
    alice_context = service.retrieve_context(
        alice_user_id,
        "brand_guide_2026",
        "natural relaxed premium brand voice",
    )
    bob_context = service.retrieve_context(
        bob_user_id,
        "brand_guide_2026",
        "urgent high pressure conversion tone",
    )

    assert "natural, relaxed, premium voice" in alice_context
    assert "strong conversion pressure" not in alice_context
    assert "strong conversion pressure" in bob_context
    assert "natural, relaxed, premium voice" not in bob_context

    alice_delete = client.delete(
        "/api/v1/media/knowledge/scopes/brand_guide_2026",
        headers=alice_headers,
    )
    assert alice_delete.status_code == 200
    assert alice_delete.json()["deleted"] is True
    assert alice_delete.json()["deleted_count"] >= 1

    alice_after_delete = client.get("/api/v1/media/knowledge/scopes", headers=alice_headers)
    assert alice_after_delete.status_code == 200
    assert alice_after_delete.json()["total"] == 0

    bob_after_delete = client.get("/api/v1/media/knowledge/scopes", headers=bob_headers)
    assert bob_after_delete.status_code == 200
    assert bob_after_delete.json()["total"] == 1


def test_knowledge_upload_accepts_csv_and_xlsx_documents(
    client: TestClient,
    isolated_knowledge_base: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    _ = isolated_knowledge_base
    headers = register_user(client, username="alice-knowledge-spreadsheets")
    user_id = client.post(
        "/api/v1/auth/login",
        data={"username": "alice-knowledge-spreadsheets", "password": "super-secret-123"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    ).json()["user"]["id"]

    async def fake_parse_document(path: str) -> str:
        if path.endswith(".csv"):
            return (
                "Row: 1 | product: lipstick, selling_point: brightening, channel: xiaohongshu\n"
                "Row: 2 | product: foundation, channel: douyin"
            )
        if path.endswith(".xlsx"):
            return (
                "Sheet: Campaign Calendar | Row: 1 | platform: xiaohongshu, topic: spring picnic, owner: ada\n"
                "Sheet: Campaign Calendar | Row: 2 | platform: douyin, topic: campus vlog, owner: leo"
            )
        raise AssertionError(f"Unexpected parse path: {path}")

    monkeypatch.setattr(knowledge_api_module, "parse_document", fake_parse_document)

    csv_upload = client.post(
        "/api/v1/media/knowledge/upload",
        headers=headers,
        data={"scope": "sheet_scope"},
        files={
            "file": (
                "keywords.csv",
                "product,selling_point,channel\nlipstick,brightening,xiaohongshu",
                "text/csv",
            )
        },
    )
    assert csv_upload.status_code == 201
    assert csv_upload.json()["scope"] == "sheet_scope"
    assert csv_upload.json()["source"] == "keywords.csv"
    assert csv_upload.json()["chunk_count"] >= 1

    xlsx_upload = client.post(
        "/api/v1/media/knowledge/upload",
        headers=headers,
        data={"scope": "sheet_scope"},
        files={
            "file": (
                "calendar.xlsx",
                b"fake-xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert xlsx_upload.status_code == 201
    assert xlsx_upload.json()["scope"] == "sheet_scope"
    assert xlsx_upload.json()["source"] == "calendar.xlsx"
    assert xlsx_upload.json()["chunk_count"] >= 1

    service = knowledge_base_module.get_knowledge_base_service()
    csv_context = service.retrieve_context(
        str(user_id),
        "sheet_scope",
        "brightening xiaohongshu lipstick",
    )
    xlsx_context = service.retrieve_context(
        str(user_id),
        "sheet_scope",
        "campus vlog owner leo",
    )

    assert "product: lipstick" in csv_context
    assert "Sheet: Campaign Calendar" in xlsx_context
    assert "owner: leo" in xlsx_context


def test_knowledge_upload_returns_400_when_document_parse_fails(
    client: TestClient,
    isolated_knowledge_base: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    _ = isolated_knowledge_base
    headers = register_user(client, username="alice-knowledge-parse-error")

    async def failing_parse_document(_: str) -> str:
        raise knowledge_api_module.MediaParserError(
            "Failed to parse the spreadsheet. Ensure the file is a valid CSV or Excel workbook.",
        )

    monkeypatch.setattr(knowledge_api_module, "parse_document", failing_parse_document)

    response = client.post(
        "/api/v1/media/knowledge/upload",
        headers=headers,
        data={"scope": "broken_sheet"},
        files={
            "file": (
                "broken.xlsx",
                b"broken-xlsx",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )

    assert response.status_code == 400
    assert "Knowledge document parsing failed" in response.json()["detail"]


def test_system_seeded_knowledge_still_available_after_tenant_filtering(
    isolated_knowledge_base: Path,
):
    _ = isolated_knowledge_base
    service = knowledge_base_module.get_knowledge_base_service()
    context = service.retrieve_context(
        "user-rag-check",
        "travel_local_guides",
        "premium district budget contrast",
    )

    assert "price and regional contrast" in context


def test_knowledge_scope_source_management_and_rename_are_user_scoped(
    client: TestClient,
    isolated_knowledge_base: Path,
):
    _ = isolated_knowledge_base
    alice_auth = register_auth_response(client, username="alice-knowledge-manage")
    bob_auth = register_auth_response(client, username="bob-knowledge-manage")
    alice_headers = {"Authorization": f"Bearer {alice_auth['access_token']}"}
    bob_headers = {"Authorization": f"Bearer {bob_auth['access_token']}"}
    alice_user_id = str(alice_auth["user"]["id"])

    first_upload = client.post(
        "/api/v1/media/knowledge/upload",
        headers=alice_headers,
        data={"scope": "brand_guide_2026"},
        files={
            "file": (
                "voice-guide.md",
                "# Voice guide\nUse a calm, premium, reassuring tone in every opening sentence.",
                "text/markdown",
            )
        },
    )
    assert first_upload.status_code == 201

    second_upload = client.post(
        "/api/v1/media/knowledge/upload",
        headers=alice_headers,
        data={"scope": "brand_guide_2026"},
        files={
            "file": (
                "faq.md",
                "# FAQ\nAnswer objections with plain language, examples, and confident structure.",
                "text/markdown",
            )
        },
    )
    assert second_upload.status_code == 201

    bob_upload = client.post(
        "/api/v1/media/knowledge/upload",
        headers=bob_headers,
        data={"scope": "brand_guide_2026"},
        files={
            "file": (
                "voice-guide.md",
                "# Bob guide\nUse urgency and short conversion pushes instead of a premium tone.",
                "text/markdown",
            )
        },
    )
    assert bob_upload.status_code == 201

    alice_sources = client.get(
        "/api/v1/media/knowledge/scopes/brand_guide_2026/sources",
        headers=alice_headers,
    )
    assert alice_sources.status_code == 200
    assert alice_sources.json()["scope"] == "brand_guide_2026"
    assert alice_sources.json()["total"] == 2
    assert {
        (item["filename"], item["chunk_count"])
        for item in alice_sources.json()["items"]
    } == {
        ("faq.md", 1),
        ("voice-guide.md", 1),
    }

    bob_sources = client.get(
        "/api/v1/media/knowledge/scopes/brand_guide_2026/sources",
        headers=bob_headers,
    )
    assert bob_sources.status_code == 200
    assert bob_sources.json()["total"] == 1
    assert bob_sources.json()["items"][0]["filename"] == "voice-guide.md"

    replacement_upload = client.post(
        "/api/v1/media/knowledge/upload",
        headers=alice_headers,
        data={"scope": "brand_guide_2026"},
        files={
            "file": (
                "voice-guide.md",
                "# Voice guide v2\nUse direct, playful, concrete wording instead of a premium tone.",
                "text/markdown",
            )
        },
    )
    assert replacement_upload.status_code == 201
    assert replacement_upload.json()["source"] == "voice-guide.md"

    alice_sources_after_replacement = client.get(
        "/api/v1/media/knowledge/scopes/brand_guide_2026/sources",
        headers=alice_headers,
    )
    assert alice_sources_after_replacement.status_code == 200
    assert alice_sources_after_replacement.json()["total"] == 2
    assert {
        (item["filename"], item["chunk_count"])
        for item in alice_sources_after_replacement.json()["items"]
    } == {
        ("faq.md", 1),
        ("voice-guide.md", 1),
    }

    preview_response = client.get(
        "/api/v1/media/knowledge/scopes/brand_guide_2026/sources/voice-guide.md/preview",
        headers=alice_headers,
    )
    assert preview_response.status_code == 200
    assert preview_response.json() == {
        "source": "voice-guide.md",
        "content": "# Voice guide v2\nUse direct, playful, concrete wording instead of a premium tone.",
        "chunk_count": 1,
    }

    service = knowledge_base_module.get_knowledge_base_service()
    replaced_context = service.retrieve_context(
        alice_user_id,
        "brand_guide_2026",
        "direct playful concrete wording",
    )
    assert "direct, playful, concrete wording" in replaced_context
    assert "calm, premium, reassuring tone" not in replaced_context

    existing_scope_upload = client.post(
        "/api/v1/media/knowledge/upload",
        headers=alice_headers,
        data={"scope": "existing_scope"},
        files={
            "file": (
                "conflict.md",
                "# Existing scope\nReserved for conflict checks.",
                "text/markdown",
            )
        },
    )
    assert existing_scope_upload.status_code == 201

    rename_conflict = client.patch(
        "/api/v1/media/knowledge/scopes/brand_guide_2026",
        headers=alice_headers,
        json={"new_name": "existing_scope"},
    )
    assert rename_conflict.status_code == 409

    rename_response = client.patch(
        "/api/v1/media/knowledge/scopes/brand_guide_2026",
        headers=alice_headers,
        json={"new_name": "brand_manual_q3"},
    )
    assert rename_response.status_code == 200
    assert rename_response.json() == {
        "previous_scope": "brand_guide_2026",
        "scope": "brand_manual_q3",
        "renamed_count": 2,
        "renamed": True,
    }

    service = knowledge_base_module.get_knowledge_base_service()
    renamed_context = service.retrieve_context(
        alice_user_id,
        "brand_manual_q3",
        "direct playful concrete wording",
    )
    old_scope_context = service.retrieve_context(
        alice_user_id,
        "brand_guide_2026",
        "direct playful concrete wording",
    )
    assert "direct, playful, concrete wording" in renamed_context
    assert "calm, premium, reassuring tone" not in renamed_context
    assert old_scope_context == ""

    alice_scopes_after_rename = client.get(
        "/api/v1/media/knowledge/scopes",
        headers=alice_headers,
    )
    assert alice_scopes_after_rename.status_code == 200
    assert {item["scope"] for item in alice_scopes_after_rename.json()["items"]} == {
        "brand_manual_q3",
        "existing_scope",
    }

    bob_scopes_after_rename = client.get(
        "/api/v1/media/knowledge/scopes",
        headers=bob_headers,
    )
    assert bob_scopes_after_rename.status_code == 200
    assert {item["scope"] for item in bob_scopes_after_rename.json()["items"]} == {
        "brand_guide_2026",
    }

    delete_source_response = client.delete(
        "/api/v1/media/knowledge/scopes/brand_manual_q3/sources/voice-guide.md",
        headers=alice_headers,
    )
    assert delete_source_response.status_code == 200
    assert delete_source_response.json() == {
        "scope": "brand_manual_q3",
        "source": "voice-guide.md",
        "deleted_count": 1,
        "deleted": True,
    }

    alice_sources_after_delete = client.get(
        "/api/v1/media/knowledge/scopes/brand_manual_q3/sources",
        headers=alice_headers,
    )
    assert alice_sources_after_delete.status_code == 200
    assert alice_sources_after_delete.json()["items"] == [
        {"filename": "faq.md", "chunk_count": 1}
    ]

    deleted_context = service.retrieve_context(
        alice_user_id,
        "brand_manual_q3",
        "calm premium reassuring tone",
    )
    assert "calm, premium, reassuring tone" not in deleted_context


def test_dashboard_summary_aggregates_owned_productivity_assets_and_activity(
    client: TestClient,
    isolated_knowledge_base: Path,
):
    _ = isolated_knowledge_base
    alice_auth = register_auth_response(client, username="alice-dashboard")
    bob_headers = register_user(client, username="bob-dashboard")
    alice_headers = {"Authorization": f"Bearer {alice_auth['access_token']}"}

    create_artifact_draft(
        client,
        headers=alice_headers,
        thread_id="thread-dashboard-a",
        message="Create Alice dashboard draft A.",
        thread_title="Alice dashboard draft A",
    )
    create_artifact_draft(
        client,
        headers=alice_headers,
        thread_id="thread-dashboard-b",
        task_type="topic_planning",
        message="Create Alice dashboard topic list.",
        thread_title="Alice dashboard draft B",
    )
    create_artifact_draft(
        client,
        headers=bob_headers,
        thread_id="thread-dashboard-bob",
        message="Create Bob dashboard draft.",
        thread_title="Bob dashboard draft",
    )

    idea_response = client.post(
        "/api/v1/media/topics",
        headers=alice_headers,
        json={"title": "看板灵感", "inspiration": "用于统计", "platform": "小红书"},
    )
    assert idea_response.status_code == 201
    drafting_response = client.post(
        "/api/v1/media/topics",
        headers=alice_headers,
        json={"title": "看板撰写", "inspiration": "用于统计", "platform": "抖音"},
    )
    assert drafting_response.status_code == 201
    patch_response = client.patch(
        f"/api/v1/media/topics/{drafting_response.json()['id']}",
        headers=alice_headers,
        json={"status": "drafting"},
    )
    assert patch_response.status_code == 200

    bob_topic_response = client.post(
        "/api/v1/media/topics",
        headers=bob_headers,
        json={"title": "Bob 看板", "inspiration": "隔离校验", "platform": "双平台"},
    )
    assert bob_topic_response.status_code == 201

    upload_response = client.post(
        "/api/v1/media/knowledge/upload",
        headers=alice_headers,
        data={"scope": "dashboard_scope"},
        files={
            "file": (
                "dashboard.md",
                "# Dashboard knowledge\n用于验证知识库资产统计。",
                "text/markdown",
            )
        },
    )
    assert upload_response.status_code == 201

    summary_response = client.get(
        "/api/v1/media/dashboard/summary",
        headers=alice_headers,
    )
    assert summary_response.status_code == 200
    payload = summary_response.json()
    assert payload["productivity"]["total_drafts"] == 2
    assert payload["productivity"]["drafts_this_week"] == 2
    assert payload["productivity"]["total_words_generated"] > 0
    assert payload["productivity"]["estimated_tokens"] >= payload["productivity"]["total_words_generated"]
    assert payload["assets"] == {
        "total_topics": 2,
        "active_topics": 2,
        "total_knowledge_scopes": 1,
        "total_knowledge_chunks": 1,
    }
    assert payload["topic_status"] == {"idea": 1, "drafting": 1, "published": 0}
    assert len(payload["activity_heatmap"]) == 14
    assert sum(item["count"] for item in payload["activity_heatmap"]) == 2

    bob_summary_response = client.get(
        "/api/v1/media/dashboard/summary",
        headers=bob_headers,
    )
    assert bob_summary_response.status_code == 200
    assert bob_summary_response.json()["productivity"]["total_drafts"] == 1
    assert bob_summary_response.json()["assets"]["total_topics"] == 1


def test_artifact_delete_endpoint_removes_only_owned_draft(client: TestClient):
    alice_headers = register_user(client, username="alice-delete-single")
    bob_headers = register_user(client, username="bob-delete-single")

    create_artifact_draft(
        client,
        headers=alice_headers,
        thread_id="thread-delete-single-a",
        message="Create Alice draft A.",
        thread_title="Alice draft A",
    )
    create_artifact_draft(
        client,
        headers=alice_headers,
        thread_id="thread-delete-single-b",
        platform="douyin",
        task_type="topic_planning",
        message="Create Alice draft B.",
        system_prompt="You are a Douyin education planner.",
        thread_title="Alice draft B",
    )
    create_artifact_draft(
        client,
        headers=bob_headers,
        thread_id="thread-delete-single-bob",
        message="Create Bob draft.",
        thread_title="Bob draft",
    )

    alice_list_response = client.get("/api/v1/media/artifacts", headers=alice_headers)
    assert alice_list_response.status_code == 200
    alice_items = alice_list_response.json()["items"]
    assert len(alice_items) == 2

    deleted_message_id = alice_items[0]["message_id"]
    deleted_thread_id = alice_items[0]["thread_id"]
    remaining_message_id = alice_items[1]["message_id"]

    delete_response = client.delete(
        f"/api/v1/media/artifacts/{deleted_message_id}",
        headers=alice_headers,
    )
    assert delete_response.status_code == 200
    delete_payload = delete_response.json()
    assert delete_payload == {
        "deleted_count": 1,
        "deleted_message_ids": [deleted_message_id],
        "cleared_all": False,
    }

    alice_after_response = client.get("/api/v1/media/artifacts", headers=alice_headers)
    assert alice_after_response.status_code == 200
    alice_after_payload = alice_after_response.json()
    assert alice_after_payload["total"] == 1
    assert [item["message_id"] for item in alice_after_payload["items"]] == [
        remaining_message_id,
    ]

    deleted_thread_messages_response = client.get(
        f"/api/v1/media/threads/{deleted_thread_id}/messages",
        headers=alice_headers,
    )
    assert deleted_thread_messages_response.status_code == 200
    deleted_thread_messages = deleted_thread_messages_response.json()["messages"]
    assert not any(
        item["message_type"] == "artifact"
        for item in deleted_thread_messages
    )

    bob_after_response = client.get("/api/v1/media/artifacts", headers=bob_headers)
    assert bob_after_response.status_code == 200
    assert bob_after_response.json()["total"] == 1


def test_artifact_batch_delete_endpoint_removes_selected_owned_drafts(
    client: TestClient,
):
    alice_headers = register_user(client, username="alice-delete-batch")
    bob_headers = register_user(client, username="bob-delete-batch")

    create_artifact_draft(
        client,
        headers=alice_headers,
        thread_id="thread-delete-batch-a",
        message="Create Alice batch draft A.",
        thread_title="Alice batch A",
    )
    create_artifact_draft(
        client,
        headers=alice_headers,
        thread_id="thread-delete-batch-b",
        platform="douyin",
        task_type="topic_planning",
        message="Create Alice batch draft B.",
        system_prompt="You are a Douyin topic planner.",
        thread_title="Alice batch B",
    )
    create_artifact_draft(
        client,
        headers=alice_headers,
        thread_id="thread-delete-batch-c",
        task_type="hot_post_analysis",
        message="Create Alice batch draft C.",
        system_prompt="You are a hot-post analyst.",
        thread_title="Alice batch C",
    )
    create_artifact_draft(
        client,
        headers=bob_headers,
        thread_id="thread-delete-batch-bob",
        message="Create Bob batch draft.",
        thread_title="Bob batch draft",
    )

    alice_before_response = client.get("/api/v1/media/artifacts", headers=alice_headers)
    assert alice_before_response.status_code == 200
    alice_before_items = alice_before_response.json()["items"]
    assert len(alice_before_items) == 3

    deleted_ids = [alice_before_items[0]["message_id"], alice_before_items[1]["message_id"]]
    remaining_id = alice_before_items[2]["message_id"]

    delete_response = client.request(
        "DELETE",
        "/api/v1/media/artifacts",
        headers=alice_headers,
        json={"message_ids": deleted_ids},
    )
    assert delete_response.status_code == 200
    delete_payload = delete_response.json()
    assert delete_payload["deleted_count"] == 2
    assert set(delete_payload["deleted_message_ids"]) == set(deleted_ids)
    assert delete_payload["cleared_all"] is False

    alice_after_response = client.get("/api/v1/media/artifacts", headers=alice_headers)
    assert alice_after_response.status_code == 200
    alice_after_payload = alice_after_response.json()
    assert alice_after_payload["total"] == 1
    assert [item["message_id"] for item in alice_after_payload["items"]] == [remaining_id]

    bob_after_response = client.get("/api/v1/media/artifacts", headers=bob_headers)
    assert bob_after_response.status_code == 200
    assert bob_after_response.json()["total"] == 1


def test_artifact_clear_all_endpoint_removes_all_current_user_drafts(
    client: TestClient,
):
    alice_headers = register_user(client, username="alice-delete-clear")
    bob_headers = register_user(client, username="bob-delete-clear")

    create_artifact_draft(
        client,
        headers=alice_headers,
        thread_id="thread-delete-clear-a",
        message="Create Alice clear draft A.",
        thread_title="Alice clear A",
    )
    create_artifact_draft(
        client,
        headers=alice_headers,
        thread_id="thread-delete-clear-b",
        platform="douyin",
        task_type="comment_reply",
        message="Create Alice clear draft B.",
        system_prompt="You are a comment reply operator.",
        thread_title="Alice clear B",
    )
    create_artifact_draft(
        client,
        headers=bob_headers,
        thread_id="thread-delete-clear-bob",
        message="Create Bob clear draft.",
        thread_title="Bob clear draft",
    )

    alice_before_response = client.get("/api/v1/media/artifacts", headers=alice_headers)
    assert alice_before_response.status_code == 200
    alice_before_message_ids = {
        item["message_id"] for item in alice_before_response.json()["items"]
    }
    assert len(alice_before_message_ids) == 2

    clear_response = client.request(
        "DELETE",
        "/api/v1/media/artifacts",
        headers=alice_headers,
        json={"clear_all": True},
    )
    assert clear_response.status_code == 200
    clear_payload = clear_response.json()
    assert clear_payload["deleted_count"] == 2
    assert set(clear_payload["deleted_message_ids"]) == alice_before_message_ids
    assert clear_payload["cleared_all"] is True

    alice_after_response = client.get("/api/v1/media/artifacts", headers=alice_headers)
    assert alice_after_response.status_code == 200
    assert alice_after_response.json() == {"items": [], "total": 0}

    bob_after_response = client.get("/api/v1/media/artifacts", headers=bob_headers)
    assert bob_after_response.status_code == 200
    assert bob_after_response.json()["total"] == 1


def test_available_models_endpoint_requires_authentication(client: TestClient):
    response = client.get("/api/v1/models/available")

    assert response.status_code == 401


def test_available_models_endpoint_returns_dashscope_registry(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("QWEN_API_KEY", "dashscope-test-key")
    headers = register_user(client, username="alice-model-registry")

    response = client.get("/api/v1/models/available", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_providers"] >= 1
    assert payload["total_models"] >= 1

    dashscope_provider = next(
        item for item in payload["items"] if item["provider_key"] == "dashscope"
    )
    assert dashscope_provider["provider"] == "阿里百炼 (DashScope)"
    assert dashscope_provider["status"] == "configured"
    assert any(model["model"] == "qwen-max" for model in dashscope_provider["models"])
    assert any(model["group"] == "大语言模型" for model in dashscope_provider["models"])


def test_available_models_endpoint_returns_mimo_registry_for_compatible_provider(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("OMNIMEDIA_LLM_PROVIDER", "langgraph")
    monkeypatch.setenv("LANGGRAPH_INNER_PROVIDER", "compatible")
    monkeypatch.setenv("LLM_API_KEY", "mimo-test-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1")
    monkeypatch.setenv("LLM_MODEL", "mimo-v2.5-pro")
    monkeypatch.setenv("LLM_ARTIFACT_MODEL", "mimo-v2.5-pro")
    monkeypatch.delenv("QWEN_API_KEY", raising=False)
    headers = register_user(client, username="alice-mimo-model-registry")

    response = client.get("/api/v1/models/available", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    compatible_provider = next(
        item for item in payload["items"] if item["provider_key"] == "compatible"
    )

    assert compatible_provider["provider"] == "小米 MiMo (Compatible API)"
    assert compatible_provider["status"] == "configured"
    assert [model["model"] for model in compatible_provider["models"]] == [
        "mimo-v2.5-pro",
        "mimo-v2.5",
        "mimo-v2-omni",
    ]
    assert [model["name"] for model in compatible_provider["models"]] == [
        "MiMo V2.5 Pro",
        "MiMo V2.5",
        "MiMo V2 Omni",
    ]
    assert compatible_provider["models"][0]["is_default"] is True
    assert compatible_provider["models"][0]["tags"] == ["大语言模型", "旗舰", "生产力"]
    assert compatible_provider["models"][2]["group"] == "全模态"


def test_available_models_endpoint_marks_mimo_configured_when_langgraph_defaults_to_proxy_gpt(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("OMNIMEDIA_LLM_PROVIDER", "langgraph")
    monkeypatch.setenv("LANGGRAPH_INNER_PROVIDER", "proxy_gpt")
    monkeypatch.setenv("LLM_API_KEY", "mimo-test-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1")
    monkeypatch.setenv("LLM_MODEL", "mimo-v2.5-pro")
    monkeypatch.setenv("PROXY_GPT_API_KEY", "proxy-gpt-test-key")
    monkeypatch.setenv("PROXY_GPT_BASE_URL", "https://proxy.example.com/v1")
    monkeypatch.setenv("PROXY_GPT_MODEL", "gpt-5.4")
    monkeypatch.delenv("QWEN_API_KEY", raising=False)
    headers = register_user(client, username="alice-mimo-proxy-gpt-registry")

    response = client.get("/api/v1/models/available", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    compatible_provider = next(
        item for item in payload["items"] if item["provider_key"] == "compatible"
    )
    proxy_provider = next(
        item for item in payload["items"] if item["provider_key"] == "proxy_gpt"
    )

    assert compatible_provider["status"] == "configured"
    assert proxy_provider["status"] == "configured"
    assert compatible_provider["models"][0]["id"] == "compatible:mimo-v2.5-pro"


def test_available_models_endpoint_returns_builtin_proxy_gpt_matrix(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("PROXY_GPT_API_KEY", "proxy-gpt-test-key")
    monkeypatch.setenv("PROXY_GPT_BASE_URL", "https://proxy.example.com/v1")
    monkeypatch.setenv("PROXY_GPT_MODEL", "gpt-5.4")
    monkeypatch.delenv("PROXY_GPT_AVAILABLE_MODELS", raising=False)
    monkeypatch.delenv("PROXY_GPT_ARTIFACT_MODEL", raising=False)
    headers = register_user(client, username="alice-openai-proxy-registry")

    response = client.get("/api/v1/models/available", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    proxy_provider = next(
        item for item in payload["items"] if item["provider_key"] == "proxy_gpt"
    )
    models_by_name = {
        model["model"]: model
        for model in proxy_provider["models"]
    }

    assert proxy_provider["provider"] == "OpenAI Proxy"
    assert proxy_provider["status"] == "configured"
    assert {
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.3-codex",
        "gpt-5.3-codex-spark",
        "gpt-5.2",
    }.issubset(models_by_name)
    assert "gpt-5.5" not in models_by_name
    assert models_by_name["gpt-5.4"]["is_default"] is True
    assert models_by_name["gpt-5.4-mini"]["tags"] == ["大语言模型", "高速", "生产力"]
    assert "代码" in models_by_name["gpt-5.3-codex"]["tags"]
    assert "推理" in models_by_name["gpt-5.3-codex-spark"]["tags"]
    assert "逻辑" in models_by_name["gpt-5.3-codex-spark"]["tags"]
    assert "日常" in models_by_name["gpt-5.2"]["tags"]


def test_available_models_endpoint_returns_multi_model_gateway_registry(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test-key")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-chat")
    monkeypatch.setenv(
        "DEEPSEEK_AVAILABLE_MODELS",
        "deepseek-chat,deepseek-v4-flashy,deepseek-pro",
    )
    monkeypatch.setenv("DEEPSEEK_ARTIFACT_MODEL", "")
    monkeypatch.setenv("PROXY_GPT_API_KEY", "proxy-gpt-test-key")
    monkeypatch.setenv("PROXY_GPT_BASE_URL", "https://proxy.example.com/v1")
    monkeypatch.setenv("PROXY_GPT_MODEL", "gpt-5.4-pro")
    monkeypatch.setenv(
        "PROXY_GPT_AVAILABLE_MODELS",
        "gpt-5.4,gpt-5.4-flash,gpt-5.4-pro,gpt-5.5",
    )
    monkeypatch.setenv("PROXY_GPT_ARTIFACT_MODEL", "")
    headers = register_user(client, username="alice-multi-model-registry")

    response = client.get("/api/v1/models/available", headers=headers)

    assert response.status_code == 200
    payload = response.json()

    deepseek_provider = next(
        item for item in payload["items"] if item["provider_key"] == "deepseek"
    )
    proxy_provider = next(
        item for item in payload["items"] if item["provider_key"] == "proxy_gpt"
    )

    assert deepseek_provider["status"] == "configured"
    assert {model["model"] for model in deepseek_provider["models"]} == {
        "deepseek-chat",
        "deepseek-v4-flashy",
        "deepseek-pro",
    }
    assert all(model["requires_premium"] is False for model in deepseek_provider["models"])
    assert sum(1 for model in deepseek_provider["models"] if model["is_default"]) == 1
    assert next(
        model for model in deepseek_provider["models"] if model["model"] == "deepseek-chat"
    )["is_default"] is True

    assert proxy_provider["status"] == "configured"
    assert {model["model"] for model in proxy_provider["models"]} == {
        "gpt-5.2",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.3-codex",
        "gpt-5.3-codex-spark",
        "gpt-5.4-flash",
        "gpt-5.4-pro",
    }
    assert not any(model["model"] == "gpt-5.5" for model in proxy_provider["models"])
    assert all(model["requires_premium"] is True for model in proxy_provider["models"])
    assert sum(1 for model in proxy_provider["models"] if model["is_default"]) == 1
    assert next(
        model for model in proxy_provider["models"] if model["model"] == "gpt-5.4-pro"
    )["is_default"] is True


def test_available_models_endpoint_keeps_mimo_default_when_extra_gateways_are_configured(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("OMNIMEDIA_LLM_PROVIDER", "langgraph")
    monkeypatch.setenv("LANGGRAPH_INNER_PROVIDER", "compatible")
    monkeypatch.setenv("LLM_API_KEY", "mimo-test-key")
    monkeypatch.setenv("LLM_BASE_URL", "https://token-plan-cn.xiaomimimo.com/v1")
    monkeypatch.setenv("LLM_MODEL", "mimo-v2.5-pro")
    monkeypatch.setenv("LLM_ARTIFACT_MODEL", "mimo-v2.5-pro")
    monkeypatch.setenv("DEEPSEEK_API_KEY", "deepseek-test-key")
    monkeypatch.setenv("DEEPSEEK_MODEL", "deepseek-chat")
    monkeypatch.setenv("PROXY_GPT_API_KEY", "proxy-gpt-test-key")
    monkeypatch.setenv("PROXY_GPT_BASE_URL", "https://proxy.example.com/v1")
    monkeypatch.setenv("PROXY_GPT_MODEL", "gpt-5.4")
    headers = register_user(client, username="alice-mimo-default-registry")

    response = client.get("/api/v1/models/available", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["items"][0]["provider_key"] == "compatible"
    assert payload["items"][0]["models"][0]["model"] == "mimo-v2.5-pro"
    assert payload["items"][0]["models"][0]["is_default"] is True


def test_media_chat_stream_blocks_premium_models_for_standard_user(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("PROXY_GPT_API_KEY", "proxy-gpt-test-key")
    monkeypatch.setenv("PROXY_GPT_BASE_URL", "https://proxy.example.com/v1")
    monkeypatch.setenv("PROXY_GPT_MODEL", "gpt-5.4")
    headers = register_user(client, username="alice-premium-block")

    response = client.post(
        "/api/v1/media/chat/stream",
        headers=headers,
        json={
            "thread_id": "thread-premium-block",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请帮我写一篇新品种草文案",
            "materials": [],
            "model_override": "proxy_gpt:gpt-5.4",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == PREMIUM_MODEL_ACCESS_DENIED_DETAIL


def test_media_chat_stream_allows_premium_models_for_admin_and_persists_override(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setenv("PROXY_GPT_API_KEY", "proxy-gpt-test-key")
    monkeypatch.setenv("PROXY_GPT_BASE_URL", "https://proxy.example.com/v1")
    monkeypatch.setenv("PROXY_GPT_MODEL", "gpt-5.4")
    headers = register_admin_user(
        client,
        username="admin-premium-allow",
        role="admin",
    )

    async def fake_stream(*args, **kwargs):
        yield 'event: start\ndata: {"thread_id":"thread-premium-allow","platform":"xiaohongshu","task_type":"content_generation","materials_count":0}\n\n'
        yield 'event: done\ndata: {"thread_id":"thread-premium-allow","status":"completed"}\n\n'

    monkeypatch.setattr(agent_module.media_agent_workflow, "stream", fake_stream)

    with client.stream(
        "POST",
        "/api/v1/media/chat/stream",
        headers=headers,
        json={
            "thread_id": "thread-premium-allow",
            "platform": "xiaohongshu",
            "task_type": "content_generation",
            "message": "请帮我写一篇新品种草文案",
            "materials": [],
            "model_override": "proxy_gpt:gpt-5.4",
        },
    ) as response:
        assert response.status_code == 200
        raw_stream = "".join(response.iter_text())

    assert 'event: start' in raw_stream
    assert 'event: done' in raw_stream

    with client.app.state.testing_session_local() as db:
        thread = db.get(Thread, "thread-premium-allow")
        assert thread is not None
        assert thread.model_override == "proxy_gpt:gpt-5.4"


def test_thread_history_returns_user_message_image_material(client: TestClient):
    headers = register_user(client, username="alice-image-history")
    image_url = "https://media-bucket.oss-cn-hangzhou.aliyuncs.com/uploads/alice/sample.jpg"
    payload = {
        "thread_id": "thread-image-history",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "请分析图片中的是什么",
        "materials": [
            {
                "type": "image",
                "url": image_url,
                "text": "sample.jpg",
            }
        ],
    }

    collect_stream_events(client, payload, headers=headers)

    response = client.get(
        "/api/v1/media/threads/thread-image-history/messages",
        headers=headers,
    )
    assert response.status_code == 200
    response_payload = response.json()
    user_message = response_payload["messages"][0]

    assert response_payload["materials"] == []
    assert user_message["role"] == "user"
    assert user_message["materials"] == [
        {
            "id": user_message["materials"][0]["id"],
            "thread_id": "thread-image-history",
            "message_id": user_message["id"],
            "type": "image",
            "url": image_url,
            "text": "sample.jpg",
            "created_at": user_message["materials"][0]["created_at"],
        }
    ]


def test_persist_assistant_output_normalizes_generated_images_before_storage(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    auth_payload = register_auth_response(client, username="alice-generated-image-storage")
    user_id = str(auth_payload["user"]["id"])
    thread_id = "thread-generated-image-storage"
    signed_url = (
        "https://mediapilot-bucket.oss-cn-beijing.aliyuncs.com/uploads/"
        "alice/generated/thread-generated-image-storage/cover-1.png"
        "?x-oss-date=20260430T154609Z&x-oss-expires=3600&x-oss-signature=expired"
    )
    normalized_stored_path = (
        "oss://uploads/alice/generated/thread-generated-image-storage/cover-1.png"
    )

    monkeypatch.setattr(
        persistence_module,
        "normalize_storage_reference",
        lambda reference: normalized_stored_path if reference == signed_url else reference,
    )

    artifact = ContentGenerationArtifactPayload(
        title="带配图的内容草稿",
        title_candidates=["标题 A"],
        body="正文草稿",
        platform_cta="平台引导语",
        generated_images=[signed_url],
    )

    with client.app.state.testing_session_local() as db:
        persistence_module.persist_assistant_output(
            db,
            thread_id=thread_id,
            user_id=user_id,
            assistant_text="生成完成",
            artifact=artifact,
        )
        record = db.scalar(
            select(ArtifactRecord).where(ArtifactRecord.thread_id == thread_id)
        )

    assert record is not None
    assert record.payload["generated_images"] == [normalized_stored_path]


def test_history_and_artifact_routes_refresh_generated_image_urls(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    auth_payload = register_auth_response(client, username="alice-generated-image-history")
    user_id = str(auth_payload["user"]["id"])
    headers = {"Authorization": f"Bearer {auth_payload['access_token']}"}
    thread_id = "thread-generated-image-history"
    expired_url = (
        "https://mediapilot-bucket.oss-cn-beijing.aliyuncs.com/uploads/"
        "alice/generated/thread-generated-image-history/cover-1.png"
        "?x-oss-date=20260430T154609Z&x-oss-expires=3600&x-oss-signature=expired"
    )
    refreshed_url = (
        "https://mediapilot-bucket.oss-cn-beijing.aliyuncs.com/uploads/"
        "alice/generated/thread-generated-image-history/cover-1.png"
        "?x-oss-date=20260501T020000Z&x-oss-expires=3600&x-oss-signature=fresh"
    )

    def fake_resolve_media_reference(reference: str | None) -> str | None:
        if reference == expired_url:
            return refreshed_url
        return reference

    monkeypatch.setattr(
        persistence_module,
        "resolve_media_reference",
        fake_resolve_media_reference,
    )

    artifact = ContentGenerationArtifactPayload(
        title="历史带图草稿",
        title_candidates=["标题 A"],
        body="正文草稿",
        platform_cta="平台引导语",
        generated_images=[expired_url],
    )

    with client.app.state.testing_session_local() as db:
        thread = Thread(
            id=thread_id,
            user_id=user_id,
            title="历史带图线程",
            system_prompt="",
        )
        message = Message(
            thread_id=thread_id,
            role="assistant",
            content="历史带图草稿",
        )
        db.add(thread)
        db.add(message)
        db.flush()
        db.add(
            ArtifactRecord(
                thread_id=thread_id,
                message_id=message.id,
                artifact_type=artifact.artifact_type,
                payload=artifact.model_dump(mode="json"),
            )
        )
        db.commit()

    history_response = client.get(
        f"/api/v1/media/threads/{thread_id}/messages",
        headers=headers,
    )
    assert history_response.status_code == 200
    history_payload = history_response.json()
    artifact_message = next(
        item for item in history_payload["messages"] if item["message_type"] == "artifact"
    )
    assert artifact_message["artifact"]["generated_images"] == [refreshed_url]

    artifacts_response = client.get("/api/v1/media/artifacts", headers=headers)
    assert artifacts_response.status_code == 200
    artifacts_payload = artifacts_response.json()
    matching_item = next(item for item in artifacts_payload["items"] if item["thread_id"] == thread_id)
    assert matching_item["artifact"]["generated_images"] == [refreshed_url]


def test_thread_update_archive_and_delete_flow(client: TestClient):
    register_user(client, username="alice-manage")
    headers = login_user(client, username="alice-manage")
    payload = {
        "thread_id": "thread-manage",
        "platform": "xiaohongshu",
        "task_type": "topic_planning",
        "message": "请给我一组年度复盘主题",
        "materials": [],
    }

    collect_stream_events(client, payload, headers=headers)

    rename_response = client.patch(
        "/api/v1/media/threads/thread-manage",
        json={"title": "高净值客户年度复盘专题"},
        headers=headers,
    )
    assert rename_response.status_code == 200
    renamed_payload = rename_response.json()
    assert renamed_payload["title"] == "高净值客户年度复盘专题"

    archive_response = client.patch(
        "/api/v1/media/threads/thread-manage",
        json={"is_archived": True},
        headers=headers,
    )
    assert archive_response.status_code == 200
    archived_payload = archive_response.json()
    assert archived_payload["is_archived"] is True

    default_threads_response = client.get("/api/v1/media/threads", headers=headers)
    assert default_threads_response.status_code == 200
    default_ids = [item["id"] for item in default_threads_response.json()["items"]]
    assert "thread-manage" not in default_ids

    archived_threads_response = client.get(
        "/api/v1/media/threads?include_archived=true",
        headers=headers,
    )
    assert archived_threads_response.status_code == 200
    archived_item = next(
        item
        for item in archived_threads_response.json()["items"]
        if item["id"] == "thread-manage"
    )
    assert archived_item["is_archived"] is True

    delete_response = client.delete("/api/v1/media/threads/thread-manage", headers=headers)
    assert delete_response.status_code == 200
    assert delete_response.json() == {"id": "thread-manage", "deleted": True}

    missing_response = client.get(
        "/api/v1/media/threads/thread-manage/messages",
        headers=headers,
    )
    assert missing_response.status_code == 404


def test_thread_update_can_change_system_prompt(client: TestClient):
    headers = register_user(client, username="alice-thread-settings")
    payload = {
        "thread_id": "thread-settings",
        "platform": "xiaohongshu",
        "task_type": "content_generation",
        "message": "请帮我生成一篇关于年度资产配置复盘的笔记",
        "materials": [],
    }

    collect_stream_events(client, payload, headers=headers)

    update_response = client.patch(
        "/api/v1/media/threads/thread-settings",
        json={
            "title": "年度资产配置复盘",
            "system_prompt": "你是一名稳健克制的理财内容顾问，请优先强调长期主义与风险提示。",
        },
        headers=headers,
    )
    assert update_response.status_code == 200
    scope_update_response = client.patch(
        "/api/v1/media/threads/thread-settings",
        json={"knowledge_base_scope": "travel_local_guides"},
        headers=headers,
    )
    assert scope_update_response.status_code == 200
    assert scope_update_response.json()["knowledge_base_scope"] == "travel_local_guides"
    assert update_response.json()["title"] == "年度资产配置复盘"

    history_response = client.get(
        "/api/v1/media/threads/thread-settings/messages",
        headers=headers,
    )
    assert history_response.status_code == 200
    history_payload = history_response.json()
    assert history_payload["knowledge_base_scope"] == "travel_local_guides"
    assert history_payload["title"] == "年度资产配置复盘"
    assert (
        history_payload["system_prompt"]
        == "你是一名稳健克制的理财内容顾问，请优先强调长期主义与风险提示。"
    )
