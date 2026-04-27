export type UiPlatform = "xiaohongshu" | "douyin" | "both";

export type UiTaskType =
  | "topic_planning"
  | "content_generation"
  | "hot_post_analysis"
  | "comment_reply";

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
  thread_title?: string;
};

export type HistoryThreadSummary = {
  id: string;
  title: string;
  latest_message_excerpt: string;
  is_archived: boolean;
  updated_at: string;
};

export type ThreadsApiResponse = {
  items: HistoryThreadSummary[];
  total: number;
  page: number;
  page_size: number;
};

export type ThreadUpdatePayload = {
  title?: string;
  is_archived?: boolean;
  system_prompt?: string;
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

export type UserProfileUpdatePayload = {
  nickname?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
};
