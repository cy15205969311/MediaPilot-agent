from __future__ import annotations

import logging
import os
import shutil
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote, urlparse
from uuid import uuid4

from fastapi.concurrency import run_in_threadpool

from app.config import OSSSettings, get_oss_settings, load_environment

try:  # pragma: no cover - exercised through the runtime path when installed
    import oss2
except ModuleNotFoundError:  # pragma: no cover - keeps local fallback usable in tests
    oss2 = None  # type: ignore[assignment]

load_environment()

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOCAL_UPLOADS_DIR = PROJECT_ROOT / "uploads"
LOCAL_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

LOCAL_STORAGE_BACKEND = "local"
OSS_STORAGE_BACKEND = "oss"
OSS_STORED_PATH_PREFIX = "oss://"
OSS_TEMP_OBJECT_PREFIX = "uploads/tmp"
DEFAULT_SIGNED_URL_EXPIRE_SECONDS = 3600
DEFAULT_SIGNED_URL_MIN_EXPIRE_SECONDS = 60
DEFAULT_SIGNED_URL_MAX_EXPIRE_SECONDS = 86400
DEFAULT_TEMP_UPLOAD_EXPIRY_DAYS = 3
DEFAULT_THREAD_UPLOAD_TRANSITION_DAYS = 30
DEFAULT_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS = "IA"


@dataclass(frozen=True)
class StoredUpload:
    backend_name: str
    object_key: str
    public_url: str


class BaseStorageClient(ABC):
    backend_name: str

    @abstractmethod
    def build_object_key(self, *, user_id: str, filename: str) -> str:
        """Build the backend-specific object key."""

    def build_temporary_object_key(self, *, user_id: str, filename: str) -> str:
        """Build a temporary object key used before a material is bound to a thread."""
        return self.build_object_key(user_id=user_id, filename=filename)

    @abstractmethod
    def build_public_url(self, object_key: str) -> str:
        """Build a public URL for the stored object."""

    def build_delivery_url(self, object_key: str, *, expires_in: int | None = None) -> str:
        """Build a frontend-facing delivery URL for the stored object."""
        return self.build_public_url(object_key)

    @abstractmethod
    def extract_object_key_from_url(self, url: str | None) -> str | None:
        """Return the object key when the URL belongs to this backend."""

    @abstractmethod
    async def upload_file(
        self,
        *,
        user_id: str,
        filename: str,
        content_type: str,
        data: bytes,
        object_key: str | None = None,
    ) -> StoredUpload:
        """Upload a file and return its storage metadata."""

    @abstractmethod
    async def upload_file_stream(
        self,
        *,
        user_id: str,
        filename: str,
        content_type: str,
        file_stream: BinaryIO,
        object_key: str | None = None,
    ) -> StoredUpload:
        """Upload a file-like object and return its storage metadata."""

    @abstractmethod
    async def delete_file(self, object_key: str) -> None:
        """Delete a file from the storage backend."""

    def copy_file_sync(self, source_object_key: str, destination_object_key: str) -> None:
        """Synchronously copy a stored file to a new backend-specific object key."""
        raise NotImplementedError(
            f"{type(self).__name__} does not support file copy operations.",
        )


