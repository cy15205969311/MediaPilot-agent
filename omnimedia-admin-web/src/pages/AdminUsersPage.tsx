import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Coins,
  Copy,
  Eye,
  Filter,
  KeyRound,
  Lock,
  Minus,
  MoreVertical,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  APIError,
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  isAdminRole,
  resetAdminUserPassword,
  updateAdminUserRole,
  updateAdminUserStatus,
  updateAdminUserTokens,
} from "../api";
import {
  StandardSearchInput,
  type StandardSearchInputHandle,
} from "../components/common/StandardSearchInput";
import { UserAvatar } from "../components/UserAvatar";
import type {
  AdminTokenAdjustAction,
  AdminToast,
  AdminUserCreatePayload,
  AdminUserItem,
  AdminUsersApiResponse,
  AuthenticatedUser,
  UserRole,
  UserStatus,
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

type CreateUserFormErrors = Partial<Record<"username" | "password" | "role", string>>;

type UserFilterTab = "all" | "standard" | "premium" | "frozen";

type UserActionMenuState = {
  user: AdminUserItem;
  top: number;
  left: number;
} | null;

type AdminUsersPageProps = {
  currentUser: AuthenticatedUser;
  onToast: (toast: AdminToast) => void;
};

const DEFAULT_PAGE_SIZE = 5;
const TOKEN_QUICK_PACKS = [10000, 50000, 100000] as const;
const USER_ACTION_MENU_WIDTH = 224;
const USER_ACTION_MENU_HEIGHT = 328;
const USER_ACTION_MENU_GAP = 10;
const USER_ACTION_MENU_EDGE_PADDING = 16;
const ROLE_ASSIGNMENT_OPTIONS: Array<{
  value: UserRole;
  label: string;
  description: string;
  permissionHint: string;
}> = [
  {
    value: "super_admin",
    label: "超级管理员",
    description: "最高权限，统筹全局配置、角色分配与关键安全操作。",
    permissionHint: "包含全量后台权限与高危治理能力。",
  },
  {
    value: "operator",
    label: "运营人员",
    description: "负责用户治理、内容运营与日常后台巡检。",
    permissionHint: "包含用户管理、内容审核、数据查看等核心权限。",
  },
  {
    value: "finance",
    label: "财务人员",
    description: "负责台账核对、充值补偿、资产导出与财务复盘。",
    permissionHint: "包含财务报表、Token 流水、充值记录与导出权限。",
  },
  {
    value: "user",
    label: "普通用户",
    description: "标准业务账号，不具备后台管理权限。",
    permissionHint: "仅保留前台创作与个人资料能力。",
  },
  {
    value: "admin",
    label: "平台管理员",
    description: "保留现有高权限兼容角色，适合全局治理或历史账号过渡。",
    permissionHint: "默认拥有管理团队级权限与无限额度展示。",
  },
  {
    value: "premium",
    label: "高级用户",
    description: "兼容现有会员型业务角色，不开放后台治理能力。",
    permissionHint: "保留高级用户身份与业务侧权益展示。",
  },
];

function getStatusFilterForTab(tab: UserFilterTab): UserStatus | undefined {
  return tab === "frozen" ? "frozen" : undefined;
}

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

function canManageUserAccounts(currentUser: Pick<AuthenticatedUser, "role">): boolean {
  return (
    currentUser.role === "super_admin" ||
    currentUser.role === "admin" ||
    currentUser.role === "operator"
  );
}

function canProvisionUsers(currentUser: Pick<AuthenticatedUser, "role">): boolean {
  return currentUser.role === "super_admin" || currentUser.role === "admin";
}

function canAssignProvisionRole(
  currentUser: Pick<AuthenticatedUser, "role">,
  role: UserRole,
): boolean {
  if (currentUser.role === "super_admin") {
    return true;
  }

  if (currentUser.role === "admin") {
    return role !== "super_admin" && role !== "admin";
  }

  return false;
}

function getProvisionRoleOptions(currentUser: Pick<AuthenticatedUser, "role">) {
  return ROLE_ASSIGNMENT_OPTIONS.filter((option) =>
    canAssignProvisionRole(currentUser, option.value),
  );
}

function getDefaultProvisionRole(currentUser: Pick<AuthenticatedUser, "role">): UserRole {
  const firstOption = getProvisionRoleOptions(currentUser)[0];
  return firstOption?.value ?? "user";
}

function canChangeUserRole(
  currentUser: Pick<AuthenticatedUser, "id" | "role">,
  user: Pick<AdminUserItem, "id" | "role">,
): boolean {
  return (
    currentUser.role === "super_admin" &&
    currentUser.id !== user.id &&
    user.role !== "super_admin"
  );
}

function getRoleChangeDisabledReason(
  currentUser: Pick<AuthenticatedUser, "id" | "role">,
  user: Pick<AdminUserItem, "id" | "role">,
): string {
  if (currentUser.role !== "super_admin") {
    return "仅超级管理员可以变更角色";
  }
  if (currentUser.id === user.id) {
    return "为避免误降权，当前不允许修改自己的角色";
  }
  if (user.role === "super_admin") {
    return "系统最高权限账号不可变更角色";
  }
  return "";
}

function getRoleOption(role: UserRole) {
  return ROLE_ASSIGNMENT_OPTIONS.find((option) => option.value === role) ?? null;
}

function getRoleBadgeClass(role: AdminUserItem["role"]): string {
  if (role === "super_admin") {
    return "bg-transparent font-bold text-slate-800";
  }
  if (role === "admin") {
    return "bg-transparent text-rose-500";
  }
  if (role === "finance") {
    return "bg-transparent text-violet-500";
  }
  if (role === "operator") {
    return "bg-transparent text-orange-500";
  }
  if (role === "premium") {
    return "bg-transparent text-yellow-600";
  }
  return "bg-transparent text-sky-500";
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

function generateProvisionPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const numbers = new Uint32Array(6);
  window.crypto.getRandomValues(numbers);
  const suffix = Array.from(numbers, (value, index) =>
    index < 4 ? String(value % 10) : alphabet[value % alphabet.length],
  ).join("");
  return `Omni@${suffix}`;
}

function validateCreateUserForm(
  form: AdminUserCreatePayload,
  currentUser: Pick<AuthenticatedUser, "role">,
): CreateUserFormErrors {
  const errors: CreateUserFormErrors = {};
  const normalizedUsername = form.username.trim();

  if (!normalizedUsername) {
    errors.username = "请输入用户名";
  } else if (normalizedUsername.length < 3) {
    errors.username = "用户名至少需要 3 个字符";
  }

  if (!form.password) {
    errors.password = "请输入初始密码";
  } else if (form.password.length < 8) {
    errors.password = "初始密码至少需要 8 个字符";
  }

  if (!canAssignProvisionRole(currentUser, form.role)) {
    errors.role = "当前账号无法预分配该系统级角色";
  }

  return errors;
}

export function formatSessionDeviceInfo(value?: string | null): string {
  return normalizeLatestSessionDeviceInfo(value);
}

export function formatLatestSessionMeta(user: Pick<AdminUserItem, "latest_session">): string {
  return buildLatestSessionMeta(user);
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

function formatUserRowId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized) {
    return "--";
  }

  const compact = normalized.includes("-") ? normalized.split("-")[0] : normalized;
  return compact.slice(0, 6).toUpperCase();
}

