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
