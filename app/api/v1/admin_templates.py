from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import Template, Thread, User
from app.models.schemas import (
    AdminTemplateCreateRequest,
    AdminTemplateListItem,
    AdminTemplateListResponse,
    AdminTemplatePlatform,
    AdminTemplateUpdateRequest,
    TemplateCategory,
    TemplateDeleteBatchRequest,
    TemplateDeleteResponse,
    TemplatePlatform,
)
from app.services.auth import RequireRole
from app.services.auth import hash_password
from app.services.template_library import (
    PRESET_TEMPLATE_ORDER,
    ensure_preset_templates,
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin-templates"])
require_admin_templates_role = RequireRole(["super_admin", "admin", "operator"])

DEFAULT_ADMIN_TEMPLATE_CATEGORY = TemplateCategory.EDUCATION.value
ADMIN_TEMPLATE_NOT_FOUND_DETAIL = "Template not found."
ADMIN_PRESET_TEMPLATE_MUTATION_FORBIDDEN_DETAIL = "Preset templates cannot be modified."
ADMIN_EMPTY_BATCH_DELETE_DETAIL = "Please select at least one template."
ADMIN_BATCH_DELETE_NOT_FOUND_DETAIL = "Some templates do not exist or have already been deleted."
ADMIN_EMPTY_TEMPLATE_TITLE_DETAIL = "Template title cannot be empty."
ADMIN_EMPTY_TEMPLATE_PROMPT_DETAIL = "Prompt content cannot be empty."
ADMIN_EMPTY_TEMPLATE_UPDATE_DETAIL = "At least one update field is required."
TEMPLATE_PRESET_TOMBSTONE_USERNAME = "__template_preset_tombstone__"


def _map_stored_platform_to_admin(platform: str) -> AdminTemplatePlatform:
    if platform == TemplatePlatform.XIAOHONGSHU.value:
        return AdminTemplatePlatform.XIAOHONGSHU
    if platform == TemplatePlatform.DOUYIN.value:
        return AdminTemplatePlatform.DOUYIN
    return AdminTemplatePlatform.GENERAL


def _map_admin_platform_to_stored(platform: AdminTemplatePlatform) -> str:
    if platform == AdminTemplatePlatform.XIAOHONGSHU:
        return TemplatePlatform.XIAOHONGSHU.value
    if platform == AdminTemplatePlatform.DOUYIN:
        return TemplatePlatform.DOUYIN.value
    return TemplatePlatform.BOTH.value


def _build_usage_count_map(
    db: Session,
    *,
    templates: list[Template],
) -> dict[str, int]:
    prompts = [template.system_prompt for template in templates if template.system_prompt]
    if not prompts:
        return {}

    rows = db.execute(
        select(Thread.system_prompt, func.count(Thread.id))
        .where(Thread.system_prompt.in_(prompts))
        .group_by(Thread.system_prompt)
    ).all()
    return {
        str(system_prompt): int(count or 0)
        for system_prompt, count in rows
        if system_prompt
    }


def _serialize_admin_template(
    template: Template,
    *,
    usage_count: int,
) -> AdminTemplateListItem:
    return AdminTemplateListItem(
        id=template.id,
        title=template.title,
        platform=_map_stored_platform_to_admin(template.platform),
        description=template.description,
        prompt_content=template.system_prompt,
        usage_count=usage_count,
        rating=5.0,
        is_preset=template.is_preset,
        created_at=template.created_at,
    )


def _list_shared_templates(db: Session) -> list[Template]:
    templates = list(
        db.scalars(
            select(Template)
            .where(Template.user_id.is_(None))
            .order_by(Template.created_at.desc())
        ).all()
    )

    preset_templates = sorted(
        [template for template in templates if template.is_preset],
        key=lambda item: PRESET_TEMPLATE_ORDER.get(item.id, len(PRESET_TEMPLATE_ORDER)),
    )
    shared_custom_templates = sorted(
        [template for template in templates if not template.is_preset],
        key=lambda item: item.created_at,
        reverse=True,
    )
    return [*preset_templates, *shared_custom_templates]


def _get_admin_template(db: Session, *, template_id: str) -> Template:
    template = db.get(Template, template_id)
    if template is None or template.user_id is not None:
        raise HTTPException(status_code=404, detail=ADMIN_TEMPLATE_NOT_FOUND_DETAIL)
    return template


def _get_or_create_template_preset_tombstone_user(db: Session) -> User:
    tombstone_user = db.scalar(
        select(User).where(User.username == TEMPLATE_PRESET_TOMBSTONE_USERNAME)
    )
    if tombstone_user is not None:
        return tombstone_user

    tombstone_user = User(
        id=uuid4().hex,
        username=TEMPLATE_PRESET_TOMBSTONE_USERNAME,
        hashed_password=hash_password(uuid4().hex),
        nickname="Template Tombstone",
        bio="Internal system user used to hide deleted preset templates.",
        role="user",
        status="frozen",
        token_balance=0,
    )
    db.add(tombstone_user)
    db.flush()
    return tombstone_user


def _is_seeded_preset_template_id(template_id: str) -> bool:
    return template_id in PRESET_TEMPLATE_ORDER


def _apply_admin_template_updates(
    template: Template,
    payload: AdminTemplateUpdateRequest,
) -> bool:
    updated = False

    if payload.title is not None:
        normalized_title = payload.title.strip()
        if not normalized_title:
            raise HTTPException(status_code=400, detail=ADMIN_EMPTY_TEMPLATE_TITLE_DETAIL)
        template.title = normalized_title
        updated = True

    if payload.platform is not None:
        template.platform = _map_admin_platform_to_stored(payload.platform)
        updated = True

    if payload.description is not None:
        template.description = payload.description.strip()
        updated = True

    if payload.prompt_content is not None:
        normalized_prompt = payload.prompt_content.strip()
        if not normalized_prompt:
            raise HTTPException(status_code=400, detail=ADMIN_EMPTY_TEMPLATE_PROMPT_DETAIL)
        template.system_prompt = normalized_prompt
        updated = True

    if payload.is_preset is not None:
        template.is_preset = payload.is_preset
        updated = True

    return updated


@router.get("/templates", response_model=AdminTemplateListResponse)
async def list_admin_templates(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_templates_role),
) -> AdminTemplateListResponse:
    ensure_preset_templates(db)
    templates = _list_shared_templates(db)
    usage_count_map = _build_usage_count_map(db, templates=templates)
    items = [
        _serialize_admin_template(
            template,
            usage_count=usage_count_map.get(template.system_prompt, 0),
        )
        for template in templates
    ]
    return AdminTemplateListResponse(items=items, total=len(items))


