from datetime import datetime, timezone
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import AliasChoices, BaseModel, BeforeValidator, ConfigDict, Field, PlainSerializer

from app.core.text_normalization import repair_possible_mojibake


def ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def serialize_datetime(value: datetime) -> str:
    return ensure_utc(value).isoformat().replace("+00:00", "Z")


class SchemaModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


NormalizedText = Annotated[str, BeforeValidator(repair_possible_mojibake)]
NormalizedOptionalText = Annotated[str | None, BeforeValidator(repair_possible_mojibake)]


UTCDateTime = Annotated[
    datetime,
    PlainSerializer(serialize_datetime, return_type=str),
]


class MaterialType(str, Enum):
    IMAGE = "image"
    VIDEO_URL = "video_url"
    AUDIO_URL = "audio_url"
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
    IMAGE_GENERATION = "image_generation"
    HOT_POST_ANALYSIS = "hot_post_analysis"
    COMMENT_REPLY = "comment_reply"


class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    FINANCE = "finance"
    OPERATOR = "operator"
    PREMIUM = "premium"
    USER = "user"


class UserAccountStatus(str, Enum):
    ACTIVE = "active"
    FROZEN = "frozen"


class ArtifactType(str, Enum):
    TOPIC_LIST = "topic_list"
    CONTENT_DRAFT = "content_draft"
    IMAGE_RESULT = "image_result"
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
    model_override: str | None = Field(
        default=None,
        max_length=80,
        description="Optional runtime model override for the active provider.",
    )
    max_generation_tokens: int | None = Field(
        default=None,
        ge=1,
        description="Optional runtime ceiling for generation tokens applied by the backend.",
    )


class MediaChatStopRequest(SchemaModel):
    thread_id: str = Field(..., min_length=1, description="Active thread identifier to cancel.")


