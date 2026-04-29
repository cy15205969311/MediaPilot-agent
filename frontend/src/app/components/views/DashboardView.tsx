import {
  Activity,
  BarChart3,
  BookOpenText,
  FileText,
  Flame,
  Layers3,
  Lightbulb,
  LoaderCircle,
  Sparkles,
  TimerReset,
  TrendingUp,
} from "lucide-react";

import type { DashboardActivityItem, DashboardSummary, TopicStatus } from "../../types";

type DashboardViewProps = {
  summary: DashboardSummary | null;
  isLoading: boolean;
};

type StatCardProps = {
  icon: typeof FileText;
  title: string;
  value: string;
  helper: string;
  trend?: string;
};

const TOPIC_STATUS_META: Array<{
  key: TopicStatus;
  label: string;
  className: string;
}> = [
  { key: "idea", label: "灵感池", className: "bg-sky-500" },
  { key: "drafting", label: "撰写中", className: "bg-amber-500" },
  { key: "published", label: "已发布", className: "bg-emerald-500" },
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatCompact(value: number): string {
  if (value >= 10000) {
    return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  }
  return formatNumber(value);
}

function formatSavedTime(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  return `${Math.round(minutes / 60)} 小时`;
}

function formatDateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value.slice(5);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function StatCard({ icon: Icon, title, value, helper, trend }: StatCardProps) {
  return (
    <article className="rounded-[28px] border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="rounded-2xl bg-primary/10 p-3 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        {trend ? (
          <div className="inline-flex items-center gap-1 rounded-full bg-success-surface px-3 py-1 text-xs font-semibold text-success-foreground">
            <TrendingUp className="h-3 w-3" />
            {trend}
          </div>
        ) : null}
      </div>
      <div className="mt-5 text-sm font-medium text-muted-foreground">{title}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight text-foreground">{value}</div>
      <div className="mt-2 text-sm leading-6 text-muted-foreground">{helper}</div>
    </article>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background px-4 py-5 lg:px-6">
      <div className="mb-6 h-8 w-64 animate-pulse rounded bg-surface-subtle" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={`dashboard-card-skeleton-${index}`} className="rounded-[28px] border border-border bg-card p-5">
            <div className="mb-5 h-11 w-11 animate-pulse rounded-2xl bg-surface-subtle" />
            <div className="mb-3 h-4 w-1/2 animate-pulse rounded bg-surface-subtle" />
            <div className="mb-3 h-8 w-2/3 animate-pulse rounded bg-surface-subtle" />
            <div className="h-4 w-full animate-pulse rounded bg-surface-subtle" />
          </div>
        ))}
      </div>
      <div className="mt-5 h-80 animate-pulse rounded-[32px] border border-border bg-card" />
    </div>
  );
}

