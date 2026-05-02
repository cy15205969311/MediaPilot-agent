import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  LockKeyhole,
  Menu,
  RefreshCw,
  Settings2,
  Sparkles,
  UserRoundPlus,
  X,
} from "lucide-react";

import {
  APIError,
  clearStoredRefreshToken,
  clearStoredToken,
  clearStoredUser,
  completePasswordReset,
  createChatStream,
  deleteKnowledgeSource,
  deleteKnowledgeScope,
  createTopic,
  createTemplate,
  deleteTopic,
  deleteArtifact,
  deleteArtifacts,
  deleteTemplate,
  deleteTemplates,
  deleteThread,
  fetchArtifacts,
  fetchDashboardSummary,
  fetchKnowledgeScopeSources,
  fetchKnowledgeScopes,
  fetchTopics,
  fetchTemplateSkills,
  fetchTemplates,
  fetchSessions,
  fetchThreadMessages,
  fetchThreads,
  getStoredRefreshToken,
  getStoredToken,
  getStoredUser,
  isUnauthorizedError,
  login,
  logoutAPI,
  previewKnowledgeSource,
  requestPasswordReset,
  register,
  revokeSession,
  resetPassword,
  setStoredUser,
  renameKnowledgeScope,
  updateTopic,
  updateThread,
  uploadKnowledgeDocument,
  updateUserProfile,
  uploadMedia,
} from "./api";
import { AppHeader } from "./components/AppHeader";
import { ChatFeed } from "./components/ChatFeed";
import { Composer } from "./components/Composer";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightPanel } from "./components/RightPanel";
import { ThreadSettingsModal } from "./components/ThreadSettingsModal";
import { UserProfileModal } from "./components/UserProfileModal";
import { DashboardView } from "./components/views/DashboardView";
import { DraftsView } from "./components/views/DraftsView";
import { KnowledgeView } from "./components/views/KnowledgeView";
import { TopicsView } from "./components/views/TopicsView";
import { TemplatesView } from "./components/views/TemplatesView";
import { quickActions, taskOptions } from "./data";
import type {
  ArtifactAction,
  ArtifactPayload,
  AuthSessionItem,
  AuthenticatedUser,
  ChatStreamEvent,
  ComposerSubmitPayload,
  ConversationMessage,
  DashboardSummary,
  DraftSummaryItem,
  HistoryMessageItem,
  KnowledgeScopeItem,
  KnowledgeScopeSourceItem,
  KnowledgeSourcePreviewApiResponse,
  MediaChatMaterialPayload,
  MediaChatRequestPayload,
  ResetPasswordResponse,
  TopicCreatePayload,
  TopicItem,
  TopicPlatform,
  TopicStatus,
  TopicUpdatePayload,
  TemplateCategory,
  TemplateCreatePayload,
  TemplatePlatform,
  TemplateSkillDiscoveryItem,
  TemplateSummaryItem,
  ThreadItem,
  ThreadsApiResponse,
  ToolCallTraceItem,
  UiPlatform,
  UiTaskType,
  UploadedMaterial,
  UploadedMaterialKind,
  UserProfileUpdatePayload,
  WorkspaceView,
} from "./types";
import {
  createId,
  formatFileSize,
  formatRelativeTime,
  getDisplayName,
  mapMaterialKindToSchema,
  mapPlatformToBackend,
  mapTaskToBackend,
} from "./utils";
import {
  buildArtifactMarkdown,
  downloadArtifactMarkdown,
} from "./artifactMarkdown";
import { cleanForPublishing } from "./utils/textUtils";

type AuthMode =
  | "login"
  | "register"
  | "forgot-password"
  | "reset-password";

type ConversationMessageDraft = Omit<ConversationMessage, "createdAt"> & {
  createdAt?: string;
};

type TemplateCreationRequest = {
  key: number;
  payload: TemplateCreatePayload;
};

type PublishResultPayload = {
  status?: string;
  message?: string;
  error?: string;
  taskId?: string;
};

type PublishToastState = {
  id: number;
  tone: "success" | "error";
  title: string;
  message: string;
  error?: string;
};

const MODEL_OVERRIDE_STORAGE_KEY = "omnimedia_model_override";
const LEGACY_QWEN_MODEL_STORAGE_KEY = "omnimedia_qwen_model_override";
const XIAOHONGSHU_CREATOR_URL = "https://creator.xiaohongshu.com/publish/publish";

function getPlatformDisplayLabel(platform: UiPlatform): string {
  if (platform === "both") {
    return "双平台";
  }
  if (platform === "douyin") {
    return "抖音";
  }
  return "小红书";
}

function getToolCallFallbackMessage(name: string, status: string): string {
  const toolLabelMap: Record<string, string> = {
    parse_materials: "整理附件素材",
    parse_document: "解析文档内容",
    video_transcription: "转写视频语音",
    audio_transcription: "转写音频语音",
    video_validation: "校验视频素材",
    audio_validation: "校验音频素材",
    ocr: "识别图片文字",
    web_search: "检索全网信息",
    retrieve_knowledge_base: "检索知识库",
    analyze_market_trends: "分析市场趋势",
    generate_content_outline: "生成内容大纲",
    generate_draft: "生成正文草稿",
    review_draft: "审查草稿质量",
    build_image_prompt: "提炼配图提示词",
    generate_cover_images: "生成内容配图",
    format_artifact: "整理结构化产物",
  };
  const statusLabelMap: Record<string, string> = {
    processing: "进行中",
    completed: "已完成",
    passed: "已通过",
    skipped: "已跳过",
    fallback: "已降级处理",
    failed: "失败",
    timeout: "超时",
    retry: "准备重试",
    max_retries: "达到最大重试次数",
  };

  const toolLabel = toolLabelMap[name] ?? name;
  const statusLabel = statusLabelMap[status] ?? status;
  return `${toolLabel} · ${statusLabel}`;
}

function isToolCallProcessingStatus(status: string): boolean {
  return status === "processing";
}

function createConversationMessage(
  message: ConversationMessageDraft,
): ConversationMessage {
  return {
    ...message,
    createdAt: message.createdAt ?? new Date().toISOString(),
  };
}

function toThreadItem(
  id: string,
  title: string,
  excerpt: string,
  updatedAt: string,
  isArchived: boolean,
): ThreadItem {
  return {
    id,
    title: title || excerpt || "Untitled thread",
    time: formatRelativeTime(updatedAt) || "刚刚",
    isArchived,
  };
}

function toThreadItemFromSummary(
  summary: ThreadsApiResponse["items"][number],
): ThreadItem {
  return toThreadItem(
    summary.id,
    summary.title,
    summary.latest_message_excerpt,
    summary.updated_at,
    summary.is_archived,
  );
}

function toConversationMessages(messages: HistoryMessageItem[]): {
  chatMessages: ConversationMessage[];
  latestArtifact: ArtifactPayload | null;
} {
  let latestArtifact: ArtifactPayload | null = null;
  const chatMessages: ConversationMessage[] = [];

  for (const message of messages) {
    if (message.message_type === "artifact" && message.artifact) {
      latestArtifact = message.artifact;
      const latestAssistantIndex = [...chatMessages]
        .map((item, index) => ({ item, index }))
        .reverse()
        .find(({ item }) => item.role === "assistant")?.index;

      if (latestAssistantIndex !== undefined) {
        chatMessages[latestAssistantIndex] = {
          ...chatMessages[latestAssistantIndex],
          artifact: message.artifact,
        };
      } else {
        chatMessages.push(
          createConversationMessage({
            id: message.id,
            role: message.role,
            content: message.content,
            createdAt: message.created_at,
            artifact: message.artifact,
          }),
        );
      }
      continue;
    }

    chatMessages.push(
      createConversationMessage({
        id: message.id,
        role: message.role,
        content: message.content,
        materials: message.materials?.map((material) => ({
          type: material.type,
          text: material.text,
          ...(material.url ? { url: material.url } : {}),
        })),
        createdAt: message.created_at,
      }),
    );
  }

  return { chatMessages, latestArtifact };
}

function deriveThreadLabel(message: string): string {
  const compact = message.trim();
  if (!compact) {
    return "Untitled thread";
  }
  return compact.length > 28 ? `${compact.slice(0, 28)}...` : compact;
}

