from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Template, Thread, User
from app.models.schemas import (
    KnowledgeScopeDeleteResponse,
    KnowledgeScopeListItem,
    KnowledgeScopeListResponse,
    KnowledgeScopeRenameRequest,
    KnowledgeScopeRenameResponse,
    KnowledgeScopeSourceItem,
    KnowledgeScopeSourceListResponse,
    KnowledgeSourceDeleteResponse,
    KnowledgeUploadResponse,
)
from app.services.auth import get_current_user
from app.services.knowledge_base import (
    build_default_scope_from_filename,
    get_knowledge_base_service,
    normalize_knowledge_base_scope,
    normalize_knowledge_source,
    split_text_into_knowledge_chunks,
)

router = APIRouter(prefix="/api/v1/media", tags=["media-knowledge"])

SUPPORTED_TEXT_SUFFIXES = {".txt", ".md", ".markdown"}
SUPPORTED_TEXT_CONTENT_TYPES = {
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "application/octet-stream",
}


def _decode_text_payload(raw_bytes: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return raw_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="无法解析上传文件，请改用 UTF-8 / UTF-8 with BOM / GB18030 编码的 txt 或 md 文件。",
    )


def _validate_text_upload(file: UploadFile) -> str:
    filename = (file.filename or "").strip() or "uploaded_text.txt"
    suffix = Path(filename).suffix.lower()
    content_type = (file.content_type or "").strip().lower()
    if suffix not in SUPPORTED_TEXT_SUFFIXES and content_type not in SUPPORTED_TEXT_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="当前知识库仅支持 .txt / .md / .markdown 文本文件上传。",
        )
    return filename


