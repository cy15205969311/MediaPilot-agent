import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
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
  knowledge_base_scope: string;
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

const TAB_ORDER: TemplateTabKey[] = ["all", "小红书", "抖音", "通用", "custom"];
const PLATFORM_OPTIONS: AdminTemplatePlatform[] = ["小红书", "抖音", "通用"];
const INDUSTRY_OPTIONS = ["美妆护肤", "美食文旅", "数码科技", "情感心理", "家居生活"];

function createInitialForm(): TemplateModalForm {
  return {
    title: "",
    platform: "小红书",
    description: "",
    prompt_content: "",
    industry_category: INDUSTRY_OPTIONS[0],
    knowledge_base_scope: "",
  };
}

function createFormFromTemplate(template?: AdminTemplateItem | null): TemplateModalForm {
  return {
    title: template?.title ?? "",
    platform: template?.platform ?? "小红书",
    description: template?.description ?? "",
    prompt_content: template?.prompt_content ?? "",
    industry_category: INDUSTRY_OPTIONS[0],
    knowledge_base_scope: "",
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
  return !template.is_preset;
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
    return "bg-red-50 text-red-500";
  }
  if (platform === "抖音") {
    return "bg-slate-100 text-slate-700";
  }
  return "bg-orange-50 text-orange-500";
}

function getPromptPreview(prompt: string): string {
  const normalized = prompt.trim();
  if (!normalized) {
    return "系统提示词将在这里展示快照预览。";
  }
  return normalized;
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
    <div className="rounded-[30px] border border-slate-200/80 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
      <div className="animate-pulse">
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-2">
            <div className="h-7 w-16 rounded-full bg-slate-100" />
            <div className="h-7 w-20 rounded-full bg-slate-100" />
          </div>
          <div className="h-11 w-11 rounded-2xl bg-slate-100" />
        </div>
        <div className="mt-5 h-8 w-3/5 rounded-full bg-slate-200" />
        <div className="mt-3 h-4 w-4/5 rounded-full bg-slate-100" />
        <div className="mt-2 h-4 w-3/5 rounded-full bg-slate-100" />
        <div className="mt-5 rounded-[24px] bg-red-50/40 p-4">
          <div className="h-3 w-28 rounded-full bg-red-100" />
          <div className="mt-3 h-4 w-full rounded-full bg-white" />
          <div className="mt-2 h-4 w-full rounded-full bg-white" />
          <div className="mt-2 h-4 w-5/6 rounded-full bg-white" />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-4">
              <div className="mx-auto h-3 w-12 rounded-full bg-slate-100" />
              <div className="mx-auto mt-3 h-5 w-16 rounded-full bg-slate-200" />
            </div>
          ))}
        </div>
        <div className="mt-5 h-12 rounded-2xl bg-slate-100" />
      </div>
    </div>
  );
}

