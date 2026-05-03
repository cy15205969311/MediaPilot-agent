import { useEffect, useMemo, useState } from "react";
import {
  Coins,
  Copy,
  Eye,
  Filter,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";

import {
  APIError,
  fetchAdminUsers,
  isAdminRole,
  resetAdminUserPassword,
  updateAdminUserStatus,
  updateAdminUserTokens,
} from "../api";
import { UserAvatar } from "../components/UserAvatar";
import type {
  AdminTokenAdjustAction,
  AdminToast,
  AdminUserItem,
  AdminUsersApiResponse,
  AuthenticatedUser,
} from "../types";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  formatRoleLabel,
  formatStatusLabel,
} from "../utils/format";

type PasswordRevealState = {
  username: string;
  password: string;
} | null;

type UserFilterTab = "all" | "standard" | "premium" | "frozen";

type AdminUsersPageProps = {
  currentUser: AuthenticatedUser;
  onToast: (toast: AdminToast) => void;
};

const DEFAULT_PAGE_SIZE = 20;
const TOKEN_QUICK_PACKS = [10000, 50000, 100000] as const;

function getUserDisplayName(user: Pick<AdminUserItem, "nickname" | "username">): string {
  return user.nickname?.trim() || user.username;
}

function isProtectedSuperAdmin(user: Pick<AdminUserItem, "role">): boolean {
  return user.role === "super_admin";
}

function isUnlimitedTokenUser(user: Pick<AdminUserItem, "role">): boolean {
  return user.role === "super_admin" || user.role === "admin";
}

function canAdjustToken(user: Pick<AdminUserItem, "role">): boolean {
  return !isUnlimitedTokenUser(user);
}

function getRoleBadgeClass(role: AdminUserItem["role"]): string {
  if (role === "super_admin") {
    return "bg-slate-900 text-white";
  }
  if (role === "admin") {
    return "bg-amber-50 text-amber-600";
  }
  if (role === "operator") {
    return "bg-orange-50 text-orange-600";
  }
  if (role === "premium") {
    return "bg-blue-50 text-blue-600";
  }
  return "bg-slate-100 text-slate-600";
}

function getActionTitle(action: AdminTokenAdjustAction): string {
  if (action === "add") {
    return "增加额度";
  }
  if (action === "deduct") {
    return "扣减额度";
  }
  return "设定余额";
}

export function formatSessionDeviceInfo(value?: string | null): string {
  return normalizeLatestSessionDeviceInfo(value);

  const normalized = (value || "").trim();
  if (!normalized) {
    return "鏈煡璁惧";
  }

  return normalized
    .replace(/\s+路\s+/g, " · ")
    .replace(/\s+on\s+/gi, " · ")
    .replace(/\s+[\\/|]+\s+/g, " · ");
}

export function formatLatestSessionMeta(user: Pick<AdminUserItem, "latest_session">): string {
  return buildLatestSessionMeta(user);

  const latestSession = user.latest_session ?? {
    ip_address: "",
    last_seen_at: null,
    created_at: null,
  };
  if (!user.latest_session) {
    return "鏆傛棤娲诲姩璁板綍";
  }

  const parts: string[] = [];
  if (latestSession.ip_address?.trim()) {
    parts.push(`IP ${latestSession.ip_address?.trim() || ""}`);
  }

  const relativeTime = formatRelativeTime(
    latestSession.last_seen_at ?? latestSession.created_at,
  );
  if (relativeTime !== "鏆傛棤") {
    parts.push(relativeTime);
  }

  return parts.join(" · ") || "鏆傛棤娲诲姩璁板綍";
}

const DEVICE_INFO_SEPARATOR_SAFE = ` ${String.fromCharCode(183)} `;
const KNOWN_DEVICE_BROWSERS_SAFE = [
  "Edge",
  "Chrome",
  "Firefox",
  "Safari",
  "TestClient",
  "curl",
];
const KNOWN_DEVICE_SYSTEMS_SAFE = [
  "Windows",
  "macOS",
  "iOS",
  "iPadOS",
  "Android",
  "Linux",
];

