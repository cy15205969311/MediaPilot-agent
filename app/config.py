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


@dataclass(frozen=True)
class OpenAIImageSettings:
    base_url: str
    api_key: str
    model: str


@dataclass(frozen=True)
class OpenAITranscriptionSettings:
    api_key: str
    base_url: str
    model: str


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


def get_openai_image_settings() -> OpenAIImageSettings:
    load_environment()

    base_url = (
        os.getenv("OPENAI_IMAGE_BASE_URL", "").strip()
        or "https://www.onetopai.asia/v1"
    )
    api_key = (
        os.getenv("OPENAI_IMAGE_API_KEY", "").strip()
        or os.getenv("OPENAI_API_KEY", "").strip()
    )
    model = os.getenv("OPENAI_IMAGE_MODEL", "").strip() or "gpt-image-2"

    return OpenAIImageSettings(
        base_url=base_url.rstrip("/"),
        api_key=api_key,
        model=model,
    )


def get_openai_transcription_settings() -> OpenAITranscriptionSettings | None:
    load_environment()

    explicit_api_key = os.getenv("OPENAI_TRANSCRIPTION_API_KEY", "").strip()
    explicit_base_url = _normalize_endpoint(os.getenv("OPENAI_TRANSCRIPTION_BASE_URL", ""))
    explicit_model = os.getenv("OPENAI_TRANSCRIPTION_MODEL", "").strip()

    llm_api_key = os.getenv("LLM_API_KEY", "").strip()
    llm_base_url = _normalize_endpoint(os.getenv("LLM_BASE_URL", ""))

    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    openai_base_url = _normalize_endpoint(os.getenv("OPENAI_BASE_URL", ""))

    if explicit_api_key or explicit_base_url or explicit_model:
        return OpenAITranscriptionSettings(
            api_key=explicit_api_key or llm_api_key or openai_api_key,
            base_url=(explicit_base_url or llm_base_url or openai_base_url).rstrip("/"),
            model=explicit_model,
        )

    if llm_api_key:
        return OpenAITranscriptionSettings(
            api_key=llm_api_key,
            base_url=llm_base_url.rstrip("/"),
            model=explicit_model,
        )

    if openai_api_key:
        return OpenAITranscriptionSettings(
            api_key=openai_api_key,
            base_url=openai_base_url.rstrip("/"),
            model=explicit_model,
        )

    return None
