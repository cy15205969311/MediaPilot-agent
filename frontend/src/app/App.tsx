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
  deleteThread,
  fetchSessions,
  fetchThreadMessages,
  fetchThreads,
  getStoredRefreshToken,
  getStoredToken,
  getStoredUser,
  isUnauthorizedError,
  login,
  logoutAPI,
  requestPasswordReset,
  register,
  revokeSession,
  resetPassword,
  setStoredUser,
  updateThread,
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
import { quickActions, taskOptions } from "./data";
import type {
  ArtifactAction,
  ArtifactPayload,
  AuthSessionItem,
  AuthenticatedUser,
  ChatStreamEvent,
  ComposerSubmitPayload,
  ConversationMessage,
  HistoryMessageItem,
  MediaChatMaterialPayload,
  MediaChatRequestPayload,
  ResetPasswordResponse,
  ThreadItem,
  ThreadsApiResponse,
  UiPlatform,
  UiTaskType,
  UploadedMaterial,
  UploadedMaterialKind,
  UserProfileUpdatePayload,
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

type AuthMode =
  | "login"
  | "register"
  | "forgot-password"
  | "reset-password";

type ConversationMessageDraft = Omit<ConversationMessage, "createdAt"> & {
  createdAt?: string;
};

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

  const chatMessages = messages
    .filter((message) => {
      if (message.message_type === "artifact" && message.artifact) {
        latestArtifact = message.artifact;
        return false;
      }
      return true;
    })
    .map((message) =>
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
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition ${
                  mode === item
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

function NewThreadModal(props: {
  open: boolean;
  title: string;
  systemPrompt: string;
  onClose: () => void;
  onTitleChange: (value: string) => void;
  onSystemPromptChange: (value: string) => void;
  onConfirm: () => void;
}) {
  const {
    open,
    title,
    systemPrompt,
    onClose,
    onTitleChange,
    onSystemPromptChange,
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
              为这次会话设置标题和机器人人设。留空时将使用默认助手。
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
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="For example: Annual portfolio review ideas"
              value={title}
            />
          </label>

          <label className="block">
            <div className="mb-2 text-sm font-medium text-card-foreground">
              机器人人设 / 品牌定位
            </div>
            <textarea
              className="min-h-36 w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm leading-7 text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
              onChange={(event) => onSystemPromptChange(event.target.value)}
              placeholder="请输入你希望我扮演的角色，留空则使用通用助手。"
              value={systemPrompt}
            />
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
          >
            开始新会话
          </button>
        </div>
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
  const [platform, setPlatform] = useState<UiPlatform>("xiaohongshu");
  const [taskType, setTaskType] = useState<UiTaskType>("content_generation");
  const [message, setMessage] = useState(
    "请帮我策划一篇关于年度资产配置复盘的小红书笔记",
  );
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [uploadedMaterials, setUploadedMaterials] = useState<UploadedMaterial[]>([]);
  const [artifact, setArtifact] = useState<ArtifactPayload | null>(null);
  const [statusText, setStatusText] = useState("等待新的内容任务");
  const [activeThreadTitle, setActiveThreadTitle] = useState("New thread");
  const [activeThreadId, setActiveThreadId] = useState("thread-new");
  const [activeSystemPrompt, setActiveSystemPrompt] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isLoadingThreadHistory, setIsLoadingThreadHistory] = useState(false);
  const [mutatingThreadId, setMutatingThreadId] = useState<string | null>(null);
  const [isNewThreadModalOpen, setIsNewThreadModalOpen] = useState(false);
  const [draftThreadTitle, setDraftThreadTitle] = useState("");
  const [draftSystemPrompt, setDraftSystemPrompt] = useState("");
  const [isThreadSettingsOpen, setIsThreadSettingsOpen] = useState(false);
  const [isSavingThreadSettings, setIsSavingThreadSettings] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isWorkspaceHeaderExpanded, setIsWorkspaceHeaderExpanded] = useState(true);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [authSessions, setAuthSessions] = useState<AuthSessionItem[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const assistantMessageIdRef = useRef<string | null>(null);
  const streamErrorRef = useRef(false);
  const hasInitializedHistoryRef = useRef(false);
  const uploadedMaterialsRef = useRef<UploadedMaterial[]>([]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);

  const isAuthenticated = Boolean(
    currentUser && (getStoredToken() || getStoredRefreshToken()),
  );
  const currentDisplayName = useMemo(() => getDisplayName(currentUser), [currentUser]);

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
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, isLoadingThreadHistory]);

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

  const isUploading = useMemo(
    () => uploadedMaterials.some((item) => item.status === "uploading"),
    [uploadedMaterials],
  );

  const artifactActions: ArtifactAction[] = useMemo(
    () => [
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
        onClick: () =>
          void navigator.clipboard.writeText(
            "MediaPilot export preview\n\nThe structured artifact can be exported to Markdown in the next iteration.",
          ),
      },
    ],
    [],
  );

  const isDraftThread = activeThreadId === "thread-new";

  const appendSystemMessage = (messagePatch: ConversationMessageDraft) => {
    setMessages((current) => [...current, createConversationMessage(messagePatch)]);
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

  const resetWorkspace = (nextTitle = "New thread", nextSystemPrompt = "") => {
    setMessages([]);
    setArtifact(null);
    replaceUploadedMaterials([]);
    setMessage("");
    setActiveThreadId("thread-new");
    setActiveThreadTitle(nextTitle);
    setActiveSystemPrompt(nextSystemPrompt);
  };

  const handleUnauthorized = (
    fallbackMessage = "当前登录状态已失效，请重新登录。",
  ) => {
    abortRef.current?.abort();
    clearStoredToken();
    clearStoredRefreshToken();
    clearStoredUser();
    setCurrentUser(null);
    setAuthSessions([]);
    setThreads([]);
    setMessages([]);
    replaceUploadedMaterials([]);
    setArtifact(null);
    setStatusText("请重新登录");
    setAuthMode("login");
    setAuthError(fallbackMessage);
    setAuthSuccess("");
    setAuthPassword("");
    setAuthConfirmPassword("");
    setAuthResetToken("");
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

  const loadThreadHistory = async (thread: ThreadItem) => {
    abortRef.current?.abort();
    setIsStreaming(false);
    assistantMessageIdRef.current = null;
    streamErrorRef.current = false;

    setActiveThreadId(thread.id);
    setActiveThreadTitle(thread.title);
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
      setStatusText("历史会话已载入");
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
            : "加载历史会话失败，请稍后重试。";

      setStatusText("历史会话加载失败");
      appendSystemMessage({
        id: createId("history-error"),
        role: "error",
        title: "历史加载失败",
        content: errorMessage,
      });
    } finally {
      setIsLoadingThreadHistory(false);
    }
  };

  const loadThreads = async (preferredThreadId?: string, shouldLoadHistory = false) => {
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
        await loadThreadHistory(targetThread);
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

  useEffect(() => {
    if (!isAuthenticated || hasInitializedHistoryRef.current) {
      return;
    }

    hasInitializedHistoryRef.current = true;
    void loadThreads(undefined, true);
  }, [isAuthenticated]);

  const triggerFilePicker = (kind: UploadedMaterialKind) => {
    if (kind === "image") {
      imageInputRef.current?.click();
      return;
    }
    if (kind === "video") {
      videoInputRef.current?.click();
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
      const uploadThreadId =
        activeThreadId !== "thread-new" ? activeThreadId : undefined;
      const payload = await uploadMedia(file, "material", uploadThreadId);
      updateUploadedMaterial(materialId, {
        status: "ready",
        sourceUrl: payload.url,
        fileType: payload.file_type,
        previewUrl: kind === "image" ? payload.url : undefined,
      });
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
        setStatusText("已建立流式连接，Agent 正在组织输出");
        setActiveThreadId(event.thread_id);
        updateAssistantTimestamp(new Date().toISOString());
        break;
      case "message":
        updateAssistantMessage(event.delta);
        break;
      case "tool_call":
        appendSystemMessage({
          id: createId("tool"),
          role: "tool",
          title: "工具调用",
          content:
            event.message ??
            `正在调用业务工具：${event.name}（状态：${event.status}）`,
          createdAt: new Date().toISOString(),
        });
        setStatusText("Agent 正在整理中间结果");
        break;
      case "artifact":
        setArtifact(event.artifact);
        setStatusText("结构化结果已更新，可在右侧继续编辑或导出");
        break;
      case "error":
        streamErrorRef.current = true;
        setStatusText("模型调用异常，请检查配置后重试");
        appendSystemMessage({
          id: createId("provider-error"),
          role: "error",
          title: "模型服务异常",
          content: `${event.code}: ${event.message}`,
          createdAt: new Date().toISOString(),
        });
        setIsStreaming(false);
        assistantMessageIdRef.current = null;
        break;
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

  const openNewThreadModal = () => {
    setDraftThreadTitle("");
    setDraftSystemPrompt("");
    setIsNewThreadModalOpen(true);
  };

  const handleConfirmNewThread = () => {
    const normalizedTitle = draftThreadTitle.trim() || "New thread";
    const normalizedSystemPrompt = draftSystemPrompt.trim();

    abortRef.current?.abort();
    setIsStreaming(false);
    assistantMessageIdRef.current = null;
    streamErrorRef.current = false;
    resetWorkspace(normalizedTitle, normalizedSystemPrompt);
    upsertThreadInList({
      id: "thread-new",
      title: normalizedTitle,
      time: "草稿",
    });
    setStatusText("准备新的内容任务");
    setRightPanelOpen(true);
    setLeftSidebarOpen(false);
    setIsNewThreadModalOpen(false);
  };

  const handleRenameThread = async (thread: ThreadItem) => {
    const nextTitle = window.prompt("请输入新的会话标题", thread.title)?.trim();
    if (!nextTitle || nextTitle === thread.title) {
      return;
    }

    setMutatingThreadId(thread.id);
    try {
      const summary = await updateThread(thread.id, { title: nextTitle });
      setStatusText("会话标题已更新");
      upsertThreadInList(toThreadItemFromSummary(summary));

      if (activeThreadId === thread.id) {
        setActiveThreadTitle(summary.title || nextTitle);
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
            : "更新会话失败，请稍后重试。";

      appendSystemMessage({
        id: createId("rename-error"),
        role: "error",
        title: "重命名失败",
        content: errorMessage,
      });
    } finally {
      setMutatingThreadId(null);
    }
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
    setArtifact(null);
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
      ...(activeSystemPrompt.trim() ? { system_prompt: activeSystemPrompt.trim() } : {}),
      ...(nextThreadTitle.trim() ? { thread_title: nextThreadTitle.trim() } : {}),
    };

    try {
      await createChatStream(requestPayload, handleStreamEvent, controller.signal);
      await loadThreads(nextThreadId, true);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatusText("上一项任务已终止");
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
      setAuthSessions([]);
      setAuthMode("login");
      setAuthPassword("");
      setAuthConfirmPassword("");
      setAuthResetToken("");
      setAuthSuccess("");
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
            currentUser={currentUser}
            isDesktopCollapsed={isLeftSidebarCollapsed}
            isLoading={isLoadingThreads}
            mutatingThreadId={mutatingThreadId}
            onCreateThread={openNewThreadModal}
            onDeleteThread={(thread) => void handleDeleteThread(thread)}
            onLogout={() => void handleLogout()}
            onClose={() => setLeftSidebarOpen(false)}
            onOpenProfile={() => void handleOpenProfile()}
            onRenameThread={(thread) => void handleRenameThread(thread)}
            onSelectThread={(thread) => {
              if (thread.id === "thread-new") {
                resetWorkspace(thread.title);
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

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
                    className={`hidden items-center gap-2 rounded-full px-3 py-2 text-sm font-medium sm:inline-flex ${isStreaming ? "bg-warning-surface text-warning-foreground" : "bg-success-surface text-success-foreground"
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
                className={`grid overflow-hidden transition-all duration-300 ease-in-out ${isWorkspaceHeaderExpanded ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
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

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-4 py-6 lg:px-6">
                <ChatFeed
                  currentUser={currentUser}
                  endRef={chatEndRef}
                  isLoadingHistory={isLoadingThreadHistory}
                  isStreaming={isStreaming}
                  messages={messages}
                />
              </div>

              <div className="border-t border-border bg-surface-elevated px-4 py-4 backdrop-blur-sm lg:px-6">
                <Composer
                  imageInputRef={imageInputRef}
                  isStreaming={isStreaming}
                  isUploading={isUploading}
                  message={message}
                  onFilesSelected={onFilesSelected}
                  onMessageChange={setMessage}
                  onRemoveMaterial={removeMaterial}
                  onSubmit={(payload) => void handleSubmit(payload)}
                  onTriggerFilePicker={triggerFilePicker}
                  textInputRef={textInputRef}
                  uploadedMaterials={uploadedMaterials}
                  videoInputRef={videoInputRef}
                />
              </div>
            </div>
          </main>

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
        </div>
      </div>

      <NewThreadModal
        onClose={() => setIsNewThreadModalOpen(false)}
        onConfirm={handleConfirmNewThread}
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