@router.get("/knowledge/scopes", response_model=KnowledgeScopeListResponse)
async def list_knowledge_scopes(
    _db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeScopeListResponse:
    _ = _db
    items = [
        KnowledgeScopeListItem(
            scope=item.scope,
            chunk_count=item.chunk_count,
            source_count=item.source_count,
            updated_at=item.updated_at,
        )
        for item in get_knowledge_base_service().list_scopes(current_user.id)
    ]
    return KnowledgeScopeListResponse(items=items, total=len(items))


@router.post(
    "/knowledge/upload",
    response_model=KnowledgeUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_knowledge_document(
    file: UploadFile = File(...),
    scope: str | None = Form(default=None),
    _db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeUploadResponse:
    _ = _db
    filename = _validate_text_upload(file)
    raw_bytes = await file.read()
    await file.close()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="上传文件为空，无法写入知识库。")

    text = _decode_text_payload(raw_bytes)
    normalized_scope = normalize_knowledge_base_scope(scope) or build_default_scope_from_filename(
        filename,
    )
    chunks = split_text_into_knowledge_chunks(text)
    if not chunks:
        raise HTTPException(status_code=400, detail="文件内容为空，无法切分知识块。")

    chunk_count = get_knowledge_base_service().add_documents(
        current_user.id,
        normalized_scope,
        chunks,
        source=filename,
    )
    return KnowledgeUploadResponse(
        scope=normalized_scope,
        source=filename,
        chunk_count=chunk_count,
    )


@router.delete("/knowledge/scopes/{scope}", response_model=KnowledgeScopeDeleteResponse)
async def delete_knowledge_scope(
    scope: str,
    _db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeScopeDeleteResponse:
    _ = _db
    normalized_scope = normalize_knowledge_base_scope(scope)
    if normalized_scope is None:
        raise HTTPException(status_code=400, detail="知识库 Scope 不能为空。")

    deleted_count = get_knowledge_base_service().delete_scope(current_user.id, normalized_scope)
    return KnowledgeScopeDeleteResponse(
        scope=normalized_scope,
        deleted_count=deleted_count,
        deleted=deleted_count > 0,
    )


@router.patch("/knowledge/scopes/{scope_name}", response_model=KnowledgeScopeRenameResponse)
async def rename_knowledge_scope(
    scope_name: str,
    payload: KnowledgeScopeRenameRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeScopeRenameResponse:
    service = get_knowledge_base_service()
    normalized_scope_name = normalize_knowledge_base_scope(scope_name)
    normalized_new_name = normalize_knowledge_base_scope(payload.new_name)
    if normalized_scope_name is None:
        raise HTTPException(status_code=400, detail="Knowledge scope cannot be empty.")
    if normalized_new_name is None:
        raise HTTPException(status_code=400, detail="New scope name is invalid after normalization.")

    scope_summaries = {item.scope: item for item in service.list_scopes(current_user.id)}
    current_summary = scope_summaries.get(normalized_scope_name)
    if current_summary is None:
        raise HTTPException(status_code=404, detail="Knowledge scope not found.")

    if normalized_scope_name == normalized_new_name:
        return KnowledgeScopeRenameResponse(
            previous_scope=normalized_scope_name,
            scope=normalized_new_name,
            renamed_count=current_summary.chunk_count,
            renamed=False,
        )

    if normalized_new_name in scope_summaries:
        raise HTTPException(status_code=409, detail="Knowledge scope name already exists.")

    renamed_count = service.rename_scope(
        current_user.id,
        normalized_scope_name,
        normalized_new_name,
    )
    if renamed_count <= 0:
        raise HTTPException(status_code=404, detail="Knowledge scope not found.")

    db.query(Thread).filter(
        Thread.user_id == current_user.id,
        Thread.knowledge_base_scope == normalized_scope_name,
    ).update(
        {Thread.knowledge_base_scope: normalized_new_name},
        synchronize_session=False,
    )
    db.query(Template).filter(
        Template.user_id == current_user.id,
        Template.knowledge_base_scope == normalized_scope_name,
    ).update(
        {Template.knowledge_base_scope: normalized_new_name},
        synchronize_session=False,
    )
    db.commit()

    return KnowledgeScopeRenameResponse(
        previous_scope=normalized_scope_name,
        scope=normalized_new_name,
        renamed_count=renamed_count,
        renamed=True,
    )


@router.get(
    "/knowledge/scopes/{scope_name}/sources",
    response_model=KnowledgeScopeSourceListResponse,
)
async def list_knowledge_scope_sources(
    scope_name: str,
    _db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeScopeSourceListResponse:
    _ = _db
    normalized_scope_name = normalize_knowledge_base_scope(scope_name)
    if normalized_scope_name is None:
        raise HTTPException(status_code=400, detail="Knowledge scope cannot be empty.")

    items = [
        KnowledgeScopeSourceItem(
            filename=item.filename,
            chunk_count=item.chunk_count,
        )
        for item in get_knowledge_base_service().list_scope_sources(
            current_user.id,
            normalized_scope_name,
        )
    ]
    return KnowledgeScopeSourceListResponse(
        scope=normalized_scope_name,
        items=items,
        total=len(items),
    )


@router.delete(
    "/knowledge/scopes/{scope_name}/sources/{source_name}",
    response_model=KnowledgeSourceDeleteResponse,
)
async def delete_knowledge_source(
    scope_name: str,
    source_name: str,
    _db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> KnowledgeSourceDeleteResponse:
    _ = _db
    normalized_scope_name = normalize_knowledge_base_scope(scope_name)
    if normalized_scope_name is None:
        raise HTTPException(status_code=400, detail="Knowledge scope cannot be empty.")

    normalized_source_name = normalize_knowledge_source(source_name)
    deleted_count = get_knowledge_base_service().delete_source(
        current_user.id,
        normalized_scope_name,
        normalized_source_name,
    )
    return KnowledgeSourceDeleteResponse(
        scope=normalized_scope_name,
        source=normalized_source_name,
        deleted_count=deleted_count,
        deleted=deleted_count > 0,
    )
