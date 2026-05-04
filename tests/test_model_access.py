import pytest
from fastapi import HTTPException

from app.services.model_access import (
    PREMIUM_MODEL_ACCESS_DENIED_DETAIL,
    ensure_model_access,
    role_has_premium_model_access,
)


@pytest.mark.parametrize(
    ("role", "expected"),
    [
        ("super_admin", True),
        ("admin", True),
        ("finance", True),
        ("operator", True),
        ("premium", True),
        ("user", False),
        ("", False),
        (None, False),
    ],
)
def test_role_has_premium_model_access_allows_all_non_user_roles(role, expected):
    assert role_has_premium_model_access(role) is expected


def test_ensure_model_access_blocks_only_standard_user_for_premium_models():
    with pytest.raises(HTTPException) as exc_info:
        ensure_model_access(
            role="user",
            provider_key="proxy_gpt",
            model_name="gpt-5.4",
        )

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == PREMIUM_MODEL_ACCESS_DENIED_DETAIL


@pytest.mark.parametrize("role", ["super_admin", "admin", "finance", "operator", "premium"])
def test_ensure_model_access_allows_all_non_user_roles(role):
    ensure_model_access(
        role=role,
        provider_key="proxy_gpt",
        model_name="gpt-5.4",
    )
