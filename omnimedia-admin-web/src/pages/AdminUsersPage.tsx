import { useEffect, useState, type ReactNode } from "react";
import {
  Coins,
  Copy,
  Download,
  Eye,
  Filter,
  KeyRound,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRound,
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
import type {
  AdminToast,
  AdminUserItem,
  AdminUsersApiResponse,
} from "../types";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatRoleLabel,
  formatStatusLabel,
} from "../utils/format";

type PasswordRevealState = {
  username: string;
  password: string;
} | null;

type UserFilterTab = "all" | "standard" | "premium" | "frozen";

type AdminUsersPageProps = {
  onToast: (toast: AdminToast) => void;
};

const DEFAULT_PAGE_SIZE = 20;

export function AdminUsersPage(props: AdminUsersPageProps) {
  const { onToast } = props;
  const [usersPayload, setUsersPayload] = useState<AdminUsersApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [openActionUserId, setOpenActionUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<UserFilterTab>("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [skip, setSkip] = useState(0);
  const [tokenModalUser, setTokenModalUser] = useState<AdminUserItem | null>(null);
  const [tokenAmount, setTokenAmount] = useState("1000");
  const [tokenRemark, setTokenRemark] = useState("");
  const [revealedPassword, setRevealedPassword] = useState<PasswordRevealState>(null);

  const total = usersPayload?.total ?? 0;
  const items = usersPayload?.items ?? [];
  const currentPage = Math.floor(skip / DEFAULT_PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const selectedUser = items.find((item) => item.id === selectedUserId) ?? null;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-user-actions]")) {
        return;
      }
      setOpenActionUserId(null);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

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

  const handleSearchSubmit = () => {
    setSkip(0);
    setSearchKeyword(searchInput.trim());
  };

  const handleToggleStatus = async (user: AdminUserItem) => {
    const nextStatus = user.status === "active" ? "frozen" : "active";
    setOpenActionUserId(null);
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
    setOpenActionUserId(null);
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
    setOpenActionUserId(null);
    setTokenModalUser(user);
    setTokenAmount("1000");
    setTokenRemark("");
  };

  const closeTokenModal = (force = false) => {
    if (isSubmitting && !force) {
      return;
    }

    setTokenModalUser(null);
    setTokenAmount("1000");
    setTokenRemark("");
  };

  const handleTokenSubmit = async () => {
    if (!tokenModalUser) {
      return;
    }

    const parsedAmount = Number(tokenAmount);
    if (!Number.isInteger(parsedAmount) || parsedAmount === 0) {
      onToast({
        tone: "warning",
        title: "额度参数无效",
        message: "请输入非 0 的整数，正数代表充值，负数代表扣减。",
      });
      return;
    }

    if (!tokenRemark.trim()) {
      onToast({
        tone: "warning",
        title: "请填写备注",
        message: "额度变更需要保留备注，便于后续审计与追踪。",
      });
      return;
    }

    setActiveUserId(tokenModalUser.id);
    setIsSubmitting(true);

    try {
      const response = await updateAdminUserTokens(tokenModalUser.id, {
        amount: parsedAmount,
        remark: tokenRemark.trim(),
      });
      replaceUserInState({
        ...tokenModalUser,
        token_balance: response.token_balance,
      });
      onToast({
        tone: "success",
        title: parsedAmount > 0 ? "额度充值成功" : "额度扣减成功",
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

  const visibleItems = items.filter((item) => {
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

  const tabItems: Array<{ key: UserFilterTab; label: string; count: number }> = [
    { key: "all", label: "全部用户", count: items.length },
    {
      key: "standard",
      label: "普通用户",
      count: items.filter((item) => item.role === "user").length,
    },
    {
      key: "premium",
      label: "高级用户",
      count: items.filter((item) => item.role === "premium" || isAdminRole(item.role)).length,
    },
    {
      key: "frozen",
      label: "冻结用户",
      count: items.filter((item) => item.status === "frozen").length,
    },
  ];

  const paginationText =
    total === 0
      ? "当前筛选条件下暂无用户。"
      : `显示 ${formatNumber(skip + 1)}-${formatNumber(skip + visibleItems.length)}，共 ${formatNumber(total)} 条`;

  return (
    <>
      <div className="p-4 lg:p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">用户中心</h1>
          </div>

          <button
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-red-500 to-orange-400 px-4 py-2 text-sm font-medium text-white"
            onClick={() =>
              onToast({
                tone: "warning",
                title: "新建用户暂未开放",
                message: "当前版本先聚焦用户管理操作，创建入口待后端接口补齐后接入。",
              })
            }
            type="button"
          >
            <Plus className="h-5 w-5" />
            新建用户
          </button>
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              className="w-48 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleSearchSubmit();
                }
              }}
              placeholder="搜索用户..."
              value={searchInput}
            />
          </label>
          <button
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600"
            onClick={handleSearchSubmit}
            type="button"
          >
            <Filter className="h-5 w-5" />
            筛选
          </button>
          <button
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600"
            onClick={() => void loadUsers()}
            type="button"
          >
            <Download className="h-5 w-5" />
            导出
          </button>
        </div>

        <div className="mb-6 flex gap-2 overflow-x-auto">
          {tabItems.map((tab) => (
            <button
              key={tab.key}
              className={
                activeTab === tab.key
                  ? "whitespace-nowrap rounded-lg border border-red-500 bg-red-50 px-4 py-2 text-sm font-medium text-red-500"
                  : "whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600"
              }
              onClick={() => setActiveTab(tab.key)}
              type="button"
            >
              {tab.label} ({formatNumber(tab.count)})
            </button>
          ))}
        </div>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-max whitespace-nowrap text-left">
              <thead>
                <tr className="text-base font-bold text-gray-900">
                  <th className="bg-red-50 px-4 py-3 text-sm font-semibold text-slate-800">
                    <input className="h-4 w-4 rounded border-slate-300 text-red-500" type="checkbox" />
                  </th>
                  <th className="bg-red-50 px-4 py-3 text-sm font-semibold text-slate-800">用户</th>
                  <th className="bg-red-50 px-4 py-3 text-sm font-semibold text-slate-800">角色</th>
                  <th className="bg-red-50 px-4 py-3 text-sm font-semibold text-slate-800">注册时间</th>
                  <th className="bg-red-50 px-4 py-3 text-sm font-semibold text-slate-800">最后活跃</th>
                  <th className="bg-red-50 px-4 py-3 text-sm font-semibold text-slate-800">Token消耗</th>
                  <th className="bg-red-50 px-4 py-3 text-sm font-semibold text-slate-800">状态</th>
                  <th className="bg-red-50 px-4 py-3 text-left text-sm font-semibold text-slate-800">操作</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <tr key={`admin-user-skeleton-${index}`}>
                      <td className="rounded-xl bg-white py-3" colSpan={7}>
                        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
                      </td>
                    </tr>
                  ))
                ) : visibleItems.length > 0 ? (
                  visibleItems.map((user) => {
                    const isBusy = isSubmitting && activeUserId === user.id;
                    const isFrozen = user.status === "frozen";
                    const isPrivileged = isAdminRole(user.role) || user.role === "premium";
                    const displayName = user.nickname?.trim() || user.username;
                    const initials = displayName.slice(0, 2).toUpperCase();

                    return (
                      <tr key={user.id} className="cursor-pointer border-t border-slate-200 transition-colors hover:bg-red-50">
                        <td className="px-4 py-4">
                          <input className="h-4 w-4 rounded border-slate-300 text-red-500" type="checkbox" />
                        </td>
                        <td className="px-4 py-4">
                          <button
                            className="flex min-w-0 items-center gap-4 text-left"
                            onClick={() => {
                              setSelectedUserId(user.id);
                              setDetailOpen(true);
                            }}
                            type="button"
                          >
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-red-100 to-orange-50 text-sm font-bold text-red-500">
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-gray-900">
                                {displayName}
                              </div>
                              <div className="mt-1 truncate text-sm text-slate-400">
                                ID: {user.id}
                              </div>
                            </div>
                          </button>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-md px-2.5 py-1 text-sm font-medium ${
                              isPrivileged
                                ? "bg-amber-50 text-amber-600"
                                : "bg-blue-50 text-blue-600"
                            }`}
                          >
                            {formatRoleLabel(user.role)}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-600">
                          {formatDate(user.created_at)}
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-600">2小时前</td>
                        <td className="px-4 py-4 text-sm font-medium text-slate-800">
                          {formatNumber(user.token_balance)}
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-sm font-medium ${
                              isFrozen
                                ? "bg-red-50 text-red-600"
                                : "bg-green-50 text-green-600"
                            }`}
                          >
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${
                                isFrozen ? "bg-red-500" : "bg-green-500"
                              }`}
                            />
                            {formatStatusLabel(user.status)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div
                            className="relative inline-flex items-center gap-2"
                            data-user-actions=""
                          >
                            <button
                              aria-label="查看详情"
                              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-500 transition hover:bg-red-100"
                              onClick={() => {
                                setSelectedUserId(user.id);
                                setDetailOpen(true);
                              }}
                              type="button"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              aria-label="更多操作"
                              className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-red-500 transition hover:bg-red-100"
                              onClick={() =>
                                setOpenActionUserId((current) =>
                                  current === user.id ? null : user.id,
                                )
                              }
                              type="button"
                            >
                              {isBusy ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <MoreVertical className="h-4 w-4" />
                              )}
                            </button>

                            {openActionUserId === user.id ? (
                              <div className="absolute right-0 top-12 z-10 w-48 rounded-2xl bg-white p-2 text-left shadow-[0_22px_50px_rgba(15,23,42,0.14)]">
                                <ActionMenuButton
                                  icon={<Eye className="h-4 w-4" />}
                                  label="查看详情"
                                  onClick={() => {
                                    setSelectedUserId(user.id);
                                    setDetailOpen(true);
                                    setOpenActionUserId(null);
                                  }}
                                />
                                <ActionMenuButton
                                  disabled={isBusy}
                                  icon={
                                    isFrozen ? (
                                      <ShieldCheck className="h-4 w-4" />
                                    ) : (
                                      <ShieldAlert className="h-4 w-4" />
                                    )
                                  }
                                  label={isFrozen ? "解冻账号" : "冻结账号"}
                                  onClick={() => void handleToggleStatus(user)}
                                />
                                <ActionMenuButton
                                  disabled={isBusy}
                                  icon={<KeyRound className="h-4 w-4" />}
                                  label="重置密码"
                                  onClick={() => void handleResetPassword(user)}
                                />
                                <ActionMenuButton
                                  disabled={isBusy}
                                  icon={<Coins className="h-4 w-4" />}
                                  label="调整额度"
                                  onClick={() => openTokenModal(user)}
                                />
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="py-16 text-center text-base text-slate-400" colSpan={7}>
                      当前筛选条件下暂无用户记录。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 px-6 pb-6 pt-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-400">{paginationText}</div>
            <div className="flex items-center gap-2">
              <button
                className="h-10 rounded-lg bg-red-50 px-4 text-sm font-medium text-slate-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={skip === 0 || isLoading}
                onClick={() => setSkip((current) => Math.max(0, current - DEFAULT_PAGE_SIZE))}
                type="button"
              >
                上一页
              </button>
              <span className="flex h-10 min-w-10 items-center justify-center rounded-lg bg-red-500 px-3 text-sm font-bold text-white">
                {currentPage}
              </span>
              <button
                className="h-10 rounded-lg bg-red-50 px-4 text-sm font-medium text-slate-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
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
            aria-label="关闭详情抽屉"
            className="flex-1"
            onClick={() => setDetailOpen(false)}
            type="button"
          />
          <aside className="relative h-screen w-full max-w-md overflow-y-auto bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-medium text-slate-400">用户详情</div>
                <div className="mt-1 text-2xl font-bold tracking-tight text-gray-900">
                  {selectedUser.nickname?.trim() || selectedUser.username}
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

            <div className="mt-7 rounded-2xl bg-red-50/70 p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-red-500 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
                  <UserRound className="h-7 w-7" />
                </div>
                <div>
                  <div className="text-base font-bold text-gray-900">
                    {selectedUser.nickname?.trim() || selectedUser.username}
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
                label="Token余额"
                value={formatNumber(selectedUser.token_balance)}
              />
            </div>

            <div className="mt-6 rounded-2xl bg-white p-5 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
              <div className="text-base font-bold text-gray-900">账号信息</div>
              <div className="mt-4 space-y-3 text-sm text-slate-500">
                <div>登录账号：{selectedUser.username}</div>
                <div>注册时间：{formatDateTime(selectedUser.created_at)}</div>
                <div>
                  当前身份：
                  {isAdminRole(selectedUser.role) ? "后台管理团队" : "普通用户侧账号"}
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <button
                className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${
                  selectedUser.status === "frozen"
                    ? "bg-green-50 text-green-600 hover:bg-green-100"
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
              <button
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-50 text-sm font-bold text-red-500 transition hover:bg-red-100"
                disabled={isSubmitting && activeUserId === selectedUser.id}
                onClick={() => void handleResetPassword(selectedUser)}
                type="button"
              >
                <KeyRound className="h-4 w-4" />
                重置登录密码
              </button>
              <button
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-50 text-sm font-bold text-orange-500 transition hover:bg-orange-100"
                disabled={isSubmitting && activeUserId === selectedUser.id}
                onClick={() => openTokenModal(selectedUser)}
                type="button"
              >
                <Coins className="h-4 w-4" />
                调整 Token 额度
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      {tokenModalUser ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/15 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg rounded-2xl bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-bold tracking-tight text-gray-900">
                  调整用户额度
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  账号：{tokenModalUser.username}，当前余额：
                  {formatNumber(tokenModalUser.token_balance)}
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

            <div className="mt-6 space-y-4">
              <label className="block">
                <div className="mb-2 text-sm font-bold text-gray-800">额度数量</div>
                <input
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-gray-900 outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-100"
                  onChange={(event) => setTokenAmount(event.target.value)}
                  placeholder="例如 1000 或 -200"
                  type="number"
                  value={tokenAmount}
                />
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-bold text-gray-800">备注</div>
                <textarea
                  className="min-h-28 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-100"
                  onChange={(event) => setTokenRemark(event.target.value)}
                  placeholder="请填写本次额度调整的原因"
                  value={tokenRemark}
                />
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-3">
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
                提交额度调整
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
                <div className="text-xl font-bold tracking-tight text-gray-900">
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
              <div className="mt-3 break-all font-mono text-lg text-gray-900">
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

function ActionMenuButton(props: {
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  const { disabled = false, icon, label, onClick } = props;

  return (
    <button
      className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function DetailMetric(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-sm font-bold text-gray-900">{value}</div>
    </div>
  );
}
