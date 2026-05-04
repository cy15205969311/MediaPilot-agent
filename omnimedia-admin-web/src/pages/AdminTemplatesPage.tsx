import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Eye,
  FileText,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import {
  APIError,
  createAdminTemplate,
  deleteAdminTemplate,
  deleteAdminTemplates,
  fetchAdminTemplates,
  updateAdminTemplate,
} from "../api";
import { StandardSearchInput } from "../components/common/StandardSearchInput";
import { useSearchParams } from "react-router-dom";
import type {
  AdminTemplateCreatePayload,
  AdminTemplateItem,
  AdminTemplatePlatform,
  AdminTemplatesApiResponse,
  AdminToast,
} from "../types";
import { formatNumber } from "../utils/format";

type AdminTemplatesPageProps = {
  onToast: (toast: AdminToast) => void;
};

type TemplateTabKey = "all" | AdminTemplatePlatform | "custom";
type TemplateModalMode = "create" | "edit";
type TemplateMutationKey = null | "modal-submit" | "batch-delete" | `delete:${string}`;
type TemplateFormErrors = Partial<Record<"title" | "prompt_content", string>>;
type TemplateModalForm = AdminTemplateCreatePayload & {
  industry_category: string;
};
type DeleteConfirmState =
  | {
    kind: "single";
    template: AdminTemplateItem;
  }
  | {
    kind: "batch";
    count: number;
    templateIds: string[];
  };

const PAGE_SIZE = 10;
const TAB_ORDER: TemplateTabKey[] = ["all", "小红书", "抖音", "通用", "custom"];
const PLATFORM_OPTIONS: AdminTemplatePlatform[] = ["小红书", "抖音", "通用"];
const INDUSTRY_OPTIONS = ["美妆护肤", "美食文旅", "数码科技", "情感心理", "家居生活"];
const TEMPLATE_SEARCH_CLEAR_PARAM_KEYS = ["templateId"];

function createInitialForm(): TemplateModalForm {
  return {
    title: "",
    platform: "小红书",
    description: "",
    prompt_content: "",
    is_preset: false,
    industry_category: INDUSTRY_OPTIONS[0],
  };
}

function createFormFromTemplate(template?: AdminTemplateItem | null): TemplateModalForm {
  return {
    title: template?.title ?? "",
    platform: template?.platform ?? "小红书",
    description: template?.description ?? "",
    prompt_content: template?.prompt_content ?? "",
    is_preset: template?.is_preset ?? false,
    industry_category: INDUSTRY_OPTIONS[0],
  };
}

function validateTemplateForm(form: Pick<TemplateModalForm, "title" | "prompt_content">): TemplateFormErrors {
  const errors: TemplateFormErrors = {};

  if (!form.title.trim()) {
    errors.title = "请输入模板名称";
  }

  if (!form.prompt_content.trim()) {
    errors.prompt_content = "请填写系统提示词";
  }

  return errors;
}

function canManageTemplate(template: AdminTemplateItem): boolean {
  return Boolean(template);
}

function getTabLabel(tab: TemplateTabKey): string {
  if (tab === "all") {
    return "全部模板";
  }
  if (tab === "custom") {
    return "自定义";
  }
  return tab;
}

function getPlatformBadgeClass(platform: AdminTemplatePlatform): string {
  if (platform === "小红书") {
    return "bg-rose-50 text-rose-500";
  }
  if (platform === "抖音") {
    return "bg-slate-100 text-slate-700";
  }
  return "bg-orange-50 text-orange-500";
}

