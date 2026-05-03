import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, FileText, HardDrive, Users } from "lucide-react";

import { APIError, fetchAdminDashboardSummary } from "../api";
import type { AdminDashboardData, AdminToast } from "../types";
import { formatNumber } from "../utils/format";

type AdminDashboardPageProps = {
  onToast: (toast: AdminToast) => void;
};

const theme = {
  primary: "#ef4444",
  secondary: "#fb923c",
  cardBg: "#ffffff",
  cardBorder: "#e2e8f0",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#94a3b8",
  warning: "#f59e0b",
  info: "#2563eb",
  surface: "#f8fafc",
};

const LazyAdminDashboardCharts = lazy(() => import("../components/charts/AdminDashboardCharts"));

function formatCompactValue(value: number): string {
  const absValue = Math.abs(value);
  if (absValue >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (absValue >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (absValue >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return formatNumber(value);
}

function formatStorageSize(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function MetricCardSkeleton() {
  return (
    <div
      className="rounded-xl border p-5"
      style={{
        backgroundColor: theme.cardBg,
        borderColor: theme.cardBorder,
      }}
    >
      <div className="animate-pulse">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="h-4 w-24 rounded-full bg-slate-200" />
          <div className="h-10 w-10 rounded-lg bg-slate-100" />
        </div>
        <div className="h-8 w-28 rounded-full bg-slate-200" />
        <div className="mt-3 h-3 w-24 rounded-full bg-slate-100" />
      </div>
    </div>
  );
}

function ChartSkeleton(props: { title: string }) {
  return (
    <div
      className="rounded-xl border p-6"
      style={{
        backgroundColor: theme.cardBg,
        borderColor: theme.cardBorder,
      }}
    >
      <div className="mb-4 text-base font-semibold" style={{ color: theme.textPrimary }}>
        {props.title}
      </div>
      <div
        className="flex h-72 animate-pulse items-center justify-center rounded-xl"
        style={{ backgroundColor: theme.surface }}
      >
        <div className="space-y-3 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-slate-200" />
          <div className="h-3 w-28 rounded-full bg-slate-200" />
        </div>
      </div>
    </div>
  );
}

function DashboardChartsFallback() {
  return (
    <>
      <ChartSkeleton title="30 天 Token 趋势" />
      <ChartSkeleton title="模型调用占比" />
    </>
  );
}

export function AdminDashboardPage(props: AdminDashboardPageProps) {
  const { onToast } = props;
  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      setIsLoading(true);

      try {
        const payload = await fetchAdminDashboardSummary();
        if (!active) {
          return;
        }
        setDashboard(payload);
      } catch (error) {
        if (!active) {
          return;
        }

        onToast({
          tone: "error",
          title: "数据总览加载失败",
          message:
            error instanceof APIError
              ? error.message
              : error instanceof Error
                ? error.message
                : "管理后台数据大盘暂时不可用，请稍后重试。",
        });
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [onToast]);

  const metrics = useMemo(
    () => [
      {
        label: "总用户数",
        value: dashboard ? formatNumber(dashboard.total_users) : "--",
        hint: "累计注册账号",
        icon: Users,
        color: theme.primary,
      },
      {
        label: "今日 Token 消耗",
        value: dashboard ? formatCompactValue(dashboard.today_tokens) : "--",
        hint: "近 24 小时消耗",
        icon: Activity,
        color: theme.secondary,
      },
      {
        label: "今日生成内容",
        value: dashboard ? formatNumber(dashboard.today_contents) : "--",
        hint: "当日内容产出",
        icon: FileText,
        color: theme.info,
      },
      {
        label: "OSS 存储",
        value: dashboard ? formatStorageSize(dashboard.oss_storage_bytes) : "--",
        hint: "当前上传文件总量",
        icon: HardDrive,
        color: theme.warning,
      },
    ],
    [dashboard],
  );

  const insightItems = useMemo(() => {
    if (!dashboard) {
      return [];
    }

    const items = [
      `近 30 天累计记录 ${formatNumber(
        dashboard.trend_30_days.reduce((sum, item) => sum + item.token_count, 0),
      )} Tokens，可用于观察系统整体消耗波动。`,
      `当前上传存储总量为 ${formatStorageSize(
        dashboard.oss_storage_bytes,
      )}，可结合生命周期清理策略持续优化成本。`,
    ];

    if (dashboard.model_usage_ratio.some((item) => item.model_name.startsWith("Untracked"))) {
      items.push("部分历史流水缺少模型名，因此会继续归并展示为 Untracked（历史数据）。");
    } else if (dashboard.model_usage_ratio.length > 0) {
      items.push(
        `当前共追踪到 ${formatNumber(dashboard.model_usage_ratio.length)} 个模型标签参与生成统计。`,
      );
    } else {
      items.push("当前时间窗口内暂无可视化的模型调用数据。");
    }

    return items;
  }, [dashboard]);

  return (
    <div className="p-4 lg:p-6">
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>
          数据总览
        </h1>
        <p className="text-sm" style={{ color: theme.textSecondary }}>
          面向管理后台的实时经营看板，聚合用户、Token、内容产出与存储占用数据。
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, index) => <MetricCardSkeleton key={index} />)
          : metrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <div
                  key={metric.label}
                  className="rounded-xl border p-5"
                  style={{
                    backgroundColor: theme.cardBg,
                    borderColor: theme.cardBorder,
                  }}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="text-sm" style={{ color: theme.textSecondary }}>
                      {metric.label}
                    </div>
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `${metric.color}16` }}
                    >
                      <Icon className="h-5 w-5" style={{ color: metric.color }} />
                    </div>
                  </div>
                  <div className="mb-2 text-3xl font-bold" style={{ color: theme.textPrimary }}>
                    {metric.value}
                  </div>
                  <div className="text-sm" style={{ color: theme.textMuted }}>
                    {metric.hint}
                  </div>
                </div>
              );
            })}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
        {isLoading ? (
          <DashboardChartsFallback />
        ) : (
          <Suspense fallback={<DashboardChartsFallback />}>
            <LazyAdminDashboardCharts dashboard={dashboard} />
          </Suspense>
        )}
      </div>

      <div
        className="rounded-xl border p-6"
        style={{
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
        }}
      >
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" style={{ color: theme.warning }} />
          <h3 className="text-base font-semibold" style={{ color: theme.textPrimary }}>
            运营提示
          </h3>
        </div>

        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-xl bg-slate-50 p-4">
                <div className="h-4 w-5/6 rounded-full bg-slate-200" />
                <div className="mt-3 h-3 w-2/3 rounded-full bg-slate-100" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {insightItems.map((message) => (
              <div
                key={message}
                className="rounded-xl border p-4"
                style={{
                  backgroundColor: theme.surface,
                  borderColor: "rgba(251, 146, 60, 0.18)",
                }}
              >
                <div className="text-sm leading-6" style={{ color: theme.textPrimary }}>
                  {message}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
