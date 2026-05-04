import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Filter,
  KeyRound,
  RefreshCw,
  RotateCcw,
  Settings2,
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
  rollbackAdminSystemSettings,
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

type SystemSettingChangeItem = {
  key: string;
  category: string;
  previousValue: unknown;
  nextValue: unknown;
};

type RollbackDialogState = {
  item: AdminAuditLogItem;
  changes: SystemSettingChangeItem[];
};

const DEFAULT_PAGE_SIZE = 5;
const DETAIL_DRAWER_CLOSE_DELAY_MS = 240;

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
  overlay: "rgba(15, 23, 42, 0.22)",
};

const ACTION_OPTIONS: Array<{
  value: AdminAuditActionType;
  label: string;
}> = [
  { value: "delete_user", label: "删除用户" },
  { value: "create_user", label: "新建用户" },
  { value: "role_change", label: "修改角色" },
  { value: "topup", label: "充值 Token" },
  { value: "token_deduct", label: "扣减 Token" },
  { value: "token_set", label: "设定余额" },
  { value: "freeze", label: "冻结账户" },
  { value: "unfreeze", label: "解除冻结" },
  { value: "reset_password", label: "重置密码" },
  { value: "delete_template", label: "删除模板" },
  { value: "update_system_settings", label: "修改系统设置" },
  { value: "rollback_system_settings", label: "回滚系统设置" },
];

const SETTING_CATEGORY_LABELS: Record<string, string> = {
  basic: "基础设置",
  token: "Token 配置",
  security: "安全设置",
  notification: "通知设置",
};

const SETTING_LABELS: Record<string, string> = {
  system_name: "系统名称",
  admin_email: "管理员邮箱",
  timezone: "时区设置",
  language: "默认语言",
  token_price: "Token 单价",
  new_user_bonus: "新用户赠送额度",
  daily_free_quota: "每日免费额度",
  minimum_topup: "最低充值额度",
  two_factor_auth: "双因素认证",
  ip_whitelist_enabled: "IP 白名单",
  ip_whitelist_ips: "白名单 IP 列表",
  login_captcha_enabled: "登录验证码",
  session_timeout_enabled: "会话超时保护",
  session_timeout_minutes: "会话超时分钟数",
  user_signup_notification: "用户注册通知",
  anomaly_alert_notification: "异常告警通知",
  system_maintenance_notification: "系统维护通知",
  daily_report_notification: "每日报表通知",
};

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getActionLabel(actionType: AdminAuditActionType): string {
  return ACTION_OPTIONS.find((option) => option.value === actionType)?.label ?? actionType;
}

function isSystemSettingAction(actionType: AdminAuditActionType): boolean {
  return (
    actionType === "update_system_settings" || actionType === "rollback_system_settings"
  );
}