class LocalStorageClient(BaseStorageClient):
    backend_name = LOCAL_STORAGE_BACKEND

    def build_object_key(self, *, user_id: str, filename: str) -> str:
        return f"{user_id}/{filename}"

    def build_temporary_object_key(self, *, user_id: str, filename: str) -> str:
        return f"tmp/{user_id}/{filename}"

    def build_public_url(self, object_key: str) -> str:
        normalized_key = object_key.strip("/")
        return f"/uploads/{quote(normalized_key, safe='/')}"

    def extract_object_key_from_url(self, url: str | None) -> str | None:
        if not url:
            return None

        parsed = urlparse(url)
        path = parsed.path if parsed.scheme or parsed.netloc else url
        normalized_path = path.strip()
        if not normalized_path.startswith("/uploads/"):
            return None

        object_key = normalized_path.removeprefix("/uploads/").strip("/")
        return object_key or None

    async def upload_file(
        self,
        *,
        user_id: str,
        filename: str,
        content_type: str,
        data: bytes,
        object_key: str | None = None,
    ) -> StoredUpload:
        resolved_object_key = object_key or self.build_object_key(user_id=user_id, filename=filename)
        await run_in_threadpool(self._write_file, resolved_object_key, data)
        return StoredUpload(
            backend_name=self.backend_name,
            object_key=resolved_object_key,
            public_url=self.build_public_url(resolved_object_key),
        )

    async def upload_file_stream(
        self,
        *,
        user_id: str,
        filename: str,
        content_type: str,
        file_stream: BinaryIO,
        object_key: str | None = None,
    ) -> StoredUpload:
        resolved_object_key = object_key or self.build_object_key(user_id=user_id, filename=filename)
        await run_in_threadpool(self._write_stream, resolved_object_key, file_stream)
        return StoredUpload(
            backend_name=self.backend_name,
            object_key=resolved_object_key,
            public_url=self.build_public_url(resolved_object_key),
        )

    def _write_file(self, object_key: str, data: bytes) -> None:
        destination = LOCAL_UPLOADS_DIR / object_key
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp_destination = self._build_temp_destination(destination)
        try:
            temp_destination.write_bytes(data)
            temp_destination.replace(destination)
        except Exception:
            temp_destination.unlink(missing_ok=True)
            raise

    def _write_stream(self, object_key: str, file_stream: BinaryIO) -> None:
        destination = LOCAL_UPLOADS_DIR / object_key
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp_destination = self._build_temp_destination(destination)
        file_stream.seek(0)
        try:
            with temp_destination.open("wb") as output:
                shutil.copyfileobj(file_stream, output, length=1024 * 1024)
            temp_destination.replace(destination)
        except Exception:
            temp_destination.unlink(missing_ok=True)
            raise

    def _build_temp_destination(self, destination: Path) -> Path:
        return destination.with_name(f".{destination.name}.{uuid4().hex}.tmp")

    async def delete_file(self, object_key: str) -> None:
        await run_in_threadpool(self._delete_file, object_key)

    def _delete_file(self, object_key: str) -> None:
        file_path = LOCAL_UPLOADS_DIR / object_key
        file_path.unlink(missing_ok=True)

    def copy_file_sync(self, source_object_key: str, destination_object_key: str) -> None:
        source_path = LOCAL_UPLOADS_DIR / source_object_key
        destination_path = LOCAL_UPLOADS_DIR / destination_object_key
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_path, destination_path)


