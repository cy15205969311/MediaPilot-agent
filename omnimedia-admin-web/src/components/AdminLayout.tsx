import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Bell,
  CheckCircle2,
  ChevronDown,
  Info,
  LogOut,
  Menu,
  Settings,
  Shield,
  User,
  UserCog,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";

import { getAllowedAdminNavigation } from "../adminMeta";
import {
  APIError,
  buildAbsoluteMediaUrl,
  fetchAdminNotifications,
  fetchAdminPendingTasks,
  markAllAdminNotificationsRead,
} from "../api";
import { CLIENT_APP_URL } from "../config";
import type {
  AdminNotificationItem,
  AdminPendingTasks,
  AdminToast,
  AuthenticatedUser,
} from "../types";
import { formatRelativeTime, getDisplayName, getInitials } from "../utils/format";

type AdminLayoutProps = {
  children: ReactNode;
  currentUser: AuthenticatedUser;
  onLogout: () => Promise<void>;
  onToast: (toast: AdminToast) => void;
};

type PendingTaskEntry = {
  key: "abnormal_users" | "storage_warnings";
  label: string;
  count: number;
  to: string;
  icon: typeof Ban;
  className: string;
};

const NOTIFICATION_LIMIT = 5;
const NOTIFICATION_POLL_INTERVAL_MS = 30_000;
const PENDING_TASK_POLL_INTERVAL_MS = 45_000;

const theme = {
  primary: "rgb(244, 63, 94)",
  secondary: "rgb(251, 146, 60)",
  primaryLight: "rgb(254, 242, 242)",
  cardBg: "rgb(255, 255, 255)",
  cardBorder: "rgb(226, 232, 240)",
  sidebarBg: "rgb(255, 255, 255)",
  sidebarBorder: "rgb(226, 232, 240)",
  textPrimary: "rgb(30, 41, 59)",
  textSecondary: "rgb(71, 85, 105)",
  textMuted: "rgb(148, 163, 184)",
  success: "rgb(34, 197, 94)",
  warning: "rgb(234, 179, 8)",
  error: "rgb(239, 68, 68)",
};

function getNotificationMeta(type: AdminNotificationItem["type"]) {
  if (type === "success") {
    return {
      icon: CheckCircle2,
      iconClassName: "text-emerald-500",
      badgeClassName: "bg-emerald-50 text-emerald-600",
      dotClassName: "bg-emerald-500",
    };
  }
  if (type === "warning") {
    return {
      icon: AlertTriangle,
      iconClassName: "text-amber-500",
      badgeClassName: "bg-amber-50 text-amber-600",
      dotClassName: "bg-rose-500",
    };
  }
  return {
    icon: Info,
    iconClassName: "text-sky-500",
    badgeClassName: "bg-sky-50 text-sky-600",
    dotClassName: "bg-rose-500",
  };
}

function formatUnreadCount(unreadCount: number): string {
  if (unreadCount > 99) {
    return "99+";
  }
  return String(unreadCount);
}