function canRollbackFromAuditLog(actionType: AdminAuditActionType): boolean {
  return actionType === "update_system_settings";
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

  if (actionType === "delete_user") {
    return {
      icon: Trash2,
      color: theme.primary,
      backgroundColor: theme.dangerSoft,
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

  if (actionType === "update_system_settings") {
    return {
      icon: Settings2,
      color: theme.secondary,
      backgroundColor: theme.warningSoft,
    };
  }

  if (actionType === "rollback_system_settings") {
    return {
      icon: RotateCcw,
      color: theme.primary,
      backgroundColor: theme.dangerSoft,
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
      ? `创建 ${role || "user"} 账户并发放 ${formatNumber(grantTokens)} Tokens`
      : `创建 ${role || "user"} 系统账户`;
  }

  if (item.action_type === "delete_user") {
    const username = toText(details.username);
    const role = toText(details.role);
    return username
      ? `删除 ${role || "user"} 账户 ${username}`
      : "删除用户账户";
  }

  if (item.action_type === "role_change") {
    const previousRole = toText(details.previous_role);
    const nextRole = toText(details.next_role);
    if (previousRole || nextRole) {
      return `${previousRole || "未知角色"} -> ${nextRole || "未知角色"}`;
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
      return `状态 ${previousStatus || "unknown"} -> ${nextStatus || "unknown"}`;
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

  if (item.action_type === "update_system_settings") {
    const changes = extractSystemSettingChanges(details);
    return changes.length > 0
      ? `更新 ${formatNumber(changes.length)} 项系统配置`
      : "更新系统设置";
  }

  if (item.action_type === "rollback_system_settings") {
    const changes = extractSystemSettingChanges(details);
    const snapshotAuditLogId = toText(details.snapshot_audit_log_id);
    return changes.length > 0
      ? `回滚 ${formatNumber(changes.length)} 项系统配置至快照 ${snapshotAuditLogId || "--"}`
      : "回滚系统设置";
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
    metaParts.push(`余额 ${formatNumber(previousBalance)} -> ${formatNumber(nextBalance)}`);
  }

  const remark = toText(details.remark);
  if (remark) {
    metaParts.push(`备注：${remark}`);
  }

  if (isSystemSettingAction(item.action_type)) {
    const changedKeys = extractSystemSettingChanges(details).map((change) =>
      prettifySettingKey(change.key),
    );
    if (changedKeys.length > 0) {
      metaParts.push(`变更项：${changedKeys.join("、")}`);
    }
  }

  if (item.action_type === "rollback_system_settings") {
    const snapshotAuditLogId = toText(details.snapshot_audit_log_id);
    if (snapshotAuditLogId) {
      metaParts.push(`回滚快照：${snapshotAuditLogId}`);
    }
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

function prettifySettingKey(key: string): string {
  return (
    SETTING_LABELS[key] ??
    key
      .split("_")
      .filter(Boolean)
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" ")
  );
}

function prettifySettingCategory(category: string): string {
  return SETTING_CATEGORY_LABELS[category] ?? category;
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "未设置";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isInteger(value) ? formatNumber(value) : String(value);
  }

  if (typeof value === "boolean") {
    return value ? "已开启" : "已关闭";
  }

  return JSON.stringify(value, null, 2);
}

function formatJsonBlock(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function extractSystemSettingChanges(details: Record<string, unknown>): SystemSettingChangeItem[] {
  const rawChanges = isPlainObject(details.changes) ? details.changes : {};

  return Object.entries(rawChanges)
    .map(([key, value]) => {
      if (!isPlainObject(value)) {
        return null;
      }

      return {
        key,
        category: typeof value.category === "string" ? value.category : "basic",
        previousValue: value.previous_value,
        nextValue: value.next_value,
      } satisfies SystemSettingChangeItem;
    })
    .filter((item): item is SystemSettingChangeItem => item !== null);
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

function SystemSettingDiffPanel(props: { item: AdminAuditLogItem }) {
  const { item } = props;
  const changes = extractSystemSettingChanges(item.details ?? {});

  if (!changes.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
        本次系统设置变更未附带结构化 Diff，当前展示原始审计载荷。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {changes.map((change) => (
        <div
          key={change.key}
          className="rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]"
        >
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">
                {prettifySettingKey(change.key)}
              </div>
              <div className="mt-1 text-xs text-slate-500">{change.key}</div>
            </div>
            <span className="inline-flex w-fit rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-600">
              {prettifySettingCategory(change.category)}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-red-500">
                Before
              </div>
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600 line-through whitespace-pre-wrap break-all">
                {formatDetailValue(change.previousValue)}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-green-600">
                After
              </div>
              <div className="rounded-2xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-700 whitespace-pre-wrap break-all">
                {formatDetailValue(change.nextValue)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function GenericAuditJsonPanel(props: { value: unknown }) {
  const { value } = props;

  return (
    <pre className="overflow-x-auto rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-xs leading-6 text-slate-700">
      {formatJsonBlock(value)}
    </pre>
  );
}

function AuditLogDetailDrawer(props: {
  item: AdminAuditLogItem | null;
  isOpen: boolean;
  isFetching: boolean;
  onRequestRollback: (item: AdminAuditLogItem) => void;
  onClose: () => void;
}) {
  const { item, isOpen, isFetching, onRequestRollback, onClose } = props;
  const visual = item ? getActionVisual(item.action_type) : null;
  const Icon = visual?.icon ?? FileText;
  const meta = item ? formatAuditMeta(item) : "";
  const changes = item ? extractSystemSettingChanges(item.details ?? {}) : [];

  return (
    <>
      <div
        aria-hidden={!isOpen}
        className={`fixed inset-0 z-40 transition-all duration-200 ${
          isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
        style={{ backgroundColor: theme.overlay }}
      />

      <aside
        aria-hidden={!isOpen}
        className={`fixed inset-y-0 right-0 z-50 flex w-full justify-end transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="h-full w-full max-w-2xl p-3 sm:p-4">
          <div className="relative flex h-full flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-500">
                  Audit Details
                </div>
                <div className="mt-2 text-xl font-semibold text-slate-900">
                  {item ? getActionLabel(item.action_type) : "查看详情"}
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  {item ? formatDateTime(item.created_at) : "选择一条日志查看详细差异"}
                </div>
              </div>

              <button
                className="rounded-full p-2 transition-colors hover:bg-slate-100"
                onClick={onClose}
                type="button"
              >
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>

            {item ? (
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-4">
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                        style={{
                          backgroundColor: visual?.backgroundColor ?? theme.surface,
                          color: visual?.color ?? theme.textMuted,
                        }}
                      >
                        <Icon className="h-5 w-5" />
                      </div>

                      <div className="min-w-0">
                        <div className="text-base font-semibold text-slate-900">
                          {item.target_name || "未命名目标对象"}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-slate-600">
                          {formatAuditSummary(item)}
                        </div>
                        {meta ? (
                          <div className="mt-2 text-sm leading-6 text-slate-500">{meta}</div>
                        ) : null}
                      </div>
                    </div>

                    <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-500">
                      操作人：{item.operator_name}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white px-4 py-3">
                      <div className="text-xs font-medium text-slate-400">审计事件 ID</div>
                      <div className="mt-1 break-all text-sm text-slate-700">{item.id}</div>
                    </div>

                    <div className="rounded-2xl bg-white px-4 py-3">
                      <div className="text-xs font-medium text-slate-400">目标 ID</div>
                      <div className="mt-1 break-all text-sm text-slate-700">
                        {item.target_id || "未记录"}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="mb-3 text-sm font-semibold text-slate-900">变更载荷</div>
                  {isSystemSettingAction(item.action_type) ? (
                    <div className="space-y-4">
                      <SystemSettingDiffPanel item={item} />
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Raw Audit JSON
                        </div>
                        <GenericAuditJsonPanel value={item.details ?? {}} />
                      </div>
                    </div>
                  ) : (
                    <GenericAuditJsonPanel value={item.details ?? {}} />
                  )}
                </div>

                {canRollbackFromAuditLog(item.action_type) ? (
                  <div className="mt-6 rounded-[24px] border border-red-100 bg-red-50/40 px-5 py-5">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-red-500">
                      Danger Zone
                    </div>
                    <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="text-base font-semibold text-slate-900">一键回滚</div>
                        <div className="mt-2 text-sm leading-6 text-slate-500">
                          {changes.length === 1
                            ? `将 ${prettifySettingKey(changes[0].key)} 恢复到该快照中的旧值，并立即生效。`
                            : `将当前系统配置回退到这份快照中的旧状态，并同步写入新的审计流水。`}
                        </div>
                      </div>
                      <button
                        className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500 px-4 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50"
                        onClick={() => onRequestRollback(item)}
                        type="button"
                      >
                        <RotateCcw className="h-4 w-4" />
                        一键回滚
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center px-6 py-10 text-center">
                <div>
                  <div className="text-lg font-semibold text-slate-900">选择一条日志</div>
                  <div className="mt-2 text-sm leading-6 text-slate-500">
                    右侧抽屉会展示完整审计载荷；系统设置变更还会自动渲染红绿 Diff。
                  </div>
                </div>
              </div>
            )}

            {isOpen && isFetching ? (
              <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm">
                <div className="flex items-center gap-3 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-orange-500 shadow-sm">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Syncing details...
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}

function RollbackConfirmDialog(props: {
  state: RollbackDialogState | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { state, isSubmitting, onCancel, onConfirm } = props;

  if (!state) {
    return null;
  }

  const primaryChange = state.changes[0] ?? null;
  const confirmMessage =
    state.changes.length === 1 && primaryChange
      ? `确定要将 [${prettifySettingKey(primaryChange.key)}] 回滚至旧值 [${formatDetailValue(primaryChange.previousValue)}] 吗？此操作将立即生效并记录新的审计流水。`
      : `确定要将 ${formatNumber(
          state.changes.length,
        )} 项系统配置回滚至该快照中的旧值吗？此操作将立即生效并记录新的审计流水。`;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[28px] border border-red-100 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.22)]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <div className="text-lg font-semibold text-slate-900">确认回滚系统设置</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">{confirmMessage}</div>
          </div>
          <button
            className="rounded-full p-2 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
            onClick={onCancel}
            type="button"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="space-y-3 px-6 py-5">
          {state.changes.map((change) => (
            <div
              key={change.key}
              className="rounded-2xl border border-red-100 bg-red-50/40 px-4 py-4"
            >
              <div className="text-sm font-semibold text-slate-900">
                {prettifySettingKey(change.key)}
              </div>
              <div className="mt-2 text-xs text-slate-500">{change.key}</div>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="rounded-xl bg-white px-3 py-2 text-xs text-slate-500">
                  当前值：{formatDetailValue(change.nextValue)}
                </div>
                <div className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-red-500">
                  回滚后：{formatDetailValue(change.previousValue)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 px-6 py-5">
          <button
            className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isSubmitting}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500 px-4 py-2.5 text-sm font-medium text-red-500 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            onClick={onConfirm}
            type="button"
          >
            {isSubmitting ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" />
            )}
            {isSubmitting ? "回滚中..." : "确认回滚"}
          </button>
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
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<AdminAuditLogItem | null>(null);
  const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
  const [isDetailFetching, setIsDetailFetching] = useState(false);
  const [rollbackDialogState, setRollbackDialogState] = useState<RollbackDialogState | null>(null);
  const [isRollbackSubmitting, setIsRollbackSubmitting] = useState(false);
  const detailDrawerCloseTimerRef = useRef<number | null>(null);
  const detailDrawerFetchTimerRef = useRef<number | null>(null);
  const selectedLogIdRef = useRef<string | null>(null);
  const isDetailDrawerOpenRef = useRef(false);

  const items = logsPayload?.items ?? [];
  const total = logsPayload?.total ?? 0;
  const currentPage = Math.floor(skip / DEFAULT_PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
  const filterSummary = useMemo(
    () => buildAppliedFilterSummary(appliedFilters),
    [appliedFilters],
  );

  useEffect(() => {
    selectedLogIdRef.current = selectedLogId;
  }, [selectedLogId]);

  useEffect(() => {
    isDetailDrawerOpenRef.current = isDetailDrawerOpen;
  }, [isDetailDrawerOpen]);

  useEffect(() => {
    return () => {
      if (detailDrawerCloseTimerRef.current !== null) {
        window.clearTimeout(detailDrawerCloseTimerRef.current);
      }
      if (detailDrawerFetchTimerRef.current !== null) {
        window.clearTimeout(detailDrawerFetchTimerRef.current);
      }
    };
  }, []);

  const clearDetailFetchingTimer = () => {
    if (detailDrawerFetchTimerRef.current !== null) {
      window.clearTimeout(detailDrawerFetchTimerRef.current);
      detailDrawerFetchTimerRef.current = null;
    }
  };

  const pulseDetailFetchingOverlay = () => {
    clearDetailFetchingTimer();
    setIsDetailFetching(true);
    detailDrawerFetchTimerRef.current = window.setTimeout(() => {
      setIsDetailFetching(false);
      detailDrawerFetchTimerRef.current = null;
    }, 220);
  };

  useEffect(() => {
    let active = true;

    const loadAuditLogs = async () => {
      const shouldKeepDrawerStable =
        isDetailDrawerOpenRef.current && Boolean(selectedLogIdRef.current);

      setIsLoading(true);
      if (shouldKeepDrawerStable) {
        clearDetailFetchingTimer();
        setIsDetailFetching(true);
      }

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
          if (selectedLogIdRef.current) {
            const nextSelectedLog =
              payload.items.find((item) => item.id === selectedLogIdRef.current) ?? null;
            setSelectedLog(nextSelectedLog);
            if (!nextSelectedLog) {
              setSelectedLogId(null);
              setIsDetailDrawerOpen(false);
            }
          }
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
          if (shouldKeepDrawerStable) {
            setIsDetailFetching(false);
          }
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
    const shouldKeepDrawerStable =
      isDetailDrawerOpenRef.current && Boolean(selectedLogIdRef.current);

    setIsLoading(true);
    if (shouldKeepDrawerStable) {
      clearDetailFetchingTimer();
      setIsDetailFetching(true);
    }

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
      if (selectedLogIdRef.current) {
        const nextSelectedLog =
          payload.items.find((item) => item.id === selectedLogIdRef.current) ?? null;
        setSelectedLog(nextSelectedLog);
        if (!nextSelectedLog) {
          setSelectedLogId(null);
          setIsDetailDrawerOpen(false);
        }
      }
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
      if (shouldKeepDrawerStable) {
        setIsDetailFetching(false);
      }
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

  const handleOpenDetailDrawer = (item: AdminAuditLogItem) => {
    if (detailDrawerCloseTimerRef.current !== null) {
      window.clearTimeout(detailDrawerCloseTimerRef.current);
      detailDrawerCloseTimerRef.current = null;
    }

    if (selectedLogIdRef.current && selectedLogIdRef.current !== item.id) {
      pulseDetailFetchingOverlay();
    }

    setSelectedLogId(item.id);
    setSelectedLog(item);
    setIsDetailDrawerOpen(true);
  };

  const handleCloseDetailDrawer = () => {
    clearDetailFetchingTimer();
    setIsDetailFetching(false);
    setIsDetailDrawerOpen(false);

    if (detailDrawerCloseTimerRef.current !== null) {
      window.clearTimeout(detailDrawerCloseTimerRef.current);
    }

    detailDrawerCloseTimerRef.current = window.setTimeout(() => {
      setSelectedLogId(null);
      setSelectedLog(null);
      detailDrawerCloseTimerRef.current = null;
    }, DETAIL_DRAWER_CLOSE_DELAY_MS);
  };

  const handleOpenRollbackDialog = (item: AdminAuditLogItem) => {
    const changes = extractSystemSettingChanges(item.details ?? {});
    if (!changes.length) {
      onToast({
        tone: "warning",
        title: "该快照暂不支持回滚",
        message: "当前审计日志未附带可用的系统设置 Diff，无法执行一键回滚。",
      });
      return;
    }

    setRollbackDialogState({ item, changes });
  };

  const handleCloseRollbackDialog = () => {
    if (isRollbackSubmitting) {
      return;
    }
    setRollbackDialogState(null);
  };

  const handleConfirmRollback = async () => {
    if (!rollbackDialogState) {
      return;
    }

    setIsRollbackSubmitting(true);

    try {
      const nextFilters =
        appliedFilters.actionType &&
        appliedFilters.actionType !== "rollback_system_settings"
          ? {
              ...appliedFilters,
              actionType: "" as const,
            }
          : appliedFilters;
      const response = await rollbackAdminSystemSettings(rollbackDialogState.item.id);
      const nextPayload = await fetchAdminAuditLogs({
        skip: 0,
        limit: DEFAULT_PAGE_SIZE,
        operatorKeyword: nextFilters.operatorKeyword,
        actionType: nextFilters.actionType,
        startDate: nextFilters.startDate,
        endDate: nextFilters.endDate,
      });

      setLogsPayload(nextPayload);
      if (skip !== 0) {
        setSkip(0);
      }
      if (nextFilters !== appliedFilters) {
        setAppliedFilters(nextFilters);
        setDraftFilters(nextFilters);
      }
      setRollbackDialogState(null);
      if (detailDrawerCloseTimerRef.current !== null) {
        window.clearTimeout(detailDrawerCloseTimerRef.current);
        detailDrawerCloseTimerRef.current = null;
      }
      clearDetailFetchingTimer();
      setIsDetailFetching(false);
      setIsDetailDrawerOpen(false);
      setSelectedLogId(null);
      setSelectedLog(null);

      onToast({
        tone: "success",
        title: "配置已成功回滚",
        message: `已恢复 ${formatNumber(response.rolled_back_keys.length)} 项系统配置，并写入新的审计流水。`,
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: "回滚失败",
        message:
          error instanceof APIError
            ? error.message
            : error instanceof Error
              ? error.message
              : "系统设置回滚失败，请稍后重试。",
      });
    } finally {
      setIsRollbackSubmitting(false);
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
            <p className="mt-2 text-sm leading-6" style={{ color: theme.textSecondary }}>
              聚合后台关键操作轨迹，支持按操作人、动作类型和日期范围筛选，并可一键导出 CSV
              合规报表。
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
                  风控轨迹列表
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
              Array.from({ length: DEFAULT_PAGE_SIZE }).map((_, index) => (
                <AuditLogSkeleton key={index} />
              ))
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
                                操作人：{item.operator_name}
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

                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: theme.textMuted }}>
                            {item.target_id ? <span>目标 ID：{item.target_id}</span> : null}
                            <span>审计事件 ID：{item.id}</span>
                          </div>

                          <button
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-white"
                            onClick={() => handleOpenDetailDrawer(item)}
                            type="button"
                          >
                            <Eye className="h-4 w-4" />
                            查看详情
                          </button>
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

      <AuditLogDetailDrawer
        isFetching={isDetailFetching}
        isOpen={isDetailDrawerOpen}
        item={selectedLog}
        onRequestRollback={handleOpenRollbackDialog}
        onClose={handleCloseDetailDrawer}
      />
      <RollbackConfirmDialog
        isSubmitting={isRollbackSubmitting}
        onCancel={handleCloseRollbackDialog}
        onConfirm={() => {
          void handleConfirmRollback();
        }}
        state={rollbackDialogState}
      />
    </>
  );
}