function revokeBlobPreview(url?: string) {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function toMaterialPayload(item: UploadedMaterial): MediaChatMaterialPayload {
  return {
    type: mapMaterialKindToSchema(item.kind),
    text: item.name,
    ...(item.sourceUrl ? { url: item.sourceUrl } : {}),
  };
}

function AuthCard(props: {
  mode: AuthMode;
  username: string;
  password: string;
  confirmPassword: string;
  resetToken: string;
  isSubmitting: boolean;
  errorText: string;
  successText: string;
  onModeChange: (mode: AuthMode) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onResetTokenChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const {
    mode,
    username,
    password,
    confirmPassword,
    resetToken,
    isSubmitting,
    errorText,
    successText,
    onModeChange,
    onUsernameChange,
    onPasswordChange,
    onConfirmPasswordChange,
    onResetTokenChange,
    onSubmit,
  } = props;
  const isCredentialMode = mode === "login" || mode === "register";
  const isForgotPasswordMode = mode === "forgot-password";
  const isResetPasswordMode = mode === "reset-password";

  const titleText = isCredentialMode
    ? mode === "login"
      ? "登录你的内容工作台"
      : "创建一个新的工作台账号"
    : isForgotPasswordMode
      ? "申请密码重置令牌"
      : "输入令牌设置新密码";

  const submitLabel = isCredentialMode
    ? mode === "login"
      ? "登录并进入工作台"
      : "注册并进入工作台"
    : isForgotPasswordMode
      ? "生成重置令牌"
      : "重置密码并返回登录";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 [background-image:var(--shell-background)]">
      <div
        className="w-full max-w-md rounded-[28px] border border-border bg-surface-elevated p-8 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl"
        data-testid="auth-card"
      >
        <div className="mb-6 flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl text-brand-foreground shadow-sm"
            style={{ background: "var(--brand-gradient)" }}
          >
            {mode === "login" || mode === "forgot-password" ? (
              <LockKeyhole className="h-6 w-6" />
            ) : (
              <UserRoundPlus className="h-6 w-6" />
            )}
          </div>
          <div>
            <div className="text-2xl font-semibold text-foreground">MediaPilot</div>
            <div className="text-sm text-muted-foreground">{titleText}</div>
          </div>
        </div>

        {isCredentialMode ? (
          <div className="mb-5 flex rounded-2xl bg-secondary p-1">
            {(["login", "register"] as const).map((item) => (
              <button
                key={item}
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${mode === item
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
                  }`}
                onClick={() => onModeChange(item)}
                type="button"
              >
                {item === "login" ? "登录" : "注册"}
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-5 flex items-center justify-between rounded-2xl bg-secondary px-4 py-3 text-sm text-secondary-foreground">
            <span>
              {isForgotPasswordMode
                ? "第一步：申请重置令牌"
                : "第二步：使用令牌重置密码"}
            </span>
            <button
              className="font-medium text-foreground transition hover:text-brand"
              onClick={() => onModeChange("login")}
              type="button"
            >
              返回登录
            </button>
          </div>
        )}

        <form className="space-y-4" onSubmit={onSubmit}>
          {(isCredentialMode || isForgotPasswordMode) ? (
            <label className="block">
              <div className="mb-2 text-sm font-medium text-card-foreground">用户名</div>
              <input
                className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                autoComplete="username"
                onChange={(event) => onUsernameChange(event.target.value)}
                placeholder="请输入用户名"
                value={username}
              />
            </label>
          ) : null}

          {isCredentialMode ? (
            <label className="block">
              <div className="mb-2 text-sm font-medium text-card-foreground">密码</div>
              <input
                className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                onChange={(event) => onPasswordChange(event.target.value)}
                placeholder="请输入密码"
                type="password"
                value={password}
              />
            </label>
          ) : null}

          {isResetPasswordMode ? (
            <>
              <label className="block">
                <div className="mb-2 text-sm font-medium text-card-foreground">
                  重置 Token
                </div>
                <textarea
                  className="min-h-28 w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm leading-6 text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                  onChange={(event) => onResetTokenChange(event.target.value)}
                  placeholder="请粘贴后端控制台输出的重置 Token"
                  value={resetToken}
                />
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-card-foreground">
                  新密码
                </div>
                <input
                  className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                  autoComplete="new-password"
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="请输入新的登录密码"
                  type="password"
                  value={password}
                />
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-card-foreground">
                  确认新密码
                </div>
                <input
                  className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                  autoComplete="new-password"
                  onChange={(event) => onConfirmPasswordChange(event.target.value)}
                  placeholder="请再次输入新的登录密码"
                  type="password"
                  value={confirmPassword}
                />
              </label>
            </>
          ) : null}

          {successText ? (
            <div className="rounded-2xl border border-success-foreground/20 bg-success-surface px-4 py-3 text-sm text-success-foreground">
              {successText}
            </div>
          ) : null}

          {errorText ? (
            <div className="rounded-2xl border border-danger-foreground/20 bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
              {errorText}
            </div>
          ) : null}

          <button
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
            {submitLabel}
          </button>
        </form>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          {mode === "login" ? (
            <button
              className="font-medium text-muted-foreground transition hover:text-brand"
              onClick={() => onModeChange("forgot-password")}
              type="button"
            >
              忘记密码？
            </button>
          ) : null}

          {isForgotPasswordMode ? (
            <button
              className="font-medium text-muted-foreground transition hover:text-brand"
              onClick={() => onModeChange("reset-password")}
              type="button"
            >
              我已经拿到重置 Token
            </button>
          ) : null}

          {isResetPasswordMode ? (
            <button
              className="font-medium text-muted-foreground transition hover:text-brand"
              onClick={() => onModeChange("forgot-password")}
              type="button"
            >
              先返回申请令牌
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function mapTemplatePlatformToWorkspace(
  platform: TemplateSummaryItem["platform"],
): UiPlatform | null {
  if (platform === "小红书") {
    return "xiaohongshu";
  }

  if (platform === "抖音") {
    return "douyin";
  }

  if (platform === "双平台") {
    return "both";
  }

  return null;
}

function mapWorkspacePlatformToTemplate(platform: UiPlatform): TemplatePlatform {
  if (platform === "both") {
    return "双平台";
  }
  if (platform === "douyin") {
    return "抖音";
  }
  return "小红书";
}

function mapTopicPlatformToWorkspace(platform: TopicPlatform): UiPlatform {
  if (platform === "双平台") {
    return "both";
  }
  if (platform === "抖音") {
    return "douyin";
  }
  return "xiaohongshu";
}

function mapCategoryToKnowledgeBaseScope(category: TemplateCategory): string {
  if (category === "美食文旅") {
    return "travel_local_guides";
  }
  if (category === "职场金融") {
    return "finance_recovery_playbook";
  }
  if (category === "数码科技") {
    return "iot_embedded_lab";
  }
  if (category === "电商/闲鱼") {
    return "secondhand_trade_playbook";
  }
  if (category === "教育/干货") {
    return "education_score_boost";
  }
  if (category === "房产/家居") {
    return "housing_home_revival";
  }
  if (category === "汽车/出行") {
    return "car_lifestyle_commuter";
  }
  if (category === "母婴/宠物") {
    return "parenting_pet_care";
  }
  if (category === "情感/心理") {
    return "emotional_wellbeing_notes";
  }
  return "beauty_skin_repair_notes";
}

function summarizeArtifactForTemplate(artifact: ArtifactPayload): string {
  if (artifact.artifact_type === "content_draft") {
    return artifact.body.trim().slice(0, 180);
  }

  if (artifact.artifact_type === "topic_list") {
    return artifact.topics
      .slice(0, 3)
      .map((topic) => `${topic.title}：${topic.angle}`)
      .join("；");
  }

  if (artifact.artifact_type === "hot_post_analysis") {
    return artifact.analysis_dimensions
      .slice(0, 3)
      .map((dimension) => `${dimension.dimension}：${dimension.insight}`)
      .join("；");
  }

  return artifact.suggestions
    .slice(0, 3)
    .map((suggestion) => `${suggestion.comment_type}：${suggestion.reply}`)
    .join("；");
}

function inferTemplateCategoryFromContext(params: {
  artifact: ArtifactPayload;
  taskType: UiTaskType;
  systemPrompt: string;
  threadTitle: string;
}): TemplateCategory {
  const context = [
    params.systemPrompt,
    params.threadTitle,
    params.artifact.title,
    summarizeArtifactForTemplate(params.artifact),
  ]
    .join(" ")
    .toLowerCase();

  if (["文旅", "探店", "citywalk", "周末", "路线", "旅行", "本地生活", "出片"].some((item) => context.includes(item.toLowerCase()))) {
    return "美食文旅";
  }
  if (["闲鱼", "二手", "回血", "断舍离", "sku"].some((item) => context.includes(item.toLowerCase()))) {
    return "电商/闲鱼";
  }
  if (["装修", "租房", "法拍房", "软装", "家居", "老破小"].some((item) => context.includes(item.toLowerCase()))) {
    return "房产/家居";
  }
  if (["汽车", "试驾", "油耗", "保养", "二手车", "新能源", "自驾"].some((item) => context.includes(item.toLowerCase()))) {
    return "汽车/出行";
  }
  if (["母婴", "宝宝", "幼猫", "幼犬", "宠物", "喂养", "囤货"].some((item) => context.includes(item.toLowerCase()))) {
    return "母婴/宠物";
  }
  if (["焦虑", "恋爱", "人格", "独处", "关系", "情绪", "心理"].some((item) => context.includes(item.toLowerCase()))) {
    return "情感/心理";
  }
  if (["stm32", "iot", "嵌入式", "开发板", "智能家居", "数码", "测评"].some((item) => context.includes(item.toLowerCase()))) {
    return "数码科技";
  }
  if (["教辅", "提分", "高考", "逆袭", "家长", "学习", "科普", "医疗", "法律"].some((item) => context.includes(item.toLowerCase()))) {
    return "教育/干货";
  }
  if (["理财", "预算", "职场", "面试", "涨薪", "合同", "复盘"].some((item) => context.includes(item.toLowerCase()))) {
    return "职场金融";
  }
  if (["护肤", "美妆", "熬夜", "健身", "成分", "平替", "母婴"].some((item) => context.includes(item.toLowerCase()))) {
    return "美妆护肤";
  }

  if (params.taskType === "hot_post_analysis") {
    return "数码科技";
  }
  return "美食文旅";
}

function buildTemplatePrefillFromArtifact(params: {
  artifact: ArtifactPayload;
  platform: UiPlatform;
  taskType: UiTaskType;
  systemPrompt: string;
  threadTitle: string;
}): TemplateCreatePayload {
  const category = inferTemplateCategoryFromContext(params);
  const summary = summarizeArtifactForTemplate(params.artifact);
  const promptBody = params.systemPrompt.trim()
    ? `${params.systemPrompt.trim()}\n\n请延续以下已验证内容方向：\n- 代表产物：${params.artifact.title}\n- 内容摘要：${summary}`
    : `你是一名擅长输出 ${category} 内容的专业编辑。\n请参考以下已验证方向继续生成稳定风格内容：\n- 代表产物：${params.artifact.title}\n- 内容摘要：${summary}\n输出时要兼顾目标受众、结构感、转化动作与风险提醒。`;

  return {
    title: params.artifact.title || params.threadTitle || "未命名模板",
    description: `基于会话「${params.threadTitle || "当前线程"}」沉淀的可复用模板：${summary.slice(0, 80)}`,
    platform: mapWorkspacePlatformToTemplate(params.platform),
    category,
    knowledge_base_scope: mapCategoryToKnowledgeBaseScope(category),
    system_prompt: promptBody,
  };
}

function buildTopicDraftPrompt(topic: TopicItem): string {
  const inspiration = topic.inspiration.trim();
  const platformHint =
    topic.platform === "双平台" ? "双平台联动内容" : `${topic.platform} 内容`;

  return [
    `你是一位顶级内容运营与爆款文案策划顾问。`,
    `请围绕选题「${topic.title}」生成一篇可直接进入撰写流程的 ${platformHint} 草稿。`,
    inspiration
      ? `请重点吸收以下灵感备注与素材线索：${inspiration}`
      : "当前没有额外备注，请你主动补全目标受众、切入角度、结构节奏与转化动作。",
    "输出时要兼顾标题钩子、正文结构、情绪价值、真实细节、平台表达习惯与结尾 CTA，避免空泛套话。",
  ].join("\n");
}

function toTopicThreadItem(topic: TopicItem): ThreadItem {
  return {
    id: topic.thread_id || "thread-new",
    title: topic.title || "Untitled thread",
    time: formatRelativeTime(topic.updated_at) || "刚刚",
    platform:
      topic.platform === "双平台"
        ? undefined
        : topic.platform === "抖音"
          ? "douyin"
          : "xiaohongshu",
  };
}

function NewThreadModal(props: {
  open: boolean;
  title: string;
  systemPrompt: string;
  knowledgeBaseScope: string;
  knowledgeScopes: KnowledgeScopeItem[];
  isLoadingKnowledgeScopes: boolean;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onSystemPromptChange: (value: string) => void;
  onKnowledgeBaseScopeChange: (value: string) => void;
  onConfirm: () => void;
}) {
  const {
    open,
    title,
    systemPrompt,
    knowledgeBaseScope,
    knowledgeScopes,
    isLoadingKnowledgeScopes,
    onClose,
    onTitleChange,
    onSystemPromptChange,
    onKnowledgeBaseScopeChange,
    onConfirm,
  } = props;

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div
        className="w-full max-w-xl rounded-[28px] border border-border bg-card p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
        data-testid="new-thread-modal"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-semibold text-foreground">新建会话</div>
            <div className="mt-1 text-sm text-muted-foreground">
              为这次会话设置标题、机器人人设和可选知识库。留空时将使用默认助手。
            </div>
          </div>
          <button
            aria-label="关闭新建会话弹窗"
            className="rounded-xl p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <div className="mb-2 text-sm font-medium text-card-foreground">会话标题</div>
            <input
              className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
              data-testid="new-thread-title-input"
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="例如：五一福州周边文旅选题"
              value={title}
            />
          </label>

          <label className="block">
            <div className="mb-2 text-sm font-medium text-card-foreground">
              机器人人设 / 品牌定位
            </div>
            <textarea
              className="min-h-36 w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm leading-7 text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
              data-testid="new-thread-system-prompt-input"
              onChange={(event) => onSystemPromptChange(event.target.value)}
              placeholder="请输入你希望我扮演的角色，留空则使用通用助手。"
              value={systemPrompt}
            />
          </label>

          <label className="block">
            <div className="mb-2 text-sm font-medium text-card-foreground">
              关联知识库（可选）
            </div>
            <select
              className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
              data-testid="new-thread-knowledge-scope-select"
              disabled={isLoadingKnowledgeScopes}
              onChange={(event) => onKnowledgeBaseScopeChange(event.target.value)}
              value={knowledgeBaseScope}
            >
              <option value="">
                {isLoadingKnowledgeScopes ? "正在加载知识库..." : "不绑定知识库"}
              </option>
              {knowledgeScopes.map((scope) => (
                <option key={scope.scope} value={scope.scope}>
                  {scope.scope} · {scope.chunk_count} 个切片
                </option>
              ))}
            </select>
            <div className="mt-2 text-xs leading-5 text-muted-foreground">
              当前一期采用单选 Scope；如果需要检索多份资料，请把文件上传到同一个 Scope。
            </div>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground transition hover:bg-muted"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
            onClick={onConfirm}
            type="button"
            data-testid="new-thread-confirm"
          >
            开始新会话
          </button>
        </div>
      </div>
    </div>
  );
}

function PlaceholderView(props: {
  title: string;
  description: string;
}) {
  const { title, description } = props;

  return (
    <div
      className="flex flex-1 items-center justify-center px-6 py-10"
      data-testid="workspace-placeholder-view"
    >
      <div className="max-w-xl rounded-[32px] border border-dashed border-border bg-card px-8 py-10 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Sparkles className="h-8 w-8" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold text-foreground">{title}</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function App() {
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authResetToken, setAuthResetToken] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(() =>
    getStoredUser(),
  );

  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 1280 : true,
  );
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("chat");
  const [platform, setPlatform] = useState<UiPlatform>("xiaohongshu");
  const [taskType, setTaskType] = useState<UiTaskType>("content_generation");
  const [modelOverride, setModelOverride] = useState<string>(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const storedValue =
      window.localStorage.getItem(MODEL_OVERRIDE_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_QWEN_MODEL_STORAGE_KEY) ??
      "";
    return storedValue.trim();
  });
  const [message, setMessage] = useState(
    "请帮我策划一篇关于xxx的小红书笔记",
  );
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [drafts, setDrafts] = useState<DraftSummaryItem[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [knowledgeScopes, setKnowledgeScopes] = useState<KnowledgeScopeItem[]>([]);
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [templates, setTemplates] = useState<TemplateSummaryItem[]>([]);
  const [templateSkills, setTemplateSkills] = useState<TemplateSkillDiscoveryItem[]>([]);
  const [uploadedMaterials, setUploadedMaterials] = useState<UploadedMaterial[]>([]);
  const [artifact, setArtifact] = useState<ArtifactPayload | null>(null);
  const [toolCallTimeline, setToolCallTimeline] = useState<ToolCallTraceItem[]>([]);
  const [statusText, setStatusText] = useState("等待新的内容任务");
  const [publishToast, setPublishToast] = useState<PublishToastState | null>(null);
  const [activeThreadTitle, setActiveThreadTitle] = useState("New thread");
  const [activeThreadId, setActiveThreadId] = useState("thread-new");
  const [activeSystemPrompt, setActiveSystemPrompt] = useState("");
  const [activeKnowledgeBaseScope, setActiveKnowledgeBaseScope] = useState("");
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingThreadHistory, setIsLoadingThreadHistory] = useState(false);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [isLoadingKnowledgeScopes, setIsLoadingKnowledgeScopes] = useState(false);
  const [isLoadingTopics, setIsLoadingTopics] = useState(false);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isLoadingTemplateSkills, setIsLoadingTemplateSkills] = useState(false);
  const [isMutatingDrafts, setIsMutatingDrafts] = useState(false);
  const [isMutatingKnowledgeScopes, setIsMutatingKnowledgeScopes] = useState(false);
  const [isMutatingTopics, setIsMutatingTopics] = useState(false);
  const [isMutatingTemplates, setIsMutatingTemplates] = useState(false);
  const [mutatingDraftMessageId, setMutatingDraftMessageId] = useState<string | null>(null);
  const [mutatingKnowledgeScope, setMutatingKnowledgeScope] = useState<string | null>(null);
  const [mutatingTopicId, setMutatingTopicId] = useState<string | null>(null);
  const [mutatingTemplateId, setMutatingTemplateId] = useState<string | null>(null);
  const [mutatingThreadId, setMutatingThreadId] = useState<string | null>(null);
  const [isNewThreadModalOpen, setIsNewThreadModalOpen] = useState(false);
  const [draftThreadTitle, setDraftThreadTitle] = useState("");
  const [draftSystemPrompt, setDraftSystemPrompt] = useState("");
  const [draftKnowledgeBaseScope, setDraftKnowledgeBaseScope] = useState("");
  const [draftTargetThreadId, setDraftTargetThreadId] = useState<string | null>(null);
  const [draftSourceTopicId, setDraftSourceTopicId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateSummaryItem | null>(null);
  const [templateCreationRequest, setTemplateCreationRequest] =
    useState<TemplateCreationRequest | null>(null);
  const [isThreadSettingsOpen, setIsThreadSettingsOpen] = useState(false);
  const [isSavingThreadSettings, setIsSavingThreadSettings] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isWorkspaceHeaderExpanded, setIsWorkspaceHeaderExpanded] = useState(true);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [authSessions, setAuthSessions] = useState<AuthSessionItem[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  useEffect(() => {
    const normalizedModelOverride = modelOverride.trim();
    if (!normalizedModelOverride) {
      window.localStorage.removeItem(MODEL_OVERRIDE_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_QWEN_MODEL_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(MODEL_OVERRIDE_STORAGE_KEY, normalizedModelOverride);
    window.localStorage.removeItem(LEGACY_QWEN_MODEL_STORAGE_KEY);
  }, [modelOverride]);

  const abortRef = useRef<AbortController | null>(null);
  const stopRequestedRef = useRef(false);
  const assistantMessageIdRef = useRef<string | null>(null);
  const streamErrorRef = useRef(false);
  const hasInitializedHistoryRef = useRef(false);
  const uploadedMaterialsRef = useRef<UploadedMaterial[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  const isAuthenticated = Boolean(
    currentUser && (getStoredToken() || getStoredRefreshToken()),
  );
  const currentDisplayName = useMemo(() => getDisplayName(currentUser), [currentUser]);
  const openXiaohongshuCreatorCenter = () => {
    window.open(XIAOHONGSHU_CREATOR_URL, "_blank", "noopener,noreferrer");
  };

  const handleAuthModeChange = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthError("");
    setAuthSuccess("");
    if (mode !== "reset-password") {
      setAuthResetToken("");
      setAuthConfirmPassword("");
    }
    if (mode === "login" || mode === "register" || mode === "forgot-password") {
      setAuthPassword("");
    }
  };

  useEffect(() => {
    if (currentUser === null && (getStoredToken() || getStoredRefreshToken())) {
      clearStoredToken();
      clearStoredRefreshToken();
      clearStoredUser();
    }
  }, [currentUser]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1280) {
        setRightPanelOpen(true);
      }
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    // 中文注释：接收 bridge.js 从扩展回传的发布结果，并同步到工作台状态与全局提示。
    const handlePublisherMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== "object") {
        return;
      }

      const publishEvent = data as {
        source?: string;
        action?: string;
        payload?: PublishResultPayload;
      };

      if (
        publishEvent.source !== "omnimedia-publisher" ||
        publishEvent.action !== "PUBLISH_RESULT" ||
        !publishEvent.payload
      ) {
        return;
      }

      const status =
        typeof publishEvent.payload.status === "string" ? publishEvent.payload.status : "";
      const messageText =
        typeof publishEvent.payload.message === "string" && publishEvent.payload.message.trim()
          ? publishEvent.payload.message.trim()
          : "";
      const errorCode =
        typeof publishEvent.payload.error === "string" ? publishEvent.payload.error : undefined;

      if (status === "queued") {
        setStatusText(messageText || "已打开小红书发布页，发布辅助面板会自动弹出，请手动复制粘贴。");
        return;
      }

      if (status === "success") {
        const successMessage = "小红书发布辅助面板已打开，请手动复制粘贴。";
        setStatusText(messageText || successMessage);
        setPublishToast({
          id: Date.now(),
          tone: "success",
          title: "发布辅助已就绪",
          message: successMessage,
        });
        return;
      }

      if (status === "error") {
        const errorMessage =
          errorCode === "NEED_LOGIN"
            ? "请先登录小红书创作者中心"
            : messageText || "小红书发布流程出现异常，请稍后重试。";
        setStatusText(errorMessage);
        setPublishToast({
          id: Date.now(),
          tone: "error",
          title: errorCode === "NEED_LOGIN" ? "需要登录" : "发布失败",
          message: errorMessage,
          error: errorCode,
        });
      }
    };

    window.addEventListener("message", handlePublisherMessage);
    return () => window.removeEventListener("message", handlePublisherMessage);
  }, []);

  useEffect(() => {
    if (!publishToast || publishToast.error === "NEED_LOGIN") {
      return;
    }

    const timeoutMs = publishToast.tone === "success" ? 4000 : 6000;
    const timerId = window.setTimeout(() => {
      setPublishToast((current) => (current?.id === publishToast.id ? null : current));
    }, timeoutMs);

    return () => window.clearTimeout(timerId);
  }, [publishToast]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, isLoadingThreadHistory, toolCallTimeline]);

  useEffect(() => {
    uploadedMaterialsRef.current = uploadedMaterials;
  }, [uploadedMaterials]);

  useEffect(() => {
    return () => {
      uploadedMaterialsRef.current.forEach((item) => revokeBlobPreview(item.previewUrl));
    };
  }, []);

  const activeTaskLabel = useMemo(
    () => taskOptions.find((item) => item.id === taskType)?.label ?? "内容生成",
    [taskType],
  );

  const workspaceTitle = useMemo(() => {
    if (platform === "xiaohongshu") {
      return "小红书内容工作台";
    }
    if (platform === "douyin") {
      return "抖音内容工作台";
    }
    return "双平台内容工作台";
  }, [platform]);

  const nonChatViewMeta: Record<
    Exclude<WorkspaceView, "chat">,
    { title: string; description: string }
  > = {
    drafts: {
      title: "我的草稿",
      description: "浏览各个会话里沉淀下来的结构化内容产物，并继续回到原始对话深挖。",
    },
    knowledge: {
      title: "知识库",
      description: "按 Scope 管理私有品牌资料、参数手册与内部知识切片，为模板和会话提供可检索的外挂上下文。",
    },
    topics: {
      title: "选题池",
      description: "用轻量级看板管理灵感、撰写进度与已发布选题，并一键带回聊天区开写。",
    },
    templates: {
      title: "模板库",
      description: "集中管理官方预置与个人沉淀的人设模板，并一键带入新的会话。",
    },
    dashboard: {
      title: "数据看板",
      description: "后续会在这里汇总生成量、平台分布、转化表现与消耗趋势。",
    },
  };

  const isUploading = useMemo(
    () => uploadedMaterials.some((item) => item.status === "uploading"),
    [uploadedMaterials],
  );

  const isDraftThread = activeThreadId === "thread-new";

  const appendSystemMessage = (messagePatch: ConversationMessageDraft) => {
    setMessages((current) => [...current, createConversationMessage(messagePatch)]);
  };

  const pushToolCallTrace = (event: Extract<ChatStreamEvent, { event: "tool_call" }>) => {
    const nowIso = new Date().toISOString();
    const nextMessage =
      event.message?.trim() || getToolCallFallbackMessage(event.name, event.status);

    setToolCallTimeline((current) => {
      const lastStep = current.at(-1);
      if (
        lastStep &&
        lastStep.name === event.name &&
        isToolCallProcessingStatus(lastStep.status)
      ) {
        const updated = [...current];
        updated[updated.length - 1] = {
          ...lastStep,
          status: event.status,
          message: nextMessage,
          updatedAt: nowIso,
        };
        return updated;
      }

      return [
        ...current,
        {
          id: createId("thinking-step"),
          name: event.name,
          status: event.status,
          message: nextMessage,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ];
    });
  };

  const upsertThreadInList = (nextThread: ThreadItem) => {
    setThreads((current) => {
      const normalizedCurrent =
        nextThread.id === "thread-new"
          ? current
          : current.filter((thread) => thread.id !== "thread-new");
      const existingIndex = normalizedCurrent.findIndex(
        (thread) => thread.id === nextThread.id,
      );
      if (existingIndex === -1) {
        return [nextThread, ...normalizedCurrent].slice(0, 20);
      }

      const cloned = [...normalizedCurrent];
      cloned[existingIndex] = { ...cloned[existingIndex], ...nextThread };
      return cloned;
    });
  };

  const replaceUploadedMaterials = (nextMaterials: UploadedMaterial[]) => {
    setUploadedMaterials((current) => {
      current.forEach((item) => revokeBlobPreview(item.previewUrl));
      return nextMaterials;
    });
  };

  const resetWorkspace = (
    nextTitle = "New thread",
    nextSystemPrompt = "",
    nextKnowledgeBaseScope = "",
    nextThreadId = "thread-new",
    nextTopicId: string | null = null,
  ) => {
    setMessages([]);
    setArtifact(null);
    setToolCallTimeline([]);
    replaceUploadedMaterials([]);
    setMessage("");
    setActiveThreadId(nextThreadId);
    setActiveThreadTitle(nextTitle);
    setActiveSystemPrompt(nextSystemPrompt);
    setActiveKnowledgeBaseScope(nextKnowledgeBaseScope);
    setActiveTopicId(nextTopicId);
  };

  const handleUnauthorized = (
    fallbackMessage = "当前登录状态已失效，请重新登录。",
  ) => {
    abortRef.current?.abort();
    clearStoredToken();
    clearStoredRefreshToken();
    clearStoredUser();
    setCurrentUser(null);
    setActiveView("chat");
    setAuthSessions([]);
    setDrafts([]);
    setKnowledgeScopes([]);
    setTopics([]);
    setTemplates([]);
    setTemplateSkills([]);
    setIsLoadingDrafts(false);
    setIsLoadingKnowledgeScopes(false);
    setIsLoadingTopics(false);
    setIsLoadingTemplates(false);
    setIsLoadingTemplateSkills(false);
    setIsMutatingDrafts(false);
    setIsMutatingKnowledgeScopes(false);
    setIsMutatingTopics(false);
    setIsMutatingTemplates(false);
    setMutatingDraftMessageId(null);
    setMutatingKnowledgeScope(null);
    setMutatingTopicId(null);
    setMutatingTemplateId(null);
    setThreads([]);
    setMessages([]);
    setToolCallTimeline([]);
    replaceUploadedMaterials([]);
    setArtifact(null);
    setStatusText("请重新登录");
    setAuthMode("login");
    setAuthError(fallbackMessage);
    setAuthSuccess("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthResetToken("");
    setSelectedTemplate(null);
    setTemplateCreationRequest(null);
    setDraftTargetThreadId(null);
    setDraftSourceTopicId(null);
    setActiveTopicId(null);
    setIsProfileModalOpen(false);
    setIsThreadSettingsOpen(false);
    setRevokingSessionId(null);
    hasInitializedHistoryRef.current = false;
  };

  const updateAssistantMessage = (contentPatch: string) => {
    const assistantId = assistantMessageIdRef.current;
    if (!assistantId) {
      return;
    }

    setMessages((current) =>
      current.map((item) =>
        item.id === assistantId ? { ...item, content: `${item.content}${contentPatch}` } : item,
      ),
    );
  };

  const updateAssistantTimestamp = (createdAt: string) => {
    const assistantId = assistantMessageIdRef.current;
    if (!assistantId) {
      return;
    }

    setMessages((current) =>
      current.map((item) =>
        item.id === assistantId ? { ...item, createdAt } : item,
      ),
    );
  };

  const removeAssistantPlaceholderIfEmpty = () => {
    const assistantId = assistantMessageIdRef.current;
    if (!assistantId) {
      return;
    }

    setMessages((current) => {
      const target = current.find((item) => item.id === assistantId);
      if (!target || target.role !== "assistant" || target.content.trim().length > 0) {
        return current;
      }
      return current.filter((item) => item.id !== assistantId);
    });
  };

  const attachArtifactToLatestAssistantMessage = (nextArtifact: ArtifactPayload) => {
    const assistantId = assistantMessageIdRef.current;

    setMessages((current) => {
      if (current.length === 0) {
        return current;
      }

      if (assistantId) {
        return current.map((item) =>
          item.id === assistantId ? { ...item, artifact: nextArtifact } : item,
        );
      }

      const latestAssistantIndex = [...current]
        .map((item, index) => ({ item, index }))
        .reverse()
        .find(({ item }) => item.role === "assistant")?.index;

      if (latestAssistantIndex === undefined) {
        return current;
      }

      return current.map((item, index) =>
        index === latestAssistantIndex ? { ...item, artifact: nextArtifact } : item,
      );
    });
  };

  const getFriendlyStreamErrorMessage = (
    event: Extract<ChatStreamEvent, { event: "error" }>,
  ): string => {
    const code = event.code.trim().toUpperCase();
    if (
      code === "QWEN_ARTIFACT_VALIDATION_ERROR" ||
      code === "QWEN_JSON_DECODE_ERROR" ||
      code === "COMPATIBLE_ARTIFACT_VALIDATION_ERROR" ||
      code === "COMPATIBLE_JSON_DECODE_ERROR" ||
      code === "OPENAI_ARTIFACT_VALIDATION_ERROR" ||
      code === "OPENAI_JSON_DECODE_ERROR"
    ) {
      return "模型结构化结果生成失败，请尝试切换更高级模型（如 Qwen-Max）后重试。";
    }

    return event.message.trim() || "模型调用异常，请检查配置后重试。";
  };

  const updateUploadedMaterial = (materialId: string, patch: Partial<UploadedMaterial>) => {
    setUploadedMaterials((current) =>
      current.map((item) => {
        if (item.id !== materialId) {
          return item;
        }

        if (
          item.previewUrl?.startsWith("blob:") &&
          patch.previewUrl &&
          patch.previewUrl !== item.previewUrl
        ) {
          URL.revokeObjectURL(item.previewUrl);
        }

        return { ...item, ...patch };
      }),
    );
  };

  const loadThreadHistory = async (
    thread: ThreadItem,
    topicId: string | null = null,
    options?: { silentNotFound?: boolean },
  ): Promise<"loaded" | "not_found" | "failed"> => {
    abortRef.current?.abort();
    setIsStreaming(false);
    assistantMessageIdRef.current = null;
    streamErrorRef.current = false;

    setActiveView("chat");
    setActiveThreadId(thread.id);
    setActiveThreadTitle(thread.title);
    setActiveTopicId(topicId);
    setToolCallTimeline([]);
    setStatusText("正在加载历史会话");
    setIsLoadingThreadHistory(true);
    setRightPanelOpen(true);
    setLeftSidebarOpen(false);

    try {
      const payload = await fetchThreadMessages(thread.id);
      const { chatMessages, latestArtifact } = toConversationMessages(payload.messages);

      setMessages(chatMessages);
      setArtifact(latestArtifact);
      replaceUploadedMaterials([]);
      setActiveThreadTitle(payload.title || thread.title);
      setActiveSystemPrompt(payload.system_prompt || "");
      setActiveKnowledgeBaseScope(payload.knowledge_base_scope || "");
      setStatusText("历史会话已载入");
      return "loaded";
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return "failed";
      }

      if (
        options?.silentNotFound &&
        error instanceof APIError &&
        error.status === 404
      ) {
        return "not_found";
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "加载历史会话失败，请稍后重试。";

      setStatusText("历史会话加载失败");
      appendSystemMessage({
        id: createId("history-error"),
        role: "error",
        title: "历史加载失败",
        content: errorMessage,
      });
      return "failed";
    } finally {
      setIsLoadingThreadHistory(false);
    }
  };

  const loadThreads = async (
    preferredThreadId?: string,
    shouldLoadHistory = false,
    preferredTopicId: string | null = null,
  ) => {
    setIsLoadingThreads(true);

    try {
      const payload = await fetchThreads();
      const nextThreads = payload.items.map(toThreadItemFromSummary);
      setThreads(nextThreads);

      if (nextThreads.length === 0) {
        if (activeThreadId !== "thread-new") {
          resetWorkspace();
        }
        setStatusText("暂无历史会话");
        return;
      }

      if (!shouldLoadHistory) {
        return;
      }

      const targetThread =
        nextThreads.find((item) => item.id === preferredThreadId) ??
        nextThreads.find((item) => item.id === activeThreadId) ??
        nextThreads[0];

      if (targetThread) {
        await loadThreadHistory(targetThread, preferredTopicId);
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "加载会话列表失败，请稍后重试。";

      setStatusText("会话列表加载失败");
      appendSystemMessage({
        id: createId("thread-list-error"),
        role: "error",
        title: "会话列表加载失败",
        content: errorMessage,
      });
    } finally {
      setIsLoadingThreads(false);
    }
  };

  const loadDrafts = async () => {
    setIsLoadingDrafts(true);

    try {
      const payload = await fetchArtifacts();
      setDrafts(payload.items);
      setStatusText(payload.total > 0 ? `已载入 ${payload.total} 份草稿` : "暂无草稿内容");
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "加载草稿箱失败，请稍后重试。";

      setStatusText("草稿箱加载失败");
      appendSystemMessage({
        id: createId("draft-list-error"),
        role: "error",
        title: "草稿箱加载失败",
        content: errorMessage,
      });
    } finally {
      setIsLoadingDrafts(false);
    }
  };

  const loadDashboardSummary = async () => {
    setIsLoadingDashboard(true);

    try {
      const payload = await fetchDashboardSummary();
      setDashboardSummary(payload);
      setStatusText("数据看板已更新");
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "加载数据看板失败，请稍后重试。";

      setStatusText("数据看板加载失败");
      appendSystemMessage({
        id: createId("dashboard-summary-error"),
        role: "error",
        title: "数据看板加载失败",
        content: errorMessage,
      });
    } finally {
      setIsLoadingDashboard(false);
    }
  };

  const loadKnowledgeScopes = async (): Promise<KnowledgeScopeItem[]> => {
    setIsLoadingKnowledgeScopes(true);

    try {
      const payload = await fetchKnowledgeScopes();
      setKnowledgeScopes(payload.items);
      setStatusText(
        payload.total > 0 ? `已载入 ${payload.total} 个知识库 Scope` : "知识库还是空的",
      );
      return payload.items;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return [];
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "加载知识库失败，请稍后重试。";

      setStatusText("知识库加载失败");
      appendSystemMessage({
        id: createId("knowledge-list-error"),
        role: "error",
        title: "知识库加载失败",
        content: errorMessage,
      });
      return [];
    } finally {
      setIsLoadingKnowledgeScopes(false);
    }
  };

  const loadTopics = async (status?: TopicStatus) => {
    setIsLoadingTopics(true);

    try {
      const payload = await fetchTopics(status);
      setTopics(payload.items);
      setStatusText(payload.total > 0 ? `已载入 ${payload.total} 个选题` : "选题池还是空的");
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "加载选题池失败，请稍后重试。";

      setStatusText("选题池加载失败");
      appendSystemMessage({
        id: createId("topic-list-error"),
        role: "error",
        title: "选题池加载失败",
        content: errorMessage,
      });
    } finally {
      setIsLoadingTopics(false);
    }
  };

  const loadTemplates = async () => {
    setIsLoadingTemplates(true);

    try {
      const payload = await fetchTemplates();
      setTemplates(payload.items);
      setStatusText(
        payload.total > 0 ? `已载入 ${payload.total} 个模板` : "暂无可用模板",
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "加载模板库失败，请稍后重试。";

      setStatusText("模板库加载失败");
      appendSystemMessage({
        id: createId("template-list-error"),
        role: "error",
        title: "模板库加载失败",
        content: errorMessage,
      });
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const handleSearchTemplateSkills = async (
    keyword: string,
    category?: TemplateCategory,
  ) => {
    setTemplateSkills([]);
    setIsLoadingTemplateSkills(true);
    setStatusText("正在全网检索并提炼 Skills 灵感…");

    try {
      const payload = await fetchTemplateSkills({ q: keyword, ...(category ? { category } : {}) });
      const discoveredSkills = (payload.templates ?? payload.items ?? []).map(
        (skill, index) => ({
          ...skill,
          id: skill.id?.trim() ? skill.id : `cloud-${Date.now()}-${index}`,
          isCloud: true,
        }),
      );
      console.log("解包处理后的云端数组:", discoveredSkills);
      console.log("Skills 最终写入界面的数组:", discoveredSkills);
      setTemplateSkills(discoveredSkills);
      setStatusText(
        payload.total > 0
          ? `已发现 ${payload.total} 条 Skills 灵感`
          : "暂未发现匹配的 Skills 灵感",
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "搜索 Skills 灵感失败，请稍后重试。";

      setStatusText("Skills 灵感搜索失败");
      appendSystemMessage({
        id: createId("template-skills-search-error"),
        role: "error",
        title: "Skills 灵感搜索失败",
        content: errorMessage,
      });
    } finally {
      setIsLoadingTemplateSkills(false);
    }
  };

  const handleUploadKnowledgeFiles = async (
    scope: string,
    files: File[],
  ): Promise<{ ok: boolean; errorMessage?: string }> => {
    if (files.length === 0) {
      return { ok: true };
    }

    const normalizedScope = scope.trim();
    setIsMutatingKnowledgeScopes(true);
    setMutatingKnowledgeScope(normalizedScope || "knowledge-upload");

    try {
      let totalChunks = 0;
      let lastScope = normalizedScope;
      for (const file of files) {
        const response = await uploadKnowledgeDocument(file, normalizedScope || undefined);
        totalChunks += response.chunk_count;
        lastScope = response.scope;
      }
      await loadKnowledgeScopes();
      setStatusText(
        `知识库已更新：${lastScope || "自动 Scope"} 累计写入 ${totalChunks} 个知识切片`,
      );
      return { ok: true };
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return {
          ok: false,
          errorMessage:
            error instanceof APIError ? error.message : "当前登录状态已失效，请重新登录。",
        };
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "上传知识文件失败，请稍后重试。";

      setStatusText("知识文件上传失败");
      appendSystemMessage({
        id: createId("knowledge-upload-error"),
        role: "error",
        title: "知识文件上传失败",
        content: errorMessage,
      });
      return {
        ok: false,
        errorMessage,
      };
    } finally {
      setIsMutatingKnowledgeScopes(false);
      setMutatingKnowledgeScope(null);
    }
  };

  const handleDeleteKnowledgeScope = async (scope: string): Promise<boolean> => {
    setIsMutatingKnowledgeScopes(true);
    setMutatingKnowledgeScope(scope);

    try {
      const response = await deleteKnowledgeScope(scope);
      setKnowledgeScopes((current) => current.filter((item) => item.scope !== response.scope));
      setStatusText(
        response.deleted
          ? `已清空知识库 Scope：${response.scope}`
          : `Scope ${response.scope} 当前没有可删除的知识切片`,
      );
      return response.deleted;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return false;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "删除知识库 Scope 失败，请稍后重试。";

      setStatusText("删除知识库 Scope 失败");
      appendSystemMessage({
        id: createId("knowledge-delete-error"),
        role: "error",
        title: "删除知识库 Scope 失败",
        content: errorMessage,
      });
      return false;
    } finally {
      setIsMutatingKnowledgeScopes(false);
      setMutatingKnowledgeScope(null);
    }
  };

  const handleRenameKnowledgeScope = async (
    scope: string,
    nextScopeName: string,
  ): Promise<string | null> => {
    setIsMutatingKnowledgeScopes(true);
    setMutatingKnowledgeScope(scope);

    try {
      const response = await renameKnowledgeScope(scope, {
        new_name: nextScopeName,
      });
      await loadKnowledgeScopes();
      setActiveKnowledgeBaseScope((current) =>
        current.trim() === response.previous_scope ? response.scope : current,
      );
      setDraftKnowledgeBaseScope((current) =>
        current.trim() === response.previous_scope ? response.scope : current,
      );
      setStatusText(
        response.renamed
          ? `知识库 Scope 已重命名：${response.previous_scope} -> ${response.scope}`
          : `Scope 名称未变化：${response.scope}`,
      );
      return response.scope;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return null;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "重命名知识库 Scope 失败，请稍后重试。";

      setStatusText("知识库 Scope 重命名失败");
      appendSystemMessage({
        id: createId("knowledge-rename-error"),
        role: "error",
        title: "知识库 Scope 重命名失败",
        content: errorMessage,
      });
      return null;
    } finally {
      setIsMutatingKnowledgeScopes(false);
      setMutatingKnowledgeScope(null);
    }
  };

  const handleLoadKnowledgeScopeSources = async (
    scope: string,
  ): Promise<KnowledgeScopeSourceItem[] | null> => {
    try {
      const response = await fetchKnowledgeScopeSources(scope);
      return response.items;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return null;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "加载知识库文件明细失败，请稍后重试。";

      setStatusText("知识库文件明细加载失败");
      appendSystemMessage({
        id: createId("knowledge-sources-error"),
        role: "error",
        title: "知识库文件明细加载失败",
        content: errorMessage,
      });
      return null;
    }
  };

  const handlePreviewKnowledgeSource = async (
    scope: string,
    source: string,
  ): Promise<KnowledgeSourcePreviewApiResponse | null> => {
    try {
      return await previewKnowledgeSource(scope, source);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return null;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "加载知识库文件预览失败，请稍后重试。";

      setStatusText("知识库文件预览加载失败");
      appendSystemMessage({
        id: createId("knowledge-preview-error"),
        role: "error",
        title: "知识库文件预览失败",
        content: errorMessage,
      });
      return null;
    }
  };

  const handleDeleteKnowledgeSource = async (
    scope: string,
    source: string,
  ): Promise<boolean> => {
    setIsMutatingKnowledgeScopes(true);
    setMutatingKnowledgeScope(scope);

    try {
      const response = await deleteKnowledgeSource(scope, source);
      await loadKnowledgeScopes();
      setStatusText(
        response.deleted
          ? `已从 ${response.scope} 移除文件：${response.source}`
          : `文件 ${response.source} 当前没有可删除的知识切片`,
      );
      return response.deleted;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return false;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "删除知识库文件失败，请稍后重试。";

      setStatusText("知识库文件删除失败");
      appendSystemMessage({
        id: createId("knowledge-source-delete-error"),
        role: "error",
        title: "知识库文件删除失败",
        content: errorMessage,
      });
      return false;
    } finally {
      setIsMutatingKnowledgeScopes(false);
      setMutatingKnowledgeScope(null);
    }
  };

  const upsertTopicInState = (nextTopic: TopicItem) => {
    setTopics((current) => {
      const existingIndex = current.findIndex((topic) => topic.id === nextTopic.id);
      if (existingIndex === -1) {
        return [nextTopic, ...current].sort((left, right) =>
          right.updated_at.localeCompare(left.updated_at),
        );
      }

      const cloned = [...current];
      cloned[existingIndex] = nextTopic;
      return cloned.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    });
  };

  const removeTopicFromState = (topicId: string) => {
    setTopics((current) => current.filter((topic) => topic.id !== topicId));
  };

  const handleCreateTopic = async (
    payload: TopicCreatePayload,
  ): Promise<TopicItem | null> => {
    setIsMutatingTopics(true);
    setMutatingTopicId("topic-create");

    try {
      const createdTopic = await createTopic(payload);
      upsertTopicInState(createdTopic);
      setStatusText(`已记录新灵感：${createdTopic.title}`);
      return createdTopic;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return null;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "创建选题失败，请稍后重试。";

      setStatusText("选题创建失败");
      appendSystemMessage({
        id: createId("topic-create-error"),
        role: "error",
        title: "选题创建失败",
        content: errorMessage,
      });
      return null;
    } finally {
      setIsMutatingTopics(false);
      setMutatingTopicId(null);
    }
  };

  const handleUpdateTopic = async (
    topic: TopicItem,
    payload: TopicUpdatePayload,
  ): Promise<TopicItem | null> => {
    setIsMutatingTopics(true);
    setMutatingTopicId(topic.id);

    try {
      const updatedTopic = await updateTopic(topic.id, payload);
      upsertTopicInState(updatedTopic);
      setStatusText(`选题已更新：${updatedTopic.title}`);
      return updatedTopic;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return null;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "更新选题失败，请稍后重试。";

      setStatusText("选题更新失败");
      appendSystemMessage({
        id: createId("topic-update-error"),
        role: "error",
        title: "选题更新失败",
        content: errorMessage,
      });
      return null;
    } finally {
      setIsMutatingTopics(false);
      setMutatingTopicId(null);
    }
  };

  const handleDeleteTopic = async (
    topic: TopicItem,
    options?: { silentNotFound?: boolean },
  ): Promise<boolean> => {
    setIsMutatingTopics(true);
    setMutatingTopicId(topic.id);

    try {
      const response = await deleteTopic(topic.id);
      if (response.deleted) {
        removeTopicFromState(topic.id);
        setStatusText(`已删除选题：${topic.title}`);
      }
      return response.deleted;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return false;
      }

      if (
        options?.silentNotFound &&
        error instanceof APIError &&
        error.status === 404
      ) {
        return false;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "删除选题失败，请稍后重试。";

      setStatusText("选题删除失败");
      appendSystemMessage({
        id: createId("topic-delete-error"),
        role: "error",
        title: "选题删除失败",
        content: errorMessage,
      });
      return false;
    } finally {
      setIsMutatingTopics(false);
      setMutatingTopicId(null);
    }
  };

  const removeTemplatesFromState = (deletedIds: string[]) => {
    if (deletedIds.length === 0) {
      return;
    }

    const deletedIdSet = new Set(deletedIds);
    setTemplates((current) => current.filter((template) => !deletedIdSet.has(template.id)));
    setSelectedTemplate((current) =>
      current && deletedIdSet.has(current.id) ? null : current,
    );
  };

  const handleCreateTemplate = async (
    payload: TemplateCreatePayload,
  ): Promise<TemplateSummaryItem | null> => {
    setIsMutatingTemplates(true);
    setMutatingTemplateId("template-create");

    try {
      const createdTemplate = await createTemplate(payload);
      setTemplates((current) => {
        const presets = current.filter((template) => template.is_preset);
        const customs = current.filter((template) => !template.is_preset);
        return [createdTemplate, ...customs, ...presets].sort((left, right) => {
          if (left.is_preset !== right.is_preset) {
            return left.is_preset ? -1 : 1;
          }
          return right.created_at.localeCompare(left.created_at);
        });
      });
      setStatusText(`模板已创建：${createdTemplate.title}`);
      return createdTemplate;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return null;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "创建模板失败，请稍后重试。";

      setStatusText("模板创建失败");
      appendSystemMessage({
        id: createId("template-create-error"),
        role: "error",
        title: "模板创建失败",
        content: errorMessage,
      });
      return null;
    } finally {
      setIsMutatingTemplates(false);
      setMutatingTemplateId(null);
    }
  };

  const handleDeleteTemplate = async (
    template: TemplateSummaryItem,
  ): Promise<boolean> => {
    setIsMutatingTemplates(true);
    setMutatingTemplateId(template.id);

    try {
      const response = await deleteTemplate(template.id);
      removeTemplatesFromState(response.deleted_ids);
      setStatusText(`模板已删除：${template.title}`);
      return true;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return false;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "删除模板失败，请稍后重试。";

      setStatusText("模板删除失败");
      appendSystemMessage({
        id: createId("template-delete-error"),
        role: "error",
        title: "模板删除失败",
        content: errorMessage,
      });
      return false;
    } finally {
      setIsMutatingTemplates(false);
      setMutatingTemplateId(null);
    }
  };

  const handleDeleteTemplates = async (templateIds: string[]): Promise<boolean> => {
    if (templateIds.length === 0) {
      return false;
    }

    setIsMutatingTemplates(true);
    setMutatingTemplateId("template-bulk");

    try {
      const response = await deleteTemplates({ template_ids: templateIds });
      removeTemplatesFromState(response.deleted_ids);
      setStatusText(`已删除 ${response.deleted_count} 个模板`);
      return true;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return false;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "批量删除模板失败，请稍后重试。";

      setStatusText("批量删除模板失败");
      appendSystemMessage({
        id: createId("template-bulk-delete-error"),
        role: "error",
        title: "批量删除模板失败",
        content: errorMessage,
      });
      return false;
    } finally {
      setIsMutatingTemplates(false);
      setMutatingTemplateId(null);
    }
  };

  const handleSelectView = (view: WorkspaceView) => {
    setActiveView(view);
    setLeftSidebarOpen(false);

    if (view === "chat") {
      setRightPanelOpen(true);
      return;
    }

    setRightPanelOpen(false);
    if (view === "drafts") {
      setStatusText("正在打开草稿箱");
      return;
    }

    if (view === "knowledge") {
      setStatusText("正在打开知识库");
      return;
    }

    if (view === "topics") {
      setStatusText("正在打开选题池");
      return;
    }

    if (view === "templates") {
      setStatusText("正在打开模板中心");
      return;
    }

    if (view === "dashboard") {
      setStatusText("正在打开数据看板");
      return;
    }

    setStatusText("该模块即将开放");
  };

  const handleOpenDraftThread = async (draft: DraftSummaryItem) => {
    const threadPlatform =
      draft.platform === "xiaohongshu" || draft.platform === "douyin"
        ? draft.platform
        : undefined;

    const fallbackThread: ThreadItem = {
      id: draft.thread_id,
      title: draft.thread_title || draft.title || "Untitled thread",
      time: formatRelativeTime(draft.created_at) || "刚刚",
      ...(threadPlatform ? { platform: threadPlatform } : {}),
    };

    upsertThreadInList(fallbackThread);
    await loadThreadHistory(fallbackThread);
  };

  const removeDraftsFromState = (deletedMessageIds: string[]) => {
    if (deletedMessageIds.length === 0) {
      return;
    }

    const deletedIds = new Set(deletedMessageIds);
    setDrafts((current) =>
      current.filter((draft) => !deletedIds.has(draft.message_id)),
    );
  };

  const handleDeleteDraft = async (draft: DraftSummaryItem) => {
    setIsMutatingDrafts(true);
    setMutatingDraftMessageId(draft.message_id);

    try {
      const response = await deleteArtifact(draft.message_id);
      removeDraftsFromState(response.deleted_message_ids);
      setStatusText(`已删除草稿：${draft.title || "未命名草稿"}`);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "删除草稿失败，请稍后重试。";

      setStatusText("删除草稿失败");
      appendSystemMessage({
        id: createId("draft-delete-error"),
        role: "error",
        title: "草稿删除失败",
        content: errorMessage,
      });
    } finally {
      setIsMutatingDrafts(false);
      setMutatingDraftMessageId(null);
    }
  };

  const handleDeleteDrafts = async (messageIds: string[]) => {
    if (messageIds.length === 0) {
      return;
    }

    setIsMutatingDrafts(true);
    setMutatingDraftMessageId(null);

    try {
      const response = await deleteArtifacts({ message_ids: messageIds });
      removeDraftsFromState(response.deleted_message_ids);
      setStatusText(`已删除 ${response.deleted_count} 份草稿`);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "批量删除草稿失败，请稍后重试。";

      setStatusText("批量删除草稿失败");
      appendSystemMessage({
        id: createId("draft-bulk-delete-error"),
        role: "error",
        title: "批量删除草稿失败",
        content: errorMessage,
      });
    } finally {
      setIsMutatingDrafts(false);
      setMutatingDraftMessageId(null);
    }
  };

  const handleClearAllDrafts = async () => {
    if (drafts.length === 0) {
      return;
    }

    setIsMutatingDrafts(true);
    setMutatingDraftMessageId(null);

    try {
      const response = await deleteArtifacts({ clear_all: true });
      removeDraftsFromState(response.deleted_message_ids);
      setStatusText(
        response.deleted_count > 0 ? "草稿箱已清空" : "当前没有可清空的草稿",
      );
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "清空草稿箱失败，请稍后重试。";

      setStatusText("清空草稿箱失败");
      appendSystemMessage({
        id: createId("draft-clear-error"),
        role: "error",
        title: "清空草稿箱失败",
        content: errorMessage,
      });
    } finally {
      setIsMutatingDrafts(false);
      setMutatingDraftMessageId(null);
    }
  };

  useEffect(() => {
    if (!isAuthenticated || hasInitializedHistoryRef.current) {
      return;
    }

    hasInitializedHistoryRef.current = true;
    void loadThreads(undefined, true);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || activeView !== "drafts") {
      return;
    }

    void loadDrafts();
  }, [activeView, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || activeView !== "dashboard") {
      return;
    }

    void loadDashboardSummary();
  }, [activeView, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || activeView !== "knowledge") {
      return;
    }

    void loadKnowledgeScopes();
  }, [activeView, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || activeView !== "topics") {
      return;
    }

    void loadTopics();
  }, [activeView, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || activeView !== "templates") {
      return;
    }

    void loadTemplates();
  }, [activeView, isAuthenticated]);

  const triggerFilePicker = (kind: UploadedMaterialKind) => {
    if (kind === "image") {
      imageInputRef.current?.click();
      return;
    }
    if (kind === "video") {
      videoInputRef.current?.click();
      return;
    }
    if (kind === "audio") {
      audioInputRef.current?.click();
      return;
    }
    textInputRef.current?.click();
  };

  const uploadSelectedFile = async (
    materialId: string,
    file: File,
    kind: UploadedMaterialKind,
  ) => {
    try {
      setStatusText(
        file.size >= 8 * 1024 * 1024
          ? `正在上传大文件素材：${file.name}，这可能需要 10-120 秒，请耐心等待`
          : `正在上传素材：${file.name}`,
      );
      const uploadThreadId =
        activeThreadId !== "thread-new" ? activeThreadId : undefined;
      const payload = await uploadMedia(file, "material", uploadThreadId);
      updateUploadedMaterial(materialId, {
        status: "ready",
        sourceUrl: payload.url,
        fileType: payload.file_type,
        previewUrl: kind === "image" ? payload.url : undefined,
      });
      setStatusText(`素材上传完成：${file.name}`);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.code === "REQUEST_TIMEOUT"
            ? "上传等待时间过长，请检查网络带宽或稍后重试；10MB 左右的视频在 OSS 模式下可能需要更久。"
            : error.message
          : error instanceof Error
            ? error.message
            : "上传失败，请稍后重试。";

      updateUploadedMaterial(materialId, {
        status: "error",
        errorMessage,
      });
      appendSystemMessage({
        id: createId("upload-error"),
        role: "error",
        title: "素材上传失败",
        content: `${file.name}: ${errorMessage}`,
      });
    }
  };

  const onFilesSelected = (kind: UploadedMaterialKind, event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const nextMaterials = files.map((file) => ({
      id: createId("material"),
      name: file.name,
      kind,
      sizeLabel: formatFileSize(file.size),
      status: "uploading" as const,
      previewUrl:
        kind === "image" && file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : undefined,
    }));

    setUploadedMaterials((current) => [...current, ...nextMaterials]);
    nextMaterials.forEach((material, index) => {
      void uploadSelectedFile(material.id, files[index], kind);
    });
    event.target.value = "";
  };

  const removeMaterial = (materialId: string) => {
    setUploadedMaterials((current) => {
      const target = current.find((item) => item.id === materialId);
      revokeBlobPreview(target?.previewUrl);
      return current.filter((item) => item.id !== materialId);
    });
  };

  const handleStreamEvent = (event: ChatStreamEvent) => {
    switch (event.event) {
      case "start":
        setToolCallTimeline([]);
        setStatusText("已建立流式连接，Agent 正在组织输出");
        setActiveThreadId(event.thread_id);
        updateAssistantTimestamp(new Date().toISOString());
        break;
      case "message":
        updateAssistantMessage(event.delta);
        break;
      case "tool_call":
        pushToolCallTrace(event);
        setStatusText(
          event.message?.trim() || getToolCallFallbackMessage(event.name, event.status),
        );
        break;
      case "artifact":
        setArtifact(event.artifact);
        attachArtifactToLatestAssistantMessage(event.artifact);
        setStatusText("结构化结果已更新，可在右侧继续编辑或导出");
        break;
      case "error":
        {
          const friendlyMessage = getFriendlyStreamErrorMessage(event);
          const detailText =
            event.message.trim() && event.message.trim() !== friendlyMessage
              ? `\n\n原始错误：${event.message.trim()}`
              : "";

          streamErrorRef.current = true;
          setStatusText(friendlyMessage);
          removeAssistantPlaceholderIfEmpty();
          appendSystemMessage({
            id: createId("provider-error"),
            role: "error",
            title: "模型服务异常",
            content: `${friendlyMessage}${detailText}\n\n错误代码：${event.code}`,
            createdAt: new Date().toISOString(),
          });
          setIsStreaming(false);
          assistantMessageIdRef.current = null;
          break;
        }
      case "done":
        if (streamErrorRef.current) {
          streamErrorRef.current = false;
          setIsStreaming(false);
          assistantMessageIdRef.current = null;
          break;
        }
        setStatusText("生成完成，可继续优化、改写或导出");
        setIsStreaming(false);
        assistantMessageIdRef.current = null;
        break;
    }
  };

  const openTemplateLibraryWithPrefill = (payload: TemplateCreatePayload) => {
    setActiveView("templates");
    setLeftSidebarOpen(false);
    setRightPanelOpen(false);
    setSelectedTemplate(null);
    setTemplateCreationRequest({
      key: Date.now(),
      payload,
    });
  };

  const handleSaveArtifactAsTemplate = () => {
    if (!artifact) {
      return;
    }

    const prefill = buildTemplatePrefillFromArtifact({
      artifact,
      platform,
      taskType,
      systemPrompt: activeSystemPrompt,
      threadTitle: activeThreadTitle,
    });

    openTemplateLibraryWithPrefill(prefill);
    setStatusText(`已为当前产物生成模板草稿：${prefill.title}`);
  };

  const openNewThreadModal = () => {
    setSelectedTemplate(null);
    setTemplateCreationRequest(null);
    setDraftThreadTitle("");
    setDraftSystemPrompt("");
    setDraftKnowledgeBaseScope("");
    setDraftTargetThreadId(null);
    setDraftSourceTopicId(null);
    void loadKnowledgeScopes();
    setIsNewThreadModalOpen(true);
  };

  const openTemplateNewThreadModal = (template: TemplateSummaryItem) => {
    setSelectedTemplate(template);
    setDraftThreadTitle(template.title);
    setDraftSystemPrompt(template.system_prompt);
    setDraftKnowledgeBaseScope(template.knowledge_base_scope ?? "");
    setDraftTargetThreadId(null);
    setDraftSourceTopicId(null);
    void loadKnowledgeScopes();
    setIsNewThreadModalOpen(true);
  };

  const openTopicNewThreadModal = (topic: TopicItem, threadId: string) => {
    setSelectedTemplate(null);
    setTemplateCreationRequest(null);
    setDraftThreadTitle(topic.title);
    setDraftSystemPrompt(buildTopicDraftPrompt(topic));
    setDraftKnowledgeBaseScope("");
    setDraftTargetThreadId(threadId);
    setDraftSourceTopicId(topic.id);
    void loadKnowledgeScopes();
    setIsNewThreadModalOpen(true);
  };

  const activateTopicDraftWorkspace = (topic: TopicItem, threadId: string) => {
    setActiveView("chat");
    setLeftSidebarOpen(false);
    setRightPanelOpen(true);
    setTaskType("content_generation");
    setPlatform(mapTopicPlatformToWorkspace(topic.platform));
    resetWorkspace(topic.title, buildTopicDraftPrompt(topic), "", threadId, topic.id);
    upsertThreadInList({
      id: threadId,
      title: topic.title,
      time: "撰写中",
      ...(topic.platform === "双平台"
        ? {}
        : { platform: mapTopicPlatformToWorkspace(topic.platform) as "xiaohongshu" | "douyin" }),
    });
  };

  const closeNewThreadModal = () => {
    setIsNewThreadModalOpen(false);
    setSelectedTemplate(null);
    setDraftKnowledgeBaseScope("");
    setDraftTargetThreadId(null);
    setDraftSourceTopicId(null);
  };

  const handleUseTemplate = (template: TemplateSummaryItem) => {
    setActiveView("chat");
    setLeftSidebarOpen(false);
    setRightPanelOpen(true);
    setTemplateCreationRequest(null);
    setStatusText(`已载入模板：${template.title}`);

    const mappedPlatform = mapTemplatePlatformToWorkspace(template.platform);
    if (mappedPlatform) {
      setPlatform(mappedPlatform);
    }

    openTemplateNewThreadModal(template);
  };

  const handleDraftTopic = async (topic: TopicItem): Promise<void> => {
    setTemplateCreationRequest(null);
    setSelectedTemplate(null);
    setTaskType("content_generation");
    setPlatform(mapTopicPlatformToWorkspace(topic.platform));
    const boundThreadId = topic.thread_id?.trim() || createId("thread");

    if (topic.thread_id?.trim()) {
      const loadResult = await loadThreadHistory(
        toTopicThreadItem(topic),
        topic.id,
        { silentNotFound: true },
      );
      if (topic.status !== "drafting") {
        void handleUpdateTopic(topic, { status: "drafting" });
      }
      if (loadResult === "loaded") {
        setStatusText(`已回到原会话继续撰写：${topic.title}`);
        return;
      }
      if (loadResult === "failed") {
        return;
      }

      activateTopicDraftWorkspace(topic, boundThreadId);
      setStatusText(`原会话不存在，已恢复该选题的草稿工作区：${topic.title}`);
      return;
    }

    const updatedTopic = await handleUpdateTopic(topic, {
      status: "drafting",
      thread_id: boundThreadId,
    });
    if (!updatedTopic) {
      return;
    }

    setActiveView("chat");
    setLeftSidebarOpen(false);
    setRightPanelOpen(true);
    openTopicNewThreadModal(updatedTopic, boundThreadId);
    setStatusText(`已为选题绑定会话并预填草稿指令：${updatedTopic.title}`);
  };

  const handleExportMarkdown = () => {
    if (!artifact) {
      setStatusText("当前还没有可导出的结构化结果");
      return;
    }

    const markdownContent = buildArtifactMarkdown(artifact, {
      taskLabel: activeTaskLabel,
      platformLabel: getPlatformDisplayLabel(platform),
    });
    const downloadedFilename = downloadArtifactMarkdown(artifact, markdownContent);
    setStatusText(`Markdown 已导出：${downloadedFilename}`);
  };

  const handlePublishToXiaohongshu = () => {
    if (!artifact || artifact.artifact_type !== "content_draft") {
      setStatusText("当前还没有可发布到小红书的图文草稿");
      return;
    }

    const preferredTitle =
      artifact.title_candidates.find((candidate) => candidate.trim()) ?? artifact.title;
    const publishTitle = cleanForPublishing(preferredTitle).trim();
    const publishContent = cleanForPublishing(
      [artifact.body, artifact.platform_cta].filter(Boolean).join("\n\n"),
    );
    const imageUrls = (artifact.generated_images ?? []).filter((url) => url.trim());

    if (!publishTitle && !publishContent && imageUrls.length === 0) {
      setStatusText("当前草稿内容为空，暂时无法发送到小红书发布插件");
      return;
    }

    window.postMessage(
      {
        type: "@@OMNIMEDIA/PUBLISH_TASK",
        action: "OMNIMEDIA_PUBLISH",
        payload: {
          title: publishTitle,
          content: publishContent,
          imageUrls,
        },
      },
      window.location.origin,
    );

    setStatusText(
      "已向 OmniMedia Publisher 插件发送发布指令；若浏览器未自动打开小红书，请确认扩展已加载。",
    );
  };

  const artifactActions: ArtifactAction[] = useMemo(() => {
    const actions: ArtifactAction[] = [
      {
        id: "continue-optimization",
        label: "继续优化",
        variant: "primary",
        onClick: () =>
          setMessage(
            "请继续优化刚才的方案，给我 3 个更强版本，并补充更明确的转化动作。",
          ),
      },
      {
        id: "rewrite-other-platform",
        label: "改写到另一平台",
        onClick: () => {
          setPlatform((current) => (current === "douyin" ? "xiaohongshu" : "douyin"));
          setMessage(
            "请基于当前结果改写成另一平台版本，保留核心观点但调整表达节奏。",
          );
        },
      },
      {
        id: "generate-three-versions",
        label: "生成 3 个版本",
        onClick: () =>
          setMessage("请在当前方向上再生成 3 个不同风格版本。"),
      },
      {
        id: "export-markdown",
        label: "导出 Markdown",
        onClick: handleExportMarkdown,
      },
    ];

    if (artifact) {
      actions.unshift({
        id: "save-as-template",
        label: "存为模板",
        onClick: handleSaveArtifactAsTemplate,
      });
    }

    if (
      artifact?.artifact_type === "content_draft" &&
      (platform === "xiaohongshu" || platform === "both")
    ) {
      actions.push({
        id: "publish-xiaohongshu",
        label: "去小红书发布",
        onClick: handlePublishToXiaohongshu,
      });
    }

    return actions;
  }, [
    artifact,
    handleExportMarkdown,
    handlePublishToXiaohongshu,
    handleSaveArtifactAsTemplate,
    platform,
  ]);

  const handleConfirmNewThread = () => {
    const normalizedTitle = draftThreadTitle.trim() || "New thread";
    const normalizedSystemPrompt = draftSystemPrompt.trim();
    const normalizedKnowledgeBaseScope = draftKnowledgeBaseScope.trim();
    const normalizedThreadId = draftTargetThreadId?.trim() || "thread-new";

    abortRef.current?.abort();
    setIsStreaming(false);
    assistantMessageIdRef.current = null;
    streamErrorRef.current = false;
    setActiveView("chat");
    resetWorkspace(
      normalizedTitle,
      normalizedSystemPrompt,
      normalizedKnowledgeBaseScope,
      normalizedThreadId,
      draftSourceTopicId,
    );
    upsertThreadInList({
      id: normalizedThreadId,
      title: normalizedTitle,
      time: normalizedThreadId === "thread-new" ? "草稿" : "撰写中",
    });
    setStatusText("准备新的内容任务");
    setRightPanelOpen(true);
    setLeftSidebarOpen(false);
    closeNewThreadModal();
  };

  const handleRenameThread = async (thread: ThreadItem, nextTitle: string) => {
    const normalizedTitle = nextTitle.trim();
    if (!normalizedTitle || normalizedTitle === thread.title) {
      return false;
    }

    setMutatingThreadId(thread.id);
    try {
      const summary = await updateThread(thread.id, { title: normalizedTitle });
      setStatusText("会话标题已更新");
      upsertThreadInList(toThreadItemFromSummary(summary));

      if (activeThreadId === thread.id) {
        setActiveThreadTitle(summary.title || normalizedTitle);
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return false;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "更新会话失败，请稍后重试。";

      appendSystemMessage({
        id: createId("rename-error"),
        role: "error",
        title: "重命名失败",
        content: errorMessage,
      });
      return false;
    } finally {
      setMutatingThreadId(null);
    }

    return true;
  };

  const handleStopStreaming = () => {
    if (!isStreaming || !abortRef.current) {
      return;
    }

    stopRequestedRef.current = true;
    abortRef.current.abort();
    abortRef.current = null;
    removeAssistantPlaceholderIfEmpty();
    setIsStreaming(false);
    assistantMessageIdRef.current = null;
    setStatusText("已停止生成，当前已输出内容已保留");
  };

  const handleDeleteThread = async (thread: ThreadItem) => {
    const confirmed = window.confirm(
      `确认删除会话“${thread.title}”吗？此操作不可恢复。`,
    );
    if (!confirmed) {
      return;
    }

    setMutatingThreadId(thread.id);
    try {
      await deleteThread(thread.id);
      setStatusText("会话已删除");
      setDrafts((current) => current.filter((item) => item.thread_id !== thread.id));

      const remainingThreads = threads.filter((item) => item.id !== thread.id);
      setThreads(remainingThreads);

      if (activeThreadId === thread.id) {
        if (remainingThreads.length > 0) {
          await loadThreads(remainingThreads[0].id, true);
        } else {
          resetWorkspace();
        }
      }
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "删除会话失败，请稍后重试。";

      appendSystemMessage({
        id: createId("delete-error"),
        role: "error",
        title: "删除失败",
        content: errorMessage,
      });
    } finally {
      setMutatingThreadId(null);
    }
  };

  const handleThreadSettingsSave = async (payload: {
    title: string;
    systemPrompt: string;
  }) => {
    const normalizedTitle =
      payload.title.trim() ||
      (isDraftThread ? "New thread" : activeThreadTitle || "Untitled thread");
    const normalizedSystemPrompt = payload.systemPrompt.trim();

    if (isDraftThread) {
      setActiveThreadTitle(normalizedTitle);
      setActiveSystemPrompt(normalizedSystemPrompt);
      setStatusText("草稿会话设置已更新");
      setIsThreadSettingsOpen(false);
      return;
    }

    setIsSavingThreadSettings(true);

    try {
      const summary = await updateThread(activeThreadId, {
        title: normalizedTitle,
        system_prompt: normalizedSystemPrompt,
      });

      upsertThreadInList(toThreadItemFromSummary(summary));
      setActiveThreadTitle(summary.title || normalizedTitle);
      setActiveSystemPrompt(normalizedSystemPrompt);
      setStatusText("会话设置已更新");
      setIsThreadSettingsOpen(false);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "保存会话设置失败，请稍后重试。";

      setStatusText("会话设置保存失败");
      appendSystemMessage({
        id: createId("thread-settings-error"),
        role: "error",
        title: "会话设置保存失败",
        content: errorMessage,
      });
    } finally {
      setIsSavingThreadSettings(false);
    }
  };

  const handleSubmit = async ({
    message: draftMessage,
    uploadedMaterials: draftMaterials,
  }: ComposerSubmitPayload) => {
    const trimmedMessage = draftMessage.trim();
    if (!trimmedMessage || isStreaming) {
      return;
    }

    if (isUploading) {
      setStatusText("请等待素材上传完成后再发起任务");
      appendSystemMessage({
        id: createId("note"),
        role: "note",
        title: "素材仍在上传",
        content: "当前仍有素材尚未上传完成，请稍后再发起任务。",
      });
      return;
    }

    abortRef.current?.abort();
    stopRequestedRef.current = false;

    const isExistingThread = activeThreadId !== "thread-new";
    const nextThreadId = isExistingThread ? activeThreadId : createId("thread");
    const nextThreadTitle = isExistingThread
      ? activeThreadTitle
      : activeThreadTitle === "New thread"
        ? deriveThreadLabel(trimmedMessage)
        : activeThreadTitle;
    const assistantMessageId = createId("assistant");
    const backendPlatform = mapPlatformToBackend(platform);
    const backendTaskType = mapTaskToBackend(taskType);
    const nowIso = new Date().toISOString();
    const readyMaterials = draftMaterials.filter((item) => item.status === "ready");
    const failedUploads = draftMaterials.filter((item) => item.status === "error");
    const requestMaterials = readyMaterials.map(toMaterialPayload);

    setMessage("");
    replaceUploadedMaterials([]);
    assistantMessageIdRef.current = assistantMessageId;
    streamErrorRef.current = false;
    setActiveView("chat");
    setArtifact(null);
    setToolCallTimeline([]);
    setActiveThreadId(nextThreadId);
    setActiveThreadTitle(nextThreadTitle);
    setStatusText("任务已提交，正在建立 Agent 流...");
    setIsStreaming(true);
    setRightPanelOpen(true);
    upsertThreadInList({
      id: nextThreadId,
      title: nextThreadTitle,
      time: "刚刚",
    });

    const noteMessages: ConversationMessageDraft[] = [];
    if (platform === "both") {
      noteMessages.push({
        id: createId("note"),
        role: "note",
        title: "双平台预览",
        content: "当前后端仍按单平台主链路执行，前端继续保留双平台工作台视图。",
        createdAt: nowIso,
      });
    }
    if (failedUploads.length > 0) {
      noteMessages.push({
        id: createId("note"),
        role: "note",
        title: "素材部分降级",
        content: "部分素材上传失败，本次请求只会携带已就绪素材。",
        createdAt: nowIso,
      });
    }

    setMessages((current) => [
      ...current,
      ...noteMessages.map(createConversationMessage),
      createConversationMessage({
        id: createId("user"),
        role: "user",
        content: trimmedMessage,
        materials: requestMaterials,
        createdAt: nowIso,
      }),
      createConversationMessage({
        id: assistantMessageId,
        role: "assistant",
        content: "",
        createdAt: nowIso,
      }),
    ]);

    const controller = new AbortController();
    abortRef.current = controller;

    const requestPayload: MediaChatRequestPayload = {
      thread_id: nextThreadId,
      platform: backendPlatform,
      task_type: backendTaskType,
      message: trimmedMessage,
      materials: requestMaterials,
      model_override: modelOverride.trim() || null,
      ...(activeSystemPrompt.trim() ? { system_prompt: activeSystemPrompt.trim() } : {}),
      ...(activeKnowledgeBaseScope.trim()
        ? { knowledge_base_scope: activeKnowledgeBaseScope.trim() }
        : {}),
      ...(nextThreadTitle.trim() ? { thread_title: nextThreadTitle.trim() } : {}),
    };

    try {
      await createChatStream(requestPayload, handleStreamEvent, controller.signal);
      await loadThreads(nextThreadId, true, activeTopicId);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatusText(
          stopRequestedRef.current
            ? "已停止生成，当前已输出内容已保留"
            : "上一项任务已终止",
        );
      } else if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
      } else {
        const errorMessage =
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "发生未知错误，请稍后重试。";

        setStatusText("请求失败，请检查后端服务");
        appendSystemMessage({
          id: createId("error"),
          role: "error",
          title: "请求异常",
          content: errorMessage,
          createdAt: new Date().toISOString(),
        });
      }
      setIsStreaming(false);
      assistantMessageIdRef.current = null;
    } finally {
      stopRequestedRef.current = false;
      abortRef.current = null;
    }
  };

  const handleAvatarUpload = async (file: File): Promise<string> => {
    try {
      const payload = await uploadMedia(file, "avatar");
      setStatusText("头像上传成功，保存后立即生效");
      return payload.url;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
      }

      throw error instanceof Error
        ? error
        : new Error("头像上传失败，请稍后重试。");
    }
  };

  const loadAuthSessions = async () => {
    setIsLoadingSessions(true);

    try {
      const payload = await fetchSessions();
      setAuthSessions(payload.items);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "加载登录设备失败，请稍后重试。";

      setStatusText("加载登录设备失败");
      appendSystemMessage({
        id: createId("sessions-error"),
        role: "error",
        title: "设备列表加载失败",
        content: errorMessage,
      });
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const handleOpenProfile = async () => {
    setIsProfileModalOpen(true);
    await loadAuthSessions();
  };

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingSessionId(sessionId);

    try {
      await revokeSession(sessionId);
      setStatusText("登录设备已下线");
      await loadAuthSessions();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "下线设备失败，请稍后重试。";

      setStatusText("下线设备失败");
      appendSystemMessage({
        id: createId("session-revoke-error"),
        role: "error",
        title: "设备下线失败",
        content: errorMessage,
      });
    } finally {
      setRevokingSessionId(null);
    }
  };

  const handleProfileSave = async (payload: UserProfileUpdatePayload) => {
    setIsUpdatingProfile(true);

    try {
      const updatedUser = await updateUserProfile(payload);
      setCurrentUser(updatedUser);
      setStoredUser(updatedUser);
      setStatusText("个人资料已更新");
      setIsProfileModalOpen(false);
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        return;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "更新个人资料失败，请稍后重试。";

      setStatusText("个人资料更新失败");
      appendSystemMessage({
        id: createId("profile-error"),
        role: "error",
        title: "资料更新失败",
        content: errorMessage,
      });
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handlePasswordReset = async ({
    old_password,
    new_password,
  }: {
    old_password: string;
    new_password: string;
  }): Promise<ResetPasswordResponse> => {
    setIsResettingPassword(true);

    try {
      const response = await resetPassword({ old_password, new_password });
      await loadAuthSessions();
      setStatusText(
        response.revoked_sessions > 0
          ? `密码已更新，已下线 ${response.revoked_sessions} 台其他设备`
          : "密码已更新",
      );
      return response;
    } catch (error) {
      if (isUnauthorizedError(error)) {
        handleUnauthorized(error instanceof APIError ? error.message : undefined);
        throw error;
      }

      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "修改密码失败，请稍后重试。";

      setStatusText("修改密码失败");
      appendSystemMessage({
        id: createId("password-reset-error"),
        role: "error",
        title: "密码更新失败",
        content: errorMessage,
      });
      throw error instanceof Error ? error : new Error(errorMessage);
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleLogout = async () => {
    abortRef.current?.abort();

    try {
      await logoutAPI();
    } catch {
      // Local logout still proceeds even if the revoke request fails.
    } finally {
      clearStoredToken();
      clearStoredRefreshToken();
      clearStoredUser();
      setCurrentUser(null);
      setActiveView("chat");
      setAuthSessions([]);
      setDrafts([]);
      setKnowledgeScopes([]);
      setTopics([]);
      setTemplates([]);
      setTemplateSkills([]);
      setIsLoadingDrafts(false);
      setIsLoadingKnowledgeScopes(false);
      setIsLoadingTopics(false);
      setIsLoadingTemplates(false);
      setIsLoadingTemplateSkills(false);
      setIsMutatingDrafts(false);
      setIsMutatingKnowledgeScopes(false);
      setIsMutatingTopics(false);
      setIsMutatingTemplates(false);
      setMutatingDraftMessageId(null);
      setMutatingKnowledgeScope(null);
      setMutatingTopicId(null);
      setMutatingTemplateId(null);
      setAuthMode("login");
      setAuthPassword("");
      setAuthConfirmPassword("");
      setAuthResetToken("");
      setAuthSuccess("");
      setSelectedTemplate(null);
      setTemplateCreationRequest(null);
      setThreads([]);
      resetWorkspace();
      setIsProfileModalOpen(false);
      setIsThreadSettingsOpen(false);
      setRevokingSessionId(null);
      hasInitializedHistoryRef.current = false;
      setStatusText("请先登录");
    }
  };

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const username = authUsername.trim();
    const password = authPassword;
    const resetToken = authResetToken.trim();

    if (authMode === "login" || authMode === "register") {
      if (!username || !password) {
        setAuthError("请输入用户名和密码。");
        return;
      }
    } else if (authMode === "forgot-password") {
      if (!username) {
        setAuthError("请输入需要重置密码的用户名。");
        return;
      }
    } else {
      if (!resetToken || !password || !authConfirmPassword) {
        setAuthError("请完整填写重置 Token、新密码和确认密码。");
        return;
      }
      if (password.length < 8) {
        setAuthError("新密码至少需要 8 个字符。");
        return;
      }
      if (password !== authConfirmPassword) {
        setAuthError("两次输入的新密码不一致。");
        return;
      }
    }

    setIsAuthSubmitting(true);
    setAuthError("");
    setAuthSuccess("");

    try {
      if (authMode === "forgot-password") {
        const response = await requestPasswordReset({ username });
        setAuthPassword("");
        setAuthConfirmPassword("");
        setAuthResetToken("");
        setAuthMode("reset-password");
        setAuthSuccess(
          `如果账号存在，系统已生成一个 ${response.expires_in_minutes} 分钟内有效的重置令牌。请查看后端控制台日志并复制 Token。`,
        );
        setStatusText("请根据控制台中的令牌完成密码重置");
        return;
      }

      if (authMode === "reset-password") {
        const response = await completePasswordReset({
          token: resetToken,
          new_password: password,
        });
        clearStoredToken();
        clearStoredRefreshToken();
        clearStoredUser();
        setCurrentUser(null);
        setAuthMode("login");
        setAuthPassword("");
        setAuthConfirmPassword("");
        setAuthResetToken("");
        setAuthSuccess(
          response.revoked_sessions > 0
            ? `密码已重置，已强制下线 ${response.revoked_sessions} 台设备，请使用新密码重新登录。`
            : "密码已重置，请使用新密码重新登录。",
        );
        setStatusText("密码已重置，请重新登录");
        return;
      }

      const response =
        authMode === "login"
          ? await login(username, password)
          : await register({ username, password });

      setCurrentUser(response.user);
      setAuthPassword("");
      setAuthConfirmPassword("");
      setAuthResetToken("");
      setActiveView("chat");
      setStatusText("登录成功，正在加载工作台");
      hasInitializedHistoryRef.current = false;
      resetWorkspace();
    } catch (error) {
      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "认证失败，请稍后重试。";
      setAuthError(errorMessage);
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  if (!isAuthenticated || currentUser === null) {
    return (
      <AuthCard
        errorText={authError}
        successText={authSuccess}
        confirmPassword={authConfirmPassword}
        isSubmitting={isAuthSubmitting}
        mode={authMode}
        onConfirmPasswordChange={setAuthConfirmPassword}
        onModeChange={handleAuthModeChange}
        onPasswordChange={setAuthPassword}
        onResetTokenChange={setAuthResetToken}
        onSubmit={handleAuthSubmit}
        onUsernameChange={setAuthUsername}
        password={authPassword}
        resetToken={authResetToken}
        username={authUsername}
      />
    );
  }

  return (
    <>
      <div
        className="flex h-screen flex-col bg-background text-foreground [background-image:var(--shell-background)]"
        data-testid="workspace-shell"
      >
        <AppHeader
          currentDisplayName={currentDisplayName}
          modelOverride={modelOverride}
          onExportMarkdown={handleExportMarkdown}
          onModelOverrideChange={setModelOverride}
          onOpenLeftSidebar={() => {
            setIsLeftSidebarCollapsed(false);
            setLeftSidebarOpen(true);
          }}
          onOpenRightPanel={() => {
            setIsRightPanelCollapsed(false);
            setRightPanelOpen(true);
          }}
          onPlatformChange={setPlatform}
          onTaskTypeChange={setTaskType}
          platform={platform}
          taskType={taskType}
        />

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <LeftSidebar
            activeThreadId={activeThreadId}
            activeView={activeView}
            currentUser={currentUser}
            draftCount={drafts.length > 0 ? drafts.length : undefined}
            knowledgeCount={knowledgeScopes.length > 0 ? knowledgeScopes.length : undefined}
            isDesktopCollapsed={isLeftSidebarCollapsed}
            isLoading={isLoadingThreads}
            mutatingThreadId={mutatingThreadId}
            topicCount={topics.length > 0 ? topics.length : undefined}
            templateCount={templates.length > 0 ? templates.length : undefined}
            onCreateThread={openNewThreadModal}
            onDeleteThread={(thread) => void handleDeleteThread(thread)}
            onLogout={() => void handleLogout()}
            onClose={() => setLeftSidebarOpen(false)}
            onOpenProfile={() => void handleOpenProfile()}
            onRenameThread={handleRenameThread}
            onSelectView={handleSelectView}
            onSelectThread={(thread) => {
              setActiveView("chat");
              if (thread.id === "thread-new") {
                resetWorkspace(thread.title);
                setRightPanelOpen(true);
                return;
              }
              void loadThreadHistory(thread);
            }}
            onToggleDesktopCollapse={() =>
              setIsLeftSidebarCollapsed((collapsed) => !collapsed)
            }
            open={leftSidebarOpen}
            threads={threads}
          />

          {leftSidebarOpen ? (
            <button
              className="fixed inset-0 top-16 z-30 bg-overlay lg:hidden"
              onClick={() => setLeftSidebarOpen(false)}
              type="button"
            />
          ) : null}

          <main className="relative z-0 flex min-w-0 flex-1 flex-col overflow-hidden">
            {activeView === "chat" ? (
              <>
                <div className="border-b border-border bg-surface-elevated px-4 py-4 backdrop-blur-sm lg:px-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {isLeftSidebarCollapsed ? (
                        <button
                          aria-label="展开左侧边栏"
                          className="hidden h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground transition hover:border-brand/40 hover:text-foreground lg:inline-flex"
                          onClick={() => setIsLeftSidebarCollapsed(false)}
                          type="button"
                        >
                          <Menu className="h-5 w-5" />
                        </button>
                      ) : null}

                      <div className="min-w-0">
                        <h2
                          className="text-2xl font-bold tracking-tight text-foreground"
                          data-testid="workspace-title"
                        >
                          {workspaceTitle}
                        </h2>
                      </div>
                    </div>

                    <div className="ml-auto flex items-center gap-3">
                      <div
                        className={`hidden items-center gap-2 rounded-full px-3 py-2 text-sm font-medium sm:inline-flex ${isStreaming
                          ? "bg-warning-surface text-warning-foreground"
                          : "bg-success-surface text-success-foreground"
                          }`}
                        data-testid="workspace-status"
                      >
                        {isStreaming ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        {statusText}
                      </div>

                      <button
                        aria-expanded={isWorkspaceHeaderExpanded}
                        aria-label={isWorkspaceHeaderExpanded ? "收起快捷操作区" : "展开快捷操作区"}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-brand/40 hover:text-foreground"
                        onClick={() => setIsWorkspaceHeaderExpanded((expanded) => !expanded)}
                        type="button"
                      >
                        {isWorkspaceHeaderExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div
                    className={`grid overflow-hidden transition-all duration-300 ease-in-out ${isWorkspaceHeaderExpanded
                      ? "mt-4 grid-rows-[1fr] opacity-100"
                      : "mt-0 grid-rows-[0fr] opacity-0"
                      }`}
                  >
                    <div className="min-h-0">
                      <div className="mb-4 text-sm text-muted-foreground">
                        当前任务：{activeTaskLabel} · 线程：{activeThreadTitle} · ID：
                        {activeThreadId}
                      </div>

                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        <div className="inline-flex max-w-3xl items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                          <Sparkles className="h-3.5 w-3.5" />
                          <span className="truncate" data-testid="workspace-persona-badge">
                            当前人设：{activeSystemPrompt || "通用助手"}
                          </span>
                        </div>
                        <button
                          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-card-foreground transition hover:border-brand/40 hover:text-brand"
                          onClick={() => setIsThreadSettingsOpen(true)}
                          type="button"
                          data-testid="open-thread-settings"
                        >
                          <Settings2 className="h-3.5 w-3.5" />
                          {isDraftThread ? "草稿设置" : "会话设置"}
                        </button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {quickActions.map((action) => (
                          <button
                            key={action}
                            className="rounded-2xl border border-border bg-card p-4 text-left text-sm font-medium text-card-foreground transition hover:border-brand/40 hover:bg-brand-soft hover:shadow-sm"
                            onClick={() => setMessage(action)}
                            type="button"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="flex min-h-0 flex-1 flex-col overflow-hidden"
                  data-testid="workspace-chat-view"
                >
                  <div className="flex-1 overflow-y-auto px-4 py-6 lg:px-6">
                    <ChatFeed
                      artifact={artifact}
                      currentUser={currentUser}
                      endRef={chatEndRef}
                      isLoadingHistory={isLoadingThreadHistory}
                      isStreaming={isStreaming}
                      messages={messages}
                      toolCallTimeline={toolCallTimeline}
                      onSaveArtifactAsTemplate={
                        artifact ? handleSaveArtifactAsTemplate : undefined
                      }
                    />
                  </div>

                  <div className="border-t border-border bg-surface-elevated px-4 py-4 backdrop-blur-sm lg:px-6">
                    <Composer
                      imageInputRef={imageInputRef}
                      audioInputRef={audioInputRef}
                      isStreaming={isStreaming}
                      isUploading={isUploading}
                      message={message}
                      onFilesSelected={onFilesSelected}
                      onMessageChange={setMessage}
                      onRemoveMaterial={removeMaterial}
                      onSubmit={(payload) => void handleSubmit(payload)}
                      onStopStreaming={handleStopStreaming}
                      onTriggerFilePicker={triggerFilePicker}
                      textInputRef={textInputRef}
                      uploadedMaterials={uploadedMaterials}
                      videoInputRef={videoInputRef}
                    />
                  </div>
                </div>
              </>
            ) : activeView === "drafts" ? (
              <DraftsView
                drafts={drafts}
                isLoading={isLoadingDrafts}
                isMutating={isMutatingDrafts}
                mutatingMessageId={mutatingDraftMessageId}
                onClearAllDrafts={handleClearAllDrafts}
                onDeleteDraft={handleDeleteDraft}
                onDeleteDrafts={handleDeleteDrafts}
                onOpenThread={handleOpenDraftThread}
              />
            ) : activeView === "dashboard" ? (
              <DashboardView
                isLoading={isLoadingDashboard}
                summary={dashboardSummary}
              />
            ) : activeView === "knowledge" ? (
              <KnowledgeView
                isLoading={isLoadingKnowledgeScopes}
                isMutating={isMutatingKnowledgeScopes}
                mutatingScope={mutatingKnowledgeScope}
                onDeleteScope={(scope) => handleDeleteKnowledgeScope(scope)}
                onDeleteSource={(scope, source) => handleDeleteKnowledgeSource(scope, source)}
                onLoadScopeSources={(scope) => handleLoadKnowledgeScopeSources(scope)}
                onPreviewSource={(scope, source) => handlePreviewKnowledgeSource(scope, source)}
                onRenameScope={(scope, nextScopeName) =>
                  handleRenameKnowledgeScope(scope, nextScopeName)
                }
                onUploadFiles={(scope, files) => handleUploadKnowledgeFiles(scope, files)}
                scopes={knowledgeScopes}
              />
            ) : activeView === "topics" ? (
              <TopicsView
                isLoading={isLoadingTopics}
                isMutating={isMutatingTopics}
                mutatingTopicId={mutatingTopicId}
                onCreateTopic={(payload) => handleCreateTopic(payload)}
                onDeleteTopic={(topic) => handleDeleteTopic(topic)}
                onDraftTopic={(topic) => handleDraftTopic(topic)}
                onUpdateTopic={(topic, payload) => handleUpdateTopic(topic, payload)}
                topics={topics}
              />
            ) : activeView === "templates" ? (
              <TemplatesView
                creationRequest={templateCreationRequest}
                isLoading={isLoadingTemplates}
                isMutating={isMutatingTemplates}
                mutatingTemplateId={mutatingTemplateId}
                onCreationRequestHandled={() => setTemplateCreationRequest(null)}
                onCreateTemplate={(payload) => handleCreateTemplate(payload)}
                onDeleteTemplate={(template) => handleDeleteTemplate(template)}
                onDeleteTemplates={(templateIds) => handleDeleteTemplates(templateIds)}
                onUseTemplate={handleUseTemplate}
                selectedTemplateId={selectedTemplate?.id ?? null}
                templates={templates}
              />
            ) : (
              <PlaceholderView
                description={
                  nonChatViewMeta[activeView as Exclude<WorkspaceView, "chat">]
                    .description
                }
                title={
                  nonChatViewMeta[activeView as Exclude<WorkspaceView, "chat">].title
                }
              />
            )}
          </main>

          {activeView === "chat" ? (
            <RightPanel
              activeTaskLabel={activeTaskLabel}
              artifact={artifact}
              artifactActions={artifactActions}
              isDesktopCollapsed={isRightPanelCollapsed}
              onClose={() => setRightPanelOpen(false)}
              onOpen={() => {
                setIsRightPanelCollapsed(false);
                setRightPanelOpen(true);
              }}
              onToggleDesktopCollapse={() =>
                setIsRightPanelCollapsed((collapsed) => !collapsed)
              }
              open={rightPanelOpen}
              platform={platform}
              taskType={taskType}
            />
          ) : null}
        </div>
      </div>

      {publishToast ? (
        <div className="pointer-events-none fixed right-4 top-20 z-[80] w-[min(92vw,24rem)]">
          <div
            className={`pointer-events-auto rounded-[28px] border px-4 py-4 shadow-xl backdrop-blur-sm ${
              publishToast.tone === "success"
                ? "border-success-foreground/20 bg-success-surface text-success-foreground"
                : "border-danger-foreground/20 bg-danger-surface text-danger-foreground"
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {publishToast.tone === "success" ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <X className="h-5 w-5" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{publishToast.title}</div>
                <div className="mt-1 text-sm leading-6">{publishToast.message}</div>

                {publishToast.error === "NEED_LOGIN" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="inline-flex items-center rounded-full border border-current/20 bg-white/10 px-3 py-1.5 text-xs font-medium transition hover:bg-white/20"
                      onClick={openXiaohongshuCreatorCenter}
                      type="button"
                    >
                      去登录小红书
                    </button>
                  </div>
                ) : null}
              </div>

              <button
                aria-label="关闭发布提示"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/5 transition hover:bg-black/10"
                onClick={() => setPublishToast(null)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <NewThreadModal
        isLoadingKnowledgeScopes={isLoadingKnowledgeScopes}
        knowledgeBaseScope={draftKnowledgeBaseScope}
        knowledgeScopes={knowledgeScopes}
        onClose={closeNewThreadModal}
        onConfirm={handleConfirmNewThread}
        onKnowledgeBaseScopeChange={setDraftKnowledgeBaseScope}
        onSystemPromptChange={setDraftSystemPrompt}
        onTitleChange={setDraftThreadTitle}
        open={isNewThreadModalOpen}
        systemPrompt={draftSystemPrompt}
        title={draftThreadTitle}
      />

      <ThreadSettingsModal
        initialSystemPrompt={activeSystemPrompt}
        initialTitle={activeThreadTitle}
        isDraft={isDraftThread}
        isSubmitting={isSavingThreadSettings}
        onClose={() => setIsThreadSettingsOpen(false)}
        onSave={handleThreadSettingsSave}
        open={isThreadSettingsOpen}
      />

      <UserProfileModal
        isLoadingSessions={isLoadingSessions}
        isResettingPassword={isResettingPassword}
        isSubmitting={isUpdatingProfile}
        onClose={() => setIsProfileModalOpen(false)}
        onRefreshSessions={() => void loadAuthSessions()}
        onRevokeSession={(sessionId) => void handleRevokeSession(sessionId)}
        onResetPassword={handlePasswordReset}
        onSave={handleProfileSave}
        onUploadAvatar={handleAvatarUpload}
        open={isProfileModalOpen}
        revokingSessionId={revokingSessionId}
        sessions={authSessions}
        user={currentUser}
      />
    </>
  );
}

export default App;

