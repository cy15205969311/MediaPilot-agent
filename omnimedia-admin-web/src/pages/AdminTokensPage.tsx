import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import {
  APIError,
  fetchAdminTokenStats,
  fetchAdminTokenTransactions,
} from "../api";
import { StandardSearchInput } from "../components/common/StandardSearchInput";
import type {
  AdminTokenStats,
  AdminTokenTransactionItem,
  AdminTokenTransactionsApiResponse,
  AdminToast,
} from "../types";
import { formatDateTime, formatNumber } from "../utils/format";

type AdminTokensPageProps = {
  onToast: (toast: AdminToast) => void;
};

const DEFAULT_PAGE_SIZE = 10;
const MEDIA_CHAT_REMARK_PREFIX = "media_chat:";
const MEDIA_CHAT_TASK_LABELS: Record<string, string> = {
  topic_planning: "选题规划",
  content_generation: "内容生成",
  hot_post_analysis: "爆款拆解",
  comment_reply: "评论回复",
  article_writing: "文章撰写",
};
const REMARK_MAP: Record<string, string> = {
  "新用户注册千万算力福利": "新用户注册福利",
  "管理员后台新建账号初始赠送": "后台新建用户赠送",
  new_user_bonus: "新用户注册福利",
  admin_grant: "系统人工赠送",
  user_topup: "在线充值",
  image_generation: "图片生成",
  "media_chat:topic_planning": "选题规划",
  "media_chat:content_generation": "内容生成",
  "media_chat:hot_post_analysis": "爆款拆解",
  "media_chat:comment_reply": "评论回复",
  "media_chat:article_writing": "文章撰写",
};

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
  dangerSoft: "#fef2f2",
  successSoft: "#f0fdf4",
  surface: "#f8fafc",
};

function formatCompactNumber(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return formatNumber(value);
}

function formatDeltaText(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "暂无对比基线";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function getDeltaTone(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return theme.textMuted;
  }
  if (value < 0) {
    return theme.primary;
  }
  if (value > 0) {
    return theme.success;
  }
  return theme.textMuted;
}

function getTransactionDisplayName(item: AdminTokenTransactionItem): string {
  return item.nickname?.trim() || item.username;
}

function getTransactionTypeLabel(value: string): string {
  if (value === "consume") {
    return "消耗";
  }
  if (value === "grant") {
    return "系统赠送";
  }
  if (value === "topup" || value === "recharge") {
    return "充值";
  }
  if (value === "adjust") {
    return "人工调整";
  }
  return value || "未分类";
}

function getTransactionTagStyles(item: AdminTokenTransactionItem): {
  backgroundColor: string;
  color: string;
} {
  if (item.amount < 0 || item.transaction_type === "consume") {
    return {
      backgroundColor: theme.dangerSoft,
      color: theme.primary,
    };
  }

  return {
    backgroundColor: theme.successSoft,
    color: theme.success,
  };
}

function formatTransactionRemark(remark: string): string {
  const normalizedRemark = remark.trim();
  if (!normalizedRemark) {
    return "--";
  }

  const mappedRemark = REMARK_MAP[normalizedRemark];
  if (mappedRemark) {
    return mappedRemark;
  }

  if (normalizedRemark.startsWith(MEDIA_CHAT_REMARK_PREFIX)) {
    const taskKey = normalizedRemark.slice(MEDIA_CHAT_REMARK_PREFIX.length).trim();
    return MEDIA_CHAT_TASK_LABELS[taskKey] || normalizedRemark;
  }

  return normalizedRemark;
}

