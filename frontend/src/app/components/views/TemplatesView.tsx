import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  BadgePlus,
  BookOpen,
  Bot,
  Cloud,
  Cpu,
  FileText,
  Link2,
  Loader2,
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
  TemplateSkillDiscoveryItem,
  TemplateSummaryItem,
} from "../../types";

type TemplateCategoryFilter = "全部" | TemplateCategory;
type TemplateCollection = "recommended" | "industry" | "mine" | "skills";

type TemplateCreationRequest = {
  key: number;
  payload: TemplateCreatePayload;
};

type TemplatesViewProps = {
  templates: TemplateSummaryItem[];
  skills: TemplateSkillDiscoveryItem[];
  isLoading: boolean;
  isLoadingSkills: boolean;
  isMutating: boolean;
  mutatingTemplateId: string | null;
  selectedTemplateId: string | null;
  creationRequest: TemplateCreationRequest | null;
  onCreationRequestHandled: () => void;
  onUseTemplate: (template: TemplateSummaryItem) => void;
  onCreateTemplate: (payload: TemplateCreatePayload) => Promise<TemplateSummaryItem | null>;
  onDeleteTemplate: (template: TemplateSummaryItem) => Promise<boolean>;
  onDeleteTemplates: (templateIds: string[]) => Promise<boolean>;
  onSearchSkills: (
    keyword: string,
    category?: TemplateCategory,
  ) => Promise<void> | void;
};

type TemplateFormState = {
  title: string;
  description: string;
  platform: TemplatePlatform;
  category: TemplateCategory;
  knowledge_base_scope: string;
  system_prompt: string;
};

const collectionTabs: Array<{
  id: TemplateCollection;
  label: string;
  description: string;
}> = [
  { id: "recommended", label: "推荐", description: "系统预置精选模板" },
  { id: "industry", label: "行业", description: "按行业检索全部模板" },
  { id: "mine", label: "我的", description: "管理个人沉淀模板" },
  { id: "skills", label: "Skills", description: "探索最新 Prompt 灵感" },
];

const categoryTabs: Array<{ id: TemplateCategoryFilter; label: string }> = [
  { id: "全部", label: "全部" },
  { id: "美妆护肤", label: "美妆护肤" },
  { id: "美食文旅", label: "美食文旅" },
  { id: "职场金融", label: "职场金融" },
  { id: "数码科技", label: "数码科技" },
  { id: "电商/闲鱼", label: "电商/闲鱼" },
  { id: "教育/干货", label: "教育/干货" },
];

const platformOptions: TemplatePlatform[] = ["小红书", "抖音", "闲鱼", "技术博客"];
const categoryOptions: TemplateCategory[] = [
  "美妆护肤",
  "美食文旅",
  "职场金融",
  "数码科技",
  "电商/闲鱼",
  "教育/干货",
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
  return <Cpu className="h-4 w-4" />;
}

