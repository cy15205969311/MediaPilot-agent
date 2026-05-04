import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Filter,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  UserPlus,
  Wallet,
  X,
} from "lucide-react";

import {
  APIError,
  downloadAdminAuditLogsCsv,
  fetchAdminAuditLogs,
} from "../api";
import type {
  AdminAuditActionType,
  AdminAuditLogItem,
  AdminAuditLogsApiResponse,
  AdminToast,
} from "../types";
import { formatDateTime, formatNumber } from "../utils/format";

type AdminAuditLogsPageProps = {
  onToast: (toast: AdminToast) => void;
};

type FilterDraft = {
  operatorKeyword: string;
  actionType: AdminAuditActionType | "";
  startDate: string;
  endDate: string;
};

const DEFAULT_PAGE_SIZE = 20;

const theme = {
  primary: "#ef4444",
  secondary: "#fb923c",
  cardBg: "#ffffff",
  cardBorder: "#e2e8f0",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#94a3b8",
  success: "#16a34a",
  warning: "#f59e0b",
  info: "#2563eb",
  dangerSoft: "#fef2f2",
  successSoft: "#f0fdf4",
  infoSoft: "#eff6ff",
  warningSoft: "#fffbeb",
  surface: "#f8fafc",
  overlay: "rgba(15, 23, 42, 0.18)",
};

const ACTION_OPTIONS: Array<{
  value: AdminAuditActionType;
  label: string;
}> = [
  { value: "create_user", label: "新建用户" },
  { value: "role_change", label: "修改角色" },
  { value: "topup", label: "资产增加" },
  { value: "token_deduct", label: "资产扣减" },
  { value: "token_set", label: "资产设定" },
  { value: "freeze", label: "账号冻结" },
  { value: "unfreeze", label: "账号解冻" },
  { value: "reset_password", label: "重置密码" },
  { value: "delete_template", label: "删除模板" },
];