function getLatestActivityLabel(user: Pick<AdminUserItem, "latest_session">): string {
  const latestSession = user.latest_session;
  if (!latestSession) {
    return "暂无记录";
  }

  const relativeTime = formatRelativeTime(
    latestSession.last_seen_at ?? latestSession.created_at,
  );
  return relativeTime === "--" ? "暂无记录" : relativeTime;
}

function getLatestActivityHint(user: Pick<AdminUserItem, "latest_session">): string {
  const latestSession = user.latest_session;
  if (!latestSession) {
    return "未捕获设备信息";
  }

  return normalizeLatestSessionDeviceInfo(latestSession.device_info);
}

export function AdminUsersPage(props: AdminUsersPageProps) {
  const { currentUser, onToast } = props;
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearchTerm = searchParams.get("search")?.trim() ?? "";
  const [usersPayload, setUsersPayload] = useState<AdminUsersApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<UserFilterTab>(
    searchParams.get("status") === "frozen" ? "frozen" : "all",
  );
  const [actionMenu, setActionMenu] = useState<UserActionMenuState>(null);
  const [searchKeyword, setSearchKeyword] = useState(initialSearchTerm);
  const searchInputRef = useRef<StandardSearchInputHandle | null>(null);
  const [skip, setSkip] = useState(0);
  const [tokenModalUser, setTokenModalUser] = useState<AdminUserItem | null>(null);
  const [tokenAction, setTokenAction] = useState<AdminTokenAdjustAction>("add");
  const [tokenAmount, setTokenAmount] = useState("1000");
  const [tokenRemark, setTokenRemark] = useState("");
  const [roleModalUser, setRoleModalUser] = useState<AdminUserItem | null>(null);
  const [nextRole, setNextRole] = useState<UserRole>("user");
  const [revealedPassword, setRevealedPassword] = useState<PasswordRevealState>(null);
  const [deleteUserTarget, setDeleteUserTarget] = useState<AdminUserItem | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState<AdminUserCreatePayload>(() => ({
    username: "",
    password: generateProvisionPassword(),
    role: getDefaultProvisionRole(currentUser),
  }));
  const [createFormErrors, setCreateFormErrors] = useState<CreateUserFormErrors>({});

  const total = usersPayload?.total ?? 0;
  const items = usersPayload?.items ?? [];
  const canGovernUserAccounts = canManageUserAccounts(currentUser);
  const canCreateUsers = canProvisionUsers(currentUser);
  const activeStatusFilter = getStatusFilterForTab(activeTab);
  const currentPage = Math.floor(skip / DEFAULT_PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const selectedUser = items.find((item) => item.id === selectedUserId) ?? null;
  const parsedTokenAmount = Number(tokenAmount);
  const selectedRoleOption = getRoleOption(nextRole);
  const provisionRoleOptions = useMemo(
    () => getProvisionRoleOptions(currentUser),
    [currentUser],
  );
  const isCreateUserSubmitting = isSubmitting && activeUserId === "__create_user__";
  const actionMenuUser = actionMenu?.user ?? null;
  const isActionMenuBusy = actionMenuUser
    ? isSubmitting && activeUserId === actionMenuUser.id
    : false;
  const isDeleteUserSubmitting = deleteUserTarget
    ? isSubmitting && activeUserId === deleteUserTarget.id
    : false;
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

  const loadUsers = async (options?: {
    skip?: number;
    search?: string;
    status?: UserStatus;
  }) => {
    setIsLoading(true);

    try {
      const payload = await fetchAdminUsers({
        skip: options?.skip ?? skip,
        limit: DEFAULT_PAGE_SIZE,
        search: options?.search ?? searchKeyword,
        status: options?.status ?? activeStatusFilter,
      });
      setUsersPayload(payload);
      return payload;
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
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [skip, searchKeyword, activeStatusFilter]);

  useEffect(() => {
    const nextStatus = searchParams.get("status");
    if (nextStatus === "frozen" && activeTab !== "frozen") {
      setActiveTab("frozen");
      return;
    }
    if (nextStatus !== "frozen" && activeTab === "frozen") {
      setActiveTab("all");
    }
  }, [activeTab, searchParams]);

  useEffect(() => {
    if (provisionRoleOptions.some((option) => option.value === createForm.role)) {
      return;
    }

    setCreateForm((current) => ({
      ...current,
      role: getDefaultProvisionRole(currentUser),
    }));
  }, [createForm.role, currentUser, provisionRoleOptions]);

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

  useEffect(() => {
    if (!actionMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("[data-user-action-menu]") ||
        target?.closest("[data-user-action-trigger]")
      ) {
        return;
      }
      setActionMenu(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionMenu(null);
      }
    };

    const handleDismiss = () => {
      setActionMenu(null);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", handleDismiss);
    window.addEventListener("scroll", handleDismiss, true);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", handleDismiss);
      window.removeEventListener("scroll", handleDismiss, true);
    };
  }, [actionMenu]);

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

  const showGovernancePermissionToast = (actionLabel: string) => {
    onToast({
      tone: "warning",
      title: "当前角色仅支持只读查看",
      message: `当前账号暂不具备${actionLabel}权限，请使用超级管理员或治理角色执行该操作。`,
    });
  };

  const showRoleChangeBlockedToast = (user: AdminUserItem) => {
    onToast({
      tone: "warning",
      title: "角色变更已被拦截",
      message: getRoleChangeDisabledReason(currentUser, user) || "当前不允许执行角色变更。",
    });
  };

  const closeActionMenu = () => {
    setActionMenu(null);
  };

  const openActionMenu = (
    user: AdminUserItem,
    triggerElement: HTMLButtonElement,
  ) => {
    const rect = triggerElement.getBoundingClientRect();
    const fitsBelow =
      rect.bottom + USER_ACTION_MENU_GAP + USER_ACTION_MENU_HEIGHT <=
      window.innerHeight - USER_ACTION_MENU_EDGE_PADDING;
    const left = Math.min(
      Math.max(USER_ACTION_MENU_EDGE_PADDING, rect.right - USER_ACTION_MENU_WIDTH),
      window.innerWidth - USER_ACTION_MENU_WIDTH - USER_ACTION_MENU_EDGE_PADDING,
    );
    const top = fitsBelow
      ? rect.bottom + USER_ACTION_MENU_GAP
      : Math.max(
          USER_ACTION_MENU_EDGE_PADDING,
          rect.top - USER_ACTION_MENU_HEIGHT - USER_ACTION_MENU_GAP,
        );

    setActionMenu((current) => (current?.user.id === user.id ? null : { user, top, left }));
  };

  const resetCreateForm = () => {
    setCreateForm({
      username: "",
      password: generateProvisionPassword(),
      role: getDefaultProvisionRole(currentUser),
    });
    setCreateFormErrors({});
  };

  const openCreateModal = () => {
    if (!canCreateUsers) {
      showGovernancePermissionToast("新建用户");
      return;
    }

    resetCreateForm();
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = (force = false) => {
    if (isSubmitting && !force) {
      return;
    }

    setIsCreateModalOpen(false);
    setCreateFormErrors({});
  };

  const handleGenerateCreatePassword = () => {
    setCreateForm((current) => ({
      ...current,
      password: generateProvisionPassword(),
    }));
    setCreateFormErrors((current) => ({
      ...current,
      password: undefined,
    }));
  };

  const handleCopyCreatePassword = async () => {
    if (!createForm.password) {
      return;
    }

    try {
      await navigator.clipboard.writeText(createForm.password);
      onToast({
        tone: "success",
        title: "初始密码已复制",
        message: "可直接发送给新成员完成首次登录。",
      });
    } catch {
      onToast({
        tone: "warning",
        title: "复制失败",
        message: "浏览器暂未授予剪贴板权限，请手动复制初始密码。",
      });
    }
  };

  const handleCreateUserSubmit = async () => {
    if (!canCreateUsers) {
      showGovernancePermissionToast("新建用户");
      return;
    }

    const payload: AdminUserCreatePayload = {
      username: createForm.username.trim(),
      password: createForm.password,
      role: createForm.role,
    };
    const validationErrors = validateCreateUserForm(payload, currentUser);
    setCreateFormErrors(validationErrors);

    if (Object.values(validationErrors).some(Boolean)) {
      onToast({
        tone: "warning",
        title: "请先完善建号信息",
        message:
          validationErrors.username ||
          validationErrors.password ||
          validationErrors.role ||
          "请检查用户名、密码和角色配置。",
      });
      return;
    }

    setActiveUserId("__create_user__");
    setIsSubmitting(true);

    try {
      const createdUser = await createAdminUser(payload);
      closeCreateModal(true);
      resetCreateForm();

      if (skip === 0 && !searchKeyword.trim()) {
        await loadUsers({ skip: 0, search: "" });
      } else {
        setSearchKeyword("");
        setSkip(0);
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.delete("search");
          return next;
        });
      }

      onToast({
        tone: "success",
        title: "用户创建成功",
        message: `${createdUser.username} 已创建，并完成 ${formatRoleLabel(createdUser.role)} 预分配。`,
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: "创建用户失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "新建用户失败，请稍后重试。",
      });
    } finally {
      setActiveUserId(null);
      setIsSubmitting(false);
    }
  };

  const openDetailDrawer = (userId: string) => {
    closeActionMenu();
    setSelectedUserId(userId);
    setDetailOpen(true);
  };

  const openRoleModal = (user: AdminUserItem) => {
    closeActionMenu();
    if (!canChangeUserRole(currentUser, user)) {
      showRoleChangeBlockedToast(user);
      return;
    }

    setRoleModalUser(user);
    setNextRole(user.role);
  };

  const closeRoleModal = (force = false) => {
    if (isSubmitting && !force) {
      return;
    }

    setRoleModalUser(null);
    setNextRole("user");
  };

  const closeDeleteUserDialog = (force = false) => {
    if (isSubmitting && !force) {
      return;
    }

    setDeleteUserTarget(null);
  };

  const handleSearchChange = (nextValue: string) => {
    setSkip(0);
    setSearchKeyword((current) => (current === nextValue ? current : nextValue));
  };

  const handleTabChange = (nextTab: UserFilterTab) => {
    setActiveTab(nextTab);
    setSkip(0);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextTab === "frozen") {
        next.set("status", "frozen");
      } else {
        next.delete("status");
      }
      return next;
    });
  };

  const handleToggleStatus = async (user: AdminUserItem) => {
    closeActionMenu();
    if (!canGovernUserAccounts) {
      showGovernancePermissionToast("冻结与解冻账号");
      return;
    }

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
    closeActionMenu();
    if (!canGovernUserAccounts) {
      showGovernancePermissionToast("重置密码");
      return;
    }

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

  const openTokenModal = (
    user: AdminUserItem,
    initialAction: AdminTokenAdjustAction = "add",
  ) => {
    closeActionMenu();
    if (!canGovernUserAccounts) {
      showGovernancePermissionToast("调整 Token 额度");
      return;
    }

    if (isProtectedSuperAdmin(user)) {
      showProtectedAccountToast(user);
      return;
    }
    if (!canAdjustToken(user)) {
      showUnlimitedTokenToast(user);
      return;
    }

    setTokenModalUser(user);
    setTokenAction(initialAction);
    setTokenAmount("1000");
    setTokenRemark("");
  };

  const prepareDeleteUser = (user: AdminUserItem) => {
    closeActionMenu();
    if (!canGovernUserAccounts) {
      showGovernancePermissionToast("删除用户");
      return;
    }

    if (isProtectedSuperAdmin(user)) {
      showProtectedAccountToast(user);
      return;
    }

    if (currentUser.id === user.id) {
      onToast({
        tone: "warning",
        title: "当前账号不可删除",
        message: "为了避免误删当前登录账号，系统暂不允许执行此操作。",
      });
      return;
    }

    setDeleteUserTarget(user);
  };

  const handleDeleteUserConfirm = async () => {
    if (!deleteUserTarget) {
      return;
    }

    setActiveUserId(deleteUserTarget.id);
    setIsSubmitting(true);

    try {
      await deleteAdminUser(deleteUserTarget.id);
      const deletedDisplayName = getUserDisplayName(deleteUserTarget);
      const nextSkip =
        skip > 0 && items.length === 1 ? Math.max(0, skip - DEFAULT_PAGE_SIZE) : skip;

      if (selectedUserId === deleteUserTarget.id) {
        setSelectedUserId(null);
        setDetailOpen(false);
      }

      closeDeleteUserDialog(true);

      if (nextSkip !== skip) {
        setSkip(nextSkip);
      } else {
        await loadUsers({ skip: nextSkip, search: searchKeyword });
      }

      onToast({
        tone: "success",
        title: "用户已删除",
        message: `${deletedDisplayName} 已从用户中心删除。`,
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: "删除用户失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "删除用户失败，请稍后重试。",
      });
    } finally {
      setActiveUserId(null);
      setIsSubmitting(false);
    }
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

  const handleRoleSubmit = async () => {
    if (!roleModalUser) {
      return;
    }

    if (!canChangeUserRole(currentUser, roleModalUser)) {
      showRoleChangeBlockedToast(roleModalUser);
      return;
    }

    if (nextRole === roleModalUser.role) {
      closeRoleModal(true);
      return;
    }

    setActiveUserId(roleModalUser.id);
    setIsSubmitting(true);

    try {
      const updatedUser = await updateAdminUserRole(roleModalUser.id, {
        role: nextRole,
      });
      replaceUserInState(updatedUser);
      onToast({
        tone: "success",
        title: "角色变更成功",
        message: `${getUserDisplayName(updatedUser)} 已切换为 ${formatRoleLabel(updatedUser.role)}。`,
      });
      closeRoleModal(true);
    } catch (error) {
      onToast({
        tone: "error",
        title: "角色变更失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "角色变更失败，请稍后重试。",
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
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              canCreateUsers
                ? "bg-gradient-to-r from-red-500 to-orange-400 text-white shadow-[0_14px_36px_rgba(248,113,113,0.28)]"
                : "cursor-not-allowed bg-slate-200 text-slate-500 shadow-none"
            }`}
            disabled={!canCreateUsers}
            onClick={openCreateModal}
            type="button"
          >
            <Plus className="h-4 w-4" />
            新建用户
          </button>

          {false ? (
          <button
            className={`hidden inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              canCreateUsers
                ? "bg-gradient-to-r from-red-500 to-orange-400 text-white shadow-[0_14px_36px_rgba(248,113,113,0.28)]"
                : "cursor-not-allowed bg-slate-200 text-slate-500 shadow-none"
            }`}
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
          ) : null}
        </div>

        <div className="mb-6 flex flex-wrap gap-3">
          <StandardSearchInput
            ref={searchInputRef}
            className="w-full sm:w-auto sm:min-w-[280px]"
            onSearchChange={handleSearchChange}
            placeholder="搜索用户名或昵称"
          />

          <button
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-sm transition hover:border-red-200 hover:bg-red-50"
            onClick={() => searchInputRef.current?.submit()}
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
              onClick={() => handleTabChange(tab.key)}
              type="button"
            >
              {tab.label} ({formatNumber(tab.count)})
            </button>
          ))}
        </div>

        <section className="overflow-visible rounded-[22px] border border-[#f2e8ea] bg-white/90">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[940px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="text-sm font-semibold text-slate-700">
                <th className="border-b border-gray-100 bg-red-50/50 px-6 py-4">用户</th>
                <th className="border-b border-gray-100 bg-red-50/50 px-5 py-4">角色</th>
                <th className="border-b border-gray-100 bg-red-50/50 px-5 py-4">注册时间</th>
                <th className="border-b border-gray-100 bg-red-50/50 px-5 py-4">最近活跃</th>
                <th className="border-b border-gray-100 bg-red-50/50 px-5 py-4">Token 余额</th>
                <th className="border-b border-gray-100 bg-red-50/50 px-5 py-4">状态</th>
                <th className="border-b border-gray-100 bg-red-50/50 px-5 py-4 text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <tr key={`admin-user-skeleton-${index}`} className="bg-transparent">
                    <td className="border-b border-slate-100 px-6 py-4" colSpan={7}>
                      <div className="h-14 animate-pulse rounded-2xl bg-slate-100/80" />
                    </td>
                  </tr>
                ))
              ) : visibleItems.length > 0 ? (
                visibleItems.map((user) => {
                  const isFrozen = user.status === "frozen";
                  const unlimitedTokenUser = isUnlimitedTokenUser(user);
                  const displayName = getUserDisplayName(user);
                  const latestActivityLabel = getLatestActivityLabel(user);
                  const latestActivityHint = getLatestActivityHint(user);
                  const isActionMenuOpen = actionMenu?.user.id === user.id;

                  return (
                    <tr
                      key={user.id}
                      className={`transition-colors ${
                        isActionMenuOpen ? "bg-[#fff8f8]" : "hover:bg-[#fffafa]"
                      }`}
                    >
                      <td className="border-b border-slate-100 px-6 py-4">
                        <button
                          className="flex min-w-0 items-center gap-3 text-left"
                          onClick={() => openDetailDrawer(user.id)}
                          type="button"
                        >
                          <UserAvatar
                            className="h-10 w-10"
                            name={displayName}
                            src={user.avatar_url}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">
                              {displayName}
                            </div>
                            <div className="mt-1 truncate text-[11px] text-slate-400">
                              ID: {formatUserRowId(user.id)}
                            </div>
                          </div>
                        </button>
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4">
                        <span
                          className={`inline-flex text-[13px] font-semibold ${getRoleBadgeClass(
                            user.role,
                          )}`}
                        >
                          {formatRoleLabel(user.role)}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4 text-sm text-slate-600">
                        {formatDate(user.created_at)}
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4">
                        <div className="space-y-1">
                          <div className="text-sm font-medium text-slate-700">
                            {latestActivityLabel}
                          </div>
                          <div className="truncate text-[11px] text-slate-400">
                            {latestActivityHint}
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4">
                        {unlimitedTokenUser ? (
                          <span className="text-sm font-semibold text-slate-400">无限额度</span>
                        ) : (
                          <span className="text-sm font-semibold text-slate-800">
                            {formatNumber(user.token_balance)}
                          </span>
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4">
                        <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-600">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              isFrozen ? "bg-red-500" : "bg-emerald-500"
                            }`}
                          />
                          {formatStatusLabel(user.status)}
                        </span>
                      </td>
                      <td className="border-b border-slate-100 px-5 py-4">
                        <div className="flex items-center justify-center">
                          <button
                            className={`inline-flex h-9 w-9 items-center justify-center rounded-xl transition ${
                              isActionMenuOpen
                                ? "bg-red-100 text-red-500"
                                : "bg-red-50/70 text-red-300 hover:bg-red-100 hover:text-red-500"
                            }`}
                            data-user-action-trigger=""
                            onClick={(event) => openActionMenu(user, event.currentTarget)}
                            type="button"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
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

        <div className="flex flex-col gap-3 px-6 pb-5 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-400">{paginationText}</div>
          <div className="flex items-center gap-2">
            <button
              className="h-9 rounded-lg bg-red-50 px-4 text-sm font-medium text-slate-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={skip === 0 || isLoading}
              onClick={() => setSkip((current) => Math.max(0, current - DEFAULT_PAGE_SIZE))}
              type="button"
            >
              上一页
            </button>
            <span className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-rose-500 px-3 text-sm font-bold text-white">
              {currentPage}
            </span>
            <button
              className="h-9 rounded-lg bg-red-50 px-4 text-sm font-medium text-slate-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
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

    {actionMenu && actionMenuUser ? (
      <div
        className="fixed z-[70] w-56 overflow-hidden rounded-2xl border border-slate-200/90 bg-white p-2 shadow-[0_20px_48px_rgba(15,23,42,0.16)]"
        data-user-action-menu=""
        style={{ top: actionMenu.top, left: actionMenu.left }}
      >
        <button
          className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm text-slate-600 transition hover:bg-slate-50"
          onClick={() => openDetailDrawer(actionMenuUser.id)}
          type="button"
        >
          <Eye className="h-4 w-4" />
          查看详情
        </button>
        <button
          className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isActionMenuBusy}
          onClick={() => void handleResetPassword(actionMenuUser)}
          type="button"
        >
          <KeyRound className="h-4 w-4" />
          重置密码
        </button>
        <button
          className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isActionMenuBusy}
          onClick={() => openRoleModal(actionMenuUser)}
          type="button"
        >
          <UserCog className="h-4 w-4" />
          修改角色
        </button>

        <div className="my-2 border-t border-slate-100" />

        <button
          className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm text-emerald-600 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isActionMenuBusy}
          onClick={() => openTokenModal(actionMenuUser, "add")}
          type="button"
        >
          <Plus className="h-4 w-4" />
          充值 Token
        </button>
        <button
          className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm text-amber-500 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isActionMenuBusy}
          onClick={() => openTokenModal(actionMenuUser, "deduct")}
          type="button"
        >
          <Minus className="h-4 w-4" />
          扣减 Token
        </button>
        <button
          className={`flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
            actionMenuUser.status === "frozen"
              ? "text-emerald-600 hover:bg-emerald-50"
              : "text-orange-500 hover:bg-orange-50"
          }`}
          disabled={isActionMenuBusy}
          onClick={() => void handleToggleStatus(actionMenuUser)}
          type="button"
        >
          <Lock className="h-4 w-4" />
          {actionMenuUser.status === "frozen" ? "解冻账户" : "冻结账户"}
        </button>
        <button
          className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-sm text-red-500 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isActionMenuBusy}
          onClick={() => prepareDeleteUser(actionMenuUser)}
          type="button"
        >
          <Trash2 className="h-4 w-4" />
          删除用户
        </button>
      </div>
    ) : null}

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
              {currentUser.role === "super_admin" ? (
                canChangeUserRole(currentUser, selectedUser) ? (
                  <button
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 text-sm font-bold text-red-500 transition hover:bg-red-100"
                    disabled={isSubmitting && activeUserId === selectedUser.id}
                    onClick={() => openRoleModal(selectedUser)}
                    type="button"
                  >
                    切换角色
                  </button>
                ) : (
                  <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">
                    {getRoleChangeDisabledReason(currentUser, selectedUser)}
                  </div>
                )
              ) : null}

              {!isProtectedSuperAdmin(selectedUser) ? (
                <button
                  className={`inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${
                    selectedUser.status === "frozen"
                      ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                  disabled={
                    (isSubmitting && activeUserId === selectedUser.id) || !canGovernUserAccounts
                  }
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
                  disabled={
                    (isSubmitting && activeUserId === selectedUser.id) || !canGovernUserAccounts
                  }
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
                  disabled={
                    (isSubmitting && activeUserId === selectedUser.id) || !canGovernUserAccounts
                  }
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

      {isCreateModalOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm sm:p-6"
          onClick={() => closeCreateModal()}
        >
          <div
            className="flex max-h-[min(780px,calc(100vh-72px))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 sm:px-7">
              <div className="text-xl font-bold tracking-tight text-slate-900">新建用户</div>
              <button
                aria-label="关闭"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                onClick={() => closeCreateModal()}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
              </div>

            <div className="min-h-0 overflow-y-auto px-6 py-5 sm:px-7">
              <div className="space-y-6">
              <section className="space-y-4">
                <div className="text-sm font-semibold text-slate-900">基础账号信息</div>

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-slate-700">用户名</div>
                  <input
                    className={`h-12 w-full rounded-2xl border bg-white px-4 text-sm text-slate-900 outline-none transition focus:ring-4 ${
                      createFormErrors.username
                        ? "border-red-300 focus:border-red-300 focus:ring-red-100"
                        : "border-slate-200 focus:border-red-300 focus:ring-red-100"
                    }`}
                    onChange={(event) => {
                      setCreateForm((current) => ({
                        ...current,
                        username: event.target.value,
                      }));
                      setCreateFormErrors((current) => ({
                        ...current,
                        username: undefined,
                      }));
                    }}
                    placeholder="请输入用户名"
                    type="text"
                    value={createForm.username}
                  />
                  {createFormErrors.username ? (
                    <div className="mt-2 text-xs text-red-500">{createFormErrors.username}</div>
                  ) : (
                    <div className="mt-2 text-xs text-slate-400">
                      建议使用便于识别的英文名、拼音或工号
                    </div>
                  )}
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-slate-700">初始密码</div>
                  <div
                    className={`flex items-center gap-2 rounded-2xl border bg-white px-3 py-2 transition focus-within:ring-4 ${
                      createFormErrors.password
                        ? "border-red-300 focus-within:border-red-300 focus-within:ring-red-100"
                        : "border-slate-200 focus-within:border-red-300 focus-within:ring-red-100"
                    }`}
                  >
                    <input
                      className="min-w-0 flex-1 bg-transparent px-1 font-mono text-sm text-slate-900 outline-none"
                      onChange={(event) => {
                        setCreateForm((current) => ({
                          ...current,
                          password: event.target.value,
                        }));
                        setCreateFormErrors((current) => ({
                          ...current,
                          password: undefined,
                        }));
                      }}
                      placeholder="至少 8 个字符"
                      type="text"
                      value={createForm.password}
                    />
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-3 text-xs font-semibold text-orange-600 transition hover:bg-orange-100"
                        onClick={handleGenerateCreatePassword}
                        type="button"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        ↻ 随机生成
                      </button>
                      <button
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                        onClick={() => void handleCopyCreatePassword()}
                        type="button"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        ⎘ 复制
                      </button>
                    </div>
                  </div>
                  {createFormErrors.password ? (
                    <div className="mt-2 text-xs text-red-500">{createFormErrors.password}</div>
                  ) : null}
                </label>
              </section>

              <section className="space-y-4">
                <div className="text-sm font-semibold text-slate-900">角色分配</div>
                <div className="grid grid-cols-2 gap-4">
                  {provisionRoleOptions.map((option) => {
                    const isSelected = createForm.role === option.value;
                    return (
                      <button
                        key={option.value}
                        className={`relative rounded-2xl border px-4 py-3.5 text-left transition ${
                          isSelected
                            ? "border-[#ff7a59] bg-red-50/30 shadow-[0_12px_24px_rgba(255,122,89,0.10)]"
                            : "border-slate-200 bg-transparent hover:border-slate-300 hover:bg-slate-50/60"
                        }`}
                        onClick={() => {
                          setCreateForm((current) => ({
                            ...current,
                            role: option.value,
                          }));
                          setCreateFormErrors((current) => ({
                            ...current,
                            role: undefined,
                          }));
                        }}
                        type="button"
                      >
                        {isSelected ? (
                          <span className="absolute right-4 top-4 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#ff7a59] text-white">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                        <div className="pr-8 text-sm font-semibold text-slate-900">
                          {option.label}
                        </div>
                        <div className="mt-1.5 text-xs leading-5 text-slate-500">
                          {option.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {createFormErrors.role ? (
                  <div className="text-xs text-red-500">{createFormErrors.role}</div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm leading-6 text-amber-900">
                💡 提示：系统将根据分配的角色，自动读取当前系统设置中的新用户初始资产或赋予无限额度，并同步写入审计流水。
              </section>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 sm:px-7">
                <button
                  className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
                  onClick={() => closeCreateModal()}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#ff7a59] px-5 text-sm font-semibold text-white transition hover:bg-[#f26d4c] disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={isSubmitting || !canCreateUsers}
                  onClick={() => void handleCreateUserSubmit()}
                  type="button"
                >
                  {isCreateUserSubmitting ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : null}
                  保存并创建
                </button>
            </div>
          </div>
        </div>
        ) : null}

      {roleModalUser ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/15 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-3xl rounded-[28px] border border-red-100 bg-[#fffdfa] p-7 shadow-[0_28px_90px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-bold tracking-tight text-slate-900">切换角色</div>
                <div className="mt-1 text-sm leading-6 text-slate-500">
                  当前账号：{getUserDisplayName(roleModalUser)}。请选择新的角色身份，保存后将立即刷新用户中心中的角色展示。
                </div>
              </div>
              <button
                aria-label="关闭"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 transition hover:bg-red-100"
                onClick={() => closeRoleModal()}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ROLE_ASSIGNMENT_OPTIONS.map((option) => {
                const isSelected = nextRole === option.value;
                return (
                  <button
                    key={option.value}
                    className={`rounded-[24px] border px-4 py-4 text-left transition ${
                      isSelected
                        ? "border-red-200 bg-gradient-to-br from-red-50 to-orange-50 shadow-[0_14px_32px_rgba(248,113,113,0.12)]"
                        : "border-slate-200 bg-white hover:border-red-100 hover:bg-red-50/40"
                    }`}
                    onClick={() => setNextRole(option.value)}
                    type="button"
                  >
                    <div className="text-sm font-semibold text-slate-900">{option.label}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-500">{option.description}</div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 rounded-[24px] border border-slate-200 bg-white p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-red-400">
                Permission Snapshot
              </div>
              <div className="mt-3 text-lg font-semibold text-slate-900">
                {selectedRoleOption?.label ?? "未选择角色"}
              </div>
              <div className="mt-2 text-sm leading-6 text-slate-500">
                {selectedRoleOption?.permissionHint ?? "请选择一个角色查看其核心权限提示。"}
              </div>
            </div>

            <div className="mt-7 flex justify-end gap-3">
              <button
                className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
                onClick={() => closeRoleModal()}
                type="button"
              >
                取消
              </button>
              <button
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-orange-400 px-5 text-sm font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isSubmitting}
                onClick={() => void handleRoleSubmit()}
                type="button"
              >
                {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                保存角色
              </button>
            </div>
          </div>
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

      {deleteUserTarget ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => closeDeleteUserDialog()}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-red-100 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-500">
                <Trash2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-bold text-slate-900">删除用户</div>
                <div className="mt-2 text-sm leading-6 text-slate-500">
                  确定要删除 {getUserDisplayName(deleteUserTarget)} 吗？删除后该用户将无法继续登录，关联的会话和用户资产也会一并清理。
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-red-100 bg-red-50/70 px-4 py-3 text-sm leading-6 text-red-600">
              此操作不可撤销，请在删除前确认该账号已无保留必要。
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
                onClick={() => closeDeleteUserDialog()}
                type="button"
              >
                取消
              </button>
              <button
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isDeleteUserSubmitting}
                onClick={() => void handleDeleteUserConfirm()}
                type="button"
              >
                {isDeleteUserSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                确认删除
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