function getPlatformBadgeClass(platform: TemplatePlatform): string {
  if (platform === "小红书") {
    return "bg-brand-soft text-brand";
  }
  if (platform === "抖音") {
    return "bg-secondary text-secondary-foreground";
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
  return "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300";
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

function toTemplatePayloadFromSkill(skill: TemplateSkillDiscoveryItem): TemplateCreatePayload {
  return {
    title: skill.title,
    description: skill.description,
    platform: skill.platform,
    category: skill.category,
    knowledge_base_scope: skill.knowledge_base_scope ?? null,
    system_prompt: skill.system_prompt,
  };
}

export function TemplatesView(props: TemplatesViewProps) {
  const {
    templates,
    skills,
    isLoading,
    isLoadingSkills,
    isMutating,
    mutatingTemplateId,
    selectedTemplateId,
    creationRequest,
    onCreationRequestHandled,
    onUseTemplate,
    onCreateTemplate,
    onDeleteTemplate,
    onDeleteTemplates,
    onSearchSkills,
  } = props;

  const [activeCollection, setActiveCollection] = useState<TemplateCollection>("recommended");
  const [activeCategory, setActiveCategory] = useState<TemplateCategoryFilter>("全部");
  const [searchValue, setSearchValue] = useState("");
  const [skillsSearchValue, setSkillsSearchValue] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [formState, setFormState] = useState<TemplateFormState>(initialFormState);
  const [hasRequestedSkills, setHasRequestedSkills] = useState(false);
  const [isSearchingSkills, setIsSearchingSkills] = useState(false);
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);
  const [savedSkillIds, setSavedSkillIds] = useState<string[]>([]);

  const isCreating = isMutating && mutatingTemplateId === "template-create";
  const isBulkDeleting = isMutating && mutatingTemplateId === "template-bulk";
  const shouldShowSkillsLoading =
    activeCollection === "skills" &&
    (isLoadingSkills || isSearchingSkills || (!hasRequestedSkills && skills.length === 0));

  useEffect(() => {
    const availableIds = new Set(
      templates.filter((template) => !template.is_preset).map((template) => template.id),
    );
    setSelectedIds((current) => current.filter((id) => availableIds.has(id)));
  }, [templates]);

  useEffect(() => {
    const availableIds = new Set(skills.map((skill) => skill.id));
    setSavedSkillIds((current) => current.filter((id) => availableIds.has(id)));
  }, [skills]);

  useEffect(() => {
    if (!creationRequest) {
      return;
    }

    setActiveCollection("mine");
    setFormState(toFormState(creationRequest.payload));
    setIsCreateModalOpen(true);
    onCreationRequestHandled();
  }, [creationRequest, onCreationRequestHandled]);

  useEffect(() => {
    if (activeCollection !== "skills" || hasRequestedSkills) {
      return;
    }

    setHasRequestedSkills(true);
    setIsSearchingSkills(true);
    void (async () => {
      try {
        await onSearchSkills(
          skillsSearchValue.trim() || "爆款 Prompt",
          activeCategory === "全部" ? undefined : activeCategory,
        );
      } finally {
        setIsSearchingSkills(false);
      }
    })();
  }, [
    activeCategory,
    activeCollection,
    hasRequestedSkills,
    onSearchSkills,
    skillsSearchValue,
  ]);

  const filteredTemplates = useMemo(() => {
    const normalizedSearch = normalizeSearchValue(searchValue);
    const baseTemplates =
      activeCollection === "recommended"
        ? templates.filter((template) => template.is_preset)
        : activeCollection === "mine"
          ? templates.filter((template) => !template.is_preset)
          : templates;

    return baseTemplates.filter((template) => {
      const matchesCategory =
        activeCategory === "全部" ? true : template.category === activeCategory;
      return matchesCategory && matchesSearch(template, normalizedSearch);
    });
  }, [activeCategory, activeCollection, searchValue, templates]);

  const filteredSkills = useMemo(() => {
    // Server-side skills search is query-driven. We intentionally do not
    // re-apply the local keyword input here, otherwise semantically relevant
    // cloud results could be hidden just because the generated title does not
    // literally contain the user's original search phrase.
    if (activeCategory === "全部") {
      return skills;
    }

    const categoryMatchedSkills = skills.filter(
      (item) => item.category === activeCategory,
    );

    // Cloud discoveries come from a server-side query. If the local tab filter
    // would hide every returned card, fall back to showing the full result set
    // instead of rendering a misleading empty state.
    if (skills.length > 0 && categoryMatchedSkills.length === 0) {
      return skills;
    }

    return categoryMatchedSkills;
  }, [activeCategory, skills]);

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

    setActiveCollection("mine");
    setSearchValue("");
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

  const handleSearchSkills = async () => {
    setHasRequestedSkills(true);
    setIsSearchingSkills(true);
    try {
      await onSearchSkills(
        skillsSearchValue.trim() || "爆款 Prompt",
        activeCategory === "全部" ? undefined : activeCategory,
      );
    } finally {
      setIsSearchingSkills(false);
    }
  };

  const handleSaveSkill = async (skill: TemplateSkillDiscoveryItem) => {
    setSavingSkillId(skill.id);
    try {
      const createdTemplate = await onCreateTemplate(toTemplatePayloadFromSkill(skill));
      if (!createdTemplate) {
        return;
      }

      setSavedSkillIds((current) =>
        current.includes(skill.id) ? current : [...current, skill.id],
      );
    } finally {
      setSavingSkillId(null);
    }
  };

  const collectionMeta = collectionTabs.find((item) => item.id === activeCollection);
  const renderedTemplateCount =
    activeCollection === "skills" ? filteredSkills.length : filteredTemplates.length;

  console.log(
    "当前用于渲染的模板总数:",
    renderedTemplateCount,
    "云端数量:",
    skills.length,
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="templates-view">
      <div className="border-b border-border bg-surface-elevated px-4 py-5 backdrop-blur-sm lg:px-6">
        {selectedIds.length === 0 ? (
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
                <Sparkles className="h-3.5 w-3.5" />
                模板生态中心
              </div>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
                模板中心
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                把官方预置、人设沉淀、对话反哺与实时 Skills 探索放进同一套工作流里。
                你可以一键应用模板、从当前产物沉淀模板，或者把联网发现的 Prompt 灵感导入成自己的资产。
              </p>
            </div>

            <div className="flex w-full flex-col gap-3 xl:max-w-2xl">
              {activeCollection !== "skills" ? (
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
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="relative block flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      className="w-full rounded-2xl border border-border bg-card py-3 pl-11 pr-4 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                      data-testid="template-skills-search-input"
                      onChange={(event) => setSkillsSearchValue(event.target.value)}
                      placeholder="搜索近期爆款 Prompt、行业写法或关键词趋势"
                      value={skillsSearchValue}
                    />
                  </label>

                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="template-skills-search-button"
                    disabled={shouldShowSkillsLoading}
                    onClick={() => void handleSearchSkills()}
                    type="button"
                  >
                    {shouldShowSkillsLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Bot className="h-4 w-4" />
                    )}
                    云端发现 Skills
                  </button>
                </div>
              )}
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
                disabled={isMutating}
                onClick={() => setSelectedIds([])}
                type="button"
              >
                取消选择
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-2xl border border-danger-foreground/20 bg-card px-4 py-3 text-sm font-medium text-danger-foreground transition hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="template-delete-selected"
                disabled={isMutating || selectedIds.length === 0}
                onClick={() => void handleDeleteSelected()}
                type="button"
              >
                {isBulkDeleting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                批量删除
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {collectionTabs.map((tab) => (
            <button
              key={tab.id}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                activeCollection === tab.id
                  ? "border-brand/40 bg-brand-soft text-brand"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`template-collection-${tab.id}`}
              onClick={() => setActiveCollection(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}

          <div className="text-xs text-muted-foreground">
            当前视图：{collectionMeta?.label} · {collectionMeta?.description}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {categoryTabs.map((tab) => (
            <button
              key={tab.id}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                activeCategory === tab.id
                  ? "border-brand/40 bg-brand-soft text-brand"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`template-tab-${tab.id}`}
              onClick={() => setActiveCategory(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}

          <div className="text-xs text-muted-foreground">
            {activeCollection === "skills"
              ? shouldShowSkillsLoading
                ? "正在全网检索并提炼 Skills 灵感…"
                : `共发现 ${filteredSkills.length} 条 Skills 灵感`
              : `共 ${filteredTemplates.length} 个模板${activeCollection === "industry" ? `（库内总数 ${templates.length}）` : ""}`}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 lg:px-6">
        {activeCollection !== "skills" && isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={`template-skeleton-${index}`}
                className="rounded-[28px] border border-border bg-card p-5 shadow-sm"
              >
                <div className="mb-4 h-5 w-2/3 animate-pulse rounded bg-surface-subtle" />
                <div className="mb-2 h-4 w-full animate-pulse rounded bg-surface-subtle" />
                <div className="mb-2 h-4 w-5/6 animate-pulse rounded bg-surface-subtle" />
                <div className="mt-6 h-10 w-28 animate-pulse rounded-2xl bg-surface-subtle" />
              </div>
            ))}
          </div>
        ) : null}

        {activeCollection !== "skills" && !isLoading && filteredTemplates.length === 0 ? (
          <div
            className="flex min-h-[360px] flex-col items-center justify-center rounded-[32px] border border-dashed border-border bg-card px-6 py-12 text-center"
            data-testid="templates-empty-state"
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-soft text-brand">
              <FileText className="h-10 w-10" />
            </div>
            <div className="mt-6 text-2xl font-semibold text-foreground">
              暂无匹配模板
            </div>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              可以尝试切换分类、修改搜索词，或者直接新建一个属于你的模板资产。
            </p>
          </div>
        ) : null}

        {activeCollection !== "skills" && !isLoading && filteredTemplates.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map((template) => {
              const isSelected = selectedIds.includes(template.id);
              const isDeleting = isMutating && mutatingTemplateId === template.id;
              const isRecentlyUsed = selectedTemplateId === template.id;

              return (
                <article
                  key={template.id}
                  className={`rounded-[28px] border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${
                    isSelected
                      ? "border-brand/40 bg-brand-soft/20 ring-2 ring-brand/30"
                      : "border-border hover:border-brand/30"
                  }`}
                  data-testid={`template-card-${template.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {!template.is_preset ? (
                        <label
                          className="mt-0.5 inline-flex cursor-pointer items-center"
                          htmlFor={`template-select-${template.id}`}
                        >
                          <input
                            checked={isSelected}
                            className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
                            data-testid={`template-checkbox-${template.id}`}
                            disabled={isMutating}
                            id={`template-select-${template.id}`}
                            onChange={() => toggleSelected(template.id)}
                            type="checkbox"
                          />
                        </label>
                      ) : (
                        <div className="inline-flex h-4 w-4 items-center justify-center text-brand">
                          <ShieldCheck className="h-4 w-4" />
                        </div>
                      )}

                      <div className="rounded-2xl bg-secondary p-2 text-secondary-foreground">
                        <PlatformGlyph platform={template.platform} />
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-lg font-semibold text-foreground">
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
                          {template.knowledge_base_scope ? (
                            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                              知识库：{template.knowledge_base_scope}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {template.is_preset ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-medium text-brand">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        官方
                      </span>
                    ) : (
                      <button
                        aria-label={`删除模板 ${template.title}`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-danger-foreground/20 text-danger-foreground transition hover:bg-danger-surface disabled:cursor-not-allowed disabled:opacity-50"
                        data-testid={`template-delete-${template.id}`}
                        disabled={isMutating}
                        onClick={() => void handleSingleDelete(template)}
                        type="button"
                      >
                        {isDeleting ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>

                  <p className="mt-4 min-h-16 text-sm leading-6 text-muted-foreground">
                    {template.description}
                  </p>

                  <div className="mt-4 rounded-2xl border border-border bg-muted/60 p-4">
                    <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Prompt 预览
                    </div>
                    <p className="line-clamp-5 text-sm leading-6 text-card-foreground">
                      {template.system_prompt}
                    </p>
                  </div>

                  <div className="mt-6 flex items-center justify-between gap-3">
                    <div className="text-xs text-muted-foreground">
                      {isRecentlyUsed
                        ? "最近已应用到新建会话"
                        : `${template.is_preset ? "官方预置" : "个人模板"} · ${formatCreatedAtLabel(template.created_at)}`}
                    </div>
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
                </article>
              );
            })}
          </div>
        ) : null}

        {activeCollection === "skills" ? (
          <div className="space-y-4">
            <div className="rounded-[28px] border border-border bg-card p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-brand-soft p-3 text-brand">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-lg font-semibold text-foreground">Skills 扩展中心</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    这里会把实时搜索到的 Prompt 结构、近期热门写法和可迁移的人设框架整理成可导入卡片。
                    你可以先搜行业关键词，再把结果导入为自己的模板。
                  </p>
                </div>
              </div>
            </div>

            {shouldShowSkillsLoading ? (
              <div
                className="flex min-h-[320px] flex-col items-center justify-center rounded-[32px] border border-brand/20 bg-card px-6 py-12 text-center shadow-sm"
                data-testid="template-skills-loading-state"
              >
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <Loader2 className="h-10 w-10 animate-spin" />
                </div>
                <div className="mt-6 text-2xl font-semibold text-foreground">
                  正在全网检索并提炼顶级 Prompt 框架
                </div>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  这一步会先搜索近期框架写法，再让模型提炼成可复用的 Meta-Prompt，
                  通常需要 10-20 秒，请稍候...
                </p>
              </div>
            ) : null}

            {!shouldShowSkillsLoading && filteredSkills.length === 0 ? (
              <div
                className="flex min-h-[320px] flex-col items-center justify-center rounded-[32px] border border-dashed border-border bg-card px-6 py-12 text-center"
                data-testid="template-skills-empty-state"
              >
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <BookOpen className="h-10 w-10" />
                </div>
                <div className="mt-6 text-2xl font-semibold text-foreground">
                  暂无匹配的 Skills 灵感
                </div>
                <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                  换一个行业关键词试试，例如“福州文旅”“闲鱼教辅”“STM32 教程”“熬夜护肤”。
                </p>
              </div>
            ) : null}

            {!shouldShowSkillsLoading && filteredSkills.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredSkills.map((skill) => {
                  const isSavingSkill = savingSkillId === skill.id;
                  const isSavedSkill = savedSkillIds.includes(skill.id);
                  const discoveryLabel =
                    skill.data_mode === "live_tavily"
                      ? "联网提炼"
                      : skill.data_mode === "llm_fallback"
                        ? "模型回退"
                        : "安全回退";

                  return (
                    <article
                      key={skill.id}
                      className="rounded-[28px] border border-border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-md"
                      data-testid={`skill-card-${skill.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="rounded-2xl bg-secondary p-2 text-secondary-foreground">
                            <PlatformGlyph platform={skill.platform} />
                          </div>
                          <div>
                            <div className="text-lg font-semibold text-foreground">
                              {skill.title}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${getPlatformBadgeClass(skill.platform)}`}
                              >
                                {skill.platform}
                              </span>
                              <span
                                className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${getCategoryBadgeClass(skill.category)}`}
                              >
                                {skill.category}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-medium text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                            <Cloud className="h-3.5 w-3.5" />
                            云端发现
                          </span>
                          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                            {discoveryLabel}
                          </span>
                        </div>
                      </div>

                      <p className="mt-4 min-h-16 text-sm leading-6 text-muted-foreground">
                        {skill.description}
                      </p>

                      <div className="mt-4 rounded-2xl border border-border bg-muted/60 p-4">
                        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          <Sparkles className="h-3.5 w-3.5" />
                          Prompt 预览
                        </div>
                        <p className="line-clamp-5 text-sm leading-6 text-card-foreground">
                          {skill.system_prompt}
                        </p>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border bg-card p-4">
                        <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                          来源线索
                        </div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {skill.source_title}
                        </div>
                        {skill.source_url ? (
                          <a
                            className="mt-2 inline-flex items-center gap-1 text-xs text-brand transition hover:opacity-90"
                            href={skill.source_url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            查看来源
                          </a>
                        ) : (
                          <div className="mt-2 text-xs text-muted-foreground">
                            当前结果由云端回退策略整理，可直接保存到你的模板库继续迭代。
                          </div>
                        )}
                        {skill.knowledge_base_scope ? (
                          <div className="mt-3 text-xs text-muted-foreground">
                            推荐知识库：{skill.knowledge_base_scope}
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-6 flex justify-end">
                        <button
                          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          data-testid={`skill-save-${skill.id}`}
                          disabled={isMutating || isSavingSkill || isSavedSkill}
                          onClick={() => void handleSaveSkill(skill)}
                          type="button"
                        >
                          {isSavingSkill ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : isSavedSkill ? (
                            <Cloud className="h-4 w-4" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )}
                          {isSavedSkill ? "已保存到我的模板" : "保存至我的模板"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
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
                  保存你的人设、行业 Prompt 和知识库作用域，下次创建会话时可以一键带入。
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
                    placeholder="例如：福州周边周末出片模板"
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
                  placeholder="例如：travel_local_guides / education_score_boost / iot_embedded_lab"
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
