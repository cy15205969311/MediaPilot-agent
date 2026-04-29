import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  BadgePlus,
  BookOpen,
  Cpu,
  FileText,
  MapPinned,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import type {
  TemplateCategory,
  TemplateCreatePayload,
  TemplatePlatform,
  TemplateSummaryItem,
} from "../../types";

type TemplateCategoryFilter = "全部" | TemplateCategory;

type TemplateCreationRequest = {
  key: number;
  payload: TemplateCreatePayload;
};

type TemplatesViewProps = {
  templates: TemplateSummaryItem[];
  isLoading: boolean;
  isMutating: boolean;
  mutatingTemplateId: string | null;
  selectedTemplateId: string | null;
  creationRequest: TemplateCreationRequest | null;
  onCreationRequestHandled: () => void;
  onUseTemplate: (template: TemplateSummaryItem) => void;
  onCreateTemplate: (payload: TemplateCreatePayload) => Promise<TemplateSummaryItem | null>;
  onDeleteTemplate: (template: TemplateSummaryItem) => Promise<boolean>;
  onDeleteTemplates: (templateIds: string[]) => Promise<boolean>;
};

type TemplateFormState = {
  title: string;
  description: string;
  platform: TemplatePlatform;
  category: TemplateCategory;
  knowledge_base_scope: string;
  system_prompt: string;
};

const categoryTabs: Array<{ id: TemplateCategoryFilter; label: string }> = [
  { id: "全部", label: "全部" },
  { id: "美妆护肤", label: "美妆护肤" },
  { id: "美食文旅", label: "美食文旅" },
  { id: "职场金融", label: "职场金融" },
  { id: "数码科技", label: "数码科技" },
  { id: "电商/闲鱼", label: "电商/闲鱼" },
  { id: "教育/干货", label: "教育/干货" },
  { id: "房产/家居", label: "房产/家居" },
  { id: "汽车/出行", label: "汽车/出行" },
  { id: "母婴/宠物", label: "母婴/宠物" },
  { id: "情感/心理", label: "情感/心理" },
];

const platformOptions: TemplatePlatform[] = [
  "小红书",
  "抖音",
  "双平台",
  "闲鱼",
  "技术博客",
];

const categoryOptions: TemplateCategory[] = [
  "美妆护肤",
  "美食文旅",
  "职场金融",
  "数码科技",
  "电商/闲鱼",
  "教育/干货",
  "房产/家居",
  "汽车/出行",
  "母婴/宠物",
  "情感/心理",
];

const initialFormState: TemplateFormState = {
  title: "",
  description: "",
  platform: "小红书",
  category: "美食文旅",
  knowledge_base_scope: "",
  system_prompt: "",
};

function toFormState(payload?: Partial<TemplateCreatePayload> | null): TemplateFormState {
  return {
    title: payload?.title ?? "",
    description: payload?.description ?? "",
    platform: payload?.platform ?? "小红书",
    category: payload?.category ?? "美食文旅",
    knowledge_base_scope: payload?.knowledge_base_scope ?? "",
    system_prompt: payload?.system_prompt ?? "",
  };
}

function PlatformGlyph(props: { platform: TemplatePlatform }) {
  const { platform } = props;

  if (platform === "小红书") {
    return <MapPinned className="h-4 w-4" />;
  }
  if (platform === "闲鱼") {
    return <ShoppingBag className="h-4 w-4" />;
  }
  if (platform === "双平台") {
    return <Sparkles className="h-4 w-4" />;
  }
  if (platform === "抖音") {
    return <FileText className="h-4 w-4" />;
  }
  return <Cpu className="h-4 w-4" />;
}

function getPlatformBadgeClass(platform: TemplatePlatform): string {
  if (platform === "小红书") {
    return "bg-brand-soft text-brand";
  }
  if (platform === "抖音") {
    return "bg-secondary text-secondary-foreground";
  }
  if (platform === "双平台") {
    return "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300";
  }
  if (platform === "闲鱼") {
    return "bg-success-surface text-success-foreground";
  }
  return "bg-warning-surface text-warning-foreground";
}