function ActivityChart({ items }: { items: DashboardActivityItem[] }) {
  const maxCount = Math.max(...items.map((item) => item.count), 1);
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="rounded-[32px] border border-border bg-card p-5 shadow-sm xl:col-span-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Activity className="h-5 w-5 text-brand" />
            近 14 天内容生成趋势
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            最近两周累计沉淀 {formatNumber(total)} 份结构化产出
          </div>
        </div>
        <div className="rounded-2xl bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
          峰值 {formatNumber(maxCount)} 篇/天
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-6 flex min-h-[260px] items-center justify-center rounded-[24px] border border-dashed border-border bg-muted/60 px-5 text-center text-sm text-muted-foreground">
          暂无趋势数据。完成一次内容生成后，这里会自动出现生产力曲线。
        </div>
      ) : (
        <div className="mt-6 flex h-[280px] items-end gap-2 rounded-[24px] border border-border bg-surface-muted px-4 py-5">
          {items.map((item) => {
            const height = Math.max(8, Math.round((item.count / maxCount) * 210));
            return (
              <div key={item.date} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <div className="text-xs font-semibold text-muted-foreground opacity-0 transition group-hover:opacity-100">
                  {item.count}
                </div>
                <div
                  className="w-full max-w-8 rounded-t-2xl bg-gradient-to-t from-primary to-orange-400 shadow-sm transition group-hover:scale-x-110 group-hover:shadow-md"
                  style={{ height }}
                  title={`${item.date}: ${item.count} 篇`}
                />
                <div className="hidden text-[11px] text-muted-foreground sm:block">
                  {formatDateLabel(item.date)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TopicFunnel({ summary }: { summary: DashboardSummary }) {
  const totalTopics = Math.max(summary.assets.total_topics, 0);
  const denominator = Math.max(totalTopics, 1);

  return (
    <section className="rounded-[32px] border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Lightbulb className="h-5 w-5 text-brand" />
        选题生命周期漏斗
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        当前共有 {formatNumber(totalTopics)} 个选题，其中 {formatNumber(summary.assets.active_topics)} 个仍在推进
      </div>

      <div className="mt-6 flex h-4 overflow-hidden rounded-full bg-muted">
        {TOPIC_STATUS_META.map((item) => {
          const count = summary.topic_status[item.key] ?? 0;
          const width = totalTopics > 0 ? Math.max(4, (count / denominator) * 100) : 0;
          return <div key={item.key} className={item.className} style={{ width: `${width}%` }} />;
        })}
      </div>

      <div className="mt-5 space-y-4">
        {TOPIC_STATUS_META.map((item) => {
          const count = summary.topic_status[item.key] ?? 0;
          const percent = totalTopics > 0 ? Math.round((count / denominator) * 100) : 0;
          return (
            <div key={item.key}>
              <div className="mb-2 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.className}`} />
                  {item.label}
                </div>
                <span className="text-muted-foreground">
                  {formatNumber(count)} 个 · {percent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className={item.className} style={{ width: `${percent}%`, height: "100%" }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AssetSnapshot({ summary }: { summary: DashboardSummary }) {
  const knowledgeDensity = summary.assets.total_knowledge_scopes > 0
    ? Math.round(summary.assets.total_knowledge_chunks / summary.assets.total_knowledge_scopes)
    : 0;
  const rows = [
    {
      label: "私有知识 Scope",
      value: `${formatNumber(summary.assets.total_knowledge_scopes)} 个`,
      helper: `平均 ${formatNumber(knowledgeDensity)} 块/Scope`,
    },
    {
      label: "知识切片资产",
      value: `${formatNumber(summary.assets.total_knowledge_chunks)} 块`,
      helper: "可被模板与会话安全检索",
    },
    {
      label: "估算 Token",
      value: formatCompact(summary.productivity.estimated_tokens),
      helper: "基于生成文本字符数粗略估算",
    },
  ];

  return (
    <section className="rounded-[32px] border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Layers3 className="h-5 w-5 text-brand" />
        资产沉淀快照
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        把 AI 产出、选题池和知识库统一折算为可运营资产
      </div>

      <div className="mt-5 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="rounded-[22px] border border-border bg-surface-muted px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">{row.label}</div>
              <div className="text-base font-bold text-foreground">{row.value}</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{row.helper}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function DashboardView({ summary, isLoading }: DashboardViewProps) {
  if (isLoading && !summary) {
    return <DashboardSkeleton />;
  }

  if (!summary) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-background px-6 text-center">
        <div className="mb-4 rounded-3xl bg-surface-tint p-4 text-brand">
          <BarChart3 className="h-8 w-8" />
        </div>
        <div className="text-xl font-semibold text-foreground">数据看板暂时没有数据</div>
        <div className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          完成内容生成、维护选题或上传知识库后，这里会汇总你的生产力账单与资产盘点。
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background px-4 py-5 lg:px-6">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Sparkles className="h-6 w-6 text-brand" />
            MediaPilot 生产力指挥舱
          </div>
          <div className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            汇总草稿产出、选题推进与知识库沉淀，让每一次 AI 协作都变成可见的内容资产。
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          <Flame className="h-4 w-4" />
          本周新增 {formatNumber(summary.productivity.drafts_this_week)} 份产出
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          helper="所有已沉淀到草稿箱的结构化内容"
          icon={FileText}
          title="累计生成草稿"
          trend={summary.productivity.drafts_this_week > 0 ? "+本周活跃" : undefined}
          value={`${formatNumber(summary.productivity.total_drafts)} 篇`}
        />
        <StatCard
          helper="按 45 分钟/篇估算的人工创作时间"
          icon={TimerReset}
          title="累计节省时间"
          value={formatSavedTime(summary.productivity.estimated_saved_minutes)}
        />
        <StatCard
          helper={`${formatNumber(summary.assets.total_knowledge_scopes)} 个 Scope 正在构建你的私有语料`}
          icon={BookOpenText}
          title="私有知识切片"
          value={`${formatNumber(summary.assets.total_knowledge_chunks)} 块`}
        />
        <StatCard
          helper={`约 ${formatCompact(summary.productivity.estimated_tokens)} tokens 的生产力账单`}
          icon={BarChart3}
          title="累计生成字数"
          value={formatCompact(summary.productivity.total_words_generated)}
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <ActivityChart items={summary.activity_heatmap} />
        <div className="grid gap-5">
          <TopicFunnel summary={summary} />
          <AssetSnapshot summary={summary} />
        </div>
      </div>
    </div>
  );
}
