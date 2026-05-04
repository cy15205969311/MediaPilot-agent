from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Template, User
from app.models.schemas import (
    TemplateCategory,
    TemplateCreateRequest,
    TemplateDeleteBatchRequest,
    TemplateDeleteResponse,
    TemplateListItem,
    TemplateListResponse,
    TemplateSkillDiscoveryItem,
    TemplateSkillSearchResponse,
    TemplateUpdateRequest,
)
from app.services.auth import get_current_user
from app.services.knowledge_base import normalize_knowledge_base_scope
from app.services.template_library import (
    PRESET_TEMPLATE_ORDER,
    ensure_preset_templates,
)
from app.services.tools import search_prompt_skills

router = APIRouter(prefix="/api/v1/media", tags=["media-templates"])

TEMPLATE_NOT_FOUND_DETAIL = "Template not found."
PRESET_TEMPLATE_MUTATION_FORBIDDEN_DETAIL = "Preset templates cannot be modified."
EMPTY_BATCH_DELETE_DETAIL = "Please select at least one template."
BATCH_DELETE_NOT_FOUND_DETAIL = "Some templates do not exist or have already been deleted."
EMPTY_TEMPLATE_TITLE_DETAIL = "Template title cannot be empty."
EMPTY_TEMPLATE_PROMPT_DETAIL = "Prompt content cannot be empty."
EMPTY_TEMPLATE_UPDATE_DETAIL = "At least one update field is required."
DEFAULT_TEMPLATE_PAGE_SIZE = 9


def _serialize_template(template: Template) -> TemplateListItem:
    return TemplateListItem(
        id=template.id,
        title=template.title,
        description=template.description,
        platform=template.platform,
        category=template.category,
        knowledge_base_scope=template.knowledge_base_scope,
        system_prompt=template.system_prompt,
        is_preset=template.is_preset,
        is_shared=template.user_id is None and not template.is_preset,
        created_at=template.created_at,
    )


def _list_visible_templates(db: Session, user_id: str) -> list[Template]:
    templates = list(
        db.scalars(
            select(Template).where(
                or_(
                    Template.user_id.is_(None),
                    Template.user_id == user_id,
                )
            )
        ).all()
    )

    preset_templates = sorted(
        [item for item in templates if item.user_id is None and item.is_preset],
        key=lambda item: PRESET_TEMPLATE_ORDER.get(item.id, len(PRESET_TEMPLATE_ORDER)),
    )
    shared_custom_templates = sorted(
        [item for item in templates if item.user_id is None and not item.is_preset],
        key=lambda item: item.created_at,
        reverse=True,
    )
    personal_custom_templates = sorted(
        [item for item in templates if item.user_id == user_id and not item.is_preset],
        key=lambda item: item.created_at,
        reverse=True,
    )
    return [*preset_templates, *shared_custom_templates, *personal_custom_templates]


def _normalize_template_search(value: str | None) -> str:
    if value is None:
        return ""
    return value.strip().lower()


def _matches_template_search(template: Template, normalized_search: str) -> bool:
    if not normalized_search:
        return True

    searchable_parts = [
        template.title,
        template.description,
        template.platform,
        template.category,
        template.system_prompt,
        template.knowledge_base_scope or "",
    ]
    return normalized_search in " ".join(searchable_parts).lower()


def _filter_templates(
    templates: list[Template],
    *,
    search: str | None,
    category: TemplateCategory | None,
) -> list[Template]:
    normalized_search = _normalize_template_search(search)
    filtered_templates: list[Template] = []

    for template in templates:
        if category is not None and template.category != category.value:
            continue
        if not _matches_template_search(template, normalized_search):
            continue
        filtered_templates.append(template)

    return filtered_templates


def _apply_view_mode(
    templates: list[Template],
    view_mode: str,
) -> list[Template]:
    if view_mode == "preset":
        return [template for template in templates if template.is_preset]
    if view_mode == "custom":
        return [template for template in templates if not template.is_preset]
    return templates


