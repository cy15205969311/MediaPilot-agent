import asyncio
from io import BytesIO
from types import SimpleNamespace

import oss2 as real_oss2

from app.config import OSSSettings
from app.services import oss_client as oss_client_module


def test_aliyun_client_uses_configured_credentials_for_v4_auth(monkeypatch):
    calls: dict[str, object] = {}

    class FakeAuthV4:
        def __init__(self, access_key_id: str, access_key_secret: str) -> None:
            calls["auth"] = (access_key_id, access_key_secret)

    class FakeBucket:
        def __init__(self, auth, endpoint: str, bucket_name: str, region: str) -> None:
            calls["bucket"] = (auth, endpoint, bucket_name, region)

    monkeypatch.setattr(
        oss_client_module,
        "oss2",
        SimpleNamespace(AuthV4=FakeAuthV4, Auth=None, Bucket=FakeBucket),
    )

    settings = OSSSettings(
        access_key_id="configured-key",
        access_key_secret="configured-secret",
        endpoint="https://oss-cn-shanghai.aliyuncs.com",
        bucket_name="media-bucket",
        public_base_url="https://media-bucket.oss-cn-shanghai.aliyuncs.com",
        region="cn-shanghai",
    )

    bucket = oss_client_module.AliyunOSSClient(settings)._get_bucket()

    assert isinstance(bucket, FakeBucket)
    assert calls["auth"] == ("configured-key", "configured-secret")
    assert calls["bucket"][1:] == (
        "https://oss-cn-shanghai.aliyuncs.com",
        "media-bucket",
        "cn-shanghai",
    )