class AliyunOSSClient(BaseStorageClient):
    backend_name = OSS_STORAGE_BACKEND

    def __init__(self, settings: OSSSettings) -> None:
        self.settings = settings
        self._bucket = None
        parsed_public_base = urlparse(settings.public_base_url)
        parsed_endpoint = urlparse(settings.endpoint)
        self._public_scheme = parsed_public_base.scheme or "https"
        self._public_netloc = parsed_public_base.netloc or parsed_public_base.path
        endpoint_netloc = parsed_endpoint.netloc or parsed_endpoint.path
        bucket_endpoint_netloc = (
            endpoint_netloc
            if endpoint_netloc.startswith(f"{settings.bucket_name}.")
            else f"{settings.bucket_name}.{endpoint_netloc}"
        )
        self._accepted_delivery_netlocs = {
            netloc
            for netloc in {
                self._public_netloc,
                endpoint_netloc,
                bucket_endpoint_netloc,
            }
            if netloc
        }

    def build_object_key(self, *, user_id: str, filename: str) -> str:
        return f"uploads/{user_id}/{filename}"

    def build_temporary_object_key(self, *, user_id: str, filename: str) -> str:
        return f"{OSS_TEMP_OBJECT_PREFIX}/{user_id}/{filename}"

    def build_public_url(self, object_key: str) -> str:
        normalized_key = quote(object_key.strip("/"), safe="/")
        return f"{self.settings.public_base_url.rstrip('/')}/{normalized_key}"

    def build_delivery_url(self, object_key: str, *, expires_in: int | None = None) -> str:
        return self.generate_presigned_url(
            object_key,
            expires_in=expires_in or _get_signed_url_expire_seconds(),
        )

    def extract_object_key_from_url(self, url: str | None) -> str | None:
        if not url:
            return None

        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return None
        if parsed.netloc not in self._accepted_delivery_netlocs:
            return None

        object_key = parsed.path.strip("/")
        return object_key or None

    async def upload_file(
        self,
        *,
        user_id: str,
        filename: str,
        content_type: str,
        data: bytes,
        object_key: str | None = None,
    ) -> StoredUpload:
        resolved_object_key = object_key or self.build_object_key(user_id=user_id, filename=filename)
        await run_in_threadpool(self._upload_sync, resolved_object_key, content_type, data)
        return StoredUpload(
            backend_name=self.backend_name,
            object_key=resolved_object_key,
            public_url=self.build_public_url(resolved_object_key),
        )

    async def upload_file_stream(
        self,
        *,
        user_id: str,
        filename: str,
        content_type: str,
        file_stream: BinaryIO,
        object_key: str | None = None,
    ) -> StoredUpload:
        resolved_object_key = object_key or self.build_object_key(user_id=user_id, filename=filename)
        await run_in_threadpool(
            self._upload_stream_sync,
            resolved_object_key,
            content_type,
            file_stream,
        )
        return StoredUpload(
            backend_name=self.backend_name,
            object_key=resolved_object_key,
            public_url=self.build_public_url(resolved_object_key),
        )

    def _upload_sync(self, object_key: str, content_type: str, data: bytes) -> None:
        headers = {"Content-Type": content_type}
        self._get_bucket().put_object(object_key, data, headers=headers)

    def _upload_stream_sync(
        self,
        object_key: str,
        content_type: str,
        file_stream: BinaryIO,
    ) -> None:
        headers = {"Content-Type": content_type}
        file_stream.seek(0)
        self._get_bucket().put_object(object_key, file_stream, headers=headers)

    async def delete_file(self, object_key: str) -> None:
        await run_in_threadpool(self._delete_sync, object_key)

    def _delete_sync(self, object_key: str) -> None:
        self._get_bucket().delete_object(object_key)

    def copy_file_sync(self, source_object_key: str, destination_object_key: str) -> None:
        self._get_bucket().copy_object(
            self.settings.bucket_name,
            source_object_key,
            destination_object_key,
        )

    def generate_presigned_url(self, object_name: str, expires_in: int = 3600) -> str:
        return self._get_bucket().sign_url(
            "GET",
            object_name,
            _normalize_signed_url_expires_in(expires_in),
            slash_safe=True,
        )

    def setup_bucket_lifecycle(self) -> None:
        bucket = self._get_bucket()
        if oss2 is None:
            raise RuntimeError(
                "The 'oss2' package is not installed. Run 'pip install -r requirements.txt'.",
            )

        tmp_rule = oss2.models.LifecycleRule(
            id="cleanup-temporary-material-uploads",
            prefix=f"{OSS_TEMP_OBJECT_PREFIX}/",
            status="Enabled",
            expiration=oss2.models.LifecycleExpiration(
                days=_get_temp_upload_expiry_days(),
            ),
            abort_multipart_upload=oss2.models.AbortMultipartUpload(days=1),
        )
        storage_transition_rule = oss2.models.LifecycleRule(
            id="transition-thread-material-uploads",
            prefix="uploads/",
            status="Enabled",
            storage_transitions=[
                oss2.models.StorageTransition(
                    days=_get_thread_upload_transition_days(),
                    storage_class=_get_thread_upload_transition_storage_class(),
                    allow_small_file=True,
                )
            ],
        )
        bucket.put_bucket_lifecycle(
            oss2.models.BucketLifecycle(
                rules=[tmp_rule, storage_transition_rule],
            )
        )

    def _get_bucket(self):
        if oss2 is None:
            raise RuntimeError(
                "The 'oss2' package is not installed. Run 'pip install -r requirements.txt'.",
            )
        if self._bucket is None:
            auth_v4 = getattr(oss2, "AuthV4", None)
            if auth_v4 is not None:
                auth = auth_v4(
                    self.settings.access_key_id,
                    self.settings.access_key_secret,
                )
                self._bucket = oss2.Bucket(
                    auth,
                    self.settings.endpoint,
                    self.settings.bucket_name,
                    region=self.settings.region,
                )
            else:
                auth = oss2.Auth(
                    self.settings.access_key_id,
                    self.settings.access_key_secret,
                )
                self._bucket = oss2.Bucket(
                    auth,
                    self.settings.endpoint,
                    self.settings.bucket_name,
                )
        return self._bucket


