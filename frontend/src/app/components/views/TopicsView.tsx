import { useMemo, useState, type FormEvent } from "react";

import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  PenLine,
  Plus,
  Rocket,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";

import type {
  TopicCreatePayload,
  TopicItem,
  TopicPlatform,
  TopicStatus,
  TopicUpdatePayload,
} from "../../types";

type TopicsViewProps = {
  topics: TopicItem[];
  isLoading: boolean;
  isMutating: boolean;
  mutatingTopicId: string | null;
  onCreateTopic: (payload: TopicCreatePayload) => Promise<TopicItem | null>;
  onDeleteTopic: (topic: TopicItem) => Promise<boolean>;
  onDraftTopic: (topic: TopicItem) => Promise<void>;
  onUpdateTopic: (topic: TopicItem, payload: TopicUpdatePayload) => Promise<TopicItem | null>;
};

type TopicFormState = {
  title: string;
  inspiration: string;
  platform: TopicPlatform;
};

type TopicEditorState = {
  mode: "create" | "edit";
  topicId: string | null;
};

const topicColumns: Array<{
  status: TopicStatus;
  title: string;
  description: string;
  icon: typeof Lightbulb;
}> = [
  {
    status: "idea",
    title: "灵感备选",
    description: "先把闪念和素材线索收进来，再决定何时开写。",
    icon: Lightbulb,
  },
  {
    status: "drafting",
    title: "撰写中",
    description: "已经准备进入内容生成，可随时一键带入工作台。",
    icon: PenLine,
  },
  {
    status: "published",
    title: "已发布",
    description: "完成闭环的选题资产，可回看复盘和二次复用。",
    icon: CheckCircle2,
  },
];

const platformOptions: TopicPlatform[] = ["小红书", "抖音", "双平台"];

const initialFormState: TopicFormState = {
  title: "",
  inspiration: "",
  platform: "小红书",
};

function getStatusAccent(status: TopicStatus): string {
  if (status === "idea") {
    return "border-amber-200 bg-amber-50/80 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
  }
  if (status === "drafting") {
    return "border-sky-200 bg-sky-50/80 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300";
  }
  return "border-emerald-200 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
}

function getPlatformBadgeClass(platform: TopicPlatform): string {
  if (platform === "小红书") {
    return "bg-brand-soft text-brand";
  }
  if (platform === "抖音") {
    return "bg-secondary text-secondary-foreground";
  }
  return "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300";
}

function formatUpdatedAtLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚更新";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getTopicFormState(topic?: TopicItem | null): TopicFormState {
  return {
    title: topic?.title ?? "",
    inspiration: topic?.inspiration ?? "",
    platform: topic?.platform ?? "小红书",
  };
}

function getNeighborStatus(
  currentStatus: TopicStatus,
  direction: "prev" | "next",
): TopicStatus | null {
  const statusOrder: TopicStatus[] = ["idea", "drafting", "published"];
  const currentIndex = statusOrder.indexOf(currentStatus);
  if (currentIndex === -1) {
    return null;
  }

  const nextIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;
  return statusOrder[nextIndex] ?? null;
}

