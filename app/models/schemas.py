from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def serialize_datetime(value: datetime) -> str:
    return ensure_utc(value).isoformat().replace("+00:00", "Z")


class SchemaModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


UTCDateTime = Annotated[
    datetime,
    PlainSerializer(serialize_datetime, return_type=str),
]


class MaterialType(str, Enum):
    IMAGE = "image"
    VIDEO_URL = "video_url"
    TEXT_LINK = "text_link"


class UploadPurpose(str, Enum):
    AVATAR = "avatar"
    MATERIAL = "material"


class Platform(str, Enum):
    XIAOHONGSHU = "xiaohongshu"
    DOUYIN = "douyin"


class TaskType(str, Enum):
    TOPIC_PLANNING = "topic_planning"
    CONTENT_GENERATION = "content_generation"
    HOT_POST_ANALYSIS = "hot_post_analysis"
    COMMENT_REPLY = "comment_reply"


class ArtifactType(str, Enum):
    TOPIC_LIST = "topic_list"
    CONTENT_DRAFT = "content_draft"
    HOT_POST_ANALYSIS = "hot_post_analysis"
    COMMENT_REPLY = "comment_reply"


class PersistedMessageType(str, Enum):
    TEXT = "text"
    ARTIFACT = "artifact"


class MaterialInput(SchemaModel):
    type: MaterialType = Field(..., description="Material category.")
    url: str | None = Field(
        default=None,
        description="Original material URL, signed upload URL, or managed storage path.",
    )
    text: str = Field(default="", description="Extracted or supplementary text.")


class MediaChatRequest(SchemaModel):
    thread_id: str = Field(..., description="Unique thread identifier.")
    platform: Platform = Field(..., description="Target platform.")
    task_type: TaskType = Field(..., description="Requested task type.")
    message: str = Field(..., description="User input.")
    materials: list[MaterialInput] = Field(
        default_factory=list,
        description="Attached materials.",
    )
    system_prompt: str | None = Field(
        default=None,
        description="Optional per-thread persona or brand prompt.",
    )
    thread_title: str | None = Field(
        default=None,
        description="Optional explicit thread title.",
    )


class UploadMediaResponse(SchemaModel):
    url: str = Field(..., description="Frontend delivery URL or signed preview URL.")
    file_type: str = Field(..., description="Top-level file type.")
    content_type: str = Field(..., description="MIME type.")
    filename: str = Field(..., description="Stored filename.")
    original_filename: str = Field(..., description="Sanitized original filename.")
    purpose: UploadPurpose = Field(..., description="Upload usage purpose.")
    thread_id: str | None = Field(
        default=None,
        description="Associated thread ID when the upload is already bound.",
    )


class UploadRetentionSummary(SchemaModel):
    storage_backend: str = Field(..., description="Active storage backend.")
    total_files: int = Field(..., description="Total tracked uploads.")
    total_bytes: int = Field(..., description="Total tracked upload size in bytes.")
    temporary_files: int = Field(..., description="Unbound temporary material uploads.")
    temporary_bytes: int = Field(..., description="Temporary material size in bytes.")
    thread_material_files: int = Field(..., description="Thread-bound material uploads.")
    thread_material_bytes: int = Field(..., description="Thread-bound material size in bytes.")
    avatar_files: int = Field(..., description="Tracked avatar uploads.")
    avatar_bytes: int = Field(..., description="Tracked avatar size in bytes.")
    stale_unbound_material_files: int = Field(
        ...,
        description="Unbound material uploads older than the local GC retention window.",
    )
    signed_url_expires_seconds: int = Field(
        ...,
        description="Effective signed delivery URL lifetime in seconds.",
    )
    lifecycle_auto_rollout_enabled: bool = Field(
        ...,
        description="Whether startup and scheduled OSS lifecycle rollout is enabled.",
    )
    tmp_upload_expire_days: int = Field(..., description="OSS tmp prefix expiration days.")
    thread_upload_transition_days: int = Field(
        ...,
        description="OSS thread material cold-transition days.",
    )
    thread_upload_transition_storage_class: str = Field(
        ...,
        description="OSS cold-transition storage class.",
    )


class ArtifactPayload(SchemaModel):
    artifact_type: ArtifactType = Field(..., description="Artifact discriminator.")
    title: str = Field(..., description="Artifact title.")


class TopicPlanningItem(SchemaModel):
    title: str = Field(..., description="Topic title.")
    angle: str = Field(..., description="Editorial angle.")
    goal: str = Field(..., description="Expected goal.")


class TopicPlanningArtifactPayload(ArtifactPayload):
    artifact_type: Literal["topic_list"] = "topic_list"
    topics: list[TopicPlanningItem] = Field(
        default_factory=list,
        description="Topic planning items.",
    )