class MediaChatStopResponse(SchemaModel):
    thread_id: str = Field(..., description="Thread identifier targeted by the stop request.")
    cancelled: bool = Field(
        ...,
        description="Whether an active backend stream was found and marked for cancellation.",
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


class CitationAuditItem(SchemaModel):
    citation_index: int = Field(..., ge=1, description="Citation source number shown in text.")
    source: NormalizedText = Field(..., description="Source filename.")
    snippet: NormalizedText = Field(..., description="Retrieved chunk preview.")
    relevance_score: float = Field(
        ...,
        ge=0,
        le=1,
        description="Normalized relevance score between 0 and 1.",
    )
    chunk_index: int = Field(default=0, ge=0, description="Chunk index within the source.")
    document_id: str | None = Field(default=None, description="Knowledge document ID.")
    scope: str | None = Field(default=None, description="Knowledge-base scope.")


class ArtifactPayload(SchemaModel):
    artifact_type: ArtifactType = Field(..., description="Artifact discriminator.")
    title: NormalizedText = Field(..., description="Artifact title.")
    citation_audit: list[CitationAuditItem] = Field(
        default_factory=list,
        description="Knowledge retrieval audit entries attached by the backend.",
    )


class TopicPlanningItem(SchemaModel):
    title: NormalizedText = Field(..., description="Topic title.")
    angle: NormalizedText = Field(..., description="Editorial angle.")
    goal: NormalizedText = Field(..., description="Expected goal.")


class TopicPlanningArtifactPayload(ArtifactPayload):
    artifact_type: Literal["topic_list"] = "topic_list"
    topics: list[TopicPlanningItem] = Field(
        default_factory=list,
        description="Topic planning items.",
    )


class ContentGenerationArtifactPayload(ArtifactPayload):
    artifact_type: Literal["content_draft"] = "content_draft"
    title_candidates: list[NormalizedText] = Field(
        default_factory=list,
        description="Candidate titles.",
    )
    body: NormalizedText = Field(..., description="Draft body.")
    platform_cta: NormalizedText = Field(..., description="Platform-specific CTA.")
    generated_images: list[str] = Field(
        default_factory=list,
        description="Backend-generated cover or supporting image URLs. Models should leave this empty.",
    )
    original_prompt: NormalizedOptionalText = Field(
        default=None,
        description="Optional pre-optimization seed text used for image generation.",
    )
    revised_prompt: NormalizedOptionalText = Field(
        default=None,
        description="Optional optimized prompt used for image generation.",
    )


class ImageGenerationArtifactPayload(ArtifactPayload):
    artifact_type: Literal["image_result"] = "image_result"
    prompt: NormalizedText = Field(..., description="Final prompt used to generate the images.")
    generated_images: list[str] = Field(
        default_factory=list,
        description="Generated image URLs returned by the image backend.",
    )
    original_prompt: NormalizedOptionalText = Field(
        default=None,
        description="Optional original prompt or seed text before optimization.",
    )
    revised_prompt: NormalizedOptionalText = Field(
        default=None,
        description="Optional optimized prompt used by the final image request.",
    )
    platform_cta: NormalizedOptionalText = Field(
        default=None,
        description="Optional next-step guidance for using the generated visuals.",
    )
    status: Literal["processing", "completed"] = Field(
        default="completed",
        description="Whether the image artifact is still processing or already completed.",
    )
    progress_message: NormalizedOptionalText = Field(
        default=None,
        description="Optional progress text shown while image generation is still processing.",
    )
    progress_percent: int | None = Field(
        default=None,
        ge=0,
        le=100,
        description="Optional coarse-grained image generation progress percent.",
    )


class HotPostAnalysisDimension(SchemaModel):
    dimension: NormalizedText = Field(..., description="Analysis dimension.")
    insight: NormalizedText = Field(..., description="Insight for the dimension.")


class HotPostAnalysisArtifactPayload(ArtifactPayload):
    artifact_type: Literal["hot_post_analysis"] = "hot_post_analysis"
    analysis_dimensions: list[HotPostAnalysisDimension] = Field(
        default_factory=list,
        description="Structured analysis dimensions.",
    )
    reusable_templates: list[NormalizedText] = Field(
        default_factory=list,
        description="Reusable expression templates.",
    )


class CommentReplySuggestion(SchemaModel):
    comment_type: NormalizedText = Field(..., description="Comment category.")
    scenario: NormalizedText = Field(..., description="Comment scenario.")
    reply: NormalizedText = Field(..., description="Suggested reply.")
    compliance_note: NormalizedText = Field(default="", description="Compliance reminder.")


class CommentReplyArtifactPayload(ArtifactPayload):
    artifact_type: Literal["comment_reply"] = "comment_reply"
    suggestions: list[CommentReplySuggestion] = Field(
        default_factory=list,
        description="Reply suggestions.",
    )


ArtifactPayloadModel = (
    TopicPlanningArtifactPayload
    | ContentGenerationArtifactPayload
    | ImageGenerationArtifactPayload
    | HotPostAnalysisArtifactPayload
    | CommentReplyArtifactPayload
)


class UserProfile(SchemaModel):
    id: str = Field(..., description="User ID.")
    username: str = Field(..., description="Username.")
    nickname: str | None = Field(default=None, description="Display nickname.")
    bio: str | None = Field(default=None, description="Profile bio.")
    avatar_url: str | None = Field(default=None, description="Resolved profile avatar delivery URL.")
    role: UserRole = Field(default=UserRole.USER, description="User role.")
    status: UserAccountStatus = Field(
        default=UserAccountStatus.ACTIVE,
        description="User account status.",
    )
    token_balance: int = Field(default=0, description="Remaining token balance.")
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


class AdminUserLatestSessionItem(SchemaModel):
    device_info: str | None = Field(default=None, description="Derived device label.")
    ip_address: str | None = Field(default=None, description="Client IP address.")
    last_seen_at: UTCDateTime = Field(..., description="Last seen time in UTC.")
    created_at: UTCDateTime = Field(..., description="Session creation time in UTC.")


class AdminUserListItem(SchemaModel):
    id: str = Field(..., description="User ID.")
    username: str = Field(..., description="Username.")
    nickname: str | None = Field(default=None, description="Display nickname.")
    avatar_url: str | None = Field(default=None, description="Resolved profile avatar delivery URL.")
    role: UserRole = Field(..., description="Role assigned to the user.")
    status: UserAccountStatus = Field(..., description="Current account status.")
    token_balance: int = Field(..., description="Current token balance.")
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")
    latest_session: AdminUserLatestSessionItem | None = Field(
        default=None,
        description="Latest observed login session for recent activity display.",
    )


class AdminUserListResponse(SchemaModel):
    items: list[AdminUserListItem] = Field(default_factory=list, description="Users.")
    total: int = Field(..., description="Total user count after filtering.")
    skip: int = Field(..., description="Current offset.")
    limit: int = Field(..., description="Current page size.")


class AdminUserCreate(SchemaModel):
    username: str = Field(..., min_length=3, max_length=64, description="Username.")
    password: str = Field(..., min_length=8, max_length=128, description="Initial password.")
    role: UserRole = Field(default=UserRole.USER, description="Preset role assignment.")


class AdminUserStatusUpdateRequest(SchemaModel):
    status: UserAccountStatus = Field(..., description="Target account status.")


class AdminUserRoleUpdateRequest(SchemaModel):
    role: UserRole = Field(..., description="Target role assignment.")


class AdminUserPasswordResetResponse(SchemaModel):
    user_id: str = Field(..., description="Target user ID.")
    new_password: str = Field(..., description="Generated plaintext password.")
    revoked_sessions: int = Field(
        default=0,
        description="Number of active sessions revoked after reset.",
    )


class AdminUserDeleteResponse(SchemaModel):
    id: str = Field(..., description="Deleted user ID.")
    deleted: bool = Field(default=True, description="Deletion result.")


class AdminTokenAdjustAction(str, Enum):
    ADD = "add"
    DEDUCT = "deduct"
    SET = "set"


class AuditActionType(str, Enum):
    CREATE_USER = "create_user"
    DELETE_USER = "delete_user"
    ROLE_CHANGE = "role_change"
    TOPUP = "topup"
    TOKEN_DEDUCT = "token_deduct"
    TOKEN_SET = "token_set"
    FREEZE = "freeze"
    UNFREEZE = "unfreeze"
    RESET_PASSWORD = "reset_password"
    DELETE_TEMPLATE = "delete_template"
    UPDATE_SYSTEM_SETTINGS = "update_system_settings"
    ROLLBACK_SYSTEM_SETTINGS = "rollback_system_settings"


class AdminUserTokenUpdateRequest(SchemaModel):
    action: AdminTokenAdjustAction = Field(..., description="Admin token adjustment mode.")
    amount: int = Field(..., ge=0, description="Unsigned amount or target balance.")
    remark: str = Field(..., min_length=1, max_length=255, description="Admin remark.")


class AdminUserTokenUpdateResponse(SchemaModel):
    user_id: str = Field(..., description="Target user ID.")
    token_balance: int = Field(..., description="Updated token balance.")
    transaction_id: str = Field(..., description="Created token transaction ID.")
    amount: int = Field(..., description="Applied delta.")
    transaction_type: str = Field(..., description="Derived transaction type.")
    remark: str = Field(..., description="Admin remark recorded in the ledger.")


class AdminDashboardTrendItem(SchemaModel):
    date: str = Field(..., description="UTC date in YYYY-MM-DD format.")
    token_count: int = Field(..., description="Token consumption total for the day.")


class AdminDashboardModelUsageItem(SchemaModel):
    model_name: str = Field(..., description="Aggregated model label.")
    count: int = Field(..., description="Aggregated token consumption total for the model.")


class AdminDashboardResponse(SchemaModel):
    total_users: int = Field(..., description="Total registered users.")
    today_tokens: int = Field(..., description="Today's token consumption total.")
    today_contents: int = Field(..., description="Today's generated content count.")
    oss_storage_bytes: int = Field(..., description="Tracked upload storage in bytes.")
    trend_30_days: list[AdminDashboardTrendItem] = Field(
        default_factory=list,
        description="Daily token totals for the recent 30-day window.",
    )
    model_usage_ratio: list[AdminDashboardModelUsageItem] = Field(
        default_factory=list,
        description="Aggregated model token totals for chart rendering.",
    )


class SystemNotificationType(str, Enum):
    INFO = "info"
    WARNING = "warning"
    SUCCESS = "success"


class AdminNotificationItem(SchemaModel):
    id: str = Field(..., description="Notification identifier.")
    type: SystemNotificationType = Field(..., description="Notification tone.")
    title: str = Field(..., description="Notification title.")
    content: str = Field(..., description="Notification body.")
    is_read: bool = Field(..., description="Whether the notification has been read.")
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")


class AdminNotificationListResponse(SchemaModel):
    items: list[AdminNotificationItem] = Field(
        default_factory=list,
        description="Latest admin notifications ordered by newest first.",
    )
    unread_count: int = Field(..., description="Total unread notification count.")
    limit: int = Field(..., description="Applied notification query limit.")


class AdminNotificationReadAllResponse(SchemaModel):
    updated_count: int = Field(..., description="Number of notifications marked as read.")
    unread_count: int = Field(default=0, description="Remaining unread notification count.")


class AdminPendingTasksResponse(SchemaModel):
    abnormal_users: int = Field(..., description="Count of non-active user accounts.")
    storage_warnings: int = Field(..., description="Count of active storage warning items.")


class AdminStorageDistribution(SchemaModel):
    image: int = Field(default=0, description="Total image bytes.")
    video: int = Field(default=0, description="Total video bytes.")
    audio: int = Field(default=0, description="Total audio bytes.")
    document: int = Field(default=0, description="Total document bytes.")
    other: int = Field(default=0, description="Total bytes for uncategorized uploads.")


class AdminStorageStatsResponse(SchemaModel):
    total_bytes: int = Field(..., description="Tracked upload storage total in bytes.")
    capacity_bytes: int = Field(..., description="Configured storage-capacity baseline in bytes.")
    distribution: AdminStorageDistribution = Field(
        default_factory=AdminStorageDistribution,
        description="Storage bytes aggregated by MIME-type bucket.",
    )


class AdminStorageUserItem(SchemaModel):
    user_id: str = Field(..., description="Owning user ID.")
    username: str = Field(..., description="Owning username.")
    nickname: str | None = Field(default=None, description="Optional user display nickname.")
    total_size_bytes: int = Field(..., description="Summed upload size in bytes for the user.")
    file_count: int = Field(..., description="Tracked upload count for the user.")
    last_upload_time: UTCDateTime | None = Field(
        default=None,
        description="Most recent upload creation time for the user.",
    )


class AdminStorageUserListResponse(SchemaModel):
    items: list[AdminStorageUserItem] = Field(
        default_factory=list,
        description="Top storage-consuming users ordered by size descending.",
    )
    limit: int = Field(..., description="Applied leaderboard limit.")


class AdminSystemSettingItem(SchemaModel):
    key: str = Field(..., description="Unique system-setting key.")
    value: Any = Field(..., description="Current setting value.")
    default_value: Any = Field(..., description="Seeded default value for reset flows.")
    category: str = Field(..., description="Grouped category identifier.")
    description: str = Field(..., description="Human-readable field description.")


class AdminSystemSettingsResponse(SchemaModel):
    categories: dict[str, list[AdminSystemSettingItem]] = Field(
        default_factory=dict,
        description="System settings grouped by category for admin rendering.",
    )


class AdminSystemSettingsRollbackResponse(SchemaModel):
    snapshot_audit_log_id: str = Field(..., description="Audit snapshot used for rollback.")
    rollback_audit_log_id: str = Field(..., description="New audit log ID generated by rollback.")
    rolled_back_keys: list[str] = Field(
        default_factory=list,
        description="System-setting keys restored during rollback.",
    )


class AdminTokenTransactionItem(SchemaModel):
    id: str = Field(..., description="Token transaction ID.")
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")
    username: str = Field(..., description="Owning account username.")
    nickname: str | None = Field(default=None, description="Optional display nickname.")
    transaction_type: str = Field(..., description="Ledger transaction type.")
    amount: int = Field(..., description="Signed token delta.")
    remark: str = Field(..., description="Ledger remark.")


class AdminTokenTransactionListResponse(SchemaModel):
    items: list[AdminTokenTransactionItem] = Field(
        default_factory=list,
        description="Paginated token transaction rows.",
    )
    total: int = Field(..., description="Total transaction count after filtering.")
    skip: int = Field(..., description="Current offset.")
    limit: int = Field(..., description="Current page size.")


class AdminTokenTransactionStatsResponse(SchemaModel):
    today_consume: int = Field(..., description="Today's consumed token total.")
    today_topup: int = Field(..., description="Today's granted or topped-up token total.")
    month_consume: int = Field(..., description="Current month-to-date consumed token total.")
    total_balance: int = Field(..., description="Current total platform token balance.")
    today_consume_change_percent: float | None = Field(
        default=None,
        description="Period-over-period percentage change for today's consumption.",
    )
    today_topup_change_percent: float | None = Field(
        default=None,
        description="Period-over-period percentage change for today's top-up activity.",
    )
    month_consume_change_percent: float | None = Field(
        default=None,
        description="Month-to-date percentage change against the prior comparable period.",
    )
    total_balance_change_percent: float | None = Field(
        default=None,
        description="Percentage change of total platform balance against the prior day baseline.",
    )


class AdminAuditLogItem(SchemaModel):
    id: str = Field(..., description="Audit log ID.")
    operator_id: str | None = Field(default=None, description="Operator user ID.")
    operator_name: str = Field(..., description="Redundant operator display name.")
    action_type: AuditActionType = Field(..., description="Audit event category.")
    target_id: str | None = Field(default=None, description="Target entity ID.")
    target_name: str = Field(..., description="Target entity display name.")
    details: dict[str, object] = Field(
        default_factory=dict,
        description="Structured change details or business context.",
    )
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")


class AdminAuditLogListResponse(SchemaModel):
    items: list[AdminAuditLogItem] = Field(
        default_factory=list,
        description="Paginated audit log rows.",
    )
    total: int = Field(..., description="Total row count after filtering.")
    skip: int = Field(..., description="Current offset.")
    limit: int = Field(..., description="Current page size.")


class ThreadSummaryItem(SchemaModel):
    id: str = Field(..., description="Thread ID.")
    title: NormalizedText = Field(default="", description="Thread title.")
    latest_message_excerpt: NormalizedText = Field(default="", description="Latest message excerpt.")
    is_archived: bool = Field(default=False, description="Archive flag.")
    model_override: str | None = Field(
        default=None,
        description="Last persisted runtime model override for the thread.",
    )
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
    content: NormalizedText = Field(..., description="Message content or artifact title.")
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
    text: NormalizedText = Field(default="", description="Supplementary text.")
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")


class ThreadMessagesResponse(SchemaModel):
    thread_id: str = Field(..., description="Thread ID.")
    title: NormalizedText = Field(default="", description="Thread title.")
    system_prompt: NormalizedText = Field(default="", description="Persisted system prompt.")
    model_override: str | None = Field(
        default=None,
        description="Persisted runtime model override for the thread.",
    )
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
    thread_title: NormalizedText = Field(default="", description="Owning thread title.")
    message_id: str = Field(..., description="Assistant message ID linked to the artifact.")
    artifact_type: ArtifactType = Field(..., description="Artifact discriminator.")
    title: NormalizedText = Field(default="", description="Artifact title.")
    excerpt: NormalizedText = Field(default="", description="Short preview excerpt for card rendering.")
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


class AvailableModelItem(SchemaModel):
    id: str = Field(..., description="Frontend-safe model registry identifier.")
    model: str = Field(..., description="Raw provider model name used for runtime invocation.")
    name: str = Field(..., description="Display name shown in the selector.")
    group: str = Field(..., description="Capability group label used for subsection rendering.")
    tags: list[str] = Field(default_factory=list, description="Small display tags for the model.")
    requires_premium: bool = Field(
        default=False,
        description="Whether this model is restricted to Premium and above roles.",
    )
    is_default: bool = Field(
        default=False,
        description="Whether this model matches the current backend default.",
    )


class AvailableModelProviderItem(SchemaModel):
    provider_key: str = Field(..., description="Stable provider key.")
    provider: str = Field(..., description="Human-readable provider name.")
    status: Literal["configured", "unconfigured"] = Field(
        ...,
        description="Whether this provider is configured for the current deployment.",
    )
    status_label: str = Field(..., description="Localized provider status label.")
    models: list[AvailableModelItem] = Field(
        default_factory=list,
        description="Provider-owned models exposed to the frontend registry.",
    )


class AvailableModelsResponse(SchemaModel):
    items: list[AvailableModelProviderItem] = Field(
        default_factory=list,
        description="Provider-grouped model registry entries available to the frontend.",
    )
    total_providers: int = Field(..., description="Returned provider group count.")
    total_models: int = Field(..., description="Returned model count across all providers.")


class AdminTemplatePlatform(str, Enum):
    XIAOHONGSHU = "小红书"
    DOUYIN = "抖音"
    GENERAL = "通用"


class AdminGlobalSearchUserItem(SchemaModel):
    id: str = Field(..., description="Matched user ID.")
    username: str = Field(..., description="Matched username.")
    nickname: str | None = Field(default=None, description="Optional display nickname.")
    role: UserRole = Field(..., description="Assigned user role.")
    status: UserAccountStatus = Field(..., description="Current account status.")


class AdminGlobalSearchTemplateItem(SchemaModel):
    id: str = Field(..., description="Matched template ID.")
    title: str = Field(..., description="Matched template title.")
    platform: AdminTemplatePlatform = Field(..., description="Admin-facing template platform.")
    is_preset: bool = Field(..., description="Whether the matched template is an official preset.")


class AdminGlobalSearchAuditLogItem(SchemaModel):
    id: str = Field(..., description="Matched audit log ID.")
    action_type: AuditActionType = Field(..., description="Matched audit action type.")
    operator_name: str = Field(..., description="Audit operator name.")
    target_name: str = Field(..., description="Audit target display name.")
    created_at: UTCDateTime = Field(..., description="Audit log creation time in UTC.")


class AdminGlobalSearchResponse(SchemaModel):
    users: list[AdminGlobalSearchUserItem] = Field(
        default_factory=list,
        description="Matched admin users.",
    )
    templates: list[AdminGlobalSearchTemplateItem] = Field(
        default_factory=list,
        description="Matched admin templates.",
    )
    audit_logs: list[AdminGlobalSearchAuditLogItem] = Field(
        default_factory=list,
        description="Matched audit logs.",
    )


class AdminTemplateListItem(SchemaModel):
    id: str = Field(..., description="Template identifier.")
    title: str = Field(..., description="Template title shown in admin.")
    platform: AdminTemplatePlatform = Field(..., description="Admin-facing template platform.")
    description: str = Field(..., description="Short business-facing template summary.")
    prompt_content: str = Field(..., description="Stored reusable system prompt.")
    usage_count: int = Field(..., ge=0, description="Observed template usage count.")
    rating: float = Field(..., ge=0, le=5, description="Template rating for admin cards.")
    is_preset: bool = Field(..., description="Whether the template is a built-in preset.")
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")


class AdminTemplateListResponse(SchemaModel):
    items: list[AdminTemplateListItem] = Field(
        default_factory=list,
        description="Shared templates visible in admin.",
    )
    total: int = Field(..., description="Returned template count.")


class AdminTemplateCreateRequest(SchemaModel):
    title: str = Field(..., min_length=1, max_length=255, description="Template title.")
    platform: AdminTemplatePlatform = Field(..., description="Admin-facing template platform.")
    description: str = Field(
        default="",
        max_length=500,
        description="Short template description for card display.",
    )
    prompt_content: str = Field(
        ...,
        min_length=1,
        max_length=6000,
        description="Reusable system prompt body.",
    )
    is_preset: bool = Field(
        default=False,
        description="Whether the template should be distributed as an official preset.",
    )


class AdminTemplateUpdateRequest(SchemaModel):
    title: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="Updated template title.",
    )
    platform: AdminTemplatePlatform | None = Field(
        default=None,
        description="Updated admin-facing template platform.",
    )
    description: str | None = Field(
        default=None,
        max_length=500,
        description="Updated short template description for card display.",
    )
    prompt_content: str | None = Field(
        default=None,
        min_length=1,
        max_length=6000,
        description="Updated reusable system prompt body.",
    )
    is_preset: bool | None = Field(
        default=None,
        description="Whether the template should remain an official preset.",
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
    is_shared: bool = Field(
        default=False,
        description="Whether the template is a shared admin-created global template.",
    )
    created_at: UTCDateTime = Field(..., description="Creation time in UTC.")


class TemplateListResponse(SchemaModel):
    items: list[TemplateListItem] = Field(
        default_factory=list,
        description="Built-in template list for the current user.",
    )
    total: int = Field(..., description="Returned template count.")
    page: int = Field(default=1, description="Resolved current page after pagination.")
    page_size: int = Field(
        default=0,
        description="Resolved page size. Equals the full item count when pagination is omitted.",
    )
    total_pages: int = Field(
        default=1,
        description="Total pages derived from the current filtered result set.",
    )
    preset_total: int = Field(
        default=0,
        description="Preset template count after applying non-view filters.",
    )
    custom_total: int = Field(
        default=0,
        description="Custom template count after applying non-view filters.",
    )


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


class TemplateUpdateRequest(SchemaModel):
    title: str | None = Field(
        default=None,
        min_length=1,
        max_length=255,
        description="Updated template title.",
    )
    description: str | None = Field(
        default=None,
        max_length=500,
        description="Updated short user-facing description.",
    )
    platform: TemplatePlatform | None = Field(
        default=None,
        description="Updated template platform.",
    )
    prompt_content: str | None = Field(
        default=None,
        min_length=1,
        max_length=6000,
        validation_alias=AliasChoices("prompt_content", "system_prompt"),
        description="Updated system prompt body.",
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
