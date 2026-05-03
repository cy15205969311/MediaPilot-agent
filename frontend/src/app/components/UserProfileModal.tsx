import {
  Camera,
  Chrome,
  Compass,
  Globe,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  RefreshCw,
  Shield,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";

import type {
  AuthSessionItem,
  AuthenticatedUser,
  ResetPasswordPayload,
  ResetPasswordResponse,
  UserProfileUpdatePayload,
} from "../types";
import { buildAbsoluteUrl, formatChatTimestamp } from "../utils";

type UserProfileModalProps = {
  open: boolean;
  user: AuthenticatedUser | null;
  isSubmitting: boolean;
  isLoadingSessions: boolean;
  isResettingPassword: boolean;
  sessions: AuthSessionItem[];
  revokingSessionId: string | null;
  onClose: () => void;
  onSave: (payload: UserProfileUpdatePayload) => Promise<void> | void;
  onUploadAvatar: (file: File) => Promise<string>;
  onRefreshSessions: () => Promise<void> | void;
  onRevokeSession: (sessionId: string) => Promise<void> | void;
  onRequestTopUp: () => void;
  onResetPassword: (
    payload: ResetPasswordPayload,
  ) => Promise<ResetPasswordResponse> | ResetPasswordResponse;
};

type ModalTab = "profile" | "sessions" | "security";

type SessionDeviceSummary = {
  browser: string;
  os: string;
  ip: string;
  compositeKey: string;
};

type DeduplicatedSession = {
  session: AuthSessionItem;
  browser: string;
  os: string;
  ip: string;
  activityTime: number;
  loginTime: number;
  compositeKey: string;
};

const BROWSER_RULES: Array<{ marker: RegExp; label: string }> = [
  { marker: /edge|edg\//i, label: "Edge" },
  { marker: /chrome/i, label: "Chrome" },
  { marker: /firefox/i, label: "Firefox" },
  { marker: /safari/i, label: "Safari" },
  { marker: /testclient/i, label: "TestClient" },
  { marker: /curl/i, label: "curl" },
];

const OS_RULES: Array<{ marker: RegExp; label: string }> = [
  { marker: /windows/i, label: "Windows" },
  { marker: /mac\s?os|macos/i, label: "macOS" },
  { marker: /iphone|ios/i, label: "iOS" },
  { marker: /ipad|ipados/i, label: "iPadOS" },
  { marker: /android/i, label: "Android" },
  { marker: /linux/i, label: "Linux" },
];

function parseSessionTimeValue(rawValue: string | null | undefined): number {
  const normalizedValue = rawValue?.trim();
  if (!normalizedValue) {
    return 0;
  }

  if (/^-?\d+(\.\d+)?$/.test(normalizedValue)) {
    const numericValue = Number(normalizedValue);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 0;
    }

    return numericValue < 1e12 ? numericValue * 1000 : numericValue;
  }

  const parsedValue = Date.parse(normalizedValue);
  return Number.isNaN(parsedValue) ? 0 : parsedValue;
}

function formatSessionTimestamp(rawValue: string | null | undefined): string {
  const parsedValue = parseSessionTimeValue(rawValue);
  if (parsedValue <= 0) {
    return "";
  }

  return formatChatTimestamp(new Date(parsedValue).toISOString());
}

function detectSessionLabel(
  rawValue: string | null | undefined,
  rules: Array<{ marker: RegExp; label: string }>,
  fallbackLabel: string,
): string {
  const normalizedValue = rawValue?.trim();
  if (!normalizedValue) {
    return fallbackLabel;
  }

  const matchedRule = rules.find((rule) => rule.marker.test(normalizedValue));
  return matchedRule?.label ?? fallbackLabel;
}

function buildSessionDeviceSummary(session: AuthSessionItem): SessionDeviceSummary {
  const browser = detectSessionLabel(session.device_info, BROWSER_RULES, "Unknown browser");
  const os = detectSessionLabel(session.device_info, OS_RULES, "Unknown OS");
  const ip = session.ip_address?.trim() || "Unknown IP";

  return {
    browser,
    os,
    ip,
    compositeKey: `${os}-${browser}-${ip}`,
  };
}

function getSessionLoginTime(session: AuthSessionItem): number {
  return parseSessionTimeValue(session.created_at);
}

function getSessionActivityTime(session: AuthSessionItem): number {
  const lastSeenTime = parseSessionTimeValue(session.last_seen_at);
  return lastSeenTime > 0 ? lastSeenTime : getSessionLoginTime(session);
}

function getSessionActivityLabel(session: AuthSessionItem): string {
  return (
    formatSessionTimestamp(session.last_seen_at) ||
    formatSessionTimestamp(session.created_at) ||
    "未知"
  );
}

function getBrowserIcon(browser: string): LucideIcon {
  switch (browser) {
    case "Chrome":
      return Chrome;
    case "Safari":
      return Compass;
    case "Firefox":
    case "Edge":
      return Globe;
    default:
      return Monitor;
  }
}

function isNewerSession(
  candidate: DeduplicatedSession,
  existing: DeduplicatedSession,
): boolean {
  if (candidate.activityTime !== existing.activityTime) {
    return candidate.activityTime > existing.activityTime;
  }

  if (candidate.loginTime !== existing.loginTime) {
    return candidate.loginTime > existing.loginTime;
  }

  if (candidate.session.is_current !== existing.session.is_current) {
    return candidate.session.is_current;
  }

  return candidate.session.id.localeCompare(existing.session.id) > 0;
}

function deduplicateSessions(sessions: AuthSessionItem[]): DeduplicatedSession[] {
  const sessionMap = new Map<string, DeduplicatedSession>();

  for (const session of sessions) {
    const summary = buildSessionDeviceSummary(session);
    const candidate: DeduplicatedSession = {
      session,
      browser: summary.browser,
      os: summary.os,
      ip: summary.ip,
      compositeKey: summary.compositeKey,
      activityTime: getSessionActivityTime(session),
      loginTime: getSessionLoginTime(session),
    };
    const existing = sessionMap.get(candidate.compositeKey);

    if (!existing || isNewerSession(candidate, existing)) {
      sessionMap.set(candidate.compositeKey, candidate);
    }
  }

  return Array.from(sessionMap.values()).sort((left, right) => {
    if (right.activityTime !== left.activityTime) {
      return right.activityTime - left.activityTime;
    }

    if (right.session.is_current !== left.session.is_current) {
      return Number(right.session.is_current) - Number(left.session.is_current);
    }

    if (right.loginTime !== left.loginTime) {
      return right.loginTime - left.loginTime;
    }

    return right.session.id.localeCompare(left.session.id);
  });
}

function formatTokenBalance(value: number | null | undefined): string {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Number(value ?? 0)));
}