function normalizeLatestSessionDeviceInfo(value?: string | null): string {
  const normalized = (value || "").trim();
  if (!normalized) {
    return "Unknown device";
  }

  const lowerValue = normalized.toLowerCase();
  const browser = KNOWN_DEVICE_BROWSERS_SAFE.find((item) =>
    lowerValue.includes(item.toLowerCase()),
  );
  const system = KNOWN_DEVICE_SYSTEMS_SAFE.find((item) =>
    lowerValue.includes(item.toLowerCase()),
  );

  if (browser && system) {
    return `${browser}${DEVICE_INFO_SEPARATOR_SAFE}${system}`;
  }

  return normalized
    .replace(/\s+on\s+/gi, DEVICE_INFO_SEPARATOR_SAFE)
    .replace(/\s+[\\/|]+\s+/g, DEVICE_INFO_SEPARATOR_SAFE);
}

function buildLatestSessionMeta(user: Pick<AdminUserItem, "latest_session">): string {
  const latestSession = user.latest_session;
  if (!latestSession) {
    return "--";
  }

  const parts: string[] = [];
  if (latestSession.ip_address?.trim()) {
    parts.push(`IP ${latestSession.ip_address.trim()}`);
  }

  const relativeTime = formatRelativeTime(
    latestSession.last_seen_at ?? latestSession.created_at,
  );
  if (relativeTime !== "--") {
    parts.push(relativeTime);
  }

  return parts.join(DEVICE_INFO_SEPARATOR_SAFE) || "--";
}

