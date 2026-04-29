export type UiPlatform = "xiaohongshu" | "douyin" | "both";

export type UiTaskType =
  | "topic_planning"
  | "content_generation"
  | "hot_post_analysis"
  | "comment_reply";

export type WorkspaceView =
  | "chat"
  | "drafts"
  | "knowledge"
  | "topics"
  | "templates"
  | "dashboard";

export type BackendPlatform = "xiaohongshu" | "douyin";

export type BackendTaskType =
  | "topic_planning"
  | "content_generation"
  | "hot_post_analysis"
  | "comment_reply";

export type MessageRole = "user" | "assistant" | "tool" | "note" | "error";

export type ConversationMessage = {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  title?: string;
  materials?: MediaChatMaterialPayload[];
};

export type ThreadItem = {
  id: string;
  title: string;
  time: string;
  platform?: "xiaohongshu" | "douyin";
  isArchived?: boolean;
};

export type UploadedMaterialKind = "image" | "video" | "text";

export type UploadedMaterialStatus = "uploading" | "ready" | "error";

export type UploadedMaterial = {
  id: string;
  name: string;
  kind: UploadedMaterialKind;
  sizeLabel: string;
  status: UploadedMaterialStatus;
  previewUrl?: string;
  sourceUrl?: string;
  fileType?: string;
  errorMessage?: string;
};

export type ComposerSubmitPayload = {
  message: string;
  uploadedMaterials: UploadedMaterial[];
};

export type UploadApiResponse = {
  url: string;
  file_type: string;
  content_type: string;
  filename: string;
  original_filename: string;
  purpose: "avatar" | "material";
  thread_id?: string | null;
};

export type MediaChatMaterialPayload = {
  type: "image" | "video_url" | "text_link";
  text: string;
  url?: string;
};

export type MediaChatRequestPayload = {
  thread_id: string;
  platform: BackendPlatform;
  task_type: BackendTaskType;
  message: string;
  materials: MediaChatMaterialPayload[];
  system_prompt?: string;
  knowledge_base_scope?: string | null;
  thread_title?: string;
};

export type HistoryThreadSummary = {
  id: string;
  title: string;
  latest_message_excerpt: string;
  is_archived: boolean;
  knowledge_base_scope?: string | null;
  updated_at: string;
};

export type ThreadsApiResponse = {
  items: HistoryThreadSummary[];
  total: number;
  page: number;
  page_size: number;
};

export type DraftSummaryItem = {
  id: string;
  thread_id: string;
  thread_title: string;
  message_id: string;
  artifact_type: ArtifactPayload["artifact_type"];
  title: string;
  excerpt: string;
  platform?: UiPlatform | null;
  created_at: string;
  artifact: ArtifactPayload;
};

export type DraftsApiResponse = {
  items: DraftSummaryItem[];
  total: number;
};

export type DraftsDeletePayload = {
  message_ids?: string[];
  clear_all?: boolean;
};

export type DraftsDeleteApiResponse = {
  deleted_count: number;
  deleted_message_ids: string[];
  cleared_all: boolean;
};

export type TopicPlatform = "小红书" | "抖音" | "双平台";

export type TopicStatus = "idea" | "drafting" | "published";

