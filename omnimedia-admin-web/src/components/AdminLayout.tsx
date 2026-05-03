import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  Search,
  Settings,
  Shield,
  User,
  UserCog,
} from "lucide-react";
import { NavLink } from "react-router-dom";

import { adminNavigation } from "../adminMeta";
import { buildAbsoluteMediaUrl } from "../api";
import { CLIENT_APP_URL } from "../config";
import type { AuthenticatedUser } from "../types";
import { getDisplayName, getInitials } from "../utils/format";

type AdminLayoutProps = {
  children: ReactNode;
  currentUser: AuthenticatedUser;
  onLogout: () => Promise<void>;
};

const theme = {
  primary: "rgb(244, 63, 94)",
  secondary: "rgb(251, 146, 60)",
  primaryLight: "rgb(254, 242, 242)",
  cardBg: "rgb(255, 255, 255)",
  cardBorder: "rgb(226, 232, 240)",
  cardHover: "rgb(254, 242, 242)",
  sidebarBg: "rgb(255, 255, 255)",
  sidebarBorder: "rgb(226, 232, 240)",
  sidebarHover: "rgb(248, 250, 252)",
  textPrimary: "rgb(30, 41, 59)",
  textSecondary: "rgb(71, 85, 105)",
  textMuted: "rgb(148, 163, 184)",
  success: "rgb(34, 197, 94)",
  warning: "rgb(251, 191, 36)",
  error: "rgb(239, 68, 68)",
};

export function AdminLayout(props: AdminLayoutProps) {
  const { children, currentUser, onLogout } = props;
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const avatarUrl = buildAbsoluteMediaUrl(currentUser.avatar_url);
  const displayName = getDisplayName(currentUser);
  const initials = getInitials(displayName);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-user-menu-root]")) {
        return;
      }
      setUserMenuOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const avatarNode = avatarUrl ? (
    <img
      alt={`${displayName} avatar`}
      className="h-full w-full object-cover"
      src={avatarUrl}
    />
  ) : (
    <User className="h-4 w-4 text-white" />
  );

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
          {adminNavigation.map((module) => {
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
          <div className="mx-4 flex flex-col gap-3 rounded-2xl border border-yellow-100/50 bg-yellow-50/50 p-4 text-sm">
            <h4 className="font-sans font-medium text-gray-800">待处理事项</h4>
            <div className="flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="h-4 w-4" />
              <span>容量预警 2个</span>
            </div>
            <div className="flex items-center gap-2 text-red-500">
              <Ban className="h-4 w-4" />
              <span>异常用户 1个</span>
            </div>
          </div>

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
                全媒体内容管理后台
              </div>
            </div>
          </div>

          <div className="hidden max-w-md flex-1 md:flex">
            <label
              className="flex flex-1 items-center gap-2 rounded-lg px-4 py-2"
              style={{
                backgroundColor: theme.primaryLight,
                border: `1px solid ${theme.cardBorder}`,
              }}
            >
              <Search className="h-4 w-4" style={{ color: theme.textMuted }} />
              <input
                className="w-full border-none bg-transparent text-gray-600 outline-none placeholder:text-gray-400"
                placeholder="搜索用户、模板、日志..."
                type="text"
              />
            </label>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              className="relative flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ backgroundColor: theme.primaryLight }}
              type="button"
            >
              <Bell className="h-5 w-5" style={{ color: theme.primary }} />
              <span
                className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full text-xs text-white"
                style={{ backgroundColor: theme.error }}
              >
                3
              </span>
            </button>

            <div className="relative" data-user-menu-root="" ref={userMenuRef}>
              <button
                className="flex items-center gap-2 rounded-lg px-3 py-1.5"
                onClick={() => setUserMenuOpen((current) => !current)}
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
                  className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-lg shadow-2xl"
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
                      系统管理员
                    </div>
                  </div>
                  <div className="py-1">
                    <button
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-red-50"
                      style={{ color: theme.textSecondary }}
                      type="button"
                    >
                      <UserCog className="h-4 w-4" />
                      个人设置
                    </button>
                    <button
                      className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-red-50"
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

        <main className="flex-1 min-w-0 overflow-y-auto p-8">{children}</main>
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
