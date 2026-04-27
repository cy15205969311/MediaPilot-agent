import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from dotenv import dotenv_values

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DOTENV_PATH = PROJECT_ROOT / ".env"
_DOTENV_MANAGED_KEYS: set[str] = set()
_DOTENV_MTIME_NS: int | None = None


@dataclass(frozen=True)
class OSSSettings:
    access_key_id: str
    access_key_secret: str
    endpoint: str
    bucket_name: str
    public_base_url: str
    region: str


def load_environment() -> Path | None:
    global _DOTENV_MTIME_NS, _DOTENV_MANAGED_KEYS

    if not DOTENV_PATH.exists():
        for key in _DOTENV_MANAGED_KEYS:
            os.environ.pop(key, None)
        _DOTENV_MANAGED_KEYS = set()
        _DOTENV_MTIME_NS = None
        return None

    current_mtime_ns = DOTENV_PATH.stat().st_mtime_ns
    if _DOTENV_MTIME_NS == current_mtime_ns:
        return DOTENV_PATH

    dotenv_items = {
        key: value
        for key, value in dotenv_values(DOTENV_PATH).items()
        if value is not None
    }
    next_managed_keys = set(dotenv_items)

    for key in _DOTENV_MANAGED_KEYS - next_managed_keys:
        os.environ.pop(key, None)

    for key, value in dotenv_items.items():
        if key in os.environ and key not in _DOTENV_MANAGED_KEYS:
            continue
        os.environ[key] = value

    _DOTENV_MANAGED_KEYS = next_managed_keys
    _DOTENV_MTIME_NS = current_mtime_ns
    return DOTENV_PATH


def _normalize_endpoint(endpoint: str) -> str:
    normalized = endpoint.strip().rstrip("/")
    if not normalized:
        return ""
    if "://" not in normalized:
        normalized = f"https://{normalized}"
    return normalized


def _build_public_base_url(endpoint: str, bucket_name: str) -> str:
    parsed = urlparse(endpoint)
    scheme = parsed.scheme or "https"
    netloc = parsed.netloc or parsed.path
    if not netloc:
        return ""

    if netloc.startswith(f"{bucket_name}."):
        return f"{scheme}://{netloc}".rstrip("/")
    return f"{scheme}://{bucket_name}.{netloc}".rstrip("/")


def _extract_region_from_endpoint(endpoint: str) -> str:
    parsed = urlparse(endpoint)
    host = parsed.netloc or parsed.path
    segments = [segment for segment in host.split(".") if segment]
    for segment in segments:
        if segment.startswith("oss-"):
            return segment.removeprefix("oss-")
    return ""


def get_oss_settings(*, required: bool = False) -> OSSSettings | None:
    load_environment()

    access_key_id = os.getenv("OSS_ACCESS_KEY_ID", "").strip()
    access_key_secret = os.getenv("OSS_ACCESS_KEY_SECRET", "").strip()
    endpoint = _normalize_endpoint(os.getenv("OSS_ENDPOINT", ""))
    bucket_name = os.getenv("OSS_BUCKET_NAME", "").strip()
    public_base_url = os.getenv("OSS_PUBLIC_BASE_URL", "").strip().rstrip("/")
    region = os.getenv("OSS_REGION", "").strip()

    if not public_base_url and endpoint and bucket_name:
        public_base_url = _build_public_base_url(endpoint, bucket_name)
    if not region and endpoint:
        region = _extract_region_from_endpoint(endpoint)

    has_full_config = all(
        [
            access_key_id,
            access_key_secret,
            endpoint,
            bucket_name,
            public_base_url,
            region,
        ]
    )

    if not has_full_config:
        if required:
            missing_fields = []
            if not access_key_id:
                missing_fields.append("OSS_ACCESS_KEY_ID")
            if not access_key_secret:
                missing_fields.append("OSS_ACCESS_KEY_SECRET")
            if not endpoint:
                missing_fields.append("OSS_ENDPOINT")
            if not bucket_name:
                missing_fields.append("OSS_BUCKET_NAME")
            if not region:
                missing_fields.append("OSS_REGION")
            if not public_base_url:
                missing_fields.append("OSS_PUBLIC_BASE_URL")
            raise RuntimeError(
                "OSS configuration is incomplete. Missing: "
                + ", ".join(missing_fields),
            )
        return None

    return OSSSettings(
        access_key_id=access_key_id,
        access_key_secret=access_key_secret,
        endpoint=endpoint,
        bucket_name=bucket_name,
        public_base_url=public_base_url,
        region=region,
    )
