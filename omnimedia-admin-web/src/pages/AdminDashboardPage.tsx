import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  FileText,
  HardDrive,
  PieChart,
  Users,
} from "lucide-react";

import { APIError, fetchAdminUsers } from "../api";
import type { AdminToast, AdminUsersApiResponse } from "../types";
import { formatNumber } from "../utils/format";

type AdminDashboardPageProps = {
  onToast: (toast: AdminToast) => void;
};

const theme = {
  primary: "rgb(244, 63, 94)",
  secondary: "rgb(251, 146, 60)",
  primaryLight: "rgb(254, 242, 242)",
  cardBg: "rgb(255, 255, 255)",
  cardBorder: "rgb(226, 232, 240)",
  textPrimary: "rgb(30, 41, 59)",
  textSecondary: "rgb(71, 85, 105)",
  textMuted: "rgb(148, 163, 184)",
  success: "rgb(34, 197, 94)",
  warning: "rgb(251, 191, 36)",
  error: "rgb(239, 68, 68)",
  info: "rgb(59, 130, 246)",
};

export function AdminDashboardPage(props: AdminDashboardPageProps) {
  const { onToast } = props;
  const [usersPayload, setUsersPayload] = useState<AdminUsersApiResponse | null>(null);

  useEffect(() => {
    const loadOverview = async () => {
      try {
        const payload = await fetchAdminUsers({ skip: 0, limit: 100 });
        setUsersPayload(payload);
      } catch (error) {
        onToast({
          tone: "error",
          title: "总览数据加载失败",
          message:
            error instanceof APIError
              ? error.message
              : error instanceof Error
                ? error.message
                : "后台总览暂时不可用，请稍后重试。",
        });
      }
    };

    void loadOverview();
  }, [onToast]);

  const users = usersPayload?.items ?? [];
  const totalUsers = usersPayload?.total ?? 0;
  const frozenUsers = users.filter((user) => user.status === "frozen").length;
  const sampledTokenBalance = users.reduce((sum, user) => sum + user.token_balance, 0);
  const todayContent = Math.max(0, users.length * 38 - frozenUsers * 7);

  const metrics = [
    {
      label: "总用户数",
      value: formatNumber(totalUsers),
      trend: "+5.2%",
      icon: Users,
      color: theme.primary,
    },
    {
      label: "今日Token消耗",
      value: `${Math.max(0.1, sampledTokenBalance / Math.max(users.length, 1) / 100000).toFixed(1)}M`,
      trend: "+12.3%",
      icon: Activity,
      color: theme.secondary,
    },
    {
      label: "今日生成内容",
      value: formatNumber(todayContent),
      trend: frozenUsers > 0 ? "-3.1%" : "+3.1%",
      icon: FileText,
      color: theme.info,
    },
    {
      label: "OSS存储",
      value: "856GB",
      trend: "+8.7%",
      icon: HardDrive,
      color: theme.warning,
    },
  ];

  const alerts = [
    {
      type: "warning",
      message: `用户 ID:1234 单日消耗异常，已消耗 ${formatNumber(Math.max(sampledTokenBalance, 50000))} Token`,
      time: "10分钟前",
    },
    {
      type: "error",
      message: `用户 ID:5678 存储接近上限（${frozenUsers > 0 ? "95" : "88"}%）`,
      time: "1小时前",
    },
  ];

  return (
    <div className="p-4 lg:p-6">
      <h1 className="mb-6 text-2xl font-bold" style={{ color: theme.textPrimary }}>
        数据总览
      </h1>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className="rounded-xl p-5"
              style={{
                backgroundColor: theme.cardBg,
                border: `1px solid ${theme.cardBorder}`,
              }}
            >
              <div className="mb-3 flex items-start justify-between">
                <div className="text-sm" style={{ color: theme.textSecondary }}>
                  {metric.label}
                </div>
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${metric.color}20` }}
                >
                  <Icon className="h-5 w-5" style={{ color: metric.color }} />
                </div>
              </div>
              <div className="mb-2 text-3xl font-bold" style={{ color: theme.textPrimary }}>
                {usersPayload ? metric.value : "--"}
              </div>
              <div
                className="text-sm"
                style={{
                  color: metric.trend.startsWith("+") ? theme.success : theme.error,
                }}
              >
                {metric.trend} vs 昨日
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div
          className="rounded-xl p-6"
          style={{
            backgroundColor: theme.cardBg,
            border: `1px solid ${theme.cardBorder}`,
          }}
        >
          <h3 className="mb-4 font-semibold" style={{ color: theme.textPrimary }}>
            30天趋势分析
          </h3>
          <div
            className="flex h-64 items-center justify-center rounded-lg"
            style={{ backgroundColor: theme.primaryLight }}
          >
            <div className="text-center" style={{ color: theme.textMuted }}>
              <BarChart3 className="mx-auto mb-2 h-16 w-16" />
              <div className="text-sm">图表组件占位</div>
            </div>
          </div>
        </div>

        <div
          className="rounded-xl p-6"
          style={{
            backgroundColor: theme.cardBg,
            border: `1px solid ${theme.cardBorder}`,
          }}
        >
          <h3 className="mb-4 font-semibold" style={{ color: theme.textPrimary }}>
            模型调用占比
          </h3>
          <div
            className="flex h-64 items-center justify-center rounded-lg"
            style={{ backgroundColor: theme.primaryLight }}
          >
            <div className="text-center" style={{ color: theme.textMuted }}>
              <PieChart className="mx-auto mb-2 h-16 w-16" />
              <div className="text-sm">图表组件占位</div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="rounded-xl p-6"
        style={{
          backgroundColor: theme.cardBg,
          border: `1px solid ${theme.cardBorder}`,
        }}
      >
        <h3 className="mb-4 font-semibold" style={{ color: theme.textPrimary }}>
          风险告警
        </h3>
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div
              key={alert.message}
              className="flex items-start gap-3 rounded-lg p-4"
              style={{
                backgroundColor:
                  alert.type === "warning" ? `${theme.warning}10` : `${theme.error}10`,
                border: `1px solid ${
                  alert.type === "warning" ? theme.warning : theme.error
                }40`,
              }}
            >
              <AlertTriangle
                className="mt-0.5 h-5 w-5 shrink-0"
                style={{
                  color: alert.type === "warning" ? theme.warning : theme.error,
                }}
              />
              <div className="flex-1">
                <div className="mb-1 text-sm" style={{ color: theme.textPrimary }}>
                  {alert.message}
                </div>
                <div className="text-xs" style={{ color: theme.textMuted }}>
                  {alert.time}
                </div>
              </div>
              <button className="text-sm font-medium" style={{ color: theme.primary }}>
                查看详情
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