function createEmptyDraft(): FilterDraft {
  return {
    operatorKeyword: "",
    actionType: "",
    startDate: "",
    endDate: "",
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function toText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function getActionLabel(actionType: AdminAuditActionType): string {
  return ACTION_OPTIONS.find((option) => option.value === actionType)?.label ?? actionType;
}

function getActionVisual(actionType: AdminAuditActionType): {
  icon: typeof FileText;
  color: string;
  backgroundColor: string;
} {
  if (actionType === "create_user") {
    return {
      icon: UserPlus,
      color: theme.info,
      backgroundColor: theme.infoSoft,
    };
  }
  if (actionType === "freeze") {
    return {
      icon: ShieldAlert,
      color: theme.primary,
      backgroundColor: theme.dangerSoft,
    };
  }
  if (actionType === "unfreeze") {
    return {
      icon: ShieldCheck,
      color: theme.success,
      backgroundColor: theme.successSoft,
    };
  }
  if (actionType === "role_change") {
    return {
      icon: UserCog,
      color: theme.info,
      backgroundColor: theme.infoSoft,
    };
  }
  if (actionType === "delete_template") {
    return {
      icon: Trash2,
      color: theme.warning,
      backgroundColor: theme.warningSoft,
    };
  }
  if (actionType === "reset_password") {
    return {
      icon: KeyRound,
      color: theme.warning,
      backgroundColor: theme.warningSoft,
    };
  }
  return {
    icon: Wallet,
    color: theme.info,
    backgroundColor: theme.infoSoft,
  };
}

function formatAuditSummary(item: AdminAuditLogItem): string {
  const details = item.details ?? {};
  if (item.action_type === "create_user") {
    const role = toText(details.role);
    const grantTokens = toNumber(details.grant_tokens) ?? 0;
    return grantTokens > 0
      ? `创建 ${role || "user"} 账号并发放 ${formatNumber(grantTokens)} Tokens`
      : `创建 ${role || "user"} 系统账号`;
  }

  if (item.action_type === "role_change") {
    const previousRole = toText(details.previous_role);
    const nextRole = toText(details.next_role);
    if (previousRole || nextRole) {
      return `${previousRole || "未知角色"} → ${nextRole || "未知角色"}`;
    }
  }

  if (item.action_type === "topup") {
    const delta = Math.abs(toNumber(details.delta) ?? toNumber(details.amount) ?? 0);
    return `增加 ${formatNumber(delta)} Tokens`;
  }

  if (item.action_type === "token_deduct") {
    const delta = Math.abs(toNumber(details.delta) ?? toNumber(details.amount) ?? 0);
    return `扣减 ${formatNumber(delta)} Tokens`;
  }

  if (item.action_type === "token_set") {
    const nextBalance = toNumber(details.next_balance);
    if (nextBalance !== null) {
      return `余额设定为 ${formatNumber(nextBalance)} Tokens`;
    }
  }

  if (item.action_type === "freeze" || item.action_type === "unfreeze") {
    const previousStatus = toText(details.previous_status);
    const nextStatus = toText(details.next_status);
    if (previousStatus || nextStatus) {
      return `状态 ${previousStatus || "unknown"} → ${nextStatus || "unknown"}`;
    }
  }

  if (item.action_type === "reset_password") {
    const revokedSessions = toNumber(details.revoked_sessions) ?? 0;
    return `已撤销 ${formatNumber(revokedSessions)} 个活跃会话`;
  }

  if (item.action_type === "delete_template") {
    const templateName = toText(details.template_name);
    if (templateName) {
      return `已删除模板 ${templateName}`;
    }
  }

  const summaryParts = Object.entries(details)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${toText(value) || JSON.stringify(value)}`);
  return summaryParts.join(" · ") || "已记录后台操作明细";
}

function formatAuditMeta(item: AdminAuditLogItem): string {
  const details = item.details ?? {};
  const metaParts: string[] = [];

  const previousBalance = toNumber(details.previous_balance);
  const nextBalance = toNumber(details.next_balance);
  if (previousBalance !== null && nextBalance !== null) {
    metaParts.push(`余额 ${formatNumber(previousBalance)} → ${formatNumber(nextBalance)}`);
  }

  const remark = toText(details.remark);
  if (remark) {
    metaParts.push(`备注：${remark}`);
  }

  const revokedSessions = toNumber(details.revoked_sessions);
  if (revokedSessions !== null && revokedSessions > 0 && item.action_type !== "reset_password") {
    metaParts.push(`撤销会话 ${formatNumber(revokedSessions)} 个`);
  }

  return metaParts.join(" · ");
}

function buildAppliedFilterSummary(filters: FilterDraft): string[] {
  const items: string[] = [];
  if (filters.operatorKeyword.trim()) {
    items.push(`操作人：${filters.operatorKeyword.trim()}`);
  }
  if (filters.actionType) {
    items.push(`类型：${getActionLabel(filters.actionType)}`);
  }
  if (filters.startDate || filters.endDate) {
    items.push(`日期：${filters.startDate || "不限"} 至 ${filters.endDate || "不限"}`);
  }
  return items;
}

function AuditLogSkeleton() {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ backgroundColor: theme.cardBg, borderColor: theme.cardBorder }}
    >
      <div className="animate-pulse">
        <div className="flex gap-4">
          <div className="h-11 w-11 rounded-xl bg-slate-100" />
          <div className="min-w-0 flex-1">
            <div className="h-4 w-48 rounded-full bg-slate-200" />
            <div className="mt-3 h-3 w-64 rounded-full bg-slate-100" />
            <div className="mt-3 h-3 w-40 rounded-full bg-slate-100" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminAuditLogsPage(props: AdminAuditLogsPageProps) {
  const { onToast } = props;
  const [logsPayload, setLogsPayload] = useState<AdminAuditLogsApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [skip, setSkip] = useState(0);
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<FilterDraft>(createEmptyDraft);
  const [draftFilters, setDraftFilters] = useState<FilterDraft>(createEmptyDraft);

  const items = logsPayload?.items ?? [];
  const total = logsPayload?.total ?? 0;
  const currentPage = Math.floor(skip / DEFAULT_PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const filterSummary = useMemo(
    () => buildAppliedFilterSummary(appliedFilters),
    [appliedFilters],
  );

  useEffect(() => {
    let active = true;

    const loadAuditLogs = async () => {
      setIsLoading(true);

      try {
        const payload = await fetchAdminAuditLogs({
          skip,
          limit: DEFAULT_PAGE_SIZE,
          operatorKeyword: appliedFilters.operatorKeyword,
          actionType: appliedFilters.actionType,
          startDate: appliedFilters.startDate,
          endDate: appliedFilters.endDate,
        });
        if (active) {
          setLogsPayload(payload);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        onToast({
          tone: "error",
          title: "审计日志加载失败",
          message:
            error instanceof APIError
              ? error.message
              : error instanceof Error
                ? error.message
                : "审计日志暂时不可用，请稍后重试。",
        });
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadAuditLogs();

    return () => {
      active = false;
    };
  }, [appliedFilters, onToast, skip]);

  const handleApplyFilters = () => {
    if (
      draftFilters.startDate &&
      draftFilters.endDate &&
      draftFilters.startDate > draftFilters.endDate
    ) {
      onToast({
        tone: "warning",
        title: "筛选日期范围无效",
        message: "开始日期不能晚于结束日期，请调整后再应用筛选。",
      });
      return;
    }

    setAppliedFilters({
      operatorKeyword: draftFilters.operatorKeyword.trim(),
      actionType: draftFilters.actionType,
      startDate: draftFilters.startDate,
      endDate: draftFilters.endDate,
    });
    setSkip(0);
    setIsFilterDrawerOpen(false);
  };

  const handleResetFilters = () => {
    const nextFilters = createEmptyDraft();
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setSkip(0);
    setIsFilterDrawerOpen(false);
  };

  const handleRefresh = async () => {
    setIsLoading(true);

    try {
      const payload = await fetchAdminAuditLogs({
        skip,
        limit: DEFAULT_PAGE_SIZE,
        operatorKeyword: appliedFilters.operatorKeyword,
        actionType: appliedFilters.actionType,
        startDate: appliedFilters.startDate,
        endDate: appliedFilters.endDate,
      });
      setLogsPayload(payload);
      onToast({
        tone: "success",
        title: "审计日志已刷新",
        message: "最新后台操作轨迹已经同步到当前列表。",
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: "刷新失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "刷新审计日志失败，请稍后重试。",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);

    try {
      const filename = await downloadAdminAuditLogsCsv({
        operatorKeyword: appliedFilters.operatorKeyword,
        actionType: appliedFilters.actionType,
        startDate: appliedFilters.startDate,
        endDate: appliedFilters.endDate,
      });
      onToast({
        tone: "success",
        title: "合规报表已开始导出",
        message: `CSV 文件 ${filename} 已生成并开始下载。`,
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: "导出失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "导出审计日志失败，请稍后重试。",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const paginationText =
    total === 0
      ? "当前筛选条件下暂无审计事件"
      : `显示 ${formatNumber(skip + 1)}-${formatNumber(
          Math.min(skip + items.length, total),
        )}，共 ${formatNumber(total)} 条`;

  return (
    <>
      <div className="p-4 lg:p-6">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>
              审计日志
            </h1>
            <p className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
              聚合后台关键操作轨迹，支持按操作者、动作类型和日期范围筛选，并可一键导出 CSV 合规报表。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-red-50"
              onClick={() => {
                setDraftFilters(appliedFilters);
                setIsFilterDrawerOpen(true);
              }}
              style={{
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
                color: theme.textSecondary,
              }}
              type="button"
            >
              <Filter className="h-4 w-4" />
              筛选
            </button>

            <button
              className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isExporting}
              onClick={() => {
                void handleExport();
              }}
              style={{
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
                color: theme.textSecondary,
              }}
              type="button"
            >
              <Download className="h-4 w-4" />
              {isExporting ? "导出中..." : "导出 CSV"}
            </button>

            <button
              className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-red-50"
              onClick={() => {
                void handleRefresh();
              }}
              style={{
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
                color: theme.textSecondary,
              }}
              type="button"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
          </div>
        </div>

        <div
          className="rounded-2xl border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.cardBorder }}
        >
          <div className="border-b p-5" style={{ borderColor: theme.cardBorder }}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
                  风控追溯列表
                </h2>
                <p className="mt-1 text-sm" style={{ color: theme.textMuted }}>
                  {paginationText}
                </p>
              </div>

              {filterSummary.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  {filterSummary.map((item) => (
                    <span
                      key={item}
                      className="rounded-full px-3 py-1.5 text-xs font-medium"
                      style={{
                        backgroundColor: theme.infoSoft,
                        color: theme.info,
                      }}
                    >
                      {item}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-sm" style={{ color: theme.textMuted }}>
                  当前未应用任何筛选条件
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 p-5">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, index) => <AuditLogSkeleton key={index} />)
            ) : items.length ? (
              items.map((item) => {
                const visual = getActionVisual(item.action_type);
                const Icon = visual.icon;
                const meta = formatAuditMeta(item);

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border p-5 transition-colors hover:bg-red-50/40"
                    style={{
                      backgroundColor: theme.cardBg,
                      borderColor: theme.cardBorder,
                    }}
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                        style={{
                          backgroundColor: visual.backgroundColor,
                          color: visual.color,
                        }}
                      >
                        <Icon className="h-5 w-5" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="rounded-full px-3 py-1 text-xs font-semibold"
                                style={{
                                  backgroundColor: visual.backgroundColor,
                                  color: visual.color,
                                }}
                              >
                                {getActionLabel(item.action_type)}
                              </span>
                              <span
                                className="rounded-full px-3 py-1 text-xs font-medium"
                                style={{
                                  backgroundColor: theme.surface,
                                  color: theme.textMuted,
                                }}
                              >
                                操作者：{item.operator_name}
                              </span>
                            </div>

                            <div
                              className="mt-3 text-base font-semibold"
                              style={{ color: theme.textPrimary }}
                            >
                              {item.target_name || "未命名目标对象"}
                            </div>

                            <div className="mt-2 text-sm leading-6" style={{ color: theme.textSecondary }}>
                              {formatAuditSummary(item)}
                            </div>

                            {meta ? (
                              <div className="mt-2 text-sm leading-6" style={{ color: theme.textMuted }}>
                                {meta}
                              </div>
                            ) : null}
                          </div>

                          <div className="shrink-0 text-sm" style={{ color: theme.textMuted }}>
                            {formatDateTime(item.created_at)}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs" style={{ color: theme.textMuted }}>
                          {item.target_id ? <span>目标 ID：{item.target_id}</span> : null}
                          <span>审计事件 ID：{item.id}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div
                className="rounded-2xl border px-6 py-16 text-center"
                style={{
                  backgroundColor: theme.surface,
                  borderColor: theme.cardBorder,
                }}
              >
                <div className="text-base font-semibold" style={{ color: theme.textPrimary }}>
                  暂无符合条件的审计日志
                </div>
                <div className="mt-2 text-sm" style={{ color: theme.textMuted }}>
                  可以尝试放宽筛选条件，或先在用户中心执行一次角色变更、冻结、额度调整等后台操作。
                </div>
              </div>
            )}
          </div>

          <div
            className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            style={{ borderColor: theme.cardBorder }}
          >
            <div className="text-sm" style={{ color: theme.textMuted }}>
              第 {formatNumber(currentPage)} / {formatNumber(totalPages)} 页
            </div>

            <div className="flex items-center gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                disabled={skip <= 0}
                onClick={() => setSkip((current) => Math.max(0, current - DEFAULT_PAGE_SIZE))}
                style={{
                  backgroundColor: theme.cardBg,
                  borderColor: theme.cardBorder,
                  color: theme.textSecondary,
                }}
                type="button"
              >
                <ChevronLeft className="h-4 w-4" />
                上一页
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                disabled={skip + DEFAULT_PAGE_SIZE >= total}
                onClick={() => setSkip((current) => current + DEFAULT_PAGE_SIZE)}
                style={{
                  backgroundColor: theme.cardBg,
                  borderColor: theme.cardBorder,
                  color: theme.textSecondary,
                }}
                type="button"
              >
                下一页
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {isFilterDrawerOpen ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsFilterDrawerOpen(false)}
            style={{ backgroundColor: theme.overlay }}
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md">
            <div
              className="flex h-full flex-col border-l shadow-2xl"
              style={{
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
              }}
            >
              <div
                className="flex items-center justify-between border-b px-6 py-5"
                style={{ borderColor: theme.cardBorder }}
              >
                <div>
                  <div className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
                    高级筛选
                  </div>
                  <div className="mt-1 text-sm" style={{ color: theme.textMuted }}>
                    精准锁定审计事件范围
                  </div>
                </div>
                <button
                  className="rounded-full p-2 transition-colors hover:bg-red-50"
                  onClick={() => setIsFilterDrawerOpen(false)}
                  type="button"
                >
                  <X className="h-5 w-5" style={{ color: theme.textMuted }} />
                </button>
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
                <div>
                  <label
                    className="mb-2 block text-sm font-medium"
                    style={{ color: theme.textPrimary }}
                  >
                    操作人
                  </label>
                  <input
                    className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        operatorKeyword: event.target.value,
                      }))
                    }
                    placeholder="输入操作人姓名或账号"
                    style={{
                      backgroundColor: theme.surface,
                      borderColor: theme.cardBorder,
                      color: theme.textPrimary,
                    }}
                    type="text"
                    value={draftFilters.operatorKeyword}
                  />
                </div>

                <div>
                  <label
                    className="mb-2 block text-sm font-medium"
                    style={{ color: theme.textPrimary }}
                  >
                    操作类型
                  </label>
                  <select
                    className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
                    onChange={(event) =>
                      setDraftFilters((current) => ({
                        ...current,
                        actionType: event.target.value as AdminAuditActionType | "",
                      }))
                    }
                    style={{
                      backgroundColor: theme.surface,
                      borderColor: theme.cardBorder,
                      color: theme.textPrimary,
                    }}
                    value={draftFilters.actionType}
                  >
                    <option value="">全部类型</option>
                    {ACTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      className="mb-2 block text-sm font-medium"
                      style={{ color: theme.textPrimary }}
                    >
                      开始日期
                    </label>
                    <input
                      className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
                      onChange={(event) =>
                        setDraftFilters((current) => ({
                          ...current,
                          startDate: event.target.value,
                        }))
                      }
                      style={{
                        backgroundColor: theme.surface,
                        borderColor: theme.cardBorder,
                        color: theme.textPrimary,
                      }}
                      type="date"
                      value={draftFilters.startDate}
                    />
                  </div>

                  <div>
                    <label
                      className="mb-2 block text-sm font-medium"
                      style={{ color: theme.textPrimary }}
                    >
                      结束日期
                    </label>
                    <input
                      className="w-full rounded-xl border px-4 py-3 text-sm outline-none"
                      onChange={(event) =>
                        setDraftFilters((current) => ({
                          ...current,
                          endDate: event.target.value,
                        }))
                      }
                      style={{
                        backgroundColor: theme.surface,
                        borderColor: theme.cardBorder,
                        color: theme.textPrimary,
                      }}
                      type="date"
                      value={draftFilters.endDate}
                    />
                  </div>
                </div>
              </div>

              <div
                className="flex items-center gap-3 border-t px-6 py-5"
                style={{ borderColor: theme.cardBorder }}
              >
                <button
                  className="flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-colors hover:bg-slate-50"
                  onClick={handleResetFilters}
                  style={{
                    backgroundColor: theme.cardBg,
                    borderColor: theme.cardBorder,
                    color: theme.textSecondary,
                  }}
                  type="button"
                >
                  清空筛选
                </button>
                <button
                  className="flex-1 rounded-xl px-4 py-3 text-sm font-medium text-white"
                  onClick={handleApplyFilters}
                  style={{
                    background: "linear-gradient(135deg, #ef4444 0%, #fb923c 100%)",
                  }}
                  type="button"
                >
                  应用筛选
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