function StatCardSkeleton() {
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ backgroundColor: theme.cardBg, borderColor: theme.cardBorder }}
    >
      <div className="animate-pulse">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="h-4 w-24 rounded-full bg-slate-200" />
          <div className="h-10 w-10 rounded-xl bg-slate-100" />
        </div>
        <div className="h-8 w-28 rounded-full bg-slate-200" />
        <div className="mt-3 h-3 w-20 rounded-full bg-slate-100" />
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{ backgroundColor: theme.cardBg, borderColor: theme.cardBorder }}
    >
      <div className="animate-pulse p-4">
        <div className="mb-4 h-10 rounded-xl bg-slate-100" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="grid grid-cols-5 gap-4 rounded-xl bg-slate-50 p-4">
              <div className="h-4 rounded-full bg-slate-200" />
              <div className="h-4 rounded-full bg-slate-200" />
              <div className="h-4 rounded-full bg-slate-200" />
              <div className="h-4 rounded-full bg-slate-200" />
              <div className="h-4 rounded-full bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AdminTokensPage(props: AdminTokensPageProps) {
  const { onToast } = props;
  const [searchParams] = useSearchParams();
  const initialSearchTerm = searchParams.get("search")?.trim() ?? "";
  const [stats, setStats] = useState<AdminTokenStats | null>(null);
  const [transactionsPayload, setTransactionsPayload] =
    useState<AdminTokenTransactionsApiResponse | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(true);
  const [isTableLoading, setIsTableLoading] = useState(true);
  const [searchKeyword, setSearchKeyword] = useState(initialSearchTerm);
  const [skip, setSkip] = useState(0);

  const items = transactionsPayload?.items ?? [];
  const total = transactionsPayload?.total ?? 0;
  const currentPage = Math.floor(skip / DEFAULT_PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));

  useEffect(() => {
    let active = true;

    const loadStats = async () => {
      setIsStatsLoading(true);

      try {
        const payload = await fetchAdminTokenStats();
        if (active) {
          setStats(payload);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        onToast({
          tone: "error",
          title: "流水大盘加载失败",
          message:
            error instanceof APIError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Token 流水统计暂时不可用，请稍后重试。",
        });
      } finally {
        if (active) {
          setIsStatsLoading(false);
        }
      }
    };

    void loadStats();

    return () => {
      active = false;
    };
  }, [onToast]);

  useEffect(() => {
    let active = true;

    const loadTransactions = async () => {
      setIsTableLoading(true);

      try {
        const payload = await fetchAdminTokenTransactions({
          skip,
          limit: DEFAULT_PAGE_SIZE,
          userKeyword: searchKeyword,
        });
        if (active) {
          setTransactionsPayload(payload);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        onToast({
          tone: "error",
          title: "流水列表加载失败",
          message:
            error instanceof APIError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Token 流水列表暂时不可用，请稍后重试。",
        });
      } finally {
        if (active) {
          setIsTableLoading(false);
        }
      }
    };

    void loadTransactions();

    return () => {
      active = false;
    };
  }, [onToast, searchKeyword, skip]);

  const handleRefresh = async () => {
    setIsStatsLoading(true);
    setIsTableLoading(true);

    try {
      const [statsPayload, transactions] = await Promise.all([
        fetchAdminTokenStats(),
        fetchAdminTokenTransactions({
          skip,
          limit: DEFAULT_PAGE_SIZE,
          userKeyword: searchKeyword,
        }),
      ]);
      setStats(statsPayload);
      setTransactionsPayload(transactions);
      onToast({
        tone: "success",
        title: "流水数据已刷新",
        message: "最新 Token 统计与台账记录已经同步到当前工作台。",
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
              : "刷新 Token 流水数据失败，请稍后重试。",
      });
    } finally {
      setIsStatsLoading(false);
      setIsTableLoading(false);
    }
  };

  const statCards = useMemo(
    () => [
      {
        label: "今日消耗",
        value: stats ? formatCompactNumber(stats.today_consume) : "--",
        delta: stats?.today_consume_change_percent,
        hint: "实时消耗总量",
        icon: TrendingDown,
        iconBg: `${theme.primary}14`,
        iconColor: theme.primary,
      },
      {
        label: "今日充值 / 赠送",
        value: stats ? formatCompactNumber(stats.today_topup) : "--",
        delta: stats?.today_topup_change_percent,
        hint: "充值与系统发放",
        icon: TrendingUp,
        iconBg: `${theme.success}14`,
        iconColor: theme.success,
      },
      {
        label: "本月消耗",
        value: stats ? formatCompactNumber(stats.month_consume) : "--",
        delta: stats?.month_consume_change_percent,
        hint: "月度累计消耗",
        icon: Coins,
        iconBg: `${theme.secondary}14`,
        iconColor: theme.secondary,
      },
      {
        label: "全平台余额",
        value: stats ? formatCompactNumber(stats.total_balance) : "--",
        delta: stats?.total_balance_change_percent,
        hint: "当前总 Token 资产",
        icon: Wallet,
        iconBg: "#eff6ff",
        iconColor: "#2563eb",
      },
    ],
    [stats],
  );

  const paginationText =
    total === 0
      ? "当前筛选条件下暂无流水记录"
      : `显示 ${formatNumber(skip + 1)}-${formatNumber(
          Math.min(skip + items.length, total),
        )}，共 ${formatNumber(total)} 条`;

  const handleSearchChange = (nextValue: string) => {
    setSkip(0);
    setSearchKeyword((current) => (current === nextValue ? current : nextValue));
  };

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>
            Token 流水管理
          </h1>
          <p className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
            接入真实 TokenTransaction 台账，支持按用户维度检索、分页审计与平台级资产总览。
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <StandardSearchInput
            className="w-full sm:min-w-[300px]"
            onSearchChange={handleSearchChange}
            placeholder="搜索用户名或流水备注..."
          />
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
            刷新数据
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isStatsLoading
          ? Array.from({ length: 4 }).map((_, index) => <StatCardSkeleton key={index} />)
          : statCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.label}
                  className="rounded-2xl border p-5"
                  style={{
                    backgroundColor: theme.cardBg,
                    borderColor: theme.cardBorder,
                  }}
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="text-sm" style={{ color: theme.textSecondary }}>
                      {card.label}
                    </div>
                    <div
                      className="flex h-11 w-11 items-center justify-center rounded-xl"
                      style={{ backgroundColor: card.iconBg }}
                    >
                      <Icon className="h-5 w-5" style={{ color: card.iconColor }} />
                    </div>
                  </div>

                  <div className="text-3xl font-bold" style={{ color: theme.textPrimary }}>
                    {card.value}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                    <span style={{ color: theme.textMuted }}>{card.hint}</span>
                    <span style={{ color: getDeltaTone(card.delta) }}>
                      {formatDeltaText(card.delta)}
                    </span>
                  </div>
                </div>
              );
            })}
      </div>

      <div
        className="rounded-2xl border"
        style={{ backgroundColor: theme.cardBg, borderColor: theme.cardBorder }}
      >
        <div className="border-b p-5" style={{ borderColor: theme.cardBorder }}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
                流水台账
              </h2>
              <p className="mt-1 text-sm" style={{ color: theme.textMuted }}>
                {paginationText}
              </p>
            </div>

            {searchKeyword ? (
              <div
                className="w-fit rounded-full px-3 py-2 text-xs font-medium"
                style={{
                  backgroundColor: theme.dangerSoft,
                  color: theme.primary,
                }}
              >
                当前筛选：{searchKeyword}
              </div>
            ) : (
              <div className="text-sm" style={{ color: theme.textMuted }}>
                当前未应用关键词筛选
              </div>
            )}
          </div>
        </div>

        {isTableLoading ? (
          <TableSkeleton />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px]">
                <thead>
                  <tr style={{ backgroundColor: theme.surface }}>
                    {["时间", "用户", "操作类型", "数量", "备注"].map((header) => (
                      <th
                        key={header}
                        className="px-5 py-4 text-left text-sm font-semibold"
                        style={{ color: theme.textPrimary }}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.length ? (
                    items.map((item) => {
                      const amountTone =
                        item.amount < 0 || item.transaction_type === "consume"
                          ? theme.primary
                          : theme.success;
                      const tagStyles = getTransactionTagStyles(item);
                      return (
                        <tr
                          key={item.id}
                          className="transition-colors hover:bg-red-50/50"
                          style={{ borderTop: `1px solid ${theme.cardBorder}` }}
                        >
                          <td className="px-5 py-5 text-sm" style={{ color: theme.textSecondary }}>
                            {formatDateTime(item.created_at)}
                          </td>
                          <td className="px-5 py-5 text-sm">
                            <div className="font-medium" style={{ color: theme.textPrimary }}>
                              {getTransactionDisplayName(item)}
                            </div>
                            <div className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                              @{item.username}
                            </div>
                          </td>
                          <td className="px-5 py-5 text-sm">
                            <span
                              className="inline-flex rounded-full px-3 py-1 text-xs font-semibold"
                              style={tagStyles}
                            >
                              {getTransactionTypeLabel(item.transaction_type)}
                            </span>
                          </td>
                          <td className="px-5 py-5 text-sm font-semibold" style={{ color: amountTone }}>
                            {item.amount > 0 ? "+" : ""}
                            {formatNumber(item.amount)}
                          </td>
                          <td className="px-5 py-5 text-sm" style={{ color: theme.textSecondary }}>
                            <span className="inline-flex rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
                              {formatTransactionRemark(item.remark)}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="px-5 py-12 text-center text-sm" colSpan={5}>
                        <div className="mx-auto max-w-md">
                          <div className="font-medium" style={{ color: theme.textPrimary }}>
                            暂无符合条件的 Token 流水
                          </div>
                          <div className="mt-2" style={{ color: theme.textMuted }}>
                            可以尝试清空用户名筛选，或等待新的充值、赠送与消耗记录写入。
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
          </>
        )}
      </div>
    </div>
  );
}
