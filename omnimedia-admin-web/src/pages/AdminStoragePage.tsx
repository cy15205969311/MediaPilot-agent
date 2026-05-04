import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clapperboard,
  FileText,
  HardDrive,
  ImageIcon,
  Music4,
  RefreshCw,
} from "lucide-react";

import {
  APIError,
  fetchAdminStorageStats,
  fetchAdminStorageUsers,
} from "../api";
import type {
  AdminStorageStats,
  AdminStorageUserItem,
  AdminStorageUsersApiResponse,
  AdminToast,
} from "../types";
import { formatBytes, formatDateTime, formatNumber, formatRelativeTime } from "../utils/format";

type AdminStoragePageProps = {
  onToast: (toast: AdminToast) => void;
};

const DEFAULT_LEADERBOARD_LIMIT = 10;

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
  info: "#60a5fa",
  surface: "#f8fafc",
};

const DISTRIBUTION_META = [
  {
    key: "video",
    label: "视频",
    color: "#ef4444",
    surface: "#fef2f2",
    Icon: Clapperboard,
  },
  {
    key: "image",
    label: "图片",
    color: "#facc15",
    surface: "#fefce8",
    Icon: ImageIcon,
  },
  {
    key: "document",
    label: "文档",
    color: "#60a5fa",
    surface: "#eff6ff",
    Icon: FileText,
  },
  {
    key: "audio",
    label: "音频",
    color: "#fb923c",
    surface: "#fff7ed",
    Icon: Music4,
  },
  {
    key: "other",
    label: "其他",
    color: "#94a3b8",
    surface: "#f8fafc",
    Icon: HardDrive,
  },
] as const;

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof APIError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function getDisplayName(item: AdminStorageUserItem): string {
  return item.nickname?.trim() || item.username;
}

