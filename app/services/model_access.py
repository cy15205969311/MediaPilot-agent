from fastapi import HTTPException

PREMIUM_REQUIRED_PROVIDER_KEYS = frozenset({"openai", "proxy_gpt"})
PREMIUM_REQUIRED_MODEL_KEYWORDS = ("image-2", "gpt-image-2")
PREMIUM_MODEL_ACCESS_DENIED_DETAIL = (
    "该模型仅限非普通用户角色使用，请切换至高级角色后重试。"
)


def role_has_premium_model_access(role: str | None) -> bool:
    normalized_role = (role or "").strip().lower()
    return bool(normalized_role) and normalized_role != "user"


def model_requires_premium(
    *,
    provider_key: str | None = None,
    model_name: str | None = None,
) -> bool:
    normalized_provider_key = (provider_key or "").strip().lower()
    if normalized_provider_key in PREMIUM_REQUIRED_PROVIDER_KEYS:
        return True

    normalized_model_name = (model_name or "").strip().lower()
    if not normalized_model_name:
        return False

    return any(
        premium_keyword in normalized_model_name
        for premium_keyword in PREMIUM_REQUIRED_MODEL_KEYWORDS
    )


def ensure_model_access(
    *,
    role: str | None,
    provider_key: str | None,
    model_name: str | None,
) -> None:
    if role_has_premium_model_access(role):
        return

    if not model_requires_premium(provider_key=provider_key, model_name=model_name):
        return

    raise HTTPException(
        status_code=403,
        detail=PREMIUM_MODEL_ACCESS_DENIED_DETAIL,
    )
