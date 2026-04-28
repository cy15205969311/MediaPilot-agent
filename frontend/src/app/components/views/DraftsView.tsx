import { useEffect, useMemo, useState } from "react";

import {
  ArrowUpRight,
  BookText,
  Clapperboard,
  FileSearch,
  FileText,
  Layers3,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import type { ArtifactPayload, DraftSummaryItem, UiPlatform } from "../../types";
import { formatChatTimestamp, formatRelativeTime } from "../../utils";

type DraftPlatformFilter = "all" | UiPlatform;

type DraftsViewProps = {
  drafts: DraftSummaryItem[];
  isLoading: boolean;
  isMutating: boolean;
  mutatingMessageId: string | null;
  onOpenThread: (draft: DraftSummaryItem) => void;
  onDeleteDraft: (draft: DraftSummaryItem) => Promise<void>;
  onDeleteDrafts: (messageIds: string[]) => Promise<void>;
  onClearAllDrafts: () => Promise<void>;
};

const platformFilters: Array<{ id: DraftPlatformFilter; label: string }> = [
  { id: "all", label: "全部平台" },
  { id: "xiaohongshu", label: "小红书" },
  { id: "douyin", label: "抖音" },
  { id: "both", label: "双平台" },
];

const artifactTypeLabels: Record<ArtifactPayload["artifact_type"], string> = {
  content_draft: "内容草稿",
  topic_list: "选题策划",
  hot_post_analysis: "爆款分析",
  comment_reply: "评论回复",
};

function getPlatformLabel(platform?: UiPlatform | null): string {
  if (platform === "douyin") {
    return "抖音";
  }
  if (platform === "both") {
    return "双平台";
  }
  if (platform === "xiaohongshu") {
    return "小红书";
  }
  return "未标注平台";
}

function PlatformGlyph(props: { platform?: UiPlatform | null }) {
  const { platform } = props;

  if (platform === "douyin") {
    return <Clapperboard className="h-4 w-4" />;
  }
  if (platform === "both") {
    return <Layers3 className="h-4 w-4" />;
  }
  return <BookText className="h-4 w-4" />;
}

function renderArtifactDetail(artifact: ArtifactPayload) {
  if (artifact.artifact_type === "content_draft") {
    return (
      <div className="space-y-4">
        {artifact.title_candidates.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">备选标题</div>
            <div className="flex flex-wrap gap-2">
              {artifact.title_candidates.map((title) => (
                <span
                  key={title}
                  className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground"
                >
                  {title}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <div className="mb-2 text-sm font-medium text-foreground">正文内容</div>
          <div className="whitespace-pre-wrap rounded-2xl border border-border bg-muted/60 p-4 text-sm leading-7 text-card-foreground">
            {artifact.body}
          </div>
        </div>

        <div>
          <div className="mb-2 text-sm font-medium text-foreground">平台行动引导</div>
          <div className="rounded-2xl border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
            {artifact.platform_cta}
          </div>
        </div>
      </div>
    );
  }

  if (artifact.artifact_type === "topic_list") {
    return (
      <div className="space-y-3">
        {artifact.topics.map((topic, index) => (
          <div
            key={`${topic.title}-${index}`}
            className="rounded-2xl border border-border bg-card p-4"
          >
            <div className="text-sm font-semibold text-foreground">{topic.title}</div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">
              角度：{topic.angle}
            </div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">
              目标：{topic.goal}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (artifact.artifact_type === "hot_post_analysis") {
    return (
      <div className="space-y-4">
        <div className="space-y-3">
          {artifact.analysis_dimensions.map((dimension, index) => (
            <div
              key={`${dimension.dimension}-${index}`}
              className="rounded-2xl border border-border bg-card p-4"
            >
              <div className="text-sm font-semibold text-foreground">
                {dimension.dimension}
              </div>
              <div className="mt-2 text-sm leading-6 text-muted-foreground">
                {dimension.insight}
              </div>
            </div>
          ))}
        </div>

        {artifact.reusable_templates.length > 0 ? (
          <div>
            <div className="mb-2 text-sm font-medium text-foreground">可复用表达</div>
            <div className="flex flex-wrap gap-2">
              {artifact.reusable_templates.map((template) => (
                <span
                  key={template}
                  className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground"
                >
                  {template}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {artifact.suggestions.map((suggestion, index) => (
        <div
          key={`${suggestion.comment_type}-${index}`}
          className="rounded-2xl border border-border bg-card p-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
              {suggestion.comment_type}
            </span>
            <span className="text-xs text-muted-foreground">{suggestion.scenario}</span>
          </div>
          <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-card-foreground">
            {suggestion.reply}
          </div>
          {suggestion.compliance_note ? (
            <div className="mt-3 rounded-xl bg-warning-surface px-3 py-2 text-xs leading-5 text-warning-foreground">
              合规提醒：{suggestion.compliance_note}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function DraftsView(props: DraftsViewProps) {
  const {
    drafts,
    isLoading,
    isMutating,
    mutatingMessageId,
    onOpenThread,
    onDeleteDraft,
    onDeleteDrafts,
    onClearAllDrafts,
  } = props;
  const [searchValue, setSearchValue] = useState("");
  const [platformFilter, setPlatformFilter] = useState<DraftPlatformFilter>("all");
  const [selectedDraft, setSelectedDraft] = useState<DraftSummaryItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const filteredDrafts = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();

    return drafts.filter((draft) => {
      const matchesPlatform =
        platformFilter === "all" ? true : draft.platform === platformFilter;

      if (!matchesPlatform) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const searchableText = [
        draft.title,
        draft.excerpt,
        draft.thread_title,
        getPlatformLabel(draft.platform),
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedSearch);
    });
  }, [drafts, platformFilter, searchValue]);

  const hasFiltersApplied =
    searchValue.trim().length > 0 || platformFilter !== "all";

  useEffect(() => {
    if (!selectedDraft) {
      return;
    }

    const exists = drafts.some((draft) => draft.id === selectedDraft.id);
    if (!exists) {
      setSelectedDraft(null);
    }
  }, [drafts, selectedDraft]);

  useEffect(() => {
    const availableIds = new Set(drafts.map((draft) => draft.message_id));
    setSelectedIds((current) => current.filter((id) => availableIds.has(id)));
  }, [drafts]);

  const toggleSelected = (messageId: string) => {
    setSelectedIds((current) =>
      current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId],
    );
  };

  const handleSingleDelete = async (draft: DraftSummaryItem) => {
    const confirmed = window.confirm(
      `确认删除草稿“${draft.title || "未命名草稿"}”吗？此操作不可恢复。`,
    );
    if (!confirmed) {
      return;
    }

    await onDeleteDraft(draft);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确认删除已选择的 ${selectedIds.length} 份草稿吗？此操作不可恢复。`,
    );
    if (!confirmed) {
      return;
    }

    await onDeleteDrafts(selectedIds);
    setSelectedIds([]);
  };

  const handleClearAll = async () => {
    const confirmed = window.confirm(
      `确认清空全部 ${drafts.length} 份草稿吗？此操作不可恢复。`,
    );
    if (!confirmed) {
      return;
    }

    await onClearAllDrafts();
    setSelectedIds([]);
    setSelectedDraft(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="drafts-view">
      <div className="border-b border-border bg-surface-elevated px-4 py-5 backdrop-blur-sm lg:px-6">
        {selectedIds.length === 0 ? (
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
                <Sparkles className="h-3.5 w-3.5" />
                草稿聚合视图
              </div>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
                我的草稿
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                汇总你在不同会话里生成的结构化内容产物，支持搜索、预览、单条删除与批量整理。
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 xl:max-w-xl">
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="relative block flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className="w-full rounded-2xl border border-border bg-card py-3 pl-11 pr-4 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                    data-testid="drafts-search-input"
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="搜索草稿标题、摘要或所属会话"
                    value={searchValue}
                  />
                </label>

                <button
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-danger-foreground/20 bg-card px-4 py-3 text-sm font-medium text-danger-foreground transition hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50"
                  data-testid="draft-clear-all"
                  disabled={isMutating || drafts.length === 0}
                  onClick={() => void handleClearAll()}
                  type="button"
                >
                  {isMutating && mutatingMessageId === null ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  清空所有
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="flex flex-col gap-4 rounded-[28px] border border-brand/20 bg-brand-soft/50 p-5 xl:flex-row xl:items-center xl:justify-between"
            data-testid="drafts-bulk-bar"
          >
            <div>
              <div
                className="text-lg font-semibold text-foreground"
                data-testid="drafts-selected-count"
              >
                已选择 {selectedIds.length} 项
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                可以继续勾选草稿，或者直接批量删除已选内容。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="draft-cancel-selection"
                disabled={isMutating}
                onClick={() => setSelectedIds([])}
                type="button"
              >
                取消选择
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-2xl border border-danger-foreground/20 bg-card px-4 py-3 text-sm font-medium text-danger-foreground transition hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="draft-delete-selected"
                disabled={isMutating || selectedIds.length === 0}
                onClick={() => void handleDeleteSelected()}
                type="button"
              >
                {isMutating ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                删除所选
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {platformFilters.map((option) => (
            <button
              key={option.id}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                platformFilter === option.id
                  ? "border-brand/40 bg-brand-soft text-brand"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setPlatformFilter(option.id)}
              type="button"
            >
              {option.label}
            </button>
          ))}

          <div className="text-xs text-muted-foreground">
            共 {drafts.length} 份草稿
            {filteredDrafts.length !== drafts.length ? `，当前显示 ${filteredDrafts.length} 份` : ""}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 lg:px-6">
        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`draft-skeleton-${index}`}
                className="rounded-3xl border border-border bg-card p-5 shadow-sm"
              >
                <div className="mb-4 h-5 w-2/3 animate-pulse rounded bg-surface-subtle" />
                <div className="mb-2 h-4 w-full animate-pulse rounded bg-surface-subtle" />
                <div className="mb-2 h-4 w-5/6 animate-pulse rounded bg-surface-subtle" />
                <div className="mt-6 h-3 w-1/3 animate-pulse rounded bg-surface-subtle" />
              </div>
            ))}
          </div>
        ) : null}

        {!isLoading && filteredDrafts.length === 0 ? (
          <div
            className="flex min-h-[420px] flex-col items-center justify-center rounded-[32px] border border-dashed border-border bg-card px-6 py-12 text-center"
            data-testid="drafts-empty-state"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-soft text-brand">
              <FileText className="h-10 w-10" />
            </div>
            <div className="mt-6 text-2xl font-semibold text-foreground">
              {hasFiltersApplied ? "没有找到匹配的草稿" : "暂无保存的草稿内容"}
            </div>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              {hasFiltersApplied
                ? "试试调整搜索词或切换平台筛选，重新定位你想找的内容。"
                : "快去和 Agent 对话，生成第一篇内容草稿、选题策划或爆款分析吧。"}
            </p>
          </div>
        ) : null}

        {!isLoading && filteredDrafts.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredDrafts.map((draft) => {
              const isSelected = selectedIds.includes(draft.message_id);
              const isDeleting =
                isMutating &&
                (mutatingMessageId === null || mutatingMessageId === draft.message_id);

              return (
                <article
                  key={draft.id}
                  className={`group rounded-[28px] border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                    isSelected
                      ? "border-brand/40 bg-brand-soft/20 ring-2 ring-brand/30"
                      : "border-border hover:border-brand/30"
                  }`}
                  data-testid={`draft-card-${draft.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <label
                        className="mt-0.5 inline-flex cursor-pointer items-center"
                        htmlFor={`draft-select-${draft.id}`}
                      >
                        <input
                          checked={isSelected}
                          className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                          data-testid={`draft-checkbox-${draft.id}`}
                          disabled={isMutating}
                          id={`draft-select-${draft.id}`}
                          onChange={() => toggleSelected(draft.message_id)}
                          type="checkbox"
                        />
                      </label>

                      <div className="rounded-2xl bg-secondary p-2 text-secondary-foreground">
                        <PlatformGlyph platform={draft.platform} />
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-muted-foreground">
                          {getPlatformLabel(draft.platform)}
                        </div>
                        <div className="truncate text-xs text-muted-foreground/80">
                          {draft.thread_title || "未命名会话"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-medium text-brand">
                        {artifactTypeLabels[draft.artifact_type]}
                      </span>
                      <button
                        aria-label={`删除草稿 ${draft.title}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-danger-foreground/20 text-danger-foreground transition hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid={`draft-delete-${draft.id}`}
                        disabled={isMutating}
                        onClick={() => void handleSingleDelete(draft)}
                        type="button"
                      >
                        {isDeleting && mutatingMessageId === draft.message_id ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    className="mt-4 w-full text-left"
                    data-testid={`draft-preview-${draft.id}`}
                    disabled={isMutating}
                    onClick={() => setSelectedDraft(draft)}
                    type="button"
                  >
                    <div className="text-lg font-semibold leading-7 text-foreground">
                      {draft.title}
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
                      {draft.excerpt}
                    </p>
                  </button>

                  <div className="mt-6 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      更新于 {formatRelativeTime(draft.created_at)}
                    </div>
                    <button
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-card-foreground transition hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`draft-open-thread-${draft.id}`}
                      disabled={isMutating}
                      onClick={() => onOpenThread(draft)}
                      type="button"
                    >
                      在会话中打开
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>

      {selectedDraft ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          data-testid="draft-detail-dialog"
        >
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[32px] border border-border bg-card shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="border-b border-border px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                      <PlatformGlyph platform={selectedDraft.platform} />
                      {getPlatformLabel(selectedDraft.platform)}
                    </span>
                    <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
                      {artifactTypeLabels[selectedDraft.artifact_type]}
                    </span>
                  </div>
                  <h3 className="mt-4 text-2xl font-semibold text-foreground">
                    {selectedDraft.title}
                  </h3>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span>{selectedDraft.thread_title || "未命名会话"}</span>
                    <span>{formatChatTimestamp(selectedDraft.created_at)}</span>
                  </div>
                </div>

                <button
                  aria-label="关闭草稿详情"
                  className="rounded-2xl p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  onClick={() => setSelectedDraft(null)}
                  type="button"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="mb-6 rounded-2xl border border-border bg-muted/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                  <FileSearch className="h-4 w-4" />
                  草稿摘要
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  {selectedDraft.excerpt}
                </p>
              </div>

              {renderArtifactDetail(selectedDraft.artifact)}
            </div>

            <div className="border-t border-border px-6 py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground transition hover:bg-muted"
                  onClick={() => setSelectedDraft(null)}
                  type="button"
                >
                  继续浏览
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
                  onClick={() => onOpenThread(selectedDraft)}
                  type="button"
                >
                  在会话中打开
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