export function AdminUsersPage(props: AdminUsersPageProps) {
  const { currentUser, onToast } = props;
  const [usersPayload, setUsersPayload] = useState<AdminUsersApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<UserFilterTab>("all");
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearchInput, setDebouncedSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [skip, setSkip] = useState(0);
  const [tokenModalUser, setTokenModalUser] = useState<AdminUserItem | null>(null);
  const [tokenAction, setTokenAction] = useState<AdminTokenAdjustAction>("add");
  const [tokenAmount, setTokenAmount] = useState("1000");
  const [tokenRemark, setTokenRemark] = useState("");
  const [revealedPassword, setRevealedPassword] = useState<PasswordRevealState>(null);

  const total = usersPayload?.total ?? 0;
  const items = usersPayload?.items ?? [];
  const currentPage = Math.floor(skip / DEFAULT_PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const selectedUser = items.find((item) => item.id === selectedUserId) ?? null;
  const parsedTokenAmount = Number(tokenAmount);
  const tokenPreviewBalance =
    tokenModalUser && Number.isInteger(parsedTokenAmount) && parsedTokenAmount >= 0
      ? tokenAction === "add"
        ? tokenModalUser.token_balance + parsedTokenAmount
        : tokenAction === "deduct"
          ? tokenModalUser.token_balance - parsedTokenAmount
          : parsedTokenAmount
      : null;

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      if (activeTab === "standard") {
        return item.role === "user";
      }
      if (activeTab === "premium") {
        return item.role === "premium" || isAdminRole(item.role);
      }
      if (activeTab === "frozen") {
        return item.status === "frozen";
      }
      return true;
    });
  }, [activeTab, items]);

  const tabItems: Array<{ key: UserFilterTab; label: string; count: number }> = useMemo(
    () => [
      { key: "all", label: "全部用户", count: items.length },
      {
        key: "standard",
        label: "普通用户",
        count: items.filter((item) => item.role === "user").length,
      },
      {
        key: "premium",
        label: "高级与管理账号",
        count: items.filter((item) => item.role === "premium" || isAdminRole(item.role)).length,
      },
      {
        key: "frozen",
        label: "冻结用户",
        count: items.filter((item) => item.status === "frozen").length,
      },
    ],
    [items],
  );

  const paginationText =
    total === 0
      ? "当前筛选条件下暂无用户。"
      : `显示 ${formatNumber(skip + 1)}-${formatNumber(
          Math.min(skip + items.length, total),
        )}，共 ${formatNumber(total)} 条`;

  const loadUsers = async () => {
    setIsLoading(true);

    try {
      const payload = await fetchAdminUsers({
        skip,
        limit: DEFAULT_PAGE_SIZE,
        search: searchKeyword,
      });
      setUsersPayload(payload);
    } catch (error) {
      onToast({
        tone: "error",
        title: "用户列表加载失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "加载用户列表失败，请稍后重试。",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [skip, searchKeyword]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchInput(searchInput);
    }, 280);

    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    const normalizedKeyword = debouncedSearchInput.trim();
    if (normalizedKeyword === searchKeyword) {
      return;
    }

    setSkip(0);
    setSearchKeyword(normalizedKeyword);
  }, [debouncedSearchInput, searchKeyword]);

  useEffect(() => {
    if (!items.length) {
      setSelectedUserId(null);
      setDetailOpen(false);
      return;
    }

    setSelectedUserId((current) =>
      current && items.some((item) => item.id === current) ? current : items[0].id,
    );
  }, [items]);

  const replaceUserInState = (updatedUser: AdminUserItem) => {
    setUsersPayload((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        items: current.items.map((item) =>
          item.id === updatedUser.id ? updatedUser : item,
        ),
      };
    });
  };

  const showProtectedAccountToast = (user: AdminUserItem) => {
    const isPeerSuperAdmin =
      currentUser.role === "super_admin" && user.role === "super_admin";

    onToast({
      tone: "warning",
      title: "超级管理员账号已受保护",
      message: isPeerSuperAdmin
        ? "同级超级管理员之间禁止互相冻结、重置密码或调整额度。"
        : "超级管理员账号仅支持查看详情，危险操作已由前后端共同锁定。",
    });
  };

  const showUnlimitedTokenToast = (user: AdminUserItem) => {
    onToast({
      tone: "warning",
      title: "该账号默认无限额度",
      message: `管理团队账号 ${getUserDisplayName(user)} 按无限额度展示，无需单独调整 Token 余额。`,
    });
  };

  const openDetailDrawer = (userId: string) => {
    setSelectedUserId(userId);
    setDetailOpen(true);
  };

  const handleSearchSubmit = () => {
    setDebouncedSearchInput(searchInput);
    setSkip(0);
    setSearchKeyword(searchInput.trim());
  };

  const handleToggleStatus = async (user: AdminUserItem) => {
    if (isProtectedSuperAdmin(user)) {
      showProtectedAccountToast(user);
      return;
    }

    const nextStatus = user.status === "active" ? "frozen" : "active";
    setActiveUserId(user.id);
    setIsSubmitting(true);

    try {
      const updatedUser = await updateAdminUserStatus(user.id, { status: nextStatus });
      replaceUserInState(updatedUser);
      onToast({
        tone: "success",
        title: nextStatus === "frozen" ? "用户已冻结" : "用户已解冻",
        message: `账号 ${updatedUser.username} 当前状态为 ${formatStatusLabel(updatedUser.status)}。`,
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: "状态更新失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "修改用户状态失败，请稍后重试。",
      });
    } finally {
      setActiveUserId(null);
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (user: AdminUserItem) => {
    if (isProtectedSuperAdmin(user)) {
      showProtectedAccountToast(user);
      return;
    }

    setActiveUserId(user.id);
    setIsSubmitting(true);

    try {
      const response = await resetAdminUserPassword(user.id);
      setRevealedPassword({
        username: user.username,
        password: response.new_password,
      });
      onToast({
        tone: "success",
        title: "密码已重置",
        message: `账号 ${user.username} 的密码已重置，并强制下线 ${response.revoked_sessions} 个会话。`,
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: "重置密码失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "重置密码失败，请稍后重试。",
      });
    } finally {
      setActiveUserId(null);
      setIsSubmitting(false);
    }
  };

  const openTokenModal = (user: AdminUserItem) => {
    if (isProtectedSuperAdmin(user)) {
      showProtectedAccountToast(user);
      return;
    }
    if (!canAdjustToken(user)) {
      showUnlimitedTokenToast(user);
      return;
    }

    setTokenModalUser(user);
    setTokenAction("add");
    setTokenAmount("1000");
    setTokenRemark("");
  };

  const closeTokenModal = (force = false) => {
    if (isSubmitting && !force) {
      return;
    }

    setTokenModalUser(null);
    setTokenAction("add");
    setTokenAmount("1000");
    setTokenRemark("");
  };

  const handleTokenSubmit = async () => {
    if (!tokenModalUser) {
      return;
    }

    const parsedAmount = Number(tokenAmount);
    const requiresPositiveAmount = tokenAction === "add" || tokenAction === "deduct";
    if (
      !Number.isInteger(parsedAmount) ||
      parsedAmount < 0 ||
      (requiresPositiveAmount && parsedAmount === 0)
    ) {
      onToast({
        tone: "warning",
        title: "额度参数无效",
        message:
          tokenAction === "set"
            ? "请输入大于等于 0 的整数作为目标余额。"
            : "请输入大于 0 的整数作为本次调整数量。",
      });
      return;
    }

    if (!tokenRemark.trim()) {
      onToast({
        tone: "warning",
        title: "请填写备注",
        message: "Token 调整必须写明原因，便于后续审计与复盘。",
      });
      return;
    }

    if (tokenAction === "deduct" && parsedAmount > tokenModalUser.token_balance) {
      onToast({
        tone: "warning",
        title: "扣减额度超过余额",
        message: "当前用户余额不足，请确认扣减数量或改用设定余额。",
      });
      return;
    }

    setActiveUserId(tokenModalUser.id);
    setIsSubmitting(true);

    try {
      const response = await updateAdminUserTokens(tokenModalUser.id, {
        action: tokenAction,
        amount: parsedAmount,
        remark: tokenRemark.trim(),
      });
      replaceUserInState({
        ...tokenModalUser,
        token_balance: response.token_balance,
      });
      onToast({
        tone: "success",
        title: `Token ${getActionTitle(tokenAction)}已生效`,
        message: `账号 ${tokenModalUser.username} 当前余额已更新为 ${formatNumber(response.token_balance)}。`,
      });
      closeTokenModal(true);
    } catch (error) {
      onToast({
        tone: "error",
        title: "额度调整失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "更新用户额度失败，请稍后重试。",
      });
    } finally {
      setActiveUserId(null);
      setIsSubmitting(false);
    }
  };

  const handleCopyPassword = async () => {
    if (!revealedPassword) {
      return;
    }

    try {
      await navigator.clipboard.writeText(revealedPassword.password);
      onToast({
        tone: "success",
        title: "密码已复制",
        message: `账号 ${revealedPassword.username} 的新密码已复制到剪贴板。`,
      });
    } catch {
      onToast({
        tone: "warning",
        title: "复制失败",
        message: "浏览器未授予剪贴板权限，请手动复制密码。",
      });
    }
  };

  return (
    <>
      <div className="p-4 lg:p-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">用户中心</h1>
            <p className="mt-2 text-sm text-slate-500">
              真实头像、资产豁免与企业级 RBAC 防护已在本页统一落地。
            </p>
          </div>

          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-orange-400 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_36px_rgba(248,113,113,0.28)]"
            onClick={() =>
              onToast({
                tone: "warning",
                title: "新建用户入口待接入",
                message: "当前版本先聚焦用户治理与资产运营，创建入口将在后续接后端接口后补齐。",
              })
            }
            type="button"
          >
            <Plus className="h-4 w-4" />
            新建用户
          </button>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              className="w-52 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleSearchSubmit();
                }
              }}
              placeholder="搜索用户名或昵称"
              value={searchInput}
            />
          </label>

          <button
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-sm transition hover:border-red-200 hover:bg-red-50"
            onClick={handleSearchSubmit}
            type="button"
          >
            <Filter className="h-4 w-4" />
            应用筛选
          </button>

          <button
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-sm transition hover:border-red-200 hover:bg-red-50"
            onClick={() => void loadUsers()}
            type="button"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            刷新列表
          </button>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto pb-1">
          {tabItems.map((tab) => (
            <button
              key={tab.key}
              className={
                activeTab === tab.key
                  ? "whitespace-nowrap rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-500"
                  : "whitespace-nowrap rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600"
              }
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              {tab.label} ({formatNumber(tab.count)})
            </button>
          ))}
        </div>

        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-max whitespace-nowrap text-left">
              <thead>
                <tr className="text-sm font-semibold text-slate-800">
                  <th className="bg-red-50 px-5 py-4">用户</th>
                  <th className="bg-red-50 px-5 py-4">角色</th>
                  <th className="bg-red-50 px-5 py-4">注册时间</th>
                  <th className="bg-red-50 px-5 py-4">最近活跃</th>
                  <th className="bg-red-50 px-5 py-4">Token 余额</th>
                  <th className="bg-red-50 px-5 py-4">状态</th>
                  <th className="bg-red-50 px-5 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <tr key={`admin-user-skeleton-${index}`} className="border-t border-slate-100">
                      <td className="px-5 py-4" colSpan={7}>
                        <div className="h-16 animate-pulse rounded-2xl bg-slate-100" />
                      </td>
                    </tr>
                  ))
                ) : visibleItems.length > 0 ? (
                  visibleItems.map((user) => {
                    const isBusy = isSubmitting && activeUserId === user.id;
                    const isFrozen = user.status === "frozen";
                    const protectedSuperAdmin = isProtectedSuperAdmin(user);
                    const unlimitedTokenUser = isUnlimitedTokenUser(user);
                    const displayName = getUserDisplayName(user);

                    return (
                      <tr
                        key={user.id}
                        className="border-t border-slate-100 transition-colors hover:bg-red-50/50"
                      >
                        <td className="px-5 py-4">
                          <button
                            className="flex min-w-0 items-center gap-4 text-left"
                            onClick={() => openDetailDrawer(user.id)}
                            type="button"
                          >
                            <UserAvatar
                              className="h-11 w-11"
                              name={displayName}
                              src={user.avatar_url}
                            />
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-slate-900">
                                {displayName}
                              </div>
                              <div className="mt-1 truncate text-sm text-slate-400">
                                @{user.username}
                              </div>
                            </div>
                          </button>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${getRoleBadgeClass(
                              user.role,
                            )}`}
                          >
                            {formatRoleLabel(user.role)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">
                          {formatDate(user.created_at)}
                        </td>
                        <td className="px-5 py-4">
                          {user.latest_session ? (
                            <div className="space-y-1">
                              <div className="text-sm font-medium text-slate-700">
                                {normalizeLatestSessionDeviceInfo(user.latest_session.device_info)}
                              </div>
                              <div className="text-xs text-slate-400">
                                {buildLatestSessionMeta(user)}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-slate-400">暂无活动记录</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {unlimitedTokenUser ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-sm font-semibold text-white">
                              <span className="text-base leading-none">∞</span>
                              无限制
                            </span>
                          ) : (
                            <span className="text-sm font-semibold text-slate-800">
                              {formatNumber(user.token_balance)}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
                              isFrozen
                                ? "bg-red-50 text-red-600"
                                : "bg-emerald-50 text-emerald-600"
                            }`}
                          >
                            <span
                              className={`h-2 w-2 rounded-full ${
                                isFrozen ? "bg-red-500" : "bg-emerald-500"
                              }`}
                            />
                            {formatStatusLabel(user.status)}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                              onClick={() => openDetailDrawer(user.id)}
                              type="button"
                            >
                              <Eye className="h-4 w-4" />
                              查看详情
                            </button>
                            {canAdjustToken(user) ? (
                              <button
                                className="inline-flex items-center gap-2 rounded-xl bg-orange-50 px-3 py-2 text-sm font-medium text-orange-600 transition hover:bg-orange-100"
                                disabled={isBusy}
                                onClick={() => openTokenModal(user)}
                                type="button"
                              >
                                <Coins className="h-4 w-4" />
                                资产调度
                              </button>
                            ) : protectedSuperAdmin ? (
                              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-600">
                                受保护账号
                              </span>
                            ) : (
                              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                                无限额度
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="px-5 py-20 text-center text-base text-slate-400" colSpan={7}>
                      当前筛选条件下暂无用户记录。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 px-6 pb-6 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-400">{paginationText}</div>
            <div className="flex items-center gap-2">
              <button
                className="h-10 rounded-xl bg-red-50 px-4 text-sm font-medium text-slate-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={skip === 0 || isLoading}
                onClick={() => setSkip((current) => Math.max(0, current - DEFAULT_PAGE_SIZE))}
                type="button"
              >
                上一页
              </button>
              <span className="flex h-10 min-w-10 items-center justify-center rounded-xl bg-red-500 px-3 text-sm font-bold text-white">
                {currentPage}
              </span>
              <button
                className="h-10 rounded-xl bg-red-50 px-4 text-sm font-medium text-slate-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={skip + DEFAULT_PAGE_SIZE >= total || isLoading}
                onClick={() => setSkip((current) => current + DEFAULT_PAGE_SIZE)}
                type="button"
              >
                下一页
              </button>
              <span className="text-sm text-slate-400">/ {totalPages}</span>
            </div>
          </div>
        </section>
      </div>

      {detailOpen && selectedUser ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/10 backdrop-blur-[2px]">
          <button
            aria-label="关闭用户详情抽屉"
            className="flex-1"
            onClick={() => setDetailOpen(false)}
            type="button"
          />
          <aside className="relative h-screen w-full max-w-md overflow-y-auto bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-slate-400">用户详情</div>
                <div className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
                  {getUserDisplayName(selectedUser)}
                </div>
                <div className="mt-2 text-sm text-slate-400">@{selectedUser.username}</div>
              </div>
              <button
                aria-label="关闭"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 transition hover:bg-red-100"
                onClick={() => setDetailOpen(false)}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-7 rounded-[28px] bg-red-50/70 p-5">
              <div className="flex items-center gap-4">
                <UserAvatar
                  className="h-16 w-16 rounded-[20px]"
                  name={getUserDisplayName(selectedUser)}
                  src={selectedUser.avatar_url}
                  textClassName="text-white"
                />
                <div>
                  <div className="text-base font-bold text-slate-900">
                    {getUserDisplayName(selectedUser)}
                  </div>
                  <div className="mt-1 text-sm text-slate-500">用户 ID：{selectedUser.id}</div>
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <DetailMetric label="角色" value={formatRoleLabel(selectedUser.role)} />
              <DetailMetric label="状态" value={formatStatusLabel(selectedUser.status)} />
              <DetailMetric label="注册时间" value={formatDate(selectedUser.created_at)} />
              <DetailMetric
                label="Token 余额"
                value={
                  isUnlimitedTokenUser(selectedUser)
                    ? "∞ 无限制"
                    : formatNumber(selectedUser.token_balance)
                }
              />
            </div>

            <div className="mt-6 rounded-[24px] bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
              <div className="text-base font-bold text-slate-900">账号信息</div>
              <div className="mt-4 space-y-3 text-sm text-slate-500">
                <div>登录账号：{selectedUser.username}</div>
                <div>创建时间：{formatDateTime(selectedUser.created_at)}</div>
                <div>
                  账号身份：
                  {isAdminRole(selectedUser.role) ? "后台管理团队" : "普通业务用户"}
                </div>
                <div>
                  最近活跃：
                  {selectedUser.latest_session ? (
                    <span>
                      {normalizeLatestSessionDeviceInfo(selectedUser.latest_session.device_info)}
                      {" · "}
                      {buildLatestSessionMeta(selectedUser)}
                    </span>
                  ) : (
                    "暂无活动记录"
                  )}
                </div>
              </div>
            </div>

            {isProtectedSuperAdmin(selectedUser) ? (
              <div className="mt-6 rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-700">
                超级管理员账号已开启资产豁免与同级防御。该账号仅支持查看详情，冻结、重置密码和
                Token 调整均已被前后端双重锁定。
              </div>
            ) : null}

            {selectedUser.role === "admin" ? (
              <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-5 text-sm leading-6 text-slate-600">
                管理员账号默认按无限额度展示，不参与常规 Token 资产调度；如需治理，可继续使用状态与密码操作。
              </div>
            ) : null}

            <div className="mt-6 space-y-3">
              {!isProtectedSuperAdmin(selectedUser) ? (
                <button
                  className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${
                    selectedUser.status === "frozen"
                      ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                  disabled={isSubmitting && activeUserId === selectedUser.id}
                  onClick={() => void handleToggleStatus(selectedUser)}
                  type="button"
                >
                  {isSubmitting && activeUserId === selectedUser.id ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : selectedUser.status === "frozen" ? (
                    <ShieldCheck className="h-4 w-4" />
                  ) : (
                    <ShieldAlert className="h-4 w-4" />
                  )}
                  {selectedUser.status === "frozen" ? "解冻当前账号" : "冻结当前账号"}
                </button>
              ) : null}

              {!isProtectedSuperAdmin(selectedUser) ? (
                <button
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-50 text-sm font-bold text-red-500 transition hover:bg-red-100"
                  disabled={isSubmitting && activeUserId === selectedUser.id}
                  onClick={() => void handleResetPassword(selectedUser)}
                  type="button"
                >
                  <KeyRound className="h-4 w-4" />
                  重置登录密码
                </button>
              ) : null}

              {canAdjustToken(selectedUser) ? (
                <button
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-50 text-sm font-bold text-orange-500 transition hover:bg-orange-100"
                  disabled={isSubmitting && activeUserId === selectedUser.id}
                  onClick={() => openTokenModal(selectedUser)}
                  type="button"
                >
                  <Coins className="h-4 w-4" />
                  调整 Token 额度
                </button>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {tokenModalUser ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/15 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-2xl rounded-[28px] border border-orange-100 bg-[#fffdfa] p-7 shadow-[0_28px_90px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-bold tracking-tight text-slate-900">
                  Token 资产调度台
                </div>
                <div className="mt-1 text-sm leading-6 text-slate-500">
                  账号：{tokenModalUser.username}，当前余额 {formatNumber(tokenModalUser.token_balance)}。
                  本次操作会写入带备注的 Token 流水，便于后续审计与复盘。
                </div>
              </div>
              <button
                aria-label="关闭"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 transition hover:bg-red-100"
                onClick={() => closeTokenModal()}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_0.85fr]">
              <div className="space-y-5">
                <div>
                  <div className="mb-3 text-sm font-bold text-slate-800">操作类型</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      {
                        value: "add" as const,
                        label: "增加额度",
                        description: "适用于补偿赠送、大客户试用和运营加额。",
                      },
                      {
                        value: "deduct" as const,
                        label: "扣减额度",
                        description: "适用于异常回收、误发修正与风控处置。",
                      },
                      {
                        value: "set" as const,
                        label: "设定余额",
                        description: "直接校准到目标余额，适合历史纠偏。",
                      },
                    ].map((option) => (
                      <button
                        key={option.value}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          tokenAction === option.value
                            ? "border-red-300 bg-gradient-to-br from-red-50 to-orange-50 text-slate-900 shadow-[0_14px_32px_rgba(248,113,113,0.12)]"
                            : "border-slate-200 bg-white text-slate-600 hover:border-orange-200 hover:bg-orange-50/40"
                        }`}
                        onClick={() => setTokenAction(option.value)}
                        type="button"
                      >
                        <div className="text-sm font-semibold">{option.label}</div>
                        <div className="mt-2 text-xs leading-5 text-slate-500">
                          {option.description}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <div className="mb-2 text-sm font-bold text-slate-800">
                    {tokenAction === "set" ? "目标余额" : "调整数量"}
                  </div>
                  <input
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-100"
                    onChange={(event) => setTokenAmount(event.target.value)}
                    placeholder={
                      tokenAction === "set"
                        ? "请输入最终余额，例如 100000"
                        : "请输入本次变动数量，例如 10000"
                    }
                    type="number"
                    value={tokenAmount}
                  />
                </label>

                <div>
                  <div className="mb-2 text-sm font-bold text-slate-800">快捷输入</div>
                  <div className="flex flex-wrap gap-2">
                    {TOKEN_QUICK_PACKS.map((pack) => (
                      <button
                        key={pack}
                        className="rounded-full border border-orange-100 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-600 transition hover:border-orange-200 hover:bg-orange-100"
                        onClick={() => setTokenAmount(String(pack))}
                        type="button"
                      >
                        {formatNumber(pack)}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <div className="mb-2 text-sm font-bold text-slate-800">操作备注</div>
                  <textarea
                    className="min-h-32 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-100"
                    onChange={(event) => setTokenRemark(event.target.value)}
                    placeholder="请填写调整原因，例如：客诉补偿、大客户试用等"
                    required
                    value={tokenRemark}
                  />
                </label>
              </div>

              <div className="rounded-[24px] border border-orange-100 bg-gradient-to-br from-[#fff8f4] via-white to-[#fff2ea] p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-400">
                  Operation Preview
                </div>
                <div className="mt-5 space-y-4">
                  <PreviewMetric
                    label="当前余额"
                    value={formatNumber(tokenModalUser.token_balance)}
                  />
                  <PreviewMetric
                    label={tokenAction === "set" ? "目标余额" : "预计变动"}
                    value={
                      Number.isInteger(parsedTokenAmount) && parsedTokenAmount >= 0
                        ? `${tokenAction === "deduct" ? "-" : tokenAction === "add" ? "+" : ""}${formatNumber(parsedTokenAmount)}`
                        : "等待输入"
                    }
                  />
                  <PreviewMetric
                    label="预计结果"
                    value={
                      tokenPreviewBalance === null
                        ? "等待输入"
                        : tokenPreviewBalance < 0
                          ? "余额不足"
                          : formatNumber(tokenPreviewBalance)
                    }
                  />
                </div>

                <div className="mt-5 rounded-2xl bg-white/90 p-4 text-sm leading-6 text-slate-500 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                  本次调度会同步记录操作人、变动数量、交易类型与备注，便于财务、风控与客服联合追踪。
                </div>
              </div>
            </div>

            <div className="mt-7 flex justify-end gap-3">
              <button
                className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
                onClick={() => closeTokenModal()}
                type="button"
              >
                取消
              </button>
              <button
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-orange-400 px-5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isSubmitting}
                onClick={() => void handleTokenSubmit()}
                type="button"
              >
                {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                提交 Token 调整
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {revealedPassword ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/15 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-bold tracking-tight text-slate-900">
                  新密码已生成
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  请立即复制并安全传达给用户：{revealedPassword.username}
                </div>
              </div>
              <button
                aria-label="关闭"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 transition hover:bg-red-100"
                onClick={() => setRevealedPassword(null)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 rounded-2xl bg-red-50/70 px-4 py-4">
              <div className="text-xs font-bold uppercase tracking-[0.28em] text-red-400">
                Password
              </div>
              <div className="mt-3 break-all font-mono text-lg text-slate-900">
                {revealedPassword.password}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-orange-400 px-5 text-sm font-bold text-white"
                onClick={() => void handleCopyPassword()}
                type="button"
              >
                <Copy className="h-4 w-4" />
                复制密码
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function PreviewMetric(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <div className="rounded-2xl bg-white/90 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function DetailMetric(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}
