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


class TemplatePlatform(str, Enum):
    XIAOHONGSHU = "小红书"
    DOUYIN = "抖音"
    BOTH = "双平台"
    XIANYU = "闲鱼"
    TECH_BLOG = "技术博客"


class TemplateCategory(str, Enum):
    BEAUTY = "美妆护肤"
    TRAVEL = "美食文旅"
    FINANCE = "职场金融"
    TECH = "数码科技"
    XIANYU = "电商/闲鱼"
    EDUCATION = "教育/干货"
    HOUSING = "房产/家居"
    AUTOMOTIVE = "汽车/出行"
    FAMILY = "母婴/宠物"
    EMOTION = "情感/心理"


class TopicPlatform(str, Enum):
    XIAOHONGSHU = "小红书"
    DOUYIN = "抖音"
    BOTH = "双平台"


class TopicStatus(str, Enum):
    IDEA = "idea"
    DRAFTING = "drafting"
    PUBLISHED = "published"


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
    knowledge_base_scope: str | None = Field(
        default=None,
        max_length=120,
        description="Optional thread-level knowledge-base scope for retrieval.",
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
    knowledge_base_scope: str | None = Field(
        default=None,
        description="Optional thread-level knowledge-base scope.",
    )
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
    knowledge_base_scope: str | None = Field(
        default=None,
        max_length=120,
        description="Updated knowledge-base scope for the thread.",
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
    knowledge_base_scope: str | None = Field(
        default=None,
        description="Persisted thread-level knowledge-base scope.",
    )
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


class TemplateListItem(SchemaModel):
    id: str = Field(..., description="Template identifier.")
    title: str = Field(..., description="Template title shown in the workspace.")
    description: str = Field(..., description="Short business-facing template summary.")
    platform: TemplatePlatform = Field(..., description="Template platform.")
    category: TemplateCategory = Field(..., description="Template industry category.")
    knowledge_base_scope: str | None = Field(
        default=None,
        description="Optional bound knowledge-base scope reserved for downstream RAG use.",
    )
    system_prompt: str = Field(
        ...,
        description="Prebuilt system prompt copied into the new-thread modal.",
    )
    is_preset: bool = Field(..., description="Whether the template is a system preset.")
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")


class TemplateListResponse(SchemaModel):
    items: list[TemplateListItem] = Field(
        default_factory=list,
        description="Built-in template list for the current user.",
    )
    total: int = Field(..., description="Returned template count.")


class TemplateCreateRequest(SchemaModel):
    title: str = Field(..., min_length=1, max_length=255, description="Template title.")
    description: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Short user-facing description.",
    )
    platform: TemplatePlatform = Field(..., description="Template platform.")
    category: TemplateCategory = Field(..., description="Template category.")
    knowledge_base_scope: str | None = Field(
        default=None,
        max_length=120,
        description="Optional knowledge-base scope key bound to this template.",
    )
    system_prompt: str = Field(
        ...,
        min_length=1,
        max_length=6000,
        description="System prompt body.",
    )


class TemplateDeleteBatchRequest(SchemaModel):
    template_ids: list[str] = Field(
        default_factory=list,
        description="User-owned template IDs to delete.",
    )


class TemplateDeleteResponse(SchemaModel):
    deleted_count: int = Field(..., description="Number of deleted templates.")
    deleted_ids: list[str] = Field(
        default_factory=list,
        description="Deleted template IDs.",
    )


class TopicListItem(SchemaModel):
    id: str = Field(..., description="Topic identifier.")
    title: str = Field(..., description="Core topic title.")
    inspiration: str = Field(default="", description="Supplementary inspiration or notes.")
    platform: TopicPlatform = Field(..., description="Target content platform.")
    status: TopicStatus = Field(..., description="Current lifecycle status.")
    thread_id: str | None = Field(
        default=None,
        description="Optional bound thread identifier used to resume drafting.",
    )
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")
    updated_at: UTCDateTime = Field(..., description="Last updated time in UTC.")


class TopicListResponse(SchemaModel):
    items: list[TopicListItem] = Field(
        default_factory=list,
        description="Topic records for the current user.",
    )
    total: int = Field(..., description="Returned topic count.")


class TopicCreateRequest(SchemaModel):
    title: str = Field(..., min_length=1, max_length=255, description="Topic title.")
    inspiration: str = Field(
        default="",
        max_length=4000,
        description="Optional inspiration note or source.",
    )
    platform: TopicPlatform = Field(..., description="Target platform for the topic.")


class TopicUpdateRequest(SchemaModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    inspiration: str | None = Field(default=None, max_length=4000)
    platform: TopicPlatform | None = Field(default=None)
    status: TopicStatus | None = Field(default=None)
    thread_id: str | None = Field(
        default=None,
        max_length=64,
        description="Optional bound thread identifier for resume drafting flows.",
    )


class TopicDeleteResponse(SchemaModel):
    id: str = Field(..., description="Deleted topic identifier.")
    deleted: bool = Field(default=True, description="Deletion result.")


class KnowledgeScopeListItem(SchemaModel):
    scope: str = Field(..., description="Normalized knowledge-base scope key.")
    chunk_count: int = Field(..., description="Stored text chunk count for this scope.")
    source_count: int = Field(..., description="Distinct uploaded source count for this scope.")
    updated_at: UTCDateTime | None = Field(
        default=None,
        description="Latest write time across the scope in UTC.",
    )


class KnowledgeScopeListResponse(SchemaModel):
    items: list[KnowledgeScopeListItem] = Field(
        default_factory=list,
        description="Knowledge scopes owned by the current user.",
    )
    total: int = Field(..., description="Returned scope count.")


class KnowledgeUploadResponse(SchemaModel):
    scope: str = Field(..., description="Normalized scope key that received the upload.")
    source: str = Field(..., description="Original source filename used for the upload.")
    chunk_count: int = Field(..., description="Number of text chunks ingested from the upload.")


class KnowledgeScopeRenameRequest(SchemaModel):
    new_name: str = Field(
        ...,
        min_length=1,
        max_length=120,
        description="Requested new scope key before normalization.",
    )


class KnowledgeScopeRenameResponse(SchemaModel):
    previous_scope: str = Field(..., description="Previous normalized scope key.")
    scope: str = Field(..., description="Current normalized scope key after rename.")
    renamed_count: int = Field(..., description="Number of chunks moved to the new scope key.")
    renamed: bool = Field(default=True, description="Whether the scope key changed.")


class KnowledgeScopeDeleteResponse(SchemaModel):
    scope: str = Field(..., description="Deleted scope key.")
    deleted_count: int = Field(..., description="Number of removed chunks.")
    deleted: bool = Field(default=True, description="Whether any knowledge chunks were deleted.")


class KnowledgeScopeSourceItem(SchemaModel):
    filename: str = Field(..., description="Uploaded source filename inside the scope.")
    chunk_count: int = Field(..., description="Stored chunk count contributed by this source.")


class KnowledgeScopeSourceListResponse(SchemaModel):
    scope: str = Field(..., description="Normalized scope key that owns these sources.")
    items: list[KnowledgeScopeSourceItem] = Field(
        default_factory=list,
        description="Distinct uploaded sources grouped inside the scope.",
    )
    total: int = Field(..., description="Returned source count.")


class KnowledgeSourceDeleteResponse(SchemaModel):
    scope: str = Field(..., description="Normalized scope key that owned the source.")
    source: str = Field(..., description="Deleted source filename.")
    deleted_count: int = Field(..., description="Number of removed chunks for the source.")
    deleted: bool = Field(default=True, description="Whether any chunks were deleted.")


class KnowledgeSourcePreviewResponse(SchemaModel):
    source: str = Field(..., description="Previewed source filename.")
    content: str = Field(..., description="Markdown text rebuilt from stored chunks.")
    chunk_count: int = Field(..., description="Number of chunks included in the preview.")


class DashboardProductivitySummary(SchemaModel):
    total_drafts: int = Field(..., description="Total artifact drafts owned by the user.")
    drafts_this_week: int = Field(..., description="Artifact drafts created in the last 7 days.")
    total_words_generated: int = Field(..., description="Estimated generated text character count.")
    estimated_tokens: int = Field(..., description="Estimated token usage based on generated text.")
    estimated_saved_minutes: int = Field(..., description="Estimated manual creation time saved.")


class DashboardAssetsSummary(SchemaModel):
    total_topics: int = Field(..., description="Total owned topic records.")
    active_topics: int = Field(..., description="Owned topics not yet published.")
    total_knowledge_scopes: int = Field(..., description="Owned knowledge scope count.")
    total_knowledge_chunks: int = Field(..., description="Owned knowledge chunk count.")


class DashboardTopicStatusSummary(SchemaModel):
    idea: int = Field(default=0, description="Topic records in idea status.")
    drafting: int = Field(default=0, description="Topic records in drafting status.")
    published: int = Field(default=0, description="Topic records in published status.")


class DashboardActivityItem(SchemaModel):
    date: str = Field(..., description="UTC date in YYYY-MM-DD format.")
    count: int = Field(..., description="Artifact draft count for this day.")


class DashboardSummaryResponse(SchemaModel):
    productivity: DashboardProductivitySummary = Field(..., description="Generation metrics.")
    assets: DashboardAssetsSummary = Field(..., description="Owned asset metrics.")
    topic_status: DashboardTopicStatusSummary = Field(..., description="Topic lifecycle buckets.")
    activity_heatmap: list[DashboardActivityItem] = Field(
        default_factory=list,
        description="Daily artifact draft counts for the recent window.",
    )


class TemplateSkillDiscoveryItem(SchemaModel):
    id: str = Field(..., description="Discovered skill/template idea identifier.")
    title: str = Field(..., description="Discovered prompt card title.")
    description: str = Field(..., description="Short discovery summary for the card.")
    platform: TemplatePlatform = Field(..., description="Suggested platform for the prompt idea.")
    category: TemplateCategory = Field(..., description="Suggested industry category.")
    knowledge_base_scope: str | None = Field(
        default=None,
        description="Suggested knowledge-base scope for downstream RAG linkage.",
    )
    system_prompt: str = Field(..., description="Recommended reusable system prompt body.")
    source_title: str = Field(..., description="Upstream discovery source title.")
    source_url: str | None = Field(
        default=None,
        description="Optional upstream discovery source URL.",
    )
    data_mode: Literal["mock", "mock_fallback", "live_tavily", "llm_fallback"] = Field(
        ...,
        description="Whether the discovery came from mock data or live Tavily search.",
    )


class TemplateSkillSearchResponse(SchemaModel):
    query: str = Field(..., description="Normalized search query used for discovery.")
    category: TemplateCategory | None = Field(
        default=None,
        description="Optional category constraint applied during discovery.",
    )
    items: list[TemplateSkillDiscoveryItem] = Field(
        default_factory=list,
        description="Discovered prompt-skill cards.",
    )
    templates: list[TemplateSkillDiscoveryItem] = Field(
        default_factory=list,
        description="Compatibility alias for discovered prompt-skill cards.",
    )
    total: int = Field(..., description="Returned discovery count.")
    data_mode: Literal["mock", "mock_fallback", "live_tavily", "llm_fallback"] = Field(
        ...,
        description="Overall discovery mode used for the response.",
    )
    fallback_reason: str | None = Field(
        default=None,
        description="Fallback note when live discovery was unavailable.",
    )
