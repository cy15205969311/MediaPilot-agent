import {
  Camera,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  RefreshCw,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

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
  onResetPassword: (
    payload: ResetPasswordPayload,
  ) => Promise<ResetPasswordResponse> | ResetPasswordResponse;
};

type ModalTab = "profile" | "sessions" | "security";

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
  onResetPassword,
}: UserProfileModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("profile");
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
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
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setIsUploadingAvatar(false);
  }, [open, user]);

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

  const handleAvatarChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
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

  const handlePasswordReset = async (): Promise<void> => {
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
      <div className="w-full max-w-3xl rounded-[28px] border border-white/70 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="text-xl font-semibold text-slate-900">
              个人资料与安全
            </div>
            <div className="mt-1 text-sm text-slate-500">
              维护公开资料、管理登录设备，并在需要时更新密码。
            </div>
          </div>
          <button
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1">
          <button
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === "profile"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            onClick={() => setActiveTab("profile")}
            type="button"
          >
            <Camera className="h-4 w-4" />
            资料设置
          </button>
          <button
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === "sessions"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            onClick={() => setActiveTab("sessions")}
            type="button"
          >
            <Shield className="h-4 w-4" />
            登录设备
          </button>
          <button
            className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
              activeTab === "security"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
            onClick={() => setActiveTab("security")}
            type="button"
          >
            <LockKeyhole className="h-4 w-4" />
            安全设置
          </button>
        </div>

        {activeTab === "profile" ? (
          <div className="space-y-5">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-rose-400 to-orange-400 text-2xl font-semibold text-white shadow-sm">
                  {previewUrl ? (
                    <img
                      alt="头像预览"
                      className="h-full w-full object-cover"
                      src={previewUrl}
                    />
                  ) : (
                    (nickname || user?.username || "U").slice(0, 1).toUpperCase()
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-800">头像</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    支持 JPG、PNG、WEBP。上传后会保存到当前账号的隔离目录。
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-rose-300 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-70"
                      disabled={disableProfileActions}
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
                    >
                      {isUploadingAvatar ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Camera className="h-4 w-4" />
                      )}
                      {isUploadingAvatar ? "上传中..." : "上传头像"}
                    </button>

                    <button
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={disableProfileActions || !avatarUrl}
                      onClick={() => setAvatarUrl("")}
                      type="button"
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
              />

              {uploadError ? (
                <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                  {uploadError}
                </div>
              ) : null}
            </div>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">昵称</div>
              <input
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                maxLength={64}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="例如：Ada 内容顾问"
                value={nickname}
              />
            </label>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">简介</div>
              <textarea
                className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-7 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                maxLength={280}
                onChange={(event) => setBio(event.target.value)}
                placeholder="例如：专注小红书、抖音内容策划与结构化生产。"
                value={bio}
              />
            </label>
          </div>
        ) : null}

        {activeTab === "sessions" ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-800">
                  活跃登录设备
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  你可以查看当前在线设备，并手动下线非当前设备。
                </div>
              </div>
              <button
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-rose-300 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isLoadingSessions}
                onClick={() => void onRefreshSessions()}
                type="button"
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
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="mb-3 h-4 w-1/2 animate-pulse rounded bg-slate-200" />
                    <div className="mb-2 h-3 w-2/3 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-slate-200" />
                  </div>
                ))}
              </div>
            ) : null}

            {!isLoadingSessions && sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                当前没有可展示的活跃设备记录。
              </div>
            ) : null}

            {!isLoadingSessions && sessions.length > 0 ? (
              <div className="space-y-3">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-800">
                            <Monitor className="h-4 w-4 text-slate-500" />
                            <span className="truncate">
                              {session.device_info || "未知设备"}
                            </span>
                          </div>
                          {session.is_current ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                              当前设备
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>IP：{session.ip_address || "未知"}</span>
                          <span>
                            最近活跃：
                            {formatChatTimestamp(session.last_seen_at) || "未知"}
                          </span>
                          <span>
                            过期时间：
                            {formatChatTimestamp(session.expires_at) || "未知"}
                          </span>
                        </div>
                      </div>

                      <button
                        className="rounded-2xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={session.is_current || revokingSessionId === session.id}
                        onClick={() => void onRevokeSession(session.id)}
                        type="button"
                      >
                        {revokingSessionId === session.id ? "下线中..." : "踢出设备"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "security" ? (
          <div className="space-y-5">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-slate-900 p-2 text-white">
                  <LockKeyhole className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-800">
                    修改密码
                  </div>
                  <div className="mt-1 text-xs leading-5 text-slate-500">
                    修改成功后，系统会自动吊销其他设备的登录会话，降低账号被盗用的风险。
                  </div>
                </div>
              </div>
            </div>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">
                当前密码
              </div>
              <input
                autoComplete="current-password"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                onChange={(event) => setOldPassword(event.target.value)}
                placeholder="请输入当前密码"
                type="password"
                value={oldPassword}
              />
            </label>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">
                新密码
              </div>
              <input
                autoComplete="new-password"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="至少 8 位"
                type="password"
                value={newPassword}
              />
            </label>

            <label className="block">
              <div className="mb-2 text-sm font-medium text-slate-700">
                确认新密码
              </div>
              <input
                autoComplete="new-password"
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="请再次输入新密码"
                type="password"
                value={confirmPassword}
              />
            </label>

            {passwordError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                {passwordError}
              </div>
            ) : null}

            {passwordSuccess ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {passwordSuccess}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            disabled={disableProfileActions || disableSecurityAction}
            onClick={onClose}
            type="button"
          >
            取消
          </button>

          {activeTab === "profile" ? (
            <button
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-3 text-sm font-medium text-white transition hover:from-rose-600 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={disableProfileActions}
              onClick={() => void handleSave()}
              type="button"
            >
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              保存资料
            </button>
          ) : null}

          {activeTab === "security" ? (
            <button
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-700 px-4 py-3 text-sm font-medium text-white transition hover:from-slate-800 hover:to-slate-600 disabled:cursor-not-allowed disabled:opacity-70"
              disabled={disableSecurityAction}
              onClick={() => void handlePasswordReset()}
              type="button"
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