function getCategoryBadgeClass(category: TemplateCategory): string {
  if (category === "美妆护肤") {
    return "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300";
  }
  if (category === "美食文旅") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300";
  }
  if (category === "职场金融") {
    return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";
  }
  if (category === "数码科技") {
    return "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300";
  }
  if (category === "电商/闲鱼") {
    return "bg-lime-100 text-lime-700 dark:bg-lime-950/60 dark:text-lime-300";
  }
  if (category === "教育/干货") {
    return "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300";
  }
  if (category === "房产/家居") {
    return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300";
  }
  if (category === "汽车/出行") {
    return "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300";
  }
  if (category === "母婴/宠物") {
    return "bg-pink-100 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300";
  }
  return "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/60 dark:text-fuchsia-300";
}

function formatCreatedAtLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "刚刚创建";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function matchesSearch(template: TemplateSummaryItem, normalizedSearch: string): boolean {
  if (!normalizedSearch) {
    return true;
  }

  return [
    template.title,
    template.description,
    template.platform,
    template.category,
    template.system_prompt,
    template.knowledge_base_scope ?? "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedSearch);
}

export function TemplatesView(props: TemplatesViewProps) {
  const {
    templates,
    isLoading,
    isMutating,
    mutatingTemplateId,
    selectedTemplateId,
    creationRequest,
    onCreationRequestHandled,
    onUseTemplate,
    onCreateTemplate,
    onDeleteTemplate,
    onDeleteTemplates,
  } = props;

  const [activeCategory, setActiveCategory] = useState<TemplateCategoryFilter>("全部");
  const [searchValue, setSearchValue] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [formState, setFormState] = useState<TemplateFormState>(initialFormState);

  const isCreating = isMutating && mutatingTemplateId === "template-create";

  useEffect(() => {
    const availableIds = new Set(
      templates.filter((template) => !template.is_preset).map((template) => template.id),
    );
    setSelectedIds((current) => current.filter((id) => availableIds.has(id)));
  }, [templates]);

  useEffect(() => {
    if (!creationRequest) {
      return;
    }

    setFormState(toFormState(creationRequest.payload));
    setIsCreateModalOpen(true);
    onCreationRequestHandled();
  }, [creationRequest, onCreationRequestHandled]);

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = normalizeSearchValue(searchValue);
    return templates.filter((template) => {
      const matchesCategory =
        activeCategory === "全部" ? true : template.category === activeCategory;
      return matchesCategory && matchesSearch(template, normalizedSearch);
    });
  }, [activeCategory, searchValue, templates]);

  const presetCount = useMemo(
    () => templates.filter((template) => template.is_preset).length,
    [templates],
  );
  const customCount = templates.length - presetCount;
  const isBulkDeleting = isMutating && mutatingTemplateId === "template-bulk";

  const openCreateModal = (payload?: Partial<TemplateCreatePayload>) => {
    setFormState(toFormState(payload));
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    if (isCreating) {
      return;
    }
    setIsCreateModalOpen(false);
    setFormState(initialFormState);
  };

  const toggleSelected = (templateId: string) => {
    setSelectedIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId],
    );
  };

  const handleCreateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload: TemplateCreatePayload = {
      title: formState.title.trim(),
      description: formState.description.trim(),
      platform: formState.platform,
      category: formState.category,
      knowledge_base_scope: formState.knowledge_base_scope.trim() || null,
      system_prompt: formState.system_prompt.trim(),
    };

    if (!payload.title || !payload.description || !payload.system_prompt) {
      window.alert("请完整填写模板名称、描述和系统提示词。");
      return;
    }

    const createdTemplate = await onCreateTemplate(payload);
    if (!createdTemplate) {
      return;
    }

    setSearchValue("");
    setActiveCategory(payload.category);
    closeCreateModal();
  };

  const handleSingleDelete = async (template: TemplateSummaryItem) => {
    const confirmed = window.confirm(
      `确认删除模板“${template.title}”吗？删除后将无法恢复。`,
    );
    if (!confirmed) {
      return;
    }

    const deleted = await onDeleteTemplate(template);
    if (deleted) {
      setSelectedIds((current) => current.filter((id) => id !== template.id));
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `确认批量删除已选择的 ${selectedIds.length} 个模板吗？删除后将无法恢复。`,
    );
    if (!confirmed) {
      return;
    }

    const deleted = await onDeleteTemplates(selectedIds);
    if (deleted) {
      setSelectedIds([]);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="templates-view">
      <div className="border-b border-border bg-surface-elevated px-4 py-5 backdrop-blur-sm lg:px-6">
        {selectedIds.length === 0 ? (
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
                <Sparkles className="h-3.5 w-3.5" />
                本地模板资产池
              </div>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
                模板中心
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                当前展示的都是本地可立即使用的模板资产，不依赖云端搜索。
                你可以按行业筛选、直接一键应用，也可以把自己的最佳人设和 Prompt
                保存进来，和系统预置模板一起沉淀。
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 xl:max-w-2xl">
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="relative block flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className="w-full rounded-2xl border border-border bg-card py-3 pl-11 pr-4 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                    data-testid="templates-search-input"
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="搜索模板名称、行业分类、知识库作用域或 Prompt 关键词"
                    value={searchValue}
                  />
                </label>

                <button
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="template-create-open"
                  disabled={isMutating}
                  onClick={() => openCreateModal()}
                  type="button"
                >
                  <BadgePlus className="h-4 w-4" />
                  新建模板
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="flex flex-col gap-4 rounded-[28px] border border-brand/20 bg-brand-soft/50 p-5 xl:flex-row xl:items-center xl:justify-between"
            data-testid="templates-bulk-bar"
          >
            <div>
              <div
                className="text-lg font-semibold text-foreground"
                data-testid="templates-selected-count"
              >
                已选择 {selectedIds.length} 项
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                当前仅支持删除自定义模板，系统预置模板会始终保留。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="template-cancel-selection"
                disabled={isBulkDeleting}
                onClick={() => setSelectedIds([])}
                type="button"
              >
                取消选择
              </button>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-destructive px-4 py-3 text-sm font-medium text-destructive-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="template-delete-selected"
                disabled={isBulkDeleting}
                onClick={() => void handleDeleteSelected()}
                type="button"
              >
                {isBulkDeleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                删除所选
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 lg:px-6">
        <div className="rounded-[28px] border border-border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap gap-2">
              {categoryTabs.map((tab) => {
                const isActive = tab.id === activeCategory;
                return (
                  <button
                    key={tab.id}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                    }`}
                    data-testid={`template-tab-${tab.id}`}
                    onClick={() => setActiveCategory(tab.id)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>本地模板 {templates.length} 张</span>
              <span>官方预置 {presetCount} 张</span>
              <span>我的模板 {customCount} 张</span>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`template-skeleton-${index}`}
                className="min-h-72 animate-pulse rounded-[28px] border border-border bg-card p-5"
              />
            ))}
          </div>
        ) : null}

        {!isLoading && filteredTemplates.length === 0 ? (
          <div className="mt-5 flex min-h-[320px] flex-col items-center justify-center rounded-[32px] border border-dashed border-border bg-card px-6 py-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-soft text-brand">
              <BookOpen className="h-10 w-10" />
            </div>
            <div className="mt-6 text-2xl font-semibold text-foreground">
              当前筛选条件下还没有模板
            </div>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              试着切换行业标签，或者放宽搜索词。你也可以直接新建模板，把自己的最佳 Prompt
              沉淀到本地模板库。
            </p>
          </div>
        ) : null}

        {!isLoading && filteredTemplates.length > 0 ? (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredTemplates.map((template) => {
              const isSelected = selectedIds.includes(template.id);
              const isRecentlyUsed = selectedTemplateId === template.id;
              const isDeleting = isMutating && mutatingTemplateId === template.id;
              const cardClass = isSelected
                ? "ring-2 ring-primary border-primary/40 bg-brand-soft/20"
                : isRecentlyUsed
                  ? "border-brand/30 shadow-md"
                  : "border-border";

              return (
                <article
                  key={template.id}
                  className={`rounded-[28px] border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md ${cardClass}`}
                  data-testid={`template-card-${template.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-secondary p-2 text-secondary-foreground">
                        <PlatformGlyph platform={template.platform} />
                      </div>
                      <div>
                        <div className="text-lg font-semibold text-foreground">
                          {template.title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${getPlatformBadgeClass(template.platform)}`}
                          >
                            {template.platform}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${getCategoryBadgeClass(template.category)}`}
                          >
                            {template.category}
                          </span>
                          {template.is_preset ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              官方预置
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {!template.is_preset ? (
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-brand/40 hover:text-foreground">
                        <input
                          checked={isSelected}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                          data-testid={`template-checkbox-${template.id}`}
                          onChange={() => toggleSelected(template.id)}
                          type="checkbox"
                        />
                        选择
                      </label>
                    ) : null}
                  </div>

                  <p className="mt-4 min-h-16 text-sm leading-6 text-muted-foreground">
                    {template.description}
                  </p>

                  {template.knowledge_base_scope ? (
                    <div className="mt-4 rounded-2xl border border-border bg-muted/60 px-4 py-3 text-xs text-muted-foreground">
                      知识库：{template.knowledge_base_scope}
                    </div>
                  ) : null}

                  <div className="mt-4 rounded-2xl border border-border bg-muted/60 p-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Prompt 预览
                    </div>
                    <p className="line-clamp-6 text-sm leading-6 text-card-foreground">
                      {template.system_prompt}
                    </p>
                  </div>

                  <div className="mt-6 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {isRecentlyUsed
                        ? "最近已应用到新建会话"
                        : `${template.is_preset ? "本地预置" : "我的模板"} · ${formatCreatedAtLabel(template.created_at)}`}
                    </div>

                    <div className="flex items-center gap-2">
                      {!template.is_preset ? (
                        <button
                          className="inline-flex items-center justify-center rounded-2xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                          data-testid={`template-delete-${template.id}`}
                          disabled={isDeleting}
                          onClick={() => void handleSingleDelete(template)}
                          type="button"
                        >
                          {isDeleting ? (
                            <RefreshCw className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      ) : null}
                      <button
                        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid={`template-use-${template.id}`}
                        disabled={isMutating}
                        onClick={() => onUseTemplate(template)}
                        type="button"
                      >
                        {isRecentlyUsed ? <RefreshCw className="h-4 w-4" /> : null}
                        一键应用
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>

      {isCreateModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          data-testid="template-create-modal"
        >
          <div className="w-full max-w-2xl rounded-[28px] border border-border bg-card p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-xl font-semibold text-foreground">新建模板</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  把你的人设、行业 Prompt 和知识库作用域保存下来，下次创建会话时就能一键带入。
                </div>
              </div>
              <button
                aria-label="关闭模板弹窗"
                className="rounded-xl p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={closeCreateModal}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form className="space-y-4" onSubmit={(event) => void handleCreateSubmit(event)}>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-card-foreground">
                    模板名称
                  </div>
                  <input
                    className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                    data-testid="template-create-title"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    placeholder="例如：法拍房捡漏讲透模板"
                    value={formState.title}
                  />
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-card-foreground">
                    所属平台
                  </div>
                  <select
                    className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                    data-testid="template-create-platform"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        platform: event.target.value as TemplatePlatform,
                      }))
                    }
                    value={formState.platform}
                  >
                    {platformOptions.map((platform) => (
                      <option key={platform} value={platform}>
                        {platform}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <div className="mb-2 text-sm font-medium text-card-foreground">
                    行业分类
                  </div>
                  <select
                    className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                    data-testid="template-create-category"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        category: event.target.value as TemplateCategory,
                      }))
                    }
                    value={formState.category}
                  >
                    {categoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <div className="mb-2 text-sm font-medium text-card-foreground">
                    模板描述
                  </div>
                  <input
                    className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                    data-testid="template-create-description"
                    onChange={(event) =>
                      setFormState((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    placeholder="一句话说明这个模板适合解决什么问题"
                    value={formState.description}
                  />
                </label>
              </div>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-card-foreground">
                  关联知识库
                </div>
                <input
                  className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                  data-testid="template-create-knowledge-base"
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      knowledge_base_scope: event.target.value,
                    }))
                  }
                  placeholder="例如：housing_home_revival / car_lifestyle_commuter / emotional_wellbeing_notes"
                  value={formState.knowledge_base_scope}
                />
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-card-foreground">
                  系统提示词
                </div>
                <textarea
                  className="min-h-44 w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm leading-7 text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                  data-testid="template-create-system-prompt"
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      system_prompt: event.target.value,
                    }))
                  }
                  placeholder="请输入完整的人设、目标受众、语气要求与输出结构。"
                  value={formState.system_prompt}
                />
              </label>

              <div className="flex justify-end gap-3">
                <button
                  className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isCreating}
                  onClick={closeCreateModal}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="template-create-submit"
                  disabled={isCreating}
                  type="submit"
                >
                  {isCreating ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
                  保存模板
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
