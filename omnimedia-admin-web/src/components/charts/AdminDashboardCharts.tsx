import { Suspense, lazy, useMemo } from "react";
import type { EChartsOption } from "echarts";
import * as echarts from "echarts/core";
import { graphic } from "echarts/core";
import { LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { BarChart3, PieChart as PieChartIcon } from "lucide-react";

import type { AdminDashboardData } from "../../types";
import { formatNumber } from "../../utils/format";

type AdminDashboardChartsProps = {
  dashboard: AdminDashboardData | null;
};

const ReactECharts = lazy(() => import("echarts-for-react"));

echarts.use([LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

const theme = {
  primary: "#ef4444",
  secondary: "#fb923c",
  cardBg: "#ffffff",
  cardBorder: "#e2e8f0",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#94a3b8",
};

const COLORS = ["#F87171", "#FBBF24", "#34D399", "#60A5FA", "#A78BFA", "#F472B6"];
const NO_DATA_LABEL = "\u6682\u65e0\u6570\u636e";
const TOKEN_TREND_TITLE = "30 \u5929 Token \u8d8b\u52bf";
const MODEL_USAGE_TITLE = "\u6a21\u578b\u8c03\u7528\u5360\u6bd4";

function ChartCanvasSkeleton() {
  return <div className="h-[320px] animate-pulse rounded-xl bg-slate-50" />;
}

function formatTrendLabel(value: string): string {
  if (!value) {
    return "";
  }

  const [, month = "", day = ""] = value.split("-");
  return `${month}/${day}`;
}

function buildLineOption(data: AdminDashboardData | null): EChartsOption {
  const trendItems = data?.trend_30_days ?? [];

  return {
    backgroundColor: "transparent",
    color: [theme.primary],
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15, 23, 42, 0.92)",
      borderWidth: 0,
      textStyle: {
        color: "#f8fafc",
      },
      valueFormatter: (value) => `${formatNumber(Number(value || 0))} Tokens`,
    },
    grid: {
      top: 24,
      right: 16,
      bottom: 32,
      left: 16,
      containLabel: true,
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: trendItems.map((item) => formatTrendLabel(item.date)),
      axisLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.25)",
        },
      },
      axisTick: {
        show: false,
      },
      axisLabel: {
        color: theme.textMuted,
        fontSize: 11,
      },
    },
    yAxis: {
      type: "value",
      axisLine: {
        show: false,
      },
      axisTick: {
        show: false,
      },
      axisLabel: {
        color: theme.textMuted,
        fontSize: 11,
      },
      splitLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.12)",
        },
      },
    },
    series: [
      {
        name: "Tokens",
        type: "line",
        smooth: true,
        showSymbol: false,
        lineStyle: {
          width: 3,
          color: theme.primary,
        },
        areaStyle: {
          color: new graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(239, 68, 68, 0.30)" },
            { offset: 1, color: "rgba(239, 68, 68, 0.03)" },
          ]),
        },
        data: trendItems.map((item) => item.token_count),
      },
    ],
  };
}

function buildPieOption(data: AdminDashboardData | null): EChartsOption {
  const usageItems = data?.model_usage_ratio ?? [];
  const shouldShowPieLabels = usageItems.length > 1;
  const chartData =
    usageItems.length > 0
      ? usageItems.map((item, index) => ({
          value: item.count,
          name: item.model_name,
          itemStyle: {
            color: COLORS[index % COLORS.length],
          },
        }))
      : [
          {
            value: 1,
            name: NO_DATA_LABEL,
            itemStyle: {
              color: "rgba(148, 163, 184, 0.25)",
            },
          },
        ];

  return {
    backgroundColor: "transparent",
    color: COLORS,
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(15, 23, 42, 0.92)",
      borderWidth: 0,
      textStyle: {
        color: "#f8fafc",
      },
      formatter: usageItems.length > 0 ? "{b}: {c} Tokens ({d}%)" : "{b}",
    },
    legend: {
      bottom: 0,
      left: "center",
      icon: "circle",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: {
        color: theme.textSecondary,
      },
    },
    series: [
      {
        name: "Models",
        type: "pie",
        radius: ["40%", "70%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        label: {
          show: shouldShowPieLabels,
          color: theme.textSecondary,
          formatter: "{b}\n{d}%",
          fontSize: 11,
        },
        labelLine: {
          show: shouldShowPieLabels,
          length: 10,
          length2: 8,
        },
        itemStyle: {
          borderColor: "#ffffff",
          borderWidth: 3,
          borderRadius: 8,
        },
        data: chartData,
      },
    ],
  };
}

export default function AdminDashboardCharts(props: AdminDashboardChartsProps) {
  const { dashboard } = props;
  const lineOption = useMemo(() => buildLineOption(dashboard), [dashboard]);
  const pieOption = useMemo(() => buildPieOption(dashboard), [dashboard]);

  return (
    <>
      <div
        className="rounded-xl border p-6"
        style={{
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
        }}
      >
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5" style={{ color: theme.primary }} />
          <h3 className="text-base font-semibold" style={{ color: theme.textPrimary }}>
            {TOKEN_TREND_TITLE}
          </h3>
        </div>
        <Suspense fallback={<ChartCanvasSkeleton />}>
          <ReactECharts
            echarts={echarts}
            option={lineOption}
            notMerge
            lazyUpdate
            style={{ height: "320px", width: "100%", backgroundColor: "transparent" }}
          />
        </Suspense>
      </div>

      <div
        className="rounded-xl border p-6"
        style={{
          backgroundColor: theme.cardBg,
          borderColor: theme.cardBorder,
        }}
      >
        <div className="mb-4 flex items-center gap-2">
          <PieChartIcon className="h-5 w-5" style={{ color: theme.secondary }} />
          <h3 className="text-base font-semibold" style={{ color: theme.textPrimary }}>
            {MODEL_USAGE_TITLE}
          </h3>
        </div>
        <Suspense fallback={<ChartCanvasSkeleton />}>
          <ReactECharts
            echarts={echarts}
            option={pieOption}
            notMerge
            lazyUpdate
            style={{ height: "320px", width: "100%", backgroundColor: "transparent" }}
          />
        </Suspense>
      </div>
    </>
  );
}
