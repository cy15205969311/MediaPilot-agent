import {
  BarChart3,
  ChevronLeft,
  Clock,
  FileText,
  LogOut,
  Pencil,
  Plus,
  Settings,
  Target,
  Trash2,
  UserCircle2,
  X,
} from "lucide-react";

import type { AuthenticatedUser, ThreadItem } from "../types";
import { buildAbsoluteUrl, getDisplayName } from "../utils";

type LeftSidebarProps = {
  open: boolean;
  isDesktopCollapsed: boolean;
  threads: ThreadItem[];
  isLoading: boolean;
  activeThreadId: string;
  mutatingThreadId: string | null;
  currentUser: AuthenticatedUser;
  onCreateThread: () => void;
  onDeleteThread: (thread: ThreadItem) => void;
  onRenameThread: (thread: ThreadItem) => void;
  onSelectThread: (thread: ThreadItem) => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  onClose: () => void;
  onToggleDesktopCollapse: () => void;
};

const shortcuts = [
  { label: "选题池", count: 12, icon: Target },
  { label: "模板库", count: 8, icon: FileText },
  { label: "数据看板", count: undefined, icon: BarChart3 },
  { label: "草稿箱", count: 3, icon: Clock },
];

export function LeftSidebar({
  open,
  isDesktopCollapsed,
  threads,
  isLoading,
  activeThreadId,
  mutatingThreadId,
  currentUser,
  onCreateThread,
  onDeleteThread,
  onRenameThread,
  onSelectThread,
  onOpenProfile,
  onLogout,
  onClose,
  onToggleDesktopCollapse,
}: LeftSidebarProps) {
  const displayName = getDisplayName(currentUser);
  const avatarUrl = currentUser.avatar_url ? buildAbsoluteUrl(currentUser.avatar_url) : "";

  return (
    <aside
      className={`fixed inset-y-16 left-0 z-40 w-80 border-r border-border bg-card shadow-sm transition-transform duration-300 lg:static lg:shrink-0 lg:translate-x-0 lg:transition-[width,border-color] lg:duration-300 ${
        open ? "translate-x-0" : "-translate-x-full"
      } ${isDesktopCollapsed ? "lg:w-0 lg:border-r-transparent" : "lg:w-80"}`}
    >
      <div
        className={`flex h-full flex-col overflow-hidden transition-opacity duration-200 ${
          isDesktopCollapsed ? "lg:pointer-events-none lg:opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-5">
          <div className="text-2xl font-bold tracking-tight text-foreground">工作区</div>
          <div className="flex items-center gap-2">
            <button
              aria-expanded={!isDesktopCollapsed}
              aria-label="折叠左侧边栏"
              className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-brand/40 hover:text-foreground lg:inline-flex"
              onClick={onToggleDesktopCollapse}
              type="button"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              aria-label="关闭左侧边栏"
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:bg-muted lg:hidden"
              onClick={onClose}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="border-b border-border p-4">
          <button
            className="w-full rounded-[24px] bg-surface-tint p-4 text-left transition hover:shadow-sm"
            onClick={onOpenProfile}
            type="button"
            data-testid="sidebar-open-profile"
          >
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full text-brand-foreground shadow-sm"
                style={{ background: "var(--brand-gradient)" }}
              >
                {avatarUrl ? (
                  <img
                    alt={`${displayName} avatar`}
                    className="h-full w-full object-cover"
                    src={avatarUrl}
                  />
                ) : (
                  <UserCircle2 className="h-6 w-6" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-xl font-semibold text-foreground">
                  {displayName}
                </div>
                <div className="truncate text-sm text-muted-foreground">
                  @{currentUser.username}
                </div>
              </div>

              <div className="rounded-2xl bg-card p-2.5 text-muted-foreground">
                <Settings className="h-4 w-4" />
              </div>
            </div>

            <div className="text-sm leading-6 text-muted-foreground">
              {currentUser.bio?.trim()
                ? currentUser.bio
                : "点击这里补充昵称、头像与简介，让工作台更贴近你的品牌身份。"}
            </div>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">最近会话</h3>
            <button
              aria-label="新建会话"
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
              onClick={onCreateThread}
              type="button"
              data-testid="sidebar-create-thread"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-2">
            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={`thread-skeleton-${index}`}
                    className="rounded-2xl border border-border bg-muted p-3"
                  >
                    <div className="mb-2 h-4 w-3/4 animate-pulse rounded bg-surface-subtle" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-surface-subtle" />
                  </div>
                ))}
              </div>
            ) : null}

            {!isLoading && threads.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted p-4 text-sm leading-6 text-muted-foreground">
                暂无历史会话。点击右上角的加号，创建一个带标题和人设配置的新会话。
              </div>
            ) : null}

            {threads.map((thread) => {
              const isActive = activeThreadId === thread.id;
              const isMutating = mutatingThreadId === thread.id;

              return (
                <div
                  key={thread.id}
                  className={`group rounded-2xl p-1 transition ${
                    isActive ? "bg-secondary" : "hover:bg-muted"
                  }`}
                >
                  <button
                    className="w-full rounded-xl px-3 py-3 text-left"
                    disabled={isMutating}
                    onClick={() => onSelectThread(thread)}
                    type="button"
                    data-testid={`sidebar-thread-${thread.id}`}
                  >
                    <div className="mb-1 flex items-start justify-between gap-3">
                      <div className="truncate text-sm font-medium text-foreground">
                        {thread.title}
                      </div>
                      {thread.platform ? (
                        <span
                          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                            thread.platform === "xiaohongshu"
                              ? "bg-brand"
                              : "bg-secondary-foreground"
                          }`}
                        />
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{thread.time}</div>
                  </button>

                  <div className="flex items-center gap-1 px-2 pb-2 opacity-0 transition group-hover:opacity-100">
                    <button
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs text-muted-foreground transition hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isMutating}
                      onClick={() => onRenameThread(thread)}
                      type="button"
                      data-testid={`sidebar-thread-rename-${thread.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      重命名
                    </button>
                    <button
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-danger-foreground/20 px-2 text-xs text-danger-foreground transition hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isMutating}
                      onClick={() => onDeleteThread(thread)}
                      type="button"
                      data-testid={`sidebar-thread-delete-${thread.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 border-t border-border pt-6">
            <h3 className="mb-3 text-sm font-semibold text-foreground">快捷入口</h3>
            <div className="space-y-2">
              {shortcuts.map((item) => (
                <button
                  key={item.label}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-card-foreground transition hover:bg-muted"
                  type="button"
                >
                  <item.icon className="h-4 w-4" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.count ? (
                    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">
                      {item.count}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-border p-4">
          <button
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground transition hover:bg-muted"
            onClick={onLogout}
            type="button"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </div>
    </aside>
  );
}