class ContentGenerationArtifactPayload(ArtifactPayload):
    artifact_type: Literal["content_draft"] = "content_draft"
    title_candidates: list[str] = Field(
        default_factory=list,
        description="Candidate titles.",
    )
    body: str = Field(..., description="Draft body.")
    platform_cta: str = Field(..., description="Platform-specific CTA.")


class HotPostAnalysisDimension(SchemaModel):
    dimension: str = Field(..., description="Analysis dimension.")
    insight: str = Field(..., description="Insight for the dimension.")


class HotPostAnalysisArtifactPayload(ArtifactPayload):
    artifact_type: Literal["hot_post_analysis"] = "hot_post_analysis"
    analysis_dimensions: list[HotPostAnalysisDimension] = Field(
        default_factory=list,
        description="Structured analysis dimensions.",
    )
    reusable_templates: list[str] = Field(
        default_factory=list,
        description="Reusable expression templates.",
    )


class CommentReplySuggestion(SchemaModel):
    comment_type: str = Field(..., description="Comment category.")
    scenario: str = Field(..., description="Comment scenario.")
    reply: str = Field(..., description="Suggested reply.")
    compliance_note: str = Field(default="", description="Compliance reminder.")


class CommentReplyArtifactPayload(ArtifactPayload):
    artifact_type: Literal["comment_reply"] = "comment_reply"
    suggestions: list[CommentReplySuggestion] = Field(
        default_factory=list,
        description="Reply suggestions.",
    )


ArtifactPayloadModel = (
    TopicPlanningArtifactPayload
    | ContentGenerationArtifactPayload
    | HotPostAnalysisArtifactPayload
    | CommentReplyArtifactPayload
)


class UserProfile(SchemaModel):
    id: str = Field(..., description="User ID.")
    username: str = Field(..., description="Username.")
    nickname: str | None = Field(default=None, description="Display nickname.")
    bio: str | None = Field(default=None, description="Profile bio.")
    avatar_url: str | None = Field(default=None, description="Resolved profile avatar delivery URL.")
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")


class UserProfileUpdate(SchemaModel):
    nickname: str | None = Field(default=None, max_length=64, description="Display nickname.")
    bio: str | None = Field(default=None, max_length=280, description="Short profile bio.")
    avatar_url: str | None = Field(
        default=None,
        max_length=2048,
        description="Avatar URL or signed upload URL. Empty or null clears the value.",
    )


class RegisterRequest(SchemaModel):
    username: str = Field(..., max_length=64, description="Username.")
    password: str = Field(..., max_length=128, description="Password.")


class PasswordResetRequestCreate(SchemaModel):
    username: str = Field(..., max_length=64, description="Username for password reset.")


class PasswordResetRequestResponse(SchemaModel):
    accepted: Literal[True] = True
    expires_in_minutes: int = Field(
        ...,
        description="Reset token lifetime in minutes.",
    )


class PasswordResetConfirmRequest(SchemaModel):
    token: str = Field(..., min_length=1, description="Password reset JWT.")
    new_password: str = Field(..., max_length=128, description="Replacement password.")


class PasswordResetConfirmResponse(SchemaModel):
    password_reset: Literal[True] = True
    revoked_sessions: int = Field(
        default=0,
        description="Number of active sessions revoked after the reset completed.",
    )


class AuthTokenResponse(SchemaModel):
    access_token: str = Field(..., description="JWT access token.")
    refresh_token: str = Field(..., description="JWT refresh token.")
    token_type: Literal["bearer"] = "bearer"
    user: UserProfile = Field(..., description="Authenticated user info.")


class RefreshTokenRequest(SchemaModel):
    refresh_token: str = Field(..., description="JWT refresh token.")


class LogoutRequest(SchemaModel):
    refresh_token: str = Field(..., description="JWT refresh token to revoke.")


class LogoutResponse(SchemaModel):
    logged_out: Literal[True] = True


class ResetPasswordRequest(SchemaModel):
    old_password: str = Field(..., max_length=128, description="Current password.")
    new_password: str = Field(..., max_length=128, description="Replacement password.")


class ResetPasswordResponse(SchemaModel):
    password_reset: Literal[True] = True
    revoked_sessions: int = Field(
        default=0,
        description="Number of other active sessions revoked after password reset.",
    )


class AuthSessionItem(SchemaModel):
    id: str = Field(..., description="Refresh session ID.")
    device_info: str | None = Field(default=None, description="Derived device label.")
    ip_address: str | None = Field(default=None, description="Client IP address.")
    expires_at: UTCDateTime = Field(..., description="Session expiry time in UTC.")
    last_seen_at: UTCDateTime = Field(..., description="Last seen time in UTC.")
    created_at: UTCDateTime = Field(..., description="Session creation time in UTC.")
    is_current: bool = Field(default=False, description="Whether this is the current device.")