export function AdminLayout(props: AdminLayoutProps) {
  const { children, currentUser, onLogout, onToast } = props;
  const navigate = useNavigate();
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 1024,
  );
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState<AdminNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingTasks, setPendingTasks] = useState<AdminPendingTasks | null>(null);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(true);
  const [isPendingTasksLoading, setIsPendingTasksLoading] = useState(true);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);
  const avatarUrl = buildAbsoluteMediaUrl(currentUser.avatar_url);
  const displayName = getDisplayName(currentUser);
  const initials = getInitials(displayName);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationRef = useRef<HTMLDivElement | null>(null);
  const allowedNavigation = useMemo(
    () => getAllowedAdminNavigation(currentUser.role),
    [currentUser.role],
  );
  const canAccessUsers = allowedNavigation.some((item) => item.to === "/users");
  const canAccessStorage = allowedNavigation.some((item) => item.to === "/storage");
  const canAccessSettings = allowedNavigation.some((item) => item.to === "/settings");

  const pendingTaskEntries = useMemo<PendingTaskEntry[]>(() => {
    const entries: PendingTaskEntry[] = [];

    if (canAccessUsers && (pendingTasks?.abnormal_users ?? 0) > 0) {
      entries.push({
        key: "abnormal_users",
        label: "异常用户",
        count: pendingTasks?.abnormal_users ?? 0,
        to: "/users?status=frozen",
        icon: Ban,
        className: "text-rose-500 hover:bg-rose-50/70",
      });
    }

    if (canAccessStorage && (pendingTasks?.storage_warnings ?? 0) > 0) {
      entries.push({
        key: "storage_warnings",
        label: "容量预警",
        count: pendingTasks?.storage_warnings ?? 0,
        to: "/storage",
        icon: AlertTriangle,
        className: "text-amber-600 hover:bg-amber-50/80",
      });
    }

    return entries;
  }, [canAccessStorage, canAccessUsers, pendingTasks]);

  const avatarNode = avatarUrl ? (
    <img
      alt={`${displayName} avatar`}
      className="h-full w-full object-cover"
      src={avatarUrl}
    />
  ) : (
    <User className="h-4 w-4 text-white" />
  );

  const loadNotifications = async () => {
    try {
      const payload = await fetchAdminNotifications({ limit: NOTIFICATION_LIMIT });
      setNotifications(payload.items);
      setUnreadCount(payload.unread_count);
    } catch (error) {
      if (error instanceof APIError && error.status === 403) {
        return;
      }
    } finally {
      setIsNotificationsLoading(false);
    }
  };

  const loadPendingTasks = async () => {
    try {
      const payload = await fetchAdminPendingTasks();
      setPendingTasks(payload);
    } catch (error) {
      if (error instanceof APIError && error.status === 403) {
        return;
      }
    } finally {
      setIsPendingTasksLoading(false);
    }
  };

  useEffect(() => {
    let isDisposed = false;

    const hydrate = async () => {
      await Promise.allSettled([loadNotifications(), loadPendingTasks()]);
    };

    void hydrate();

    const notificationTimer = window.setInterval(() => {
      if (!isDisposed) {
        void loadNotifications();
      }
    }, NOTIFICATION_POLL_INTERVAL_MS);
    const pendingTimer = window.setInterval(() => {
      if (!isDisposed) {
        void loadPendingTasks();
      }
    }, PENDING_TASK_POLL_INTERVAL_MS);

    return () => {
      isDisposed = true;
      window.clearInterval(notificationTimer);
      window.clearInterval(pendingTimer);
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;

      if (target?.closest("[data-user-menu-root]")) {
        return;
      }
      if (target?.closest("[data-notification-root]")) {
        return;
      }

      setUserMenuOpen(false);
      setNotificationOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const handleToggleNotifications = async () => {
    const nextOpen = !notificationOpen;
    setNotificationOpen(nextOpen);
    setUserMenuOpen(false);

    if (nextOpen) {
      await loadNotifications();
    }
  };

  const handleMarkAllRead = async () => {
    if (unreadCount <= 0 || isMarkingAllRead) {
      return;
    }

    setIsMarkingAllRead(true);
    try {
      const response = await markAllAdminNotificationsRead();
      setUnreadCount(response.unread_count);
      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          is_read: true,
        })),
      );
      onToast({
        tone: "success",
        title: "消息已全部标记为已读",
        message: `本次共处理 ${response.updated_count} 条通知。`,
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: "消息状态更新失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "标记已读失败，请稍后重试。",
      });
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const handleOpenPersonalSettings = () => {
    setUserMenuOpen(false);
    onToast({
      tone: "warning",
      title: "个人设置即将开放",
      message: "个人资料与安全偏好入口正在开发中。",
    });
  };

  const handleOpenSystemSettings = () => {
    setUserMenuOpen(false);
    if (!canAccessSettings) {
      onToast({
        tone: "warning",
        title: "当前账号暂无权限",
        message: "只有具备系统设置权限的管理员可以访问该页面。",
      });
      return;
    }
    navigate("/settings");
  };

  const handlePendingTaskNavigate = (to: string) => {
    setLeftSidebarOpen(false);
    navigate(to);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[linear-gradient(to_bottom_right,rgb(255,247,237),rgb(255,255,255),rgb(255,241,242))]">
      <aside
        className={`fixed left-0 top-0 z-40 flex h-screen w-64 min-w-[16rem] max-w-[16rem] flex-none shrink-0 flex-col overflow-y-auto transition-transform duration-300 lg:sticky lg:translate-x-0 ${
          leftSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{
          backgroundColor: theme.sidebarBg,
          borderRight: `1px solid ${theme.sidebarBorder}`,
        }}
      >
        <div className="p-4">
          <div
            className="rounded-lg px-3 py-2 text-xs font-medium"
            style={{
              backgroundColor: `${theme.success}20`,
              color: theme.success,
            }}
          >
            生产环境
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {allowedNavigation.map((module) => {
            const Icon = module.icon;
            return (
              <NavLink
                key={module.key}
                className={({ isActive }) =>
                  [
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    isActive ? "font-medium" : "",
                  ].join(" ")
                }
                onClick={() => setLeftSidebarOpen(false)}
                style={({ isActive }) => ({
                  backgroundColor: isActive ? theme.primaryLight : "transparent",
                  color: isActive ? theme.primary : theme.textSecondary,
                })}
                to={module.to}
              >
                <Icon className="h-5 w-5" />
                <span className="flex-1 font-medium">{module.title}</span>
                {module.badge ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{
                      backgroundColor: theme.primaryLight,
                      color: theme.primary,
                    }}
                  >
                    {module.badge}
                  </span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="mt-auto pb-6">
          {!isPendingTasksLoading && pendingTaskEntries.length > 0 ? (
            <div className="mx-4 flex flex-col gap-3 rounded-2xl border border-yellow-100/60 bg-yellow-50/70 p-4 text-sm shadow-[0_16px_40px_rgba(250,204,21,0.12)]">
              <h4 className="font-medium text-slate-800">待处理事项</h4>
              {pendingTaskEntries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button
                    key={entry.key}
                    className={`flex items-center gap-2 rounded-xl px-2 py-2 text-left transition ${entry.className}`}
                    onClick={() => handlePendingTaskNavigate(entry.to)}
                    type="button"
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      {entry.label} {entry.count} 个
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <a
            className="mx-4 mt-4 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-xl bg-red-50 p-3 text-center font-medium text-red-500 transition-colors hover:bg-red-100"
            href={CLIENT_APP_URL}
            rel="noreferrer"
            target="_blank"
          >
            <ArrowLeft className="h-4 w-4" />
            返回工作台
          </a>
        </div>
      </aside>

      <div className="flex h-screen w-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#FDFDFD]">
        <header
          className="flex h-16 shrink-0 items-center border-b px-4 backdrop-blur-md lg:px-6"
          style={{
            backgroundColor: `${theme.cardBg}cc`,
            borderColor: theme.cardBorder,
          }}
        >
          <button
            className="mr-3 lg:hidden"
            onClick={() => setLeftSidebarOpen((current) => !current)}
            type="button"
          >
            <Menu className="h-6 w-6" style={{ color: theme.textSecondary }} />
          </button>

          <div className="mr-6 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-red-500 to-orange-400">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div className="hidden sm:block">
              <div className="font-bold" style={{ color: theme.textPrimary }}>
                OmniMedia Console
              </div>
              <div className="text-xs" style={{ color: theme.textMuted }}>
                全媒体内容治理后台
              </div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="relative" data-notification-root="" ref={notificationRef}>
              <button
                className="relative flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-red-100"
                onClick={() => void handleToggleNotifications()}
                style={{ backgroundColor: theme.primaryLight }}
                type="button"
              >
                <Bell className="h-5 w-5" style={{ color: theme.primary }} />
                {unreadCount > 0 ? (
                  <span
                    className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white"
                    style={{ backgroundColor: theme.error }}
                  >
                    {formatUnreadCount(unreadCount)}
                  </span>
                ) : null}
              </button>

              {notificationOpen ? (
                <div
                  className="absolute right-0 top-full z-[70] mt-3 w-[360px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.16)]"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">消息中心</div>
                      <div className="mt-1 text-xs text-slate-400">
                        最近 {NOTIFICATION_LIMIT} 条系统通知
                      </div>
                    </div>
                    <button
                      className="text-xs font-medium text-red-500 transition hover:text-red-600 disabled:cursor-not-allowed disabled:text-slate-300"
                      disabled={unreadCount <= 0 || isMarkingAllRead}
                      onClick={() => void handleMarkAllRead()}
                      type="button"
                    >
                      {isMarkingAllRead ? "处理中..." : "全部标为已读"}
                    </button>
                  </div>

                  <div className="max-h-[360px] overflow-y-auto px-3 py-3">
                    {isNotificationsLoading ? (
                      <div className="space-y-3 p-2">
                        {Array.from({ length: 3 }).map((_, index) => (
                          <div
                            key={`notification-skeleton-${index}`}
                            className="h-20 animate-pulse rounded-2xl bg-slate-100"
                          />
                        ))}
                      </div>
                    ) : notifications.length > 0 ? (
                      <div className="space-y-2">
                        {notifications.map((notification) => {
                          const meta = getNotificationMeta(notification.type);
                          const Icon = meta.icon;
                          return (
                            <div
                              key={notification.id}
                              className={`rounded-2xl border px-3 py-3 transition ${
                                notification.is_read
                                  ? "border-slate-100 bg-white"
                                  : "border-red-100 bg-red-50/40"
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${meta.badgeClassName}`}
                                >
                                  <Icon className={`h-4 w-4 ${meta.iconClassName}`} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    {!notification.is_read ? (
                                      <span className={`h-2 w-2 rounded-full ${meta.dotClassName}`} />
                                    ) : null}
                                    <div className="truncate text-sm font-semibold text-slate-900">
                                      {notification.title}
                                    </div>
                                  </div>
                                  <div className="mt-1 text-sm leading-6 text-slate-500">
                                    {notification.content}
                                  </div>
                                  <div className="mt-2 text-xs text-slate-400">
                                    {formatRelativeTime(notification.created_at)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center text-sm text-slate-400">
                        当前没有新的系统消息。
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative" data-user-menu-root="" ref={userMenuRef}>
              <button
                className="flex items-center gap-2 rounded-lg px-3 py-1.5"
                onClick={() => {
                  setUserMenuOpen((current) => !current);
                  setNotificationOpen(false);
                }}
                style={{ backgroundColor: theme.primaryLight }}
                type="button"
              >
                <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-red-500 to-orange-400 text-xs font-bold text-white">
                  {avatarUrl ? avatarNode : initials.slice(0, 1)}
                </div>
                <span
                  className="hidden max-w-28 truncate text-sm font-medium sm:block"
                  style={{ color: theme.textPrimary }}
                >
                  {displayName || "管理员"}
                </span>
                <ChevronDown className="h-4 w-4" style={{ color: theme.textMuted }} />
              </button>

              {userMenuOpen ? (
                <div
                  className="absolute right-0 top-full z-[70] mt-2 w-56 overflow-hidden rounded-lg shadow-2xl"
                  style={{
                    backgroundColor: theme.cardBg,
                    border: `1px solid ${theme.cardBorder}`,
                  }}
                >
                  <div className="border-b px-4 py-3" style={{ borderColor: theme.cardBorder }}>
                    <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>
                      {displayName || "管理员"}
                    </div>
                    <div className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                      后台管理账号
                    </div>
                  </div>
                  <div className="py-1">
                    <button
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-red-50"
                      onClick={handleOpenPersonalSettings}
                      style={{ color: theme.textSecondary }}
                      type="button"
                    >
                      <UserCog className="h-4 w-4" />
                      个人设置
                    </button>
                    <button
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-red-50"
                      onClick={handleOpenSystemSettings}
                      style={{ color: theme.textSecondary }}
                      type="button"
                    >
                      <Settings className="h-4 w-4" />
                      系统设置
                    </button>
                  </div>
                  <div className="border-t" style={{ borderColor: theme.cardBorder }}>
                    <button
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-red-50"
                      onClick={() => {
                        setUserMenuOpen(false);
                        void onLogout();
                      }}
                      style={{ color: theme.error }}
                      type="button"
                    >
                      <LogOut className="h-4 w-4" />
                      退出登录
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto p-8">{children}</main>
      </div>

      <div
        className={`fixed inset-0 z-30 bg-black/20 transition-opacity lg:hidden ${
          leftSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setLeftSidebarOpen(false)}
      />
    </div>
  );
}