export type TopicItem = {
  id: string;
  title: string;
  inspiration: string;
  platform: TopicPlatform;
  status: TopicStatus;
  thread_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type TopicsApiResponse = {
  items: TopicItem[];
  total: number;
};

export type TopicCreatePayload = {
  title: string;
  inspiration?: string;
  platform: TopicPlatform;
};

export type TopicUpdatePayload = {
  title?: string;
  inspiration?: string;
  platform?: TopicPlatform;
  status?: TopicStatus;
  thread_id?: string | null;
};

export type TopicDeleteApiResponse = {
  id: string;
  deleted: boolean;
};

export type KnowledgeScopeItem = {
  scope: string;
  chunk_count: number;
  source_count: number;
  updated_at?: string | null;
};

export type KnowledgeScopesApiResponse = {
  items: KnowledgeScopeItem[];
  total: number;
};

export type KnowledgeUploadApiResponse = {
  scope: string;
  source: string;
  chunk_count: number;
};

export type KnowledgeScopeDeleteApiResponse = {
  scope: string;
  deleted_count: number;
  deleted: boolean;
};
export type KnowledgeScopeRenamePayload = {
  new_name: string;
};

export type KnowledgeScopeRenameApiResponse = {
  previous_scope: string;
  scope: string;
  renamed_count: number;
  renamed: boolean;
};

export type KnowledgeScopeSourceItem = {
  filename: string;
  chunk_count: number;
};

export type KnowledgeScopeSourcesApiResponse = {
  scope: string;
  items: KnowledgeScopeSourceItem[];
  total: number;
};

export type KnowledgeSourceDeleteApiResponse = {
  scope: string;
  source: string;
  deleted_count: number;
  deleted: boolean;
};

export type TemplatePlatform = "小红书" | "抖音" | "双平台" | "闲鱼" | "技术博客";

export type TemplateCategory =
  | "美妆护肤"
  | "美食文旅"
  | "职场金融"
  | "数码科技"
  | "电商/闲鱼"
  | "教育/干货"
  | "房产/家居"
  | "汽车/出行"
  | "母婴/宠物"
  | "情感/心理";

export type TemplateSummaryItem = {
  id: string;
  title: string;
  description: string;
  platform: TemplatePlatform;
  category: TemplateCategory;
  knowledge_base_scope?: string | null;
  system_prompt: string;
  is_preset: boolean;
  created_at: string;
};

export type TemplatesApiResponse = {
  items: TemplateSummaryItem[];
  total: number;
};

export type TemplateCreatePayload = {
  title: string;
  description: string;
  platform: TemplatePlatform;
  category: TemplateCategory;
  knowledge_base_scope?: string | null;
  system_prompt: string;
};

export type TemplateDeletePayload = {
  template_ids: string[];
};

export type TemplateDeleteApiResponse = {
  deleted_count: number;
  deleted_ids: string[];
};

export type TemplateSkillDiscoveryItem = {
  id: string;
  title: string;
  description: string;
  platform: TemplatePlatform;
  category: TemplateCategory;
  knowledge_base_scope?: string | null;
  system_prompt: string;
  source_title: string;
  source_url?: string | null;
  data_mode: "mock" | "mock_fallback" | "live_tavily" | "llm_fallback";
  isCloud?: boolean;
};

export type TemplateSkillsApiResponse = {
  query: string;
  category?: TemplateCategory | null;
  items: TemplateSkillDiscoveryItem[];
  templates?: TemplateSkillDiscoveryItem[] | null;
  total: number;
  data_mode: "mock" | "mock_fallback" | "live_tavily" | "llm_fallback";
  fallback_reason?: string | null;
};

export type ThreadUpdatePayload = {
  title?: string;
  is_archived?: boolean;
  system_prompt?: string;
  knowledge_base_scope?: string | null;
};

export type ThreadDeleteApiResponse = {
  id: string;
  deleted: boolean;
};

export type TopicPlanningItem = {
  title: string;
  angle: string;
  goal: string;
};

export type TopicPlanningArtifactPayload = {
  artifact_type: "topic_list";
  title: string;
  topics: TopicPlanningItem[];
};

export type ContentGenerationArtifactPayload = {
  artifact_type: "content_draft";
  title: string;
  title_candidates: string[];
  body: string;
  platform_cta: string;
};

export type HotPostAnalysisDimension = {
  dimension: string;
  insight: string;
};

export type HotPostAnalysisArtifactPayload = {
  artifact_type: "hot_post_analysis";
  title: string;
  analysis_dimensions: HotPostAnalysisDimension[];
  reusable_templates: string[];
};

export type CommentReplySuggestion = {
  comment_type: string;
  scenario: string;
  reply: string;
  compliance_note: string;
};

export type CommentReplyArtifactPayload = {
  artifact_type: "comment_reply";
  title: string;
  suggestions: CommentReplySuggestion[];
};

export type ArtifactPayload =
  | TopicPlanningArtifactPayload
  | ContentGenerationArtifactPayload
  | HotPostAnalysisArtifactPayload
  | CommentReplyArtifactPayload;

export type PersistedMessageType = "text" | "artifact";

export type HistoryMessageItem = {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  message_type: PersistedMessageType;
  content: string;
  created_at: string;
  artifact?: ArtifactPayload | null;
  materials?: HistoryMaterialItem[];
};

export type HistoryMaterialItem = {
  id: string;
  thread_id: string;
  message_id?: string | null;
  type: "image" | "video_url" | "text_link";
  url?: string | null;
  text: string;
  created_at: string;
};

export type ThreadMessagesApiResponse = {
  thread_id: string;
  title: string;
  system_prompt: string;
  knowledge_base_scope?: string | null;
  messages: HistoryMessageItem[];
  materials: HistoryMaterialItem[];
};

export type StartStreamEvent = {
  event: "start";
  thread_id: string;
  platform: BackendPlatform;
  task_type: BackendTaskType;
  materials_count: number;
};

export type MessageStreamEvent = {
  event: "message";
  delta: string;
  index: number;
};

export type ToolCallStreamEvent = {
  event: "tool_call";
  name: string;
  status: string;
  message?: string;
};

export type ArtifactStreamEvent = {
  event: "artifact";
  artifact: ArtifactPayload;
};

export type ErrorStreamEvent = {
  event: "error";
  code: string;
  message: string;
};

export type DoneStreamEvent = {
  event: "done";
  thread_id: string;
};

export type ChatStreamEvent =
  | StartStreamEvent
  | MessageStreamEvent
  | ToolCallStreamEvent
  | ArtifactStreamEvent
  | ErrorStreamEvent
  | DoneStreamEvent;

export type ArtifactAction = {
  id: string;
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary";
};

export type AuthenticatedUser = {
  id: string;
  username: string;
  nickname?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  created_at: string;
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  user: AuthenticatedUser;
};

export type LogoutResponse = {
  logged_out: true;
};

export type ResetPasswordPayload = {
  old_password: string;
  new_password: string;
};

export type ResetPasswordResponse = {
  password_reset: true;
  revoked_sessions: number;
};

export type AuthSessionItem = {
  id: string;
  device_info?: string | null;
  ip_address?: string | null;
  expires_at: string;
  last_seen_at: string;
  created_at: string;
  is_current: boolean;
};

export type AuthSessionsResponse = {
  items: AuthSessionItem[];
};

export type SessionRevokeResponse = {
  id: string;
  revoked: boolean;
};

export type RegisterPayload = {
  username: string;
  password: string;
};

export type PasswordResetRequestPayload = {
  username: string;
};

export type PasswordResetRequestApiResponse = {
  accepted: true;
  expires_in_minutes: number;
};

export type PasswordResetConfirmPayload = {
  token: string;
  new_password: string;
};

export type PasswordResetConfirmResponse = {
  password_reset: true;
  revoked_sessions: number;
};

export type UserProfileUpdatePayload = {
  nickname?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
};