def test_local_storage_client_upload_file_stream_writes_bytes(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(oss_client_module, "LOCAL_UPLOADS_DIR", tmp_path / "uploads")
    oss_client_module.LOCAL_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    stored_upload = asyncio.run(
        oss_client_module.LocalStorageClient().upload_file_stream(
            user_id="alice",
            filename="cover.png",
            content_type="image/png",
            file_stream=BytesIO(b"stream-bytes"),
        )
    )

    assert stored_upload.object_key == "alice/cover.png"
    assert stored_upload.public_url == "/uploads/alice/cover.png"
    assert (oss_client_module.LOCAL_UPLOADS_DIR / "alice" / "cover.png").read_bytes() == b"stream-bytes"


def test_aliyun_client_upload_file_stream_passes_file_like_object(monkeypatch):
    calls: dict[str, object] = {}

    class FakeAuthV4:
        def __init__(self, access_key_id: str, access_key_secret: str) -> None:
            calls["auth"] = (access_key_id, access_key_secret)

    class FakeBucket:
        def __init__(self, auth, endpoint: str, bucket_name: str, region: str) -> None:
            calls["bucket"] = (auth, endpoint, bucket_name, region)

        def put_object(self, object_key: str, data, headers=None) -> None:
            calls["put_object"] = {
                "object_key": object_key,
                "data": data.read(),
                "headers": headers,
            }

    monkeypatch.setattr(
        oss_client_module,
        "oss2",
        SimpleNamespace(AuthV4=FakeAuthV4, Auth=None, Bucket=FakeBucket),
    )

    settings = OSSSettings(
        access_key_id="configured-key",
        access_key_secret="configured-secret",
        endpoint="https://oss-cn-shanghai.aliyuncs.com",
        bucket_name="media-bucket",
        public_base_url="https://media-bucket.oss-cn-shanghai.aliyuncs.com",
        region="cn-shanghai",
    )

    stored_upload = asyncio.run(
        oss_client_module.AliyunOSSClient(settings).upload_file_stream(
            user_id="alice",
            filename="cover.png",
            content_type="image/png",
            file_stream=BytesIO(b"oss-stream"),
        )
    )

    assert stored_upload.object_key == "uploads/alice/cover.png"
    assert stored_upload.public_url == "https://media-bucket.oss-cn-shanghai.aliyuncs.com/uploads/alice/cover.png"
    assert calls["put_object"] == {
        "object_key": "uploads/alice/cover.png",
        "data": b"oss-stream",
        "headers": {"Content-Type": "image/png"},
    }


def test_aliyun_client_generates_presigned_delivery_url(monkeypatch):
    calls: dict[str, object] = {}

    class FakeAuthV4:
        def __init__(self, access_key_id: str, access_key_secret: str) -> None:
            calls["auth"] = (access_key_id, access_key_secret)

    class FakeBucket:
        def __init__(self, auth, endpoint: str, bucket_name: str, region: str) -> None:
            calls["bucket"] = (auth, endpoint, bucket_name, region)

        def sign_url(self, method: str, key: str, expires: int, **kwargs) -> str:
            calls["sign_url"] = {
                "method": method,
                "key": key,
                "expires": expires,
                "kwargs": kwargs,
            }
            return f"https://signed.example.com/{key}?Expires={expires}"

    monkeypatch.setattr(
        oss_client_module,
        "oss2",
        SimpleNamespace(AuthV4=FakeAuthV4, Auth=None, Bucket=FakeBucket),
    )

    client = oss_client_module.AliyunOSSClient(
        OSSSettings(
            access_key_id="configured-key",
            access_key_secret="configured-secret",
            endpoint="https://oss-cn-shanghai.aliyuncs.com",
            bucket_name="media-bucket",
            public_base_url="https://media-bucket.oss-cn-shanghai.aliyuncs.com",
            region="cn-shanghai",
        )
    )

    signed_url = client.generate_presigned_url("uploads/alice/cover.png", expires_in=1800)

    assert signed_url == "https://signed.example.com/uploads/alice/cover.png?Expires=1800"
    assert calls["sign_url"] == {
        "method": "GET",
        "key": "uploads/alice/cover.png",
        "expires": 1800,
        "kwargs": {"slash_safe": True},
    }


def test_aliyun_client_sets_up_bucket_lifecycle_rules(monkeypatch):
    calls: dict[str, object] = {}

    class FakeAuthV4:
        def __init__(self, access_key_id: str, access_key_secret: str) -> None:
            calls["auth"] = (access_key_id, access_key_secret)

    class FakeBucket:
        def __init__(self, auth, endpoint: str, bucket_name: str, region: str) -> None:
            calls["bucket"] = (auth, endpoint, bucket_name, region)

        def put_bucket_lifecycle(self, lifecycle) -> None:
            calls["lifecycle"] = lifecycle

    monkeypatch.setenv("OSS_TMP_UPLOAD_EXPIRE_DAYS", "3")
    monkeypatch.setenv("OSS_THREAD_UPLOAD_TRANSITION_DAYS", "30")
    monkeypatch.setenv("OSS_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS", "IA")
    monkeypatch.setattr(
        oss_client_module,
        "oss2",
        SimpleNamespace(
            AuthV4=FakeAuthV4,
            Auth=None,
            Bucket=FakeBucket,
            models=real_oss2.models,
        ),
    )

    client = oss_client_module.AliyunOSSClient(
        OSSSettings(
            access_key_id="configured-key",
            access_key_secret="configured-secret",
            endpoint="https://oss-cn-shanghai.aliyuncs.com",
            bucket_name="media-bucket",
            public_base_url="https://media-bucket.oss-cn-shanghai.aliyuncs.com",
            region="cn-shanghai",
        )
    )

    client.setup_bucket_lifecycle()

    lifecycle = calls["lifecycle"]
    assert len(lifecycle.rules) == 2

    tmp_rule = lifecycle.rules[0]
    assert tmp_rule.id == "cleanup-temporary-material-uploads"
    assert tmp_rule.prefix == "uploads/tmp/"
    assert tmp_rule.expiration.days == 3

    transition_rule = lifecycle.rules[1]
    assert transition_rule.id == "transition-thread-material-uploads"
    assert transition_rule.prefix == "uploads/"
    assert len(transition_rule.storage_transitions) == 1
    assert transition_rule.storage_transitions[0].days == 30
    assert transition_rule.storage_transitions[0].storage_class == "IA"