def create_storage_client(preferred_backend: str | None = None) -> BaseStorageClient:
    load_environment()
    backend_name = (preferred_backend or os.getenv("OMNIMEDIA_STORAGE_BACKEND", "auto")).strip().lower()

    if backend_name == OSS_STORAGE_BACKEND:
        settings = get_oss_settings(required=True)
        return AliyunOSSClient(settings)

    if backend_name == LOCAL_STORAGE_BACKEND:
        return LocalStorageClient()

    settings = get_oss_settings(required=False)
    if settings is not None:
        return AliyunOSSClient(settings)
    return LocalStorageClient()


def build_stored_file_path(backend_name: str, object_key: str) -> str:
    normalized_key = object_key.strip("/")
    if backend_name == OSS_STORAGE_BACKEND:
        return f"{OSS_STORED_PATH_PREFIX}{normalized_key}"
    return normalized_key


def parse_stored_file_path(stored_path: str) -> tuple[str, str]:
    normalized = stored_path.strip()
    if normalized.startswith(OSS_STORED_PATH_PREFIX):
        return OSS_STORAGE_BACKEND, normalized.removeprefix(OSS_STORED_PATH_PREFIX).strip("/")
    return LOCAL_STORAGE_BACKEND, normalized.strip("/")


def build_public_url_from_stored_path(stored_path: str) -> str:
    return build_delivery_url_from_stored_path(stored_path)


def build_delivery_url_from_stored_path(
    stored_path: str,
    *,
    expires_in: int | None = None,
) -> str:
    normalized_reference = normalize_storage_reference(stored_path)
    if normalized_reference is None:
        raise RuntimeError("Stored path is empty.")
    if normalized_reference.startswith("http://") or normalized_reference.startswith("https://"):
        return normalized_reference

    backend_name, object_key = parse_stored_file_path(normalized_reference)
    storage_client = create_storage_client(backend_name)
    return storage_client.build_delivery_url(object_key, expires_in=expires_in)


def delete_stored_file_sync_safe(stored_path: str) -> None:
    backend_name, object_key = parse_stored_file_path(stored_path)

    try:
        client = create_storage_client(backend_name)
    except RuntimeError:
        logger.warning(
            "Storage backend %s is unavailable; skipping delete for %s",
            backend_name,
            stored_path,
        )
        return

    try:
        import asyncio

        asyncio.run(client.delete_file(object_key))
    except RuntimeError:
        logger.warning(
            "Unable to synchronously delete stored file %s during shutdown-safe path.",
            stored_path,
        )


def extract_upload_object_key(url: str | None) -> str | None:
    normalized_reference = normalize_storage_reference(url)
    if normalized_reference is None:
        return None
    if normalized_reference.startswith("http://") or normalized_reference.startswith("https://"):
        return None

    _, object_key = parse_stored_file_path(normalized_reference)
    return object_key or None


