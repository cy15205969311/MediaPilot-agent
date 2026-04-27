from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlparse

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

    @abstractmethod
    def build_public_url(self, object_key: str) -> str:
        """Build a public URL for the stored object."""

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
    ) -> StoredUpload:
        """Upload a file and return its storage metadata."""

    @abstractmethod
    async def delete_file(self, object_key: str) -> None:
        """Delete a file from the storage backend."""


class LocalStorageClient(BaseStorageClient):
    backend_name = LOCAL_STORAGE_BACKEND

    def build_object_key(self, *, user_id: str, filename: str) -> str:
        return f"{user_id}/{filename}"

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
    ) -> StoredUpload:
        object_key = self.build_object_key(user_id=user_id, filename=filename)
        await run_in_threadpool(self._write_file, object_key, data)
        return StoredUpload(
            backend_name=self.backend_name,
            object_key=object_key,
            public_url=self.build_public_url(object_key),
        )

    def _write_file(self, object_key: str, data: bytes) -> None:
        destination = LOCAL_UPLOADS_DIR / object_key
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)

    async def delete_file(self, object_key: str) -> None:
        await run_in_threadpool(self._delete_file, object_key)

    def _delete_file(self, object_key: str) -> None:
        file_path = LOCAL_UPLOADS_DIR / object_key
        file_path.unlink(missing_ok=True)


class AliyunOSSClient(BaseStorageClient):
    backend_name = OSS_STORAGE_BACKEND

    def __init__(self, settings: OSSSettings) -> None:
        self.settings = settings
        self._bucket = None
        parsed_public_base = urlparse(settings.public_base_url)
        self._public_scheme = parsed_public_base.scheme or "https"
        self._public_netloc = parsed_public_base.netloc or parsed_public_base.path

    def build_object_key(self, *, user_id: str, filename: str) -> str:
        return f"uploads/{user_id}/{filename}"

    def build_public_url(self, object_key: str) -> str:
        normalized_key = quote(object_key.strip("/"), safe="/")
        return f"{self.settings.public_base_url.rstrip('/')}/{normalized_key}"

    def extract_object_key_from_url(self, url: str | None) -> str | None:
        if not url:
            return None

        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return None
        if parsed.netloc != self._public_netloc:
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
    ) -> StoredUpload:
        object_key = self.build_object_key(user_id=user_id, filename=filename)
        await run_in_threadpool(self._upload_sync, object_key, content_type, data)
        return StoredUpload(
            backend_name=self.backend_name,
            object_key=object_key,
            public_url=self.build_public_url(object_key),
        )

    def _upload_sync(self, object_key: str, content_type: str, data: bytes) -> None:
        headers = {"Content-Type": content_type}
        self._get_bucket().put_object(object_key, data, headers=headers)

    async def delete_file(self, object_key: str) -> None:
        await run_in_threadpool(self._delete_sync, object_key)

    def _delete_sync(self, object_key: str) -> None:
        self._get_bucket().delete_object(object_key)

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
    if stored_path.startswith("http://") or stored_path.startswith("https://"):
        return stored_path

    backend_name, object_key = parse_stored_file_path(stored_path)
    return create_storage_client(backend_name).build_public_url(object_key)


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
    settings = get_oss_settings(required=False)
    if settings is not None:
        try:
            oss_client = AliyunOSSClient(settings)
        except RuntimeError:
            oss_client = None
        if oss_client is not None:
            oss_key = oss_client.extract_object_key_from_url(url)
            if oss_key:
                return oss_key

    local_client = LocalStorageClient()
    return local_client.extract_object_key_from_url(url)
