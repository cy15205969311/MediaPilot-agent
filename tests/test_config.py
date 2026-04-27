import os
import time
from pathlib import Path

import app.config as config_module


OSS_KEYS = [
    "OMNIMEDIA_STORAGE_BACKEND",
    "OSS_ACCESS_KEY_ID",
    "OSS_ACCESS_KEY_SECRET",
    "OSS_ENDPOINT",
    "OSS_BUCKET_NAME",
    "OSS_REGION",
    "OSS_PUBLIC_BASE_URL",
]


def reset_config_state(monkeypatch, env_path: Path) -> None:
    monkeypatch.setattr(config_module, "DOTENV_PATH", env_path)
    monkeypatch.setattr(config_module, "_DOTENV_MANAGED_KEYS", set())
    monkeypatch.setattr(config_module, "_DOTENV_MTIME_NS", None)
    for key in OSS_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_get_oss_settings_reloads_dotenv_after_file_change(
    tmp_path: Path,
    monkeypatch,
):
    env_path = tmp_path / ".env"
    reset_config_state(monkeypatch, env_path)

    env_path.write_text(
        "\n".join(
            [
                "OMNIMEDIA_STORAGE_BACKEND=oss",
                "OSS_ACCESS_KEY_ID=test-key-a",
                "OSS_ACCESS_KEY_SECRET=test-secret-a",
                "OSS_ENDPOINT=https://oss-cn-beijing.aliyuncs.com",
                "OSS_BUCKET_NAME=media-bucket-a",
                "OSS_REGION=cn-beijing",
                "OSS_PUBLIC_BASE_URL=https://media-bucket-a.oss-cn-beijing.aliyuncs.com",
            ]
        ),
        encoding="utf-8",
    )

    first_settings = config_module.get_oss_settings(required=True)

    assert first_settings.bucket_name == "media-bucket-a"
    assert os.getenv("OSS_BUCKET_NAME") == "media-bucket-a"

    time.sleep(0.02)
    env_path.write_text(
        "\n".join(
            [
                "OMNIMEDIA_STORAGE_BACKEND=oss",
                "OSS_ACCESS_KEY_ID=test-key-b",
                "OSS_ACCESS_KEY_SECRET=test-secret-b",
                "OSS_ENDPOINT=https://oss-cn-shanghai.aliyuncs.com",
                "OSS_BUCKET_NAME=media-bucket-b",
                "OSS_REGION=cn-shanghai",
                "OSS_PUBLIC_BASE_URL=https://media-bucket-b.oss-cn-shanghai.aliyuncs.com",
            ]
        ),
        encoding="utf-8",
    )

    second_settings = config_module.get_oss_settings(required=True)

    assert second_settings.bucket_name == "media-bucket-b"
    assert second_settings.region == "cn-shanghai"
    assert second_settings.public_base_url.endswith(
        "media-bucket-b.oss-cn-shanghai.aliyuncs.com"
    )
    assert os.getenv("OSS_BUCKET_NAME") == "media-bucket-b"


def test_get_oss_settings_required_reports_missing_fields(
    tmp_path: Path,
    monkeypatch,
):
    env_path = tmp_path / ".env"
    reset_config_state(monkeypatch, env_path)

    env_path.write_text(
        "\n".join(
            [
                "OSS_ACCESS_KEY_ID=test-key",
                "OSS_ENDPOINT=https://oss-cn-beijing.aliyuncs.com",
            ]
        ),
        encoding="utf-8",
    )

    try:
        config_module.get_oss_settings(required=True)
    except RuntimeError as exc:
        message = str(exc)
    else:  # pragma: no cover - defensive assertion
        raise AssertionError("Expected missing OSS configuration to raise RuntimeError")

    assert "OSS_ACCESS_KEY_SECRET" in message
    assert "OSS_BUCKET_NAME" in message