function getRankVisual(rank: number): { backgroundColor: string; color: string } {
  if (rank === 1) {
    return { backgroundColor: "#fee2e2", color: "#dc2626" };
  }
  if (rank === 2) {
    return { backgroundColor: "#fef3c7", color: "#ca8a04" };
  }
  if (rank === 3) {
    return { backgroundColor: "#dbeafe", color: "#2563eb" };
  }
  return { backgroundColor: "#f1f5f9", color: "#94a3b8" };
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {Array.from({ length: 2 }).map((_, index) => (
        <div
          key={index}
          className="rounded-[28px] border bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.05)]"
          style={{ borderColor: theme.cardBorder }}
        >
          <div className="animate-pulse">
            <div className="mb-4 h-5 w-40 rounded-full bg-slate-200" />
            <div className="h-10 w-36 rounded-full bg-slate-200" />
            <div className="mt-4 h-3 w-full rounded-full bg-slate-100" />
            <div className="mt-6 space-y-3">
              {Array.from({ length: 4 }).map((__, rowIndex) => (
                <div key={rowIndex}>
                  <div className="mb-2 h-4 w-28 rounded-full bg-slate-100" />
                  <div className="h-2 w-full rounded-full bg-slate-100" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-[28px] border bg-white shadow-[0_18px_48px_rgba(15,23,42,0.05)]"
      style={{ borderColor: theme.cardBorder }}
    >
      <div className="animate-pulse p-6">
        <div className="mb-6 h-6 w-48 rounded-full bg-slate-200" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="grid grid-cols-[80px_1.4fr_1fr_1fr_1.2fr_120px] gap-4 rounded-2xl bg-slate-50 p-4">
              {Array.from({ length: 6 }).map((__, cellIndex) => (
                <div key={cellIndex} className="h-5 rounded-full bg-slate-200" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AdminStoragePage(props: AdminStoragePageProps) {
  const { onToast } = props;
  const [stats, setStats] = useState<AdminStorageStats | null>(null);
  const [rankingPayload, setRankingPayload] = useState<AdminStorageUsersApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const rankingItems = rankingPayload?.items ?? [];
  const capacityBytes = stats?.capacity_bytes ?? 0;
  const totalBytes = stats?.total_bytes ?? 0;
  const usagePercentRaw = capacityBytes > 0 ? (totalBytes / capacityBytes) * 100 : 0;
  const usagePercent = Math.min(100, Math.max(0, usagePercentRaw));
  const remainingBytes = Math.max(capacityBytes - totalBytes, 0);
  const overflowBytes = Math.max(totalBytes - capacityBytes, 0);

  const distributionItems = useMemo(() => {
    const distribution = stats?.distribution;
    return DISTRIBUTION_META.map((item) => {
      const bytes = distribution ? distribution[item.key] : 0;
      const percent = totalBytes > 0 ? (bytes / totalBytes) * 100 : 0;
      return {
        ...item,
        bytes,
        percent,
      };
    });
  }, [stats?.distribution, totalBytes]);

  useEffect(() => {
    let active = true;

    const loadStorageData = async (isManualRefresh: boolean) => {
      if (isManualRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const [statsPayload, usersPayload] = await Promise.all([
          fetchAdminStorageStats(),
          fetchAdminStorageUsers({ limit: DEFAULT_LEADERBOARD_LIMIT }),
        ]);

        if (!active) {
          return;
        }

        setStats(statsPayload);
        setRankingPayload(usersPayload);

        if (isManualRefresh) {
          onToast({
            tone: "success",
            title: "存储看板已刷新",
            message: "最新的存储总量、类型分布和用户排行已经同步完成。",
          });
        }
      } catch (error) {
        if (!active) {
          return;
        }

        onToast({
          tone: "error",
          title: "存储看板加载失败",
          message: getErrorMessage(error, "存储治理数据暂时不可用，请稍后重试。"),
        });
      } finally {
        if (!active) {
          return;
        }

        setIsLoading(false);
        setIsRefreshing(false);
      }
    };

    void loadStorageData(false);

    return () => {
      active = false;
    };
  }, [onToast]);

  const handleRefresh = async () => {
    if (isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    try {
      const [statsPayload, usersPayload] = await Promise.all([
        fetchAdminStorageStats(),
        fetchAdminStorageUsers({ limit: DEFAULT_LEADERBOARD_LIMIT }),
      ]);
      setStats(statsPayload);
      setRankingPayload(usersPayload);
      onToast({
        tone: "success",
        title: "存储看板已刷新",
        message: "最新的存储总量、类型分布和用户排行已经同步完成。",
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: "刷新失败",
        message: getErrorMessage(error, "存储治理数据刷新失败，请稍后重试。"),
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em]" style={{ color: "#f97316" }}>
            Storage Governance
          </div>
          <h1 className="mt-2 text-3xl font-semibold" style={{ color: theme.textPrimary }}>
            存储治理
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6" style={{ color: theme.textSecondary }}>
            用真实上传记录汇总平台存储占用、文件类型分布和高消耗用户排行，帮助后台更快识别成本热点。
          </p>
        </div>

        <button
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border bg-white px-4 text-sm font-medium transition hover:bg-slate-50"
          disabled={isRefreshing}
          onClick={() => {
            void handleRefresh();
          }}
          style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}
          type="button"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          刷新统计
        </button>
      </div>

      {isLoading ? (
        <SummarySkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section
            className="rounded-[28px] border bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.05)]"
            style={{ borderColor: theme.cardBorder }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
                  总存储使用情况
                </h2>
                <p className="mt-1 text-sm" style={{ color: theme.textMuted }}>
                  默认容量基线为 {formatBytes(capacityBytes)}，进度会随真实上传行为即时变化。
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
                <HardDrive className="h-5 w-5" />
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-3">
              <div className="text-sm font-medium" style={{ color: theme.textSecondary }}>
                当前已使用
              </div>
              <div className="text-4xl font-semibold tracking-tight" style={{ color: theme.textPrimary }}>
                {formatBytes(totalBytes)}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm" style={{ color: theme.textMuted }}>
                <span>容量占比 {usagePercentRaw.toFixed(2)}%</span>
                <span>总容量 {formatBytes(capacityBytes)}</span>
              </div>
            </div>

            <div className="mt-6 h-4 w-full rounded-full bg-slate-100">
              <div
                className="h-4 rounded-full bg-gradient-to-r from-[#ff6b57] to-[#ff9857] transition-all duration-500"
                style={{ width: `${usagePercent}%` }}
              />
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-[0.18em]" style={{ color: theme.textMuted }}>
                  剩余容量
                </div>
                <div className="mt-2 text-lg font-semibold" style={{ color: theme.textPrimary }}>
                  {formatBytes(remainingBytes)}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-[0.18em]" style={{ color: theme.textMuted }}>
                  容量状态
                </div>
                <div className="mt-2 text-lg font-semibold" style={{ color: theme.textPrimary }}>
                  {overflowBytes > 0 ? "已超限" : "健康"}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium uppercase tracking-[0.18em]" style={{ color: theme.textMuted }}>
                  高消耗用户
                </div>
                <div className="mt-2 text-lg font-semibold" style={{ color: theme.textPrimary }}>
                  {rankingItems[0] ? getDisplayName(rankingItems[0]) : "暂无"}
                </div>
              </div>
            </div>

            {overflowBytes > 0 ? (
              <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50/70 px-4 py-3 text-sm text-red-600">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>当前已超出容量基线 {formatBytes(overflowBytes)}，建议尽快清理大文件或扩容存储。</span>
              </div>
            ) : null}
          </section>

          <section
            className="rounded-[28px] border bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.05)]"
            style={{ borderColor: theme.cardBorder }}
          >
            <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
              文件类型分布
            </h2>
            <p className="mt-1 text-sm" style={{ color: theme.textMuted }}>
              聚合所有已追踪上传记录，帮助快速识别视频、图片、文档和音频的增长趋势。
            </p>

            <div className="mt-6 space-y-4">
              {distributionItems.map((item) => {
                const Icon = item.Icon;
                return (
                  <div key={item.key} className="rounded-2xl border px-4 py-4" style={{ borderColor: "#f1f5f9" }}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-2xl"
                          style={{ backgroundColor: item.surface, color: item.color }}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>
                            {item.label}
                          </div>
                          <div className="text-xs" style={{ color: theme.textMuted }}>
                            {item.percent.toFixed(2)}% 占比
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
                          {formatBytes(item.bytes)}
                        </div>
                        <div className="text-xs" style={{ color: theme.textMuted }}>
                          {formatNumber(item.bytes)} Bytes
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 h-2 w-full rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(0, Math.min(100, item.percent))}%`, backgroundColor: item.color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      <div className="mt-6">
        {isLoading ? (
          <LeaderboardSkeleton />
        ) : (
          <section
            className="overflow-hidden rounded-[28px] border bg-white shadow-[0_18px_48px_rgba(15,23,42,0.05)]"
            style={{ borderColor: theme.cardBorder }}
          >
            <div className="border-b px-6 py-5" style={{ borderColor: "#f1f5f9" }}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
                    用户存储排行榜
                  </h2>
                  <p className="mt-1 text-sm" style={{ color: theme.textMuted }}>
                    默认展示前 {rankingPayload?.limit ?? DEFAULT_LEADERBOARD_LIMIT} 名高存储消耗用户，按总占用从高到低排序。
                  </p>
                </div>
                <div className="text-sm" style={{ color: theme.textSecondary }}>
                  共展示 {formatNumber(rankingItems.length)} 位用户
                </div>
              </div>
            </div>

            {rankingItems.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <HardDrive className="h-6 w-6" />
                </div>
                <div className="mt-4 text-lg font-medium" style={{ color: theme.textPrimary }}>
                  当前还没有可统计的上传记录
                </div>
                <div className="mt-2 text-sm" style={{ color: theme.textMuted }}>
                  当前页会在用户产生真实上传后自动显示容量分布和高消耗用户排行。
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full table-fixed">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-sm" style={{ color: theme.textSecondary }}>
                      <th className="px-6 py-4 font-medium">排名</th>
                      <th className="px-6 py-4 font-medium">用户</th>
                      <th className="px-6 py-4 font-medium">存储使用</th>
                      <th className="px-6 py-4 font-medium">文件数量</th>
                      <th className="px-6 py-4 font-medium">最近上传</th>
                      <th className="px-6 py-4 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingItems.map((item, index) => {
                      const rank = index + 1;
                      const rankVisual = getRankVisual(rank);
                      return (
                        <tr key={item.user_id} className="border-t align-top" style={{ borderColor: "#f8fafc" }}>
                          <td className="px-6 py-4">
                            <div
                              className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
                              style={rankVisual}
                            >
                              {rank}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-medium" style={{ color: theme.textPrimary }}>
                              {getDisplayName(item)}
                            </div>
                            <div className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                              @{item.username}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-semibold" style={{ color: theme.textPrimary }}>
                              {formatBytes(item.total_size_bytes)}
                            </div>
                            <div className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                              {formatNumber(item.total_size_bytes)} Bytes
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-medium" style={{ color: theme.textPrimary }}>
                              {formatNumber(item.file_count)}
                            </div>
                            <div className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                              上传文件
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-medium" style={{ color: theme.textPrimary }}>
                              {formatRelativeTime(item.last_upload_time)}
                            </div>
                            <div className="mt-1 text-xs" style={{ color: theme.textMuted }}>
                              {formatDateTime(item.last_upload_time)}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <button
                              className="rounded-xl px-3 py-2 text-sm font-medium transition hover:bg-red-50"
                              onClick={() => {
                                onToast({
                                  tone: "warning",
                                  title: "功能开发中",
                                  message: `“${getDisplayName(item)}”的大文件明细功能正在开发中。`,
                                });
                              }}
                              style={{ color: theme.primary }}
                              type="button"
                            >
                              查看详情
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