export function TopicsView(props: TopicsViewProps) {
  const {
    topics,
    isLoading,
    isMutating,
    mutatingTopicId,
    onCreateTopic,
    onDeleteTopic,
    onDraftTopic,
    onUpdateTopic,
  } = props;

  const [searchValue, setSearchValue] = useState("");
  const [formState, setFormState] = useState<TopicFormState>(initialFormState);
  const [editorState, setEditorState] = useState<TopicEditorState | null>(null);

  const normalizedSearch = searchValue.trim().toLowerCase();

  const filteredTopics = useMemo(() => {
    return topics.filter((topic) => {
      if (!normalizedSearch) {
        return true;
      }

      return [topic.title, topic.inspiration, topic.platform]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch);
    });
  }, [normalizedSearch, topics]);

  const groupedTopics = useMemo(() => {
    return {
      idea: filteredTopics.filter((topic) => topic.status === "idea"),
      drafting: filteredTopics.filter((topic) => topic.status === "drafting"),
      published: filteredTopics.filter((topic) => topic.status === "published"),
    } satisfies Record<TopicStatus, TopicItem[]>;
  }, [filteredTopics]);

  const editingTopic = useMemo(
    () =>
      editorState?.mode === "edit" && editorState.topicId
        ? topics.find((topic) => topic.id === editorState.topicId) ?? null
        : null,
    [editorState, topics],
  );

  const openCreateModal = () => {
    setFormState(initialFormState);
    setEditorState({ mode: "create", topicId: null });
  };

  const openEditModal = (topic: TopicItem) => {
    setFormState(getTopicFormState(topic));
    setEditorState({ mode: "edit", topicId: topic.id });
  };

  const closeModal = () => {
    setEditorState(null);
    setFormState(initialFormState);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload: TopicCreatePayload = {
      title: formState.title.trim(),
      inspiration: formState.inspiration.trim(),
      platform: formState.platform,
    };

    if (!payload.title) {
      return;
    }

    if (editorState?.mode === "edit" && editingTopic) {
      const updated = await onUpdateTopic(editingTopic, payload);
      if (updated) {
        closeModal();
      }
      return;
    }

    const created = await onCreateTopic(payload);
    if (created) {
      closeModal();
    }
  };

  const handleMoveTopic = async (
    topic: TopicItem,
    direction: "prev" | "next",
  ) => {
    const nextStatus = getNeighborStatus(topic.status, direction);
    if (!nextStatus) {
      return;
    }

    await onUpdateTopic(topic, { status: nextStatus });
  };

  const handleDelete = async (topic: TopicItem) => {
    const confirmed = window.confirm(`确认删除选题「${topic.title}」吗？此操作不可恢复。`);
    if (!confirmed) {
      return;
    }
    await onDeleteTopic(topic);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="border-b border-border bg-surface-elevated px-4 py-4 backdrop-blur-sm lg:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-2xl font-bold tracking-tight text-foreground">
              选题策划池
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              把灵感、撰写进度和已发布选题放到一个轻量级工作流里，随时带回聊天区开写。
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative block min-w-[240px]">
              <input
                className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 pr-11 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="搜索选题标题或灵感备注"
                value={searchValue}
              />
              <SquarePen className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </label>

            <button
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
              data-testid="topics-create-button"
              onClick={openCreateModal}
              type="button"
            >
              <Plus className="h-4 w-4" />
              新建灵感
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-6">
        <div className="grid gap-4 xl:grid-cols-3">
          {topicColumns.map((column) => {
            const items = groupedTopics[column.status];
            const ColumnIcon = column.icon;

            return (
              <section
                key={column.status}
                className="flex min-h-[420px] flex-col rounded-[28px] border border-border bg-card/80 p-4 shadow-sm"
                data-testid={`topic-column-${column.status}`}
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-lg font-semibold text-foreground">
                      <span
                        className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl border ${getStatusAccent(column.status)}`}
                      >
                        <ColumnIcon className="h-4 w-4" />
                      </span>
                      {column.title}
                    </div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">
                      {column.description}
                    </div>
                  </div>
                  <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-secondary-foreground">
                    {items.length}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-3">
                  {isLoading ? (
                    Array.from({ length: 3 }).map((_, index) => (
                      <div
                        key={`${column.status}-skeleton-${index}`}
                        className="rounded-[24px] border border-border bg-muted p-4"
                      >
                        <div className="mb-3 h-4 w-2/3 animate-pulse rounded bg-surface-subtle" />
                        <div className="mb-2 h-3 w-full animate-pulse rounded bg-surface-subtle" />
                        <div className="h-3 w-5/6 animate-pulse rounded bg-surface-subtle" />
                      </div>
                    ))
                  ) : null}

                  {!isLoading && items.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center rounded-[24px] border border-dashed border-border bg-muted/60 px-5 py-10 text-center text-sm leading-6 text-muted-foreground">
                      {column.status === "idea"
                        ? "先记下一条灵感，后面就能一键转成草稿任务。"
                        : column.status === "drafting"
                          ? "把准备开写的选题推进到这里，方便集中冲刺。"
                          : "已经完成发布的内容，会在这里沉淀成可复用选题资产。"}
                    </div>
                  ) : null}

                  {!isLoading
                    ? items.map((topic) => {
                        const canMoveLeft = topic.status !== "idea";
                        const canMoveRight = topic.status !== "published";
                        const isCardMutating = isMutating && mutatingTopicId === topic.id;
                        const isResumeReady =
                          topic.status !== "published" && Boolean(topic.thread_id?.trim());
                        const primaryActionLabel = isResumeReady
                          ? "继续撰写"
                          : "一键生成草稿";

                        return (
                          <article
                            key={topic.id}
                            className="rounded-[24px] border border-border bg-card p-4 shadow-sm transition hover:border-brand/20 hover:shadow-md"
                            data-testid={`topic-card-${topic.id}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span
                                    className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getPlatformBadgeClass(topic.platform)}`}
                                  >
                                    {topic.platform}
                                  </span>
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusAccent(topic.status)}`}
                                  >
                                    {topic.status === "idea"
                                      ? "灵感"
                                      : topic.status === "drafting"
                                        ? "撰写中"
                                        : "已发布"}
                                  </span>
                                </div>
                                <h3 className="mt-3 text-base font-semibold leading-7 text-foreground">
                                  {topic.title}
                                </h3>
                              </div>

                              <button
                                aria-label={`删除选题 ${topic.title}`}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-danger-foreground/15 text-danger-foreground transition hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={isCardMutating}
                                onClick={() => void handleDelete(topic)}
                                type="button"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>

                            <p className="mt-3 line-clamp-3 text-sm leading-7 text-muted-foreground">
                              {topic.inspiration.trim() || "暂时还没有补充灵感备注，后续可以继续补全场景、角度和受众。"}
                            </p>

                            <div className="mt-4 text-xs text-muted-foreground">
                              最近更新：{formatUpdatedAtLabel(topic.updated_at)}
                            </div>

                            <div className="mt-4 flex flex-wrap items-center gap-2">
                              <button
                                className="inline-flex items-center gap-2 rounded-2xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                                data-testid={`topic-draft-${topic.id}`}
                                disabled={isCardMutating || topic.status === "published"}
                                onClick={() => void onDraftTopic(topic)}
                                type="button"
                              >
                                <Rocket className="h-4 w-4" />
                                {primaryActionLabel}
                              </button>

                              <button
                                className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-sm font-medium text-card-foreground transition hover:border-brand/30 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={isCardMutating}
                                onClick={() => openEditModal(topic)}
                                type="button"
                              >
                                <SquarePen className="h-4 w-4" />
                                编辑
                              </button>
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                              <button
                                className="inline-flex items-center gap-1 rounded-2xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={!canMoveLeft || isCardMutating}
                                onClick={() => void handleMoveTopic(topic, "prev")}
                                type="button"
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                                左移
                              </button>
                              <button
                                className="inline-flex items-center gap-1 rounded-2xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={!canMoveRight || isCardMutating}
                                onClick={() => void handleMoveTopic(topic, "next")}
                                type="button"
                              >
                                右移
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </article>
                        );
                      })
                    : null}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {editorState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
          <div className="w-full max-w-2xl rounded-[28px] border border-border bg-card p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-semibold text-foreground">
                  {editorState.mode === "create" ? "新建灵感" : "编辑选题"}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  把标题、平台和灵感备注整理好，后面就能一键转入撰写工作流。
                </div>
              </div>
              <button
                aria-label="关闭选题编辑弹窗"
                className="rounded-xl p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={closeModal}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
              <label className="block">
                <div className="mb-2 text-sm font-medium text-card-foreground">选题标题</div>
                <input
                  className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                  data-testid="topic-form-title"
                  onChange={(event) =>
                    setFormState((current) => ({ ...current, title: event.target.value }))
                  }
                  placeholder="例如：法拍房新手第一次看房，最容易踩的 5 个坑"
                  value={formState.title}
                />
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-card-foreground">所属平台</div>
                <select
                  className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      platform: event.target.value as TopicPlatform,
                    }))
                  }
                  value={formState.platform}
                >
                  {platformOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-card-foreground">
                  灵感备注 / 素材来源
                </div>
                <textarea
                  className="min-h-40 w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm leading-7 text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                  data-testid="topic-form-inspiration"
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      inspiration: event.target.value,
                    }))
                  }
                  placeholder="记录痛点、目标受众、内容角度、竞品观察，或者你刚想到的开头钩子。"
                  value={formState.inspiration}
                />
              </label>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground transition hover:bg-muted"
                  onClick={closeModal}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isMutating || !formState.title.trim()}
                  type="submit"
                >
                  {editorState.mode === "create" ? "保存灵感" : "保存修改"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