function formatTemplateCardDate(value?: string | null): string {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function getPromptPreview(prompt: string): string {
  const normalized = prompt.trim();
  if (!normalized) {
    return "该模板暂未填写系统提示词。";
  }

  if (normalized.length <= 110) {
    return normalized;
  }

  return `${normalized.slice(0, 110)}...`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof APIError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function TemplateCardSkeleton() {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
      <div className="animate-pulse">
        <div className="mb-4 flex items-start justify-between">
          <div className="h-12 w-12 rounded-2xl bg-slate-100" />
          <div className="h-5 w-5 rounded bg-slate-100" />
        </div>
        <div className="h-6 w-2/3 rounded-full bg-slate-200" />
        <div className="mt-3 flex gap-2">
          <div className="h-6 w-16 rounded-full bg-slate-100" />
          <div className="h-6 w-20 rounded-full bg-slate-100" />
        </div>
        <div className="mt-4 h-4 w-full rounded-full bg-slate-100" />
        <div className="mt-2 h-4 w-4/5 rounded-full bg-slate-100" />
        <div className="mt-5 flex items-center justify-between">
          <div className="h-4 w-24 rounded-full bg-slate-100" />
          <div className="h-4 w-12 rounded-full bg-slate-100" />
        </div>
        <div className="mt-5 flex gap-2">
          <div className="h-11 flex-1 rounded-xl bg-slate-100" />
          <div className="h-11 w-11 rounded-xl bg-slate-100" />
          <div className="h-11 w-11 rounded-xl bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

export function AdminTemplatesPage(props: AdminTemplatesPageProps) {
  const { onToast } = props;
  const [searchParams, setSearchParams] = useSearchParams();
  const [templatesPayload, setTemplatesPayload] = useState<AdminTemplatesApiResponse | null>(null);
  const [activeTab, setActiveTab] = useState<TemplateTabKey>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [mutationKey, setMutationKey] = useState<TemplateMutationKey>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<TemplateModalMode>("create");
  const [editingTemplate, setEditingTemplate] = useState<AdminTemplateItem | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<AdminTemplateItem | null>(null);
  const [form, setForm] = useState<TemplateModalForm>(createInitialForm);
  const [formErrors, setFormErrors] = useState<TemplateFormErrors>({});
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [deleteConfirmState, setDeleteConfirmState] = useState<DeleteConfirmState | null>(null);

  const items = templatesPayload?.items ?? [];
  const isSaving = mutationKey === "modal-submit";
  const isBatchDeleting = mutationKey === "batch-delete";
  const hasSelection = selectedTemplateIds.length > 0;
  const activeTemplateId = searchParams.get("templateId")?.trim() ?? "";
  const activeKeyword = searchParams.get("keyword")?.trim().toLowerCase() ?? "";

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesRouteSearch =
        (!activeTemplateId || item.id === activeTemplateId) &&
        (!activeKeyword ||
          item.title.toLowerCase().includes(activeKeyword) ||
          item.description.toLowerCase().includes(activeKeyword));

      if (!matchesRouteSearch) {
        return false;
      }

      if (activeTab === "all") {
        return true;
      }
      if (activeTab === "custom") {
        return canManageTemplate(item);
      }
      return item.platform === activeTab;
    });
  }, [activeKeyword, activeTab, activeTemplateId, items]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedItems = filteredItems.slice(pageStart, pageStart + PAGE_SIZE);

  const tabCounts = useMemo(
    () =>
      ({
        all: items.length,
        小红书: items.filter((item) => item.platform === "小红书").length,
        抖音: items.filter((item) => item.platform === "抖音").length,
        通用: items.filter((item) => item.platform === "通用").length,
        custom: items.filter((item) => canManageTemplate(item)).length,
      }) satisfies Record<TemplateTabKey, number>,
    [items],
  );

  const paginationText =
    filteredItems.length === 0
      ? "当前筛选条件下暂无模板。"
      : `显示 ${formatNumber(pageStart + 1)}-${formatNumber(
        Math.min(pageStart + pagedItems.length, filteredItems.length),
      )}，共 ${formatNumber(filteredItems.length)} 条`;

  const emptyStateMessage =
    activeTab === "custom"
      ? "当前还没有自定义模板，可以从右上角立即新建一份团队共享模板。"
      : activeTab === "all"
        ? "模板库暂时为空，创建后会立即同步到后台共享模板资产中。"
        : `当前分类下还没有 ${getTabLabel(activeTab)} 模板。`;

  const loadTemplates = async () => {
    setIsLoading(true);

    try {
      const payload = await fetchAdminTemplates();
      setTemplatesPayload(payload);
      return payload;
    } catch (error) {
      onToast({
        tone: "error",
        title: "模板库加载失败",
        message: getErrorMessage(error, "模板列表暂时不可用，请稍后重试。"),
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  useEffect(() => {
    if (!activeTemplateId && !activeKeyword) {
      return;
    }

    setActiveTab("all");
    setCurrentPage(1);
  }, [activeKeyword, activeTemplateId]);

  useEffect(() => {
    if (!activeTemplateId || activeKeyword || items.length === 0) {
      return;
    }

    const matchedTemplate = items.find((item) => item.id === activeTemplateId);
    if (!matchedTemplate) {
      return;
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("keyword", matchedTemplate.title);
      return next;
    });
  }, [activeKeyword, activeTemplateId, items, setSearchParams]);

  useEffect(() => {
    const availableIds = new Set(items.map((item) => item.id));
    setSelectedTemplateIds((current) => current.filter((id) => availableIds.has(id)));
  }, [items]);

  useEffect(() => {
    if (currentPage <= totalPages) {
      return;
    }

    setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const handleRefresh = async () => {
    const payload = await loadTemplates();
    if (!payload) {
      return;
    }

    onToast({
      tone: "success",
      title: "模板库已刷新",
      message: "最新模板资产和统计信息已经同步完成。",
    });
  };

  const handleSearchChange = () => {
    setCurrentPage(1);
  };

  const openCreateModal = () => {
    setModalMode("create");
    setEditingTemplate(null);
    setForm(createInitialForm());
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (template: AdminTemplateItem) => {
    setPreviewTemplate(null);
    setModalMode("edit");
    setEditingTemplate(template);
    setForm(createFormFromTemplate(template));
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openPreviewModal = (template: AdminTemplateItem) => {
    setPreviewTemplate(template);
  };

  const closeModal = () => {
    if (isSaving) {
      return;
    }

    setIsModalOpen(false);
    setEditingTemplate(null);
    setFormErrors({});
  };

  const handleFormChange = (patch: Partial<TemplateModalForm>) => {
    setForm((current) => ({ ...current, ...patch }));

    if (patch.title !== undefined || patch.prompt_content !== undefined) {
      setFormErrors((current) => ({
        ...current,
        ...(patch.title !== undefined ? { title: undefined } : {}),
        ...(patch.prompt_content !== undefined ? { prompt_content: undefined } : {}),
      }));
    }
  };

  const handleSubmit = async () => {
    const nextErrors = validateTemplateForm(form);
    setFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setMutationKey("modal-submit");

    try {
      const payload: AdminTemplateCreatePayload = {
        title: form.title.trim(),
        platform: form.platform,
        description: form.description.trim(),
        prompt_content: form.prompt_content.trim(),
        is_preset: form.is_preset,
      };

      if (modalMode === "create") {
        await createAdminTemplate(payload);
      } else if (editingTemplate) {
        await updateAdminTemplate(editingTemplate.id, payload);
      }

      await loadTemplates();
      setIsModalOpen(false);
      setEditingTemplate(null);
      setForm(createInitialForm());
      setFormErrors({});

      onToast({
        tone: "success",
        title: modalMode === "create" ? "模板创建成功" : "模板更新成功",
        message:
          modalMode === "create"
            ? form.is_preset
              ? "新模板已作为官方预置模板写入后台模板库。"
              : "新模板已经写入共享模板库。"
            : form.is_preset
              ? "官方预置模板已更新，前台调用侧会读取最新版本。"
              : "模板内容已更新，后续使用会自动读取最新版本。",
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: modalMode === "create" ? "模板创建失败" : "模板更新失败",
        message: getErrorMessage(error, "模板保存失败，请稍后重试。"),
      });
    } finally {
      setMutationKey(null);
    }
  };

  const toggleSelected = (templateId: string) => {
    setSelectedTemplateIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId],
    );
  };

  const openSingleDeleteConfirm = (template: AdminTemplateItem) => {
    setDeleteConfirmState({ kind: "single", template });
  };

  const openBatchDeleteConfirm = () => {
    if (selectedTemplateIds.length === 0) {
      return;
    }

    setDeleteConfirmState({
      kind: "batch",
      count: selectedTemplateIds.length,
      templateIds: selectedTemplateIds,
    });
  };

  const closeDeleteConfirm = () => {
    if (mutationKey === "batch-delete") {
      return;
    }

    if (
      deleteConfirmState?.kind === "single" &&
      mutationKey === `delete:${deleteConfirmState.template.id}`
    ) {
      return;
    }

    setDeleteConfirmState(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmState) {
      return;
    }

    const nextMutationKey =
      deleteConfirmState.kind === "single"
        ? (`delete:${deleteConfirmState.template.id}` as const)
        : "batch-delete";
    setMutationKey(nextMutationKey);

    try {
      const response =
        deleteConfirmState.kind === "single"
          ? await deleteAdminTemplate(deleteConfirmState.template.id)
          : await deleteAdminTemplates({ template_ids: deleteConfirmState.templateIds });

      setSelectedTemplateIds((current) => current.filter((id) => !response.deleted_ids.includes(id)));
      await loadTemplates();
      setDeleteConfirmState(null);

      onToast({
        tone: "success",
        title: deleteConfirmState.kind === "single" ? "模板已删除" : "批量删除成功",
        message:
          deleteConfirmState.kind === "single"
            ? "该模板已从模板库移除，C 端用户将无法继续使用。"
            : `已删除 ${response.deleted_count} 个模板，选中状态也已自动清空。`,
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: deleteConfirmState.kind === "single" ? "删除失败" : "批量删除失败",
        message: getErrorMessage(error, "模板删除失败，请稍后重试。"),
      });
    } finally {
      setMutationKey(null);
    }
  };

  return (
    <>
      <div className="px-4 py-5 lg:px-6 lg:py-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-[30px] font-bold tracking-tight text-slate-900">模板库管理</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              统一管理官方预置与共享模板资产，支持按平台检索、预览、编辑以及批量清理。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              onClick={() => {
                void handleRefresh();
              }}
              type="button"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
            <button
              className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#ff6b57] to-[#ff8b4d] px-4 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(255,107,87,0.24)] transition hover:-translate-y-0.5"
              onClick={openCreateModal}
              type="button"
            >
              <Plus className="h-4 w-4" />
              新建模板
            </button>
          </div>
        </div>

        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 pr-2">
            {TAB_ORDER.map((tab, index) => {
              const isActive = activeTab === tab;

              return (
                <button
                  key={tab}
                  className="whitespace-nowrap rounded-xl border px-4 py-2 text-sm font-medium transition"
                  onClick={() => setActiveTab(tab)}
                  style={{
                    backgroundColor: isActive ? "#fff1f1" : "#ffffff",
                    borderColor: isActive ? "#ff8f7d" : "#e2e8f0",
                    color: isActive ? "#ff6b57" : "#64748b",
                    boxShadow: isActive ? "0 10px 24px rgba(255,107,87,0.08)" : "none",
                  }}
                  type="button"
                >
                  {getTabLabel(tab)}
                  {index > -1 ? (
                    <span className="ml-2 text-xs opacity-70">({formatNumber(tabCounts[tab])})</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="w-64 shrink-0">
            <StandardSearchInput
              className="w-full"
              clearParamKeys={TEMPLATE_SEARCH_CLEAR_PARAM_KEYS}
              onSearchChange={handleSearchChange}
              paramKey="keyword"
              placeholder="搜索模板名称或描述..."
            />
          </div>
        </div>

        <div
          aria-hidden={!hasSelection}
          className={`sticky top-4 z-30 mb-5 overflow-hidden transition-all duration-300 ${hasSelection
            ? "max-h-32 translate-y-0 opacity-100"
            : "pointer-events-none max-h-0 -translate-y-3 opacity-0"
            }`}
        >
          <div className="flex flex-col gap-4 rounded-[24px] border border-red-100 bg-white/95 px-5 py-4 shadow-[0_22px_50px_rgba(15,23,42,0.12)] backdrop-blur-sm md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-900">
                已选择 {formatNumber(selectedTemplateIds.length)} 项
              </div>
              <div className="mt-1 text-sm text-slate-500">
                支持批量删除官方模板和自定义模板，确认后前台可调用的模板资产会同步更新。
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
                disabled={isBatchDeleting}
                onClick={() => setSelectedTemplateIds([])}
                type="button"
              >
                取消选择
              </button>
              <button
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(239,68,68,0.24)] transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={isBatchDeleting}
                onClick={openBatchDeleteConfirm}
                type="button"
              >
                {isBatchDeleting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                批量删除
              </button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <TemplateCardSkeleton key={index} />
            ))}
          </div>
        ) : pagedItems.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {pagedItems.map((item) => {
                const isSelected = selectedTemplateIds.includes(item.id);
                const isManageable = canManageTemplate(item);
                const isDeleting = mutationKey === `delete:${item.id}`;
                const isBusy = isDeleting || isSaving || isBatchDeleting;

                return (
                  <article
                    key={item.id}
                    className={`rounded-[24px] border bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_48px_rgba(15,23,42,0.08)] ${isSelected ? "border-red-300 ring-2 ring-red-100" : "border-slate-200/90"
                      }`}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#ff6b57] to-[#ff9a52] text-white">
                        <FileText className="h-5 w-5" />
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${item.is_preset ? "bg-sky-50 text-sky-600" : "bg-slate-100 text-slate-600"
                            }`}
                        >
                          {item.is_preset ? "官方预置" : "自定义"}
                        </span>
                        {isManageable ? (
                          <label className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded border border-slate-300 bg-white">
                            <input
                              checked={isSelected}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-[#ff6b57] focus:ring-[#ffb4a8]"
                              disabled={isBusy}
                              onChange={() => toggleSelected(item.id)}
                              type="checkbox"
                            />
                          </label>
                        ) : null}
                      </div>
                    </div>

                    <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${getPlatformBadgeClass(
                          item.platform,
                        )}`}
                      >
                        {item.platform}
                      </span>
                      <span className="text-xs text-slate-400">{formatTemplateCardDate(item.created_at)}</span>
                    </div>

                    <p className="mt-4 min-h-[48px] text-sm leading-6 text-slate-500">
                      {item.description.trim() || "该模板暂未填写适用场景描述，可用于沉淀团队可复用的内容策略资产。"}
                    </p>

                    <div className="mt-4 flex items-center justify-between text-sm">
                      <div className="text-slate-500">使用 {formatNumber(item.usage_count)} 次</div>
                      <div className="flex items-center gap-1 text-amber-500">
                        <span>★</span>
                        <span>{item.rating.toFixed(1)}</span>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-red-100/70 bg-red-50/40 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-400">
                        Prompt Snapshot
                      </div>
                      <div className="mt-2 text-sm leading-6 text-slate-600">{getPromptPreview(item.prompt_content)}</div>
                    </div>

                    {isManageable ? (
                      <div className="mt-5 grid grid-cols-3 gap-2">
                        <button
                          className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-[#ff6b57] transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70"
                          disabled={isBusy}
                          onClick={() => openEditModal(item)}
                          type="button"
                        >
                          编辑
                        </button>
                        <button
                          className="rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-70"
                          disabled={isBusy}
                          onClick={() => openPreviewModal(item)}
                          type="button"
                        >
                          预览
                        </button>
                        <button
                          className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-500 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-70"
                          disabled={isBusy}
                          onClick={() => openSingleDeleteConfirm(item)}
                          type="button"
                        >
                          {isDeleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          删除
                        </button>
                      </div>
                    ) : (
                      <div className="mt-5 flex gap-2">
                        <button
                          className="flex-1 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-medium text-slate-400"
                          disabled
                          type="button"
                        >
                          编辑
                        </button>
                        <button
                          className="inline-flex items-center justify-center rounded-xl bg-red-50 px-4 py-2.5 text-[#ff6b57] transition hover:bg-red-100"
                          onClick={() => openPreviewModal(item)}
                          type="button"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          className="inline-flex items-center justify-center rounded-xl bg-slate-100 px-4 py-2.5 text-slate-400"
                          disabled
                          type="button"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}

                    {isDeleting ? (
                      <div className="mt-3 inline-flex items-center gap-2 text-xs text-red-500">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        正在删除模板...
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>

            <div className="mt-6 flex flex-col gap-4 rounded-[24px] border border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-500">{paginationText}</div>
              <div className="flex items-center gap-3">
                <button
                  className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={currentPage === 1 || isLoading}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  type="button"
                >
                  上一页
                </button>
                <div className="text-sm font-medium text-slate-700">
                  {currentPage} / {totalPages}
                </div>
                <button
                  className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={currentPage >= totalPages || isLoading}
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  type="button"
                >
                  下一页
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-[24px] border border-slate-200 bg-white px-6 py-16 text-center shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-400">
              <FileText className="h-6 w-6" />
            </div>
            <div className="mt-5 text-lg font-semibold text-slate-900">当前分类暂无模板</div>
            <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">{emptyStateMessage}</div>
            <button
              className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#ff6b57] to-[#ff8b4d] px-4 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(255,107,87,0.24)] transition hover:-translate-y-0.5"
              onClick={openCreateModal}
              type="button"
            >
              <Plus className="h-4 w-4" />
              新建模板
            </button>
          </div>
        )}
      </div>

      <TemplateModal
        form={form}
        formErrors={formErrors}
        isOpen={isModalOpen}
        isSubmitting={isSaving}
        mode={modalMode}
        onChange={handleFormChange}
        onClose={closeModal}
        onSubmit={() => {
          void handleSubmit();
        }}
      />

      <TemplatePreviewModal
        onEdit={(template) => openEditModal(template)}
        onClose={() => setPreviewTemplate(null)}
        template={previewTemplate}
      />

      <DeleteConfirmDialog
        confirmState={deleteConfirmState}
        isSubmitting={
          deleteConfirmState?.kind === "single"
            ? mutationKey === `delete:${deleteConfirmState.template.id}`
            : isBatchDeleting
        }
        onCancel={closeDeleteConfirm}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
      />
    </>
  );
}

type TemplateModalProps = {
  form: TemplateModalForm;
  formErrors: TemplateFormErrors;
  isOpen: boolean;
  isSubmitting: boolean;
  mode: TemplateModalMode;
  onChange: (patch: Partial<TemplateModalForm>) => void;
  onClose: () => void;
  onSubmit: () => void;
};

function TemplateModal(props: TemplateModalProps) {
  const { form, formErrors, isOpen, isSubmitting, mode, onChange, onClose, onSubmit } = props;

  if (!isOpen) {
    return null;
  }

  const isEditMode = mode === "edit";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[min(90vh,960px)] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 px-6 py-5 sm:px-8">
          <div>
            <div className="text-[20px] font-semibold text-slate-900">
              {isEditMode ? "编辑模板" : "新建模板"}
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-500">
              维护模板名称、平台、描述与系统提示词。你也可以把模板直接设为官方预置，保存后会同步分发到前台官方模板池。
            </div>
          </div>
          <button
            aria-label="关闭模板弹窗"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          <div className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              <TemplateField label="模板名称" required>
                <input
                  className={`h-14 w-full rounded-2xl border bg-white px-5 text-sm text-slate-900 outline-none transition focus:ring-4 ${formErrors.title
                    ? "border-red-300 focus:border-red-300 focus:ring-red-100"
                    : "border-slate-200 focus:border-red-300 focus:ring-red-100"
                    }`}
                  onChange={(event) => onChange({ title: event.target.value })}
                  placeholder="例如：小红书新品种草模板"
                  type="text"
                  value={form.title}
                />
                {formErrors.title ? (
                  <div className="mt-2 text-xs text-red-500">{formErrors.title}</div>
                ) : null}
              </TemplateField>

              <TemplateField label="所属平台">
                <select
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-5 text-sm text-slate-900 outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-100"
                  onChange={(event) =>
                    onChange({ platform: event.target.value as AdminTemplatePlatform })
                  }
                  value={form.platform}
                >
                  {PLATFORM_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </TemplateField>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <TemplateField label="行业分类">
                <select
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-5 text-sm text-slate-900 outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-100"
                  onChange={(event) => onChange({ industry_category: event.target.value })}
                  value={form.industry_category}
                >
                  {INDUSTRY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </TemplateField>

              <TemplateField label="模板描述">
                <input
                  className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-5 text-sm text-slate-900 outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-100"
                  onChange={(event) => onChange({ description: event.target.value })}
                  placeholder="一句话说明适用场景和内容方向"
                  type="text"
                  value={form.description}
                />
              </TemplateField>
            </div>

            <label className="flex items-center justify-between gap-4 rounded-[24px] border border-slate-200 bg-slate-50/70 px-5 py-4">
              <div>
                <div className="text-sm font-medium text-slate-900">设为官方预置模板</div>
                <div className="mt-1 text-xs leading-5 text-slate-500">
                  开启后，该模板会作为官方模板在前台工作台分发；关闭后则按后台共享自定义模板管理。
                </div>
              </div>
              <button
                aria-checked={form.is_preset}
                className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition ${
                  form.is_preset ? "bg-[#ff7b5f]" : "bg-slate-300"
                }`}
                onClick={() => onChange({ is_preset: !form.is_preset })}
                role="switch"
                type="button"
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition ${
                    form.is_preset ? "left-6" : "left-1"
                  }`}
                />
              </button>
            </label>

            <TemplateField label="系统提示词" required>
              <textarea
                className={`w-full rounded-[24px] border bg-white px-5 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:ring-4 ${formErrors.prompt_content
                  ? "border-red-300 focus:border-red-300 focus:ring-red-100"
                  : "border-slate-200 focus:border-red-300 focus:ring-red-100"
                  }`}
                onChange={(event) => onChange({ prompt_content: event.target.value })}
                placeholder="请输入完整的提示词，包括人设、目标受众、语气、输出格式与约束条件。"
                rows={9}
                value={form.prompt_content}
              />
              {formErrors.prompt_content ? (
                <div className="mt-2 text-xs text-red-500">{formErrors.prompt_content}</div>
              ) : null}
            </TemplateField>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 sm:px-8">
          <button
            className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#ff6b57] to-[#ff8b4d] px-5 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            onClick={onSubmit}
            type="button"
          >
            {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
            {isEditMode ? "保存修改" : "保存模板"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateField(props: {
  children: ReactNode;
  label: string;
  required?: boolean;
}) {
  const { children, label, required = false } = props;

  return (
    <label className="block">
      <div className="mb-3 text-sm font-medium text-slate-900">
        {label}
        {required ? <span className="ml-1 text-red-500">*</span> : null}
      </div>
      {children}
    </label>
  );
}

type TemplatePreviewModalProps = {
  onClose: () => void;
  onEdit: (template: AdminTemplateItem) => void;
  template: AdminTemplateItem | null;
};

function TemplatePreviewModal(props: TemplatePreviewModalProps) {
  const { onClose, onEdit, template } = props;

  if (!template) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[72] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 px-6 py-5 sm:px-8">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${getPlatformBadgeClass(
                  template.platform,
                )}`}
              >
                {template.platform}
              </span>
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${template.is_preset ? "bg-sky-50 text-sky-600" : "bg-slate-100 text-slate-600"
                  }`}
              >
                {template.is_preset ? "官方预置" : "自定义"}
              </span>
            </div>
            <div className="mt-3 text-[22px] font-semibold text-slate-900">{template.title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">
              {template.description.trim() || "该模板暂未填写描述。"}
            </div>
          </div>
          <button
            aria-label="关闭预览"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[24px] border border-red-100 bg-red-50/35 p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-red-400">
                Prompt Snapshot
              </div>
              <pre className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                {template.prompt_content.trim() || "该模板暂无系统提示词。"}
              </pre>
            </div>

            <div className="space-y-4">
              <PreviewMetricCard label="使用次数" value={formatNumber(template.usage_count)} />
              <PreviewMetricCard label="评分" value={template.rating.toFixed(1)} />
              <PreviewMetricCard label="创建日期" value={formatTemplateCardDate(template.created_at)} />
              <div className="rounded-[24px] border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-500 shadow-[0_12px_32px_rgba(15,23,42,0.04)]">
                预览模式仅供快速校验模板资产内容。若需要修改，请进入编辑态后保存；官方预置模板的改动会同步影响前台调用侧。
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 sm:px-8">
          <button
            className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
          <button
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#ff6b57] to-[#ff8b4d] px-5 text-sm font-semibold text-white transition hover:brightness-105"
            onClick={() => onEdit(template)}
            type="button"
          >
            <PencilLine className="h-4 w-4" />
            编辑模板
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewMetricCard(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_12px_32px_rgba(15,23,42,0.04)]">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-3 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

type DeleteConfirmDialogProps = {
  confirmState: DeleteConfirmState | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function DeleteConfirmDialog(props: DeleteConfirmDialogProps) {
  const { confirmState, isSubmitting, onCancel, onConfirm } = props;

  if (!confirmState) {
    return null;
  }

  const title = confirmState.kind === "single" ? "确认删除该模板？" : "确认批量删除？";
  const description =
    confirmState.kind === "single"
      ? `模板“${confirmState.template.title}”删除后，C 端用户将无法继续使用。该操作不可撤销。`
      : `即将删除已选中的 ${confirmState.count} 个模板。删除后 C 端用户将无法继续使用这些模板，且无法恢复。`;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_28px_80px_rgba(15,23,42,0.18)]">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold text-slate-900">{title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">{description}</div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
            disabled={isSubmitting}
            onClick={onCancel}
            type="button"
          >
            取消
          </button>
          <button
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            onClick={onConfirm}
            type="button"
          >
            {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {confirmState.kind === "single" ? "确认删除" : "批量删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