class AuthSessionsResponse(SchemaModel):
    items: list[AuthSessionItem] = Field(default_factory=list, description="Active sessions.")


class SessionRevokeResponse(SchemaModel):
    id: str = Field(..., description="Revoked session ID.")
    revoked: bool = Field(default=True, description="Revocation result.")


class ThreadSummaryItem(SchemaModel):
    id: str = Field(..., description="Thread ID.")
    title: str = Field(default="", description="Thread title.")
    latest_message_excerpt: str = Field(default="", description="Latest message excerpt.")
    is_archived: bool = Field(default=False, description="Archive flag.")
    updated_at: UTCDateTime = Field(..., description="Last updated time in UTC.")


class ThreadListResponse(SchemaModel):
    items: list[ThreadSummaryItem] = Field(default_factory=list, description="Threads.")
    total: int = Field(..., description="Total count.")
    page: int = Field(..., description="Current page.")
    page_size: int = Field(..., description="Page size.")


class ThreadUpdateRequest(SchemaModel):
    title: str | None = Field(default=None, description="Updated thread title.")
    is_archived: bool | None = Field(default=None, description="Archive flag.")
    system_prompt: str | None = Field(
        default=None,
        description="Updated system prompt for the thread.",
    )


class ThreadDeleteResponse(SchemaModel):
    id: str = Field(..., description="Deleted thread ID.")
    deleted: bool = Field(default=True, description="Deletion result.")


class MessageHistoryItem(SchemaModel):
    id: str = Field(..., description="Message ID.")
    thread_id: str = Field(..., description="Thread ID.")
    role: str = Field(..., description="Message role.")
    message_type: PersistedMessageType = Field(..., description="Message kind.")
    content: str = Field(..., description="Message content or artifact title.")
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")
    artifact: ArtifactPayloadModel | None = Field(
        default=None,
        description="Structured artifact payload when message_type is artifact.",
    )
    materials: list["MaterialHistoryItem"] = Field(
        default_factory=list,
        description="Materials attached to this message.",
    )


class MaterialHistoryItem(SchemaModel):
    id: str = Field(..., description="Material ID.")
    thread_id: str = Field(..., description="Thread ID.")
    message_id: str | None = Field(default=None, description="Owning message ID.")
    type: MaterialType = Field(..., description="Material type.")
    url: str | None = Field(default=None, description="Material URL.")
    text: str = Field(default="", description="Supplementary text.")
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")


class ThreadMessagesResponse(SchemaModel):
    thread_id: str = Field(..., description="Thread ID.")
    title: str = Field(default="", description="Thread title.")
    system_prompt: str = Field(default="", description="Persisted system prompt.")
    messages: list[MessageHistoryItem] = Field(
        default_factory=list,
        description="Thread messages.",
    )
    materials: list[MaterialHistoryItem] = Field(
        default_factory=list,
        description="Thread materials.",
    )


class ArtifactListItem(SchemaModel):
    id: str = Field(..., description="Artifact record ID.")
    thread_id: str = Field(..., description="Owning thread ID.")
    thread_title: str = Field(default="", description="Owning thread title.")
    message_id: str = Field(..., description="Assistant message ID linked to the artifact.")
    artifact_type: ArtifactType = Field(..., description="Artifact discriminator.")
    title: str = Field(default="", description="Artifact title.")
    excerpt: str = Field(default="", description="Short preview excerpt for card rendering.")
    platform: Literal["xiaohongshu", "douyin", "both"] | None = Field(
        default=None,
        description="Best-effort inferred target platform.",
    )
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")
    artifact: ArtifactPayloadModel = Field(
        ...,
        description="Full structured artifact payload for preview and expansion.",
    )


class ArtifactListResponse(SchemaModel):
    items: list[ArtifactListItem] = Field(
        default_factory=list,
        description="Artifacts for the current user ordered by newest first.",
    )
    total: int = Field(..., description="Total artifact count returned.")


class ArtifactDeleteBatchRequest(SchemaModel):
    message_ids: list[str] = Field(
        default_factory=list,
        description="Artifact-linked assistant message IDs to delete.",
    )
    clear_all: bool = Field(
        default=False,
        description="Whether to delete all artifact-linked assistant messages for the current user.",
    )


class ArtifactDeleteResponse(SchemaModel):
    deleted_count: int = Field(..., description="Number of deleted artifact-linked messages.")
    deleted_message_ids: list[str] = Field(
        default_factory=list,
        description="Deleted assistant message IDs.",
    )
    cleared_all: bool = Field(
        default=False,
        description="Whether the request cleared all drafts for the current user.",
    )