def normalize_storage_reference(reference: str | None) -> str | None:
    if reference is None:
        return None

    normalized = str(reference).strip()
    if not normalized:
        return None

    if normalized.startswith(OSS_STORED_PATH_PREFIX):
        _, object_key = parse_stored_file_path(normalized)
        return build_stored_file_path(OSS_STORAGE_BACKEND, object_key)

    parsed = urlparse(normalized)
    settings = get_oss_settings(required=False)
    if settings is not None:
        try:
            oss_client = AliyunOSSClient(settings)
        except RuntimeError:
            oss_client = None
        if oss_client is not None:
            oss_object_key = oss_client.extract_object_key_from_url(normalized)
            if oss_object_key:
                return build_stored_file_path(OSS_STORAGE_BACKEND, oss_object_key)

    local_client = LocalStorageClient()
    if not parsed.scheme and not parsed.netloc:
        local_object_key = local_client.extract_object_key_from_url(normalized)
        if local_object_key:
            return build_stored_file_path(LOCAL_STORAGE_BACKEND, local_object_key)
    elif _is_local_upload_host(parsed.netloc) and parsed.path.startswith("/uploads/"):
        local_object_key = local_client.extract_object_key_from_url(normalized)
        if local_object_key:
            return build_stored_file_path(LOCAL_STORAGE_BACKEND, local_object_key)

    if not parsed.scheme and not parsed.netloc and "/" in normalized and not normalized.startswith("/"):
        return build_stored_file_path(LOCAL_STORAGE_BACKEND, normalized)

    return normalized


def is_temporary_upload_object_key(object_key: str) -> bool:
    normalized_key = object_key.strip("/")
    return normalized_key.startswith(f"{OSS_TEMP_OBJECT_PREFIX}/")


def _get_signed_url_expire_seconds() -> int:
    return _normalize_signed_url_expires_in(
        _read_positive_int_env(
            "OSS_SIGNED_URL_EXPIRE_SECONDS",
            DEFAULT_SIGNED_URL_EXPIRE_SECONDS,
        )
    )


def _normalize_signed_url_expires_in(expires_in: int) -> int:
    minimum = _read_positive_int_env(
        "OSS_SIGNED_URL_MIN_EXPIRE_SECONDS",
        DEFAULT_SIGNED_URL_MIN_EXPIRE_SECONDS,
    )
    configured_maximum = _read_positive_int_env(
        "OSS_SIGNED_URL_MAX_EXPIRE_SECONDS",
        DEFAULT_SIGNED_URL_MAX_EXPIRE_SECONDS,
    )
    maximum = max(minimum, configured_maximum)
    if expires_in < minimum:
        return minimum
    if expires_in > maximum:
        return maximum
    return expires_in


def _get_temp_upload_expiry_days() -> int:
    return _read_positive_int_env(
        "OSS_TMP_UPLOAD_EXPIRE_DAYS",
        DEFAULT_TEMP_UPLOAD_EXPIRY_DAYS,
    )


def _get_thread_upload_transition_days() -> int:
    return _read_positive_int_env(
        "OSS_THREAD_UPLOAD_TRANSITION_DAYS",
        DEFAULT_THREAD_UPLOAD_TRANSITION_DAYS,
    )


def _get_thread_upload_transition_storage_class() -> str:
    return (
        os.getenv(
            "OSS_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS",
            DEFAULT_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS,
        )
        .strip()
        or DEFAULT_THREAD_UPLOAD_TRANSITION_STORAGE_CLASS
    )


def _read_positive_int_env(env_name: str, default: int) -> int:
    raw_value = os.getenv(env_name, "").strip()
    if not raw_value:
        return default
    try:
        parsed = int(raw_value)
    except ValueError:
        logger.warning("Invalid integer value for %s=%s. Falling back to %s.", env_name, raw_value, default)
        return default
    if parsed <= 0:
        logger.warning("Non-positive value for %s=%s. Falling back to %s.", env_name, raw_value, default)
        return default
    return parsed


def _is_local_upload_host(netloc: str) -> bool:
    normalized_netloc = netloc.strip().lower()
    return normalized_netloc in {
        "testserver",
        "localhost",
        "127.0.0.1",
        "::1",
        "localhost:8000",
        "127.0.0.1:8000",
        "[::1]:8000",
    }