def _paginate_templates(
    templates: list[Template],
    *,
    page: int | None,
    page_size: int | None,
) -> tuple[list[Template], int, int, int]:
    if page is None and page_size is None:
        resolved_page = 1
        resolved_page_size = len(templates)
        return templates, resolved_page, resolved_page_size, 1

    resolved_page_size = page_size or DEFAULT_TEMPLATE_PAGE_SIZE
    total_pages = max(1, (len(templates) + resolved_page_size - 1) // resolved_page_size)
    resolved_page = min(page or 1, total_pages)
    start_index = (resolved_page - 1) * resolved_page_size
    end_index = start_index + resolved_page_size
    return templates[start_index:end_index], resolved_page, resolved_page_size, total_pages


def _get_mutable_template(
    db: Session,
    *,
    template_id: str,
    user_id: str,
) -> Template:
    template = db.get(Template, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail=TEMPLATE_NOT_FOUND_DETAIL)
    if template.is_preset:
        raise HTTPException(
            status_code=403,
            detail=PRESET_TEMPLATE_MUTATION_FORBIDDEN_DETAIL,
        )
    if template.user_id != user_id:
        raise HTTPException(status_code=404, detail=TEMPLATE_NOT_FOUND_DETAIL)
    return template


def _apply_template_updates(template: Template, payload: TemplateUpdateRequest) -> bool:
    updated = False

    if payload.title is not None:
        normalized_title = payload.title.strip()
        if not normalized_title:
            raise HTTPException(status_code=400, detail=EMPTY_TEMPLATE_TITLE_DETAIL)
        template.title = normalized_title
        updated = True

    if payload.description is not None:
        template.description = payload.description.strip()
        updated = True

    if payload.platform is not None:
        template.platform = payload.platform
        updated = True

    if payload.prompt_content is not None:
        normalized_prompt = payload.prompt_content.strip()
        if not normalized_prompt:
            raise HTTPException(status_code=400, detail=EMPTY_TEMPLATE_PROMPT_DETAIL)
        template.system_prompt = normalized_prompt
        updated = True

    return updated


@router.get("/templates", response_model=TemplateListResponse)
async def list_templates(
    page: int | None = Query(default=None, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=50),
    search: str | None = Query(default=None, max_length=120),
    category: TemplateCategory | None = Query(default=None),
    view_mode: str = Query(default="all", pattern="^(all|preset|custom)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TemplateListResponse:
    ensure_preset_templates(db)
    visible_templates = _list_visible_templates(db, current_user.id)
    filtered_templates = _filter_templates(
        visible_templates,
        search=search,
        category=category,
    )
    preset_total = sum(1 for item in filtered_templates if item.is_preset)
    custom_total = len(filtered_templates) - preset_total
    view_filtered_templates = _apply_view_mode(filtered_templates, view_mode)
    paginated_templates, resolved_page, resolved_page_size, total_pages = _paginate_templates(
        view_filtered_templates,
        page=page,
        page_size=page_size,
    )
    items = [_serialize_template(item) for item in paginated_templates]
    return TemplateListResponse(
        items=items,
        total=len(view_filtered_templates),
        page=resolved_page,
        page_size=resolved_page_size,
        total_pages=total_pages,
        preset_total=preset_total,
        custom_total=custom_total,
    )


@router.post("/templates", response_model=TemplateListItem, status_code=status.HTTP_201_CREATED)
async def create_template(
    payload: TemplateCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TemplateListItem:
    ensure_preset_templates(db)

    template = Template(
        id=f"template-user-{uuid4().hex}",
        user_id=current_user.id,
        title=payload.title.strip(),
        description=payload.description.strip(),
        platform=payload.platform,
        category=payload.category,
        knowledge_base_scope=normalize_knowledge_base_scope(payload.knowledge_base_scope),
        system_prompt=payload.system_prompt.strip(),
        is_preset=False,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return _serialize_template(template)


@router.patch("/templates/{template_id}", response_model=TemplateListItem)
async def update_template(
    template_id: str,
    payload: TemplateUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TemplateListItem:
    ensure_preset_templates(db)
    template = _get_mutable_template(
        db,
        template_id=template_id,
        user_id=current_user.id,
    )

    if not _apply_template_updates(template, payload):
        raise HTTPException(status_code=400, detail=EMPTY_TEMPLATE_UPDATE_DETAIL)

    db.commit()
    db.refresh(template)
    return _serialize_template(template)


@router.delete("/templates/{template_id}", response_model=TemplateDeleteResponse)
async def delete_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TemplateDeleteResponse:
    ensure_preset_templates(db)
    template = _get_mutable_template(
        db,
        template_id=template_id,
        user_id=current_user.id,
    )
    db.delete(template)
    db.commit()
    return TemplateDeleteResponse(deleted_count=1, deleted_ids=[template_id])


@router.delete("/templates", response_model=TemplateDeleteResponse)
async def delete_templates(
    payload: TemplateDeleteBatchRequest = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TemplateDeleteResponse:
    ensure_preset_templates(db)
    requested_ids = list(dict.fromkeys(payload.template_ids))
    if len(requested_ids) == 0:
        raise HTTPException(status_code=400, detail=EMPTY_BATCH_DELETE_DETAIL)

    templates = list(
        db.scalars(
            select(Template).where(Template.id.in_(requested_ids))
        ).all()
    )

    if len(templates) != len(requested_ids):
        raise HTTPException(status_code=404, detail=BATCH_DELETE_NOT_FOUND_DETAIL)

    if any(item.is_preset for item in templates):
        raise HTTPException(
            status_code=403,
            detail=PRESET_TEMPLATE_MUTATION_FORBIDDEN_DETAIL,
        )

    if any(item.user_id != current_user.id for item in templates):
        raise HTTPException(status_code=404, detail=BATCH_DELETE_NOT_FOUND_DETAIL)

    db.execute(
        delete(Template).where(
            Template.id.in_(requested_ids),
            Template.user_id == current_user.id,
            Template.is_preset.is_(False),
        )
    )
    db.commit()

    return TemplateDeleteResponse(
        deleted_count=len(requested_ids),
        deleted_ids=requested_ids,
    )


@router.get("/skills/search", response_model=TemplateSkillSearchResponse)
async def search_skills(
    q: str = Query(default="爆款模板", min_length=1, max_length=120),
    category: TemplateCategory | None = Query(default=None),
    current_user: User = Depends(get_current_user),
) -> TemplateSkillSearchResponse:
    _ = current_user
    result = search_prompt_skills(
        keyword=q,
        category=category.value if category is not None else None,
    )
    items = [
        TemplateSkillDiscoveryItem.model_validate(item)
        for item in result["items"]
    ]
    return TemplateSkillSearchResponse(
        query=result["query"],
        category=category,
        items=items,
        templates=items,
        total=result.get("total", len(items)),
        data_mode=result["data_mode"],
        fallback_reason=result.get("fallback_reason"),
    )