@router.post("/templates", response_model=AdminTemplateListItem, status_code=status.HTTP_201_CREATED)
async def create_admin_template(
    payload: AdminTemplateCreateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_templates_role),
) -> AdminTemplateListItem:
    ensure_preset_templates(db)

    normalized_title = payload.title.strip()
    normalized_description = payload.description.strip()
    normalized_prompt = payload.prompt_content.strip()

    if not normalized_title:
        raise HTTPException(status_code=400, detail=ADMIN_EMPTY_TEMPLATE_TITLE_DETAIL)
    if not normalized_prompt:
        raise HTTPException(status_code=400, detail=ADMIN_EMPTY_TEMPLATE_PROMPT_DETAIL)

    template = Template(
        id=f"template-admin-{uuid4().hex}",
        user_id=None,
        title=normalized_title,
        description=normalized_description,
        platform=_map_admin_platform_to_stored(payload.platform),
        category=DEFAULT_ADMIN_TEMPLATE_CATEGORY,
        knowledge_base_scope=None,
        system_prompt=normalized_prompt,
        is_preset=payload.is_preset,
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    return _serialize_admin_template(template, usage_count=0)


@router.patch("/templates/{template_id}", response_model=AdminTemplateListItem)
async def update_admin_template(
    template_id: str,
    payload: AdminTemplateUpdateRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_templates_role),
) -> AdminTemplateListItem:
    ensure_preset_templates(db)
    template = _get_admin_template(db, template_id=template_id)

    if not _apply_admin_template_updates(template, payload):
        raise HTTPException(status_code=400, detail=ADMIN_EMPTY_TEMPLATE_UPDATE_DETAIL)

    db.commit()
    db.refresh(template)
    usage_count_map = _build_usage_count_map(db, templates=[template])
    return _serialize_admin_template(
        template,
        usage_count=usage_count_map.get(template.system_prompt, 0),
    )


@router.delete("/templates/{template_id}", response_model=TemplateDeleteResponse)
async def delete_admin_template(
    template_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_templates_role),
) -> TemplateDeleteResponse:
    ensure_preset_templates(db)
    template = _get_admin_template(db, template_id=template_id)

    if _is_seeded_preset_template_id(template.id):
        tombstone_user = _get_or_create_template_preset_tombstone_user(db)
        template.user_id = tombstone_user.id
    else:
        db.delete(template)

    db.commit()
    return TemplateDeleteResponse(deleted_count=1, deleted_ids=[template_id])


@router.delete("/templates", response_model=TemplateDeleteResponse)
async def delete_admin_templates(
    payload: TemplateDeleteBatchRequest = Body(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_templates_role),
) -> TemplateDeleteResponse:
    ensure_preset_templates(db)
    requested_ids = list(dict.fromkeys(payload.template_ids))
    if len(requested_ids) == 0:
        raise HTTPException(status_code=400, detail=ADMIN_EMPTY_BATCH_DELETE_DETAIL)

    templates = list(
        db.scalars(
            select(Template).where(Template.id.in_(requested_ids))
        ).all()
    )

    if len(templates) != len(requested_ids):
        raise HTTPException(status_code=404, detail=ADMIN_BATCH_DELETE_NOT_FOUND_DETAIL)

    if any(item.user_id is not None for item in templates):
        raise HTTPException(status_code=404, detail=ADMIN_BATCH_DELETE_NOT_FOUND_DETAIL)

    tombstone_user: User | None = None
    hard_delete_ids = [
        item.id for item in templates if not _is_seeded_preset_template_id(item.id)
    ]

    for template in templates:
        if not _is_seeded_preset_template_id(template.id):
            continue

        if tombstone_user is None:
            tombstone_user = _get_or_create_template_preset_tombstone_user(db)
        template.user_id = tombstone_user.id

    if hard_delete_ids:
        db.execute(
            delete(Template).where(
                Template.id.in_(hard_delete_ids),
                Template.user_id.is_(None),
            )
        )
    db.commit()

    return TemplateDeleteResponse(
        deleted_count=len(requested_ids),
        deleted_ids=requested_ids,
    )