function isPrivilegedAccount(role: AuthenticatedUser["role"] | undefined): boolean {
  return role === "super_admin" || role === "admin";
}

export function UserProfileModal({
  open,
  user,
  isSubmitting,
  isLoadingSessions,
  isResettingPassword,
  sessions,
  revokingSessionId,
  onClose,
  onSave,
  onUploadAvatar,
  onRefreshSessions,
  onRevokeSession,
  onRequestTopUp,
  onResetPassword,
}: UserProfileModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("profile");
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [assetNotice, setAssetNotice] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setActiveTab("profile");
    setNickname(user?.nickname ?? "");
    setBio(user?.bio ?? "");
    setAvatarUrl(user?.avatar_url ?? "");
    setUploadError("");
    setPasswordError("");
    setPasswordSuccess("");
    setAssetNotice("");
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setIsUploadingAvatar(false);
  }, [open, user]);

  const deduplicatedSessions = useMemo(() => deduplicateSessions(sessions), [sessions]);

  if (!open) {
    return null;
  }

  const handleSave = async () => {
    await onSave({
      nickname: nickname.trim() || null,
      bio: bio.trim() || null,
      avatar_url: avatarUrl.trim() || null,
    });
  };

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setUploadError("");
    setIsUploadingAvatar(true);

    try {
      const uploadedUrl = await onUploadAvatar(file);
      setAvatarUrl(uploadedUrl);
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "头像上传失败，请稍后重试。",
      );
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handlePasswordReset = async () => {
    setPasswordError("");
    setPasswordSuccess("");

    if (!oldPassword || !newPassword || !confirmPassword) {
      setPasswordError("请完整填写当前密码、新密码和确认密码。");
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError("新密码至少需要 8 个字符。");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }

    const response = await onResetPassword({
      old_password: oldPassword,
      new_password: newPassword,
    });

    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordSuccess(
      response.revoked_sessions > 0
        ? `密码已更新，已强制下线 ${response.revoked_sessions} 台其他设备。`
        : "密码已更新，当前设备会话已保留。",
    );
  };

  const previewUrl = avatarUrl ? buildAbsoluteUrl(avatarUrl) : "";
  const disableProfileActions = isSubmitting || isUploadingAvatar;
  const disableSecurityAction = isResettingPassword;
  const currentInitial = (nickname || user?.username || "U").slice(0, 1).toUpperCase();
  const privilegedAccount = isPrivilegedAccount(user?.role);
  const tokenBalanceLabel = privilegedAccount
    ? "∞ 无限算力"
    : `${formatTokenBalance(user?.token_balance)} Tokens`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-[28px] border border-border bg-card p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
        data-testid="user-profile-modal"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-semibold text-foreground">个人资料与安全</div>
            <div className="mt-1 text-sm text-muted-foreground">
              维护公开资料、管理登录设备，并在需要时更新密码。
            </div>
          </div>
          <button
            className="rounded-xl p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            onClick={onClose}
            type="button"
            data-testid="user-profile-close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-2 rounded-2xl bg-secondary p-1">
          <button
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === "profile"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("profile")}
            type="button"
            data-testid="user-profile-tab-profile"
          >
            <Camera className="h-4 w-4" />
            资料设置
          </button>
          <button
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === "sessions"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("sessions")}
            type="button"
            data-testid="user-profile-tab-sessions"
          >
            <Shield className="h-4 w-4" />
            登录设备
          </button>
          <button
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === "security"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab("security")}
            type="button"
            data-testid="user-profile-tab-security"
          >
            <LockKeyhole className="h-4 w-4" />
            安全设置
          </button>
        </div>

        {activeTab === "profile" ? (
          <div className="space-y-5">
            <div className="rounded-[24px] border border-brand/15 bg-[linear-gradient(135deg,rgba(255,247,237,0.96),rgba(255,255,255,1),rgba(255,241,242,0.96))] p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-brand">
                    我的资产
                  </div>
                  <div
                    className={`mt-3 text-3xl font-semibold ${
                      privilegedAccount
                        ? "bg-[linear-gradient(135deg,#f97316,#ef4444,#111827)] bg-clip-text text-transparent"
                        : "text-foreground"
                    }`}
                  >
                    {tokenBalanceLabel}
                  </div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">
                    {privilegedAccount
                      ? "尊贵的管理团队账号，享有系统无限算力与最高权限。"
                      : "新账号默认附赠千万级创作算力，可用于内容生成、解析与多模态工作流。"}
                  </div>
                </div>

                {privilegedAccount ? (
                  <div
                    className="inline-flex items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700"
                    data-testid="profile-privileged-tag"
                  >
                    特权账号
                  </div>
                ) : (
                  <button
                    className="inline-flex items-center justify-center rounded-2xl border border-brand/20 bg-card px-4 py-3 text-sm font-medium text-brand transition hover:border-brand/40 hover:bg-brand-soft"
                    onClick={() => {
                      setAssetNotice("支付系统正在接入中，敬请期待。");
                      onRequestTopUp();
                    }}
                    type="button"
                    data-testid="profile-top-up-button"
                  >
                    获取算力 / 去充值
                  </button>
                )}
              </div>

              {assetNotice && !privilegedAccount ? (
                <div className="mt-4 rounded-2xl border border-brand/10 bg-white/85 px-4 py-3 text-sm text-muted-foreground">
                  {assetNotice}
                </div>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-border bg-surface-muted p-4">
              <div className="flex items-center gap-4">
                <div
                  className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl font-semibold text-brand-foreground shadow-sm"
                  style={{ background: "var(--brand-gradient)" }}
                >
                  {previewUrl ? (
                    <img
                      alt="头像预览"
                      className="h-full w-full object-cover"
                      src={previewUrl}
                    />
                  ) : (
                    currentInitial
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-card-foreground">头像</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    支持 JPG、PNG、WEBP。上传后会保存到当前账号的隔离目录。
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground transition hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-70"
                      disabled={disableProfileActions}
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
                      data-testid="profile-avatar-upload-trigger"
                    >
                      {isUploadingAvatar ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Camera className="h-4 w-4" />
                      )}
                      {isUploadingAvatar ? "上传中..." : "上传头像"}
                    </button>

                    <button
                      className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disableProfileActions || !avatarUrl}
                      onClick={() => setAvatarUrl("")}
                      type="button"
                      data-testid="profile-avatar-remove"
                    >
                      <Trash2 className="h-4 w-4" />
                      移除头像
                    </button>
                  </div>
                </div>
              </div>

              <input
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(event) => void handleAvatarChange(event)}
                ref={fileInputRef}
                type="file"
                data-testid="profile-avatar-input"
              />

              {uploadError ? (
                <div className="mt-3 rounded-2xl border border-danger-foreground/20 bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
                  {uploadError}
                </div>
              ) : null}
            </div>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-card-foreground">昵称</div>
              <input
                className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                maxLength={64}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="例如：Ada 内容顾问"
                value={nickname}
                data-testid="profile-nickname-input"
              />
            </label>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-card-foreground">简介</div>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm leading-7 text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                maxLength={280}
                onChange={(event) => setBio(event.target.value)}
                placeholder="例如：专注小红书、抖音内容策划与结构化生产。"
                value={bio}
                data-testid="profile-bio-input"
              />
            </label>
          </div>
        ) : null}

        {activeTab === "sessions" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-border bg-surface-muted px-4 py-3">
              <div>
                <div className="text-sm font-medium text-card-foreground">活跃登录设备</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  你可以查看当前在线设备，并手动下线非当前设备。
                </div>
              </div>
              <button
                className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground transition hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoadingSessions}
                onClick={() => void onRefreshSessions()}
                type="button"
                data-testid="session-refresh-button"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isLoadingSessions ? "animate-spin" : ""}`}
                />
                刷新列表
              </button>
            </div>

            {isLoadingSessions ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`session-skeleton-${index}`}
                    className="rounded-2xl border border-border bg-card p-4"
                  >
                    <div className="mb-3 h-4 w-1/2 animate-pulse rounded bg-surface-subtle" />
                    <div className="mb-2 h-3 w-2/3 animate-pulse rounded bg-surface-subtle" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-surface-subtle" />
                  </div>
                ))}
              </div>
            ) : null}

            {!isLoadingSessions && deduplicatedSessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-surface-muted px-4 py-6 text-sm text-muted-foreground">
                当前没有可展示的活跃设备记录。
              </div>
            ) : null}

            {!isLoadingSessions && deduplicatedSessions.length > 0 ? (
              <div className="space-y-3">
                {deduplicatedSessions.map(({ session, browser, os, ip }) => {
                  const BrowserIcon = getBrowserIcon(browser);

                  return (
                    <div
                    key={session.id}
                    className="rounded-2xl border border-border bg-card p-4"
                    data-testid={`session-card-${session.id}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="inline-flex items-center gap-2 text-sm font-medium text-card-foreground">
                            <BrowserIcon className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate">{browser}{/*
                              {session.device_info || "未知设备"}
                            */}</span>
                          </div>
                          {session.is_current ? (
                            <span className="rounded-full bg-success-surface px-2.5 py-1 text-xs font-medium text-success-foreground">
                              当前设备
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{`OS: ${os}`}</span>
                          <span>{`IP: ${ip}`}</span>
                          <span>{`Last active: ${getSessionActivityLabel(session)}`}</span>
                          <span>
                            Expires:
                            {formatSessionTimestamp(session.expires_at) || "Unknown"}
                          </span>
                        </div>

                        {/* <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>绯荤粺锛?{os}</span>
                          <span>IP锛?{ip}</span>
                          <span>鏈€杩戞椿璺冿細{getSessionActivityLabel(session)}</span>
                          <span>
                            杩囨湡鏃堕棿锛?
                            {formatSessionTimestamp(session.expires_at) || "鏈煡"}
                          </span>
                        </div> */}

                        {/* <div className="hidden">
                          <span>IP：{session.ip_address || "未知"}</span>
                          <span>
                            最近活跃：
                            {formatChatTimestamp(session.last_seen_at) || "未知"}
                          </span>
                          <span>
                            过期时间：
                            {formatChatTimestamp(session.expires_at) || "未知"}
                          </span>
                        </div> */}
                      </div>

                      <button
                        className="rounded-2xl border border-danger-foreground/20 px-3 py-2 text-sm font-medium text-danger-foreground transition hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={session.is_current || revokingSessionId === session.id}
                        onClick={() => void onRevokeSession(session.id)}
                        type="button"
                        data-testid={`session-revoke-${session.id}`}
                      >
                        {revokingSessionId === session.id ? "下线中..." : "踢出设备"}
                      </button>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "security" ? (
          <div className="space-y-5">
            <div className="rounded-[24px] border border-border bg-surface-muted p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-foreground p-2 text-background">
                  <LockKeyhole className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-card-foreground">修改密码</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                    修改成功后，系统会自动吊销其他设备的登录会话，降低账号被盗用的风险。
                  </div>
                </div>
              </div>
            </div>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-card-foreground">当前密码</div>
              <input
                autoComplete="current-password"
                className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                onChange={(event) => setOldPassword(event.target.value)}
                placeholder="请输入当前密码"
                type="password"
                data-testid="profile-current-password-input"
                value={oldPassword}
              />
            </label>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-card-foreground">新密码</div>
              <input
                autoComplete="new-password"
                className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="至少 8 位"
                type="password"
                data-testid="profile-new-password-input"
                value={newPassword}
              />
            </label>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-card-foreground">
                确认新密码
              </div>
              <input
                autoComplete="new-password"
                className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="请再次输入新密码"
                type="password"
                data-testid="profile-confirm-password-input"
                value={confirmPassword}
              />
            </label>

            {passwordError ? (
              <div
                className="rounded-2xl border border-danger-foreground/20 bg-danger-surface px-4 py-3 text-sm text-danger-foreground"
                data-testid="profile-password-error"
              >
                {passwordError}
              </div>
            ) : null}

            {passwordSuccess ? (
              <div
                className="rounded-2xl border border-success-foreground/20 bg-success-surface px-4 py-3 text-sm text-success-foreground"
                data-testid="profile-password-success"
              >
                {passwordSuccess}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground transition hover:bg-muted"
            disabled={disableProfileActions || disableSecurityAction}
            onClick={onClose}
            type="button"
            data-testid="user-profile-cancel"
          >
            取消
          </button>

          {activeTab === "profile" ? (
            <button
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={disableProfileActions}
              onClick={() => void handleSave()}
              type="button"
              data-testid="profile-save-button"
            >
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              保存资料
            </button>
          ) : null}

          {activeTab === "security" ? (
            <button
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-foreground px-4 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={disableSecurityAction}
              onClick={() => void handlePasswordReset()}
              type="button"
              data-testid="profile-password-save-button"
            >
              {isResettingPassword ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : null}
              更新密码
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
