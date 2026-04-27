import asyncio
from io import BytesIO
from types import SimpleNamespace

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