export function AdminTemplatesPage(props: AdminTemplatesPageProps) {
  const { onToast } = props;
  const [templatesPayload, setTemplatesPayload] = useState<AdminTemplatesApiResponse | null>(null);
  const [activeTab, setActiveTab] = useState<TemplateTabKey>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [mutationKey, setMutationKey] = useState<TemplateMutationKey>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<TemplateModalMode>("create");
  const [editingTemplate, setEditingTemplate] = useState<AdminTemplateItem | null>(null);
  const [form, setForm] = useState<TemplateModalForm>(createInitialForm);
  const [formErrors, setFormErrors] = useState<TemplateFormErrors>({});
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [deleteConfirmState, setDeleteConfirmState] = useState<DeleteConfirmState | null>(null);

  const items = templatesPayload?.items ?? [];
  const isSaving = mutationKey === "modal-submit";
  const isBatchDeleting = mutationKey === "batch-delete";
  const hasSelection = selectedTemplateIds.length > 0;

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (activeTab === "all") {
        return true;
      }
      if (activeTab === "custom") {
        return canManageTemplate(item);
      }
      return item.platform === activeTab;
    });
  }, [activeTab, items]);

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

  const emptyStateMessage =
    activeTab === "custom"
      ? "当前还没有自定义模板，可以从右上角立即新建一份团队共享模板。"
      : activeTab === "all"
        ? "模板库暂时为空，创建后会立刻同步到共享模板资产中。"
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
    const availableIds = new Set(
      items.filter((item) => canManageTemplate(item)).map((item) => item.id),
    );
    setSelectedTemplateIds((current) => current.filter((id) => availableIds.has(id)));
  }, [items]);

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

  const openCreateModal = () => {
    setModalMode("create");
    setEditingTemplate(null);
    setForm(createInitialForm());
    setFormErrors({});
    setIsModalOpen(true);
  };

  const openEditModal = (template: AdminTemplateItem) => {
    setModalMode("edit");
    setEditingTemplate(template);
    setForm(createFormFromTemplate(template));
    setFormErrors({});
    setIsModalOpen(true);
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
            ? "新模板已经写入共享模板库。"
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

      setSelectedTemplateIds((current) =>
        current.filter((id) => !response.deleted_ids.includes(id)),
      );
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
        <div className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-[34px] font-bold tracking-tight text-slate-900">模板库管理</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50/60 hover:text-red-500"
              onClick={() => {
                void handleRefresh();
              }}
              type="button"
            >
              <RefreshCw className="h-4 w-4" />
              刷新
            </button>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#ff5f5f] to-[#ff8a45] px-4 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(255,107,87,0.24)] transition hover:-translate-y-0.5"
              onClick={openCreateModal}
              type="button"
            >
              <Plus className="h-4 w-4" />
              新建模板
            </button>
          </div>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          {TAB_ORDER.map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                className={`whitespace-nowrap rounded-xl border px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? "border-[#f3b7c1] bg-white text-rose-500 shadow-[0_6px_18px_rgba(255,95,95,0.08)]"
                    : "border-slate-200/80 bg-white text-slate-600 hover:border-slate-300"
                }`}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {getTabLabel(tab)} ({formatNumber(tabCounts[tab])})
              </button>
            );
          })}
        </div>

        <div
          aria-hidden={!hasSelection}
          className={`sticky top-4 z-30 mb-5 overflow-hidden transition-all duration-300 ${
            hasSelection
              ? "max-h-32 translate-y-0 opacity-100"
              : "pointer-events-none max-h-0 -translate-y-3 opacity-0"
          }`}
        >
          <div className="flex flex-col gap-4 rounded-[28px] border border-red-100 bg-white/95 px-5 py-4 shadow-[0_20px_45px_rgba(15,23,42,0.12)] backdrop-blur-sm md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-lg font-semibold text-slate-900">
                已选择 {formatNumber(selectedTemplateIds.length)} 项
              </div>
              <div className="mt-1 text-sm text-slate-500">
                仅支持删除自定义模板，确认后 C 端用户将无法继续使用这些模板。
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
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-500 px-5 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(239,68,68,0.24)] transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-70"
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
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <TemplateCardSkeleton key={index} />
            ))}
          </div>
        ) : filteredItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 2xl:grid-cols-3">
            {filteredItems.map((item) => {
              const isSelected = selectedTemplateIds.includes(item.id);
              const isManageable = canManageTemplate(item);
              const isDeleting = mutationKey === `delete:${item.id}`;
              const isBusy = isDeleting || isSaving || isBatchDeleting;

              return (
                <article
                  key={item.id}
                  className={`flex h-full flex-col rounded-[30px] border bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] ${
                    isSelected ? "border-red-300 ring-2 ring-red-200/70" : "border-slate-200/80"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getPlatformBadgeClass(
                          item.platform,
                        )}`}
                      >
                        {item.platform}
                      </span>
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                          item.is_preset ? "bg-blue-50 text-blue-500" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {item.is_preset ? "官方预置" : "自定义"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {isManageable ? (
                        <label className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-slate-200 bg-white">
                          <input
                            checked={isSelected}
                            className="h-4 w-4 rounded border-slate-300 text-red-500 focus:ring-red-300"
                            disabled={isBusy}
                            onChange={() => toggleSelected(item.id)}
                            type="checkbox"
                          />
                        </label>
                      ) : null}
                      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#ff5f6d] to-[#ff9951] text-white">
                        <FileText className="h-5 w-5" />
                      </div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <h2 className="text-[26px] font-bold leading-tight text-slate-900">{item.title}</h2>
                    <p className="mt-2 min-h-[48px] text-sm leading-6 text-slate-500">
                      {item.description.trim() || "该模板暂未填写适用场景描述，可用于沉淀团队可复用的 Prompt 资产。"}
                    </p>
                  </div>

                  <div className="mt-5 rounded-[24px] border border-red-100 bg-red-50/30 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-red-400">
                      PROMPT SNAPSHOT
                    </div>
                    <div
                      className="mt-3 overflow-hidden text-sm leading-6 text-slate-600"
                      style={{
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 5,
                      }}
                    >
                      {getPromptPreview(item.prompt_content)}
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-3">
                    <TemplateStatCard label="使用次数" value={formatNumber(item.usage_count)} />
                    <TemplateStatCard label="评分" value={item.rating.toFixed(1)} />
                    <TemplateStatCard label="创建日期" value={formatTemplateCardDate(item.created_at)} />
                  </div>

                  {isManageable ? (
                    <div className="mt-6 flex gap-3 border-t border-slate-100 pt-4">
                      <button
                        className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#fff2f2] px-4 text-sm font-semibold text-rose-500 transition hover:bg-[#ffe8e8] disabled:cursor-not-allowed disabled:opacity-70"
                        disabled={isBusy}
                        onClick={() => openEditModal(item)}
                        type="button"
                      >
                        <PencilLine className="h-4 w-4" />
                        编辑
                      </button>
                      <button
                        className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 text-sm font-semibold text-red-500 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70"
                        disabled={isBusy}
                        onClick={() => openSingleDeleteConfirm(item)}
                        type="button"
                      >
                        {isDeleting ? (
                          <RefreshCw className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                        删除
                      </button>
                    </div>
                  ) : (
                    <div className="mt-6 border-t border-slate-100 pt-4 text-center text-sm text-slate-400">
                      官方预置模板仅支持查看，不能编辑或删除。
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[30px] border border-slate-200/80 bg-white px-6 py-16 text-center shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-400">
              <FileText className="h-6 w-6" />
            </div>
            <div className="mt-5 text-lg font-semibold text-slate-900">当前分类暂无模板</div>
            <div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
              {emptyStateMessage}
            </div>
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
        className="flex max-h-[min(88vh,960px)] w-full max-w-4xl flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 px-8 py-6">
          <div>
            <div className="text-[18px] font-semibold text-slate-900">
              {isEditMode ? "编辑模板" : "新建模板"}
            </div>
            <div className="mt-2 text-sm leading-6 text-slate-500">
              把你的人设、行业 Prompt 和知识库作用域存下来，下次创建会话时就能一键带入。
            </div>
          </div>
          <button
            aria-label="关闭模板对话框"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              <TemplateField label="模板名称" required>
                <input
                  className={`h-14 w-full rounded-2xl border bg-white px-5 text-sm text-slate-900 outline-none transition focus:ring-4 ${
                    formErrors.title
                      ? "border-red-300 focus:border-red-300 focus:ring-red-100"
                      : "border-slate-200 focus:border-red-300 focus:ring-red-100"
                  }`}
                  onChange={(event) => onChange({ title: event.target.value })}
                  placeholder="例如：法拍房捡漏讲透模板"
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
                  placeholder="一句话说明这个模板适合解决什么问题"
                  type="text"
                  value={form.description}
                />
              </TemplateField>
            </div>

            <TemplateField label="关联知识库">
              <input
                className="h-14 w-full rounded-2xl border border-slate-200 bg-white px-5 text-sm text-slate-900 outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-100"
                onChange={(event) => onChange({ knowledge_base_scope: event.target.value })}
                placeholder="搜索并选择已有知识库，例如：brand_guide_2026"
                type="text"
                value={form.knowledge_base_scope}
              />
              <div className="mt-2 text-xs text-slate-400">
                当前仅作 UI 占位展示，保存时不会提交到后端。
              </div>
            </TemplateField>

            <TemplateField label="系统提示词" required>
              <textarea
                className={`w-full rounded-[26px] border bg-white px-5 py-4 text-sm leading-7 text-slate-900 outline-none transition focus:ring-4 ${
                  formErrors.prompt_content
                    ? "border-red-300 focus:border-red-300 focus:ring-red-100"
                    : "border-slate-200 focus:border-red-300 focus:ring-red-100"
                }`}
                onChange={(event) => onChange({ prompt_content: event.target.value })}
                placeholder="请输入完整的人设、目标受众、语气要求与输出结构。"
                rows={8}
                value={form.prompt_content}
              />
              {formErrors.prompt_content ? (
                <div className="mt-2 text-xs text-red-500">{formErrors.prompt_content}</div>
              ) : null}
            </TemplateField>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-8 py-5">
          <button
            className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-[#ff5f5f] to-[#ff8a45] px-5 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            onClick={onSubmit}
            type="button"
          >
            {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
            保存模板
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateField(props: {
  children: React.ReactNode;
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

function TemplateStatCard(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-4 text-center">
      <div className="text-xs font-medium text-slate-400">{label}</div>
      <div className="mt-2 text-base font-bold text-slate-900">{value}</div>
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
      ? `模板「${confirmState.template.title}」删除后，C 端用户将无法继续使用。该操作不可撤销。`
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
