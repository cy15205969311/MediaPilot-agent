import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileText,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Star,
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
import { formatDate, formatNumber } from "../utils/format";

type AdminTemplatesPageProps = {
  onToast: (toast: AdminToast) => void;
};

type TemplateTabKey = "all" | AdminTemplatePlatform | "custom";
type TemplateDrawerMode = "create" | "edit";
type TemplateMutationKey = null | "drawer-submit" | "batch-delete" | `delete:${string}`;
type TemplateFormErrors = Partial<Record<"title" | "prompt_content", string>>;
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

const theme = {
  primary: "#ef4444",
  secondary: "#fb923c",
  cardBg: "#ffffff",
  cardBorder: "#e2e8f0",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  textMuted: "#94a3b8",
  surface: "#f8fafc",
  overlay: "rgba(15, 23, 42, 0.18)",
};

const TAB_ORDER: TemplateTabKey[] = ["all", "小红书", "抖音", "通用", "custom"];
const PLATFORM_OPTIONS: AdminTemplatePlatform[] = ["小红书", "抖音", "通用"];

function createInitialForm(): AdminTemplateCreatePayload {
  return {
    title: "",
    platform: "小红书",
    description: "",
    prompt_content: "",
  };
}

function createFormFromTemplate(template?: AdminTemplateItem | null): AdminTemplateCreatePayload {
  return {
    title: template?.title ?? "",
    platform: template?.platform ?? "小红书",
    description: template?.description ?? "",
    prompt_content: template?.prompt_content ?? "",
  };
}

function validateTemplateForm(form: AdminTemplateCreatePayload): TemplateFormErrors {
  const errors: TemplateFormErrors = {};

  if (!form.title.trim()) {
    errors.title = "请输入模板名称";
  }

  if (!form.prompt_content.trim()) {
    errors.prompt_content = "请填写 Prompt 内容";
  }

  return errors;
}

function canManageTemplate(template: AdminTemplateItem): boolean {
  return !template.is_preset;
}

function getPlatformTone(platform: AdminTemplatePlatform): {
  badgeBg: string;
  badgeColor: string;
  accent: string;
} {
  if (platform === "小红书") {
    return {
      badgeBg: "#fef2f2",
      badgeColor: "#dc2626",
      accent: "#ef4444",
    };
  }
  if (platform === "抖音") {
    return {
      badgeBg: "#e2e8f0",
      badgeColor: "#0f172a",
      accent: "#0f172a",
    };
  }
  return {
    badgeBg: "#fff7ed",
    badgeColor: "#ea580c",
    accent: "#fb923c",
  };
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

function getPromptPreview(prompt: string, maxLength = 220): string {
  const normalized = prompt.trim();
  if (!normalized) {
    return "Prompt 片段会在这里实时预览。";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
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
    <div
      className="rounded-[28px] border p-6"
      style={{ backgroundColor: theme.cardBg, borderColor: theme.cardBorder }}
    >
      <div className="animate-pulse">
        <div className="flex items-start justify-between gap-3">
          <div className="h-7 w-24 rounded-full bg-slate-100" />
          <div className="h-10 w-10 rounded-2xl bg-slate-100" />
        </div>
        <div className="mt-5 h-6 w-40 rounded-full bg-slate-200" />
        <div className="mt-3 h-4 w-full rounded-full bg-slate-100" />
        <div className="mt-2 h-4 w-5/6 rounded-full bg-slate-100" />
        <div className="mt-6 h-24 rounded-[22px] bg-slate-50" />
        <div className="mt-6 flex gap-3">
          <div className="h-12 flex-1 rounded-2xl bg-slate-100" />
          <div className="h-12 flex-1 rounded-2xl bg-slate-100" />
        </div>
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
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<TemplateDrawerMode>("create");
  const [editingTemplate, setEditingTemplate] = useState<AdminTemplateItem | null>(null);
  const [form, setForm] = useState<AdminTemplateCreatePayload>(createInitialForm);
  const [formErrors, setFormErrors] = useState<TemplateFormErrors>({});
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [deleteConfirmState, setDeleteConfirmState] = useState<DeleteConfirmState | null>(null);

  const items = templatesPayload?.items ?? [];
  const isSaving = mutationKey === "drawer-submit";
  const isBatchDeleting = mutationKey === "batch-delete";

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

  const tabCounts = useMemo(() => {
    return {
      all: items.length,
      小红书: items.filter((item) => item.platform === "小红书").length,
      抖音: items.filter((item) => item.platform === "抖音").length,
      通用: items.filter((item) => item.platform === "通用").length,
      custom: items.filter((item) => canManageTemplate(item)).length,
    } satisfies Record<TemplateTabKey, number>;
  }, [items]);

  const customTemplateCount = tabCounts.custom;
  const presetTemplateCount = items.filter((item) => item.is_preset).length;
  const totalUsageCount = items.reduce((sum, item) => sum + item.usage_count, 0);
  const hasSelection = selectedTemplateIds.length > 0;

  const emptyStateMessage =
    activeTab === "custom"
      ? "当前还没有自定义模板，右上角可以立即新建一份团队通用 Prompt。"
      : activeTab === "all"
        ? "模板库暂时为空，创建后会自动同步到 C 端模板工作台。"
        : `当前分类下还没有 ${getTabLabel(activeTab)} 模板。`;

  const handleRefresh = async () => {
    const payload = await loadTemplates();
    if (!payload) {
      return;
    }

    onToast({
      tone: "success",
      title: "模板库已刷新",
      message: "最新模板卡片、使用热度与共享状态已经同步到当前工作台。",
    });
  };

  const openCreateDrawer = () => {
    setDrawerMode("create");
    setEditingTemplate(null);
    setForm(createInitialForm());
    setFormErrors({});
    setIsDrawerOpen(true);
  };

  const openEditDrawer = (template: AdminTemplateItem) => {
    setDrawerMode("edit");
    setEditingTemplate(template);
    setForm(createFormFromTemplate(template));
    setFormErrors({});
    setIsDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (isSaving) {
      return;
    }
    setIsDrawerOpen(false);
    setEditingTemplate(null);
    setFormErrors({});
  };

  const handleSubmit = async () => {
    const nextErrors = validateTemplateForm(form);
    setFormErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setMutationKey("drawer-submit");

    try {
      const payload = {
        title: form.title.trim(),
        platform: form.platform,
        description: form.description.trim(),
        prompt_content: form.prompt_content.trim(),
      };

      if (drawerMode === "create") {
        await createAdminTemplate(payload);
      } else if (editingTemplate) {
        await updateAdminTemplate(editingTemplate.id, payload);
      }

      await loadTemplates();
      setIsDrawerOpen(false);
      setEditingTemplate(null);
      setForm(createInitialForm());
      setFormErrors({});
      setActiveTab("all");
      onToast({
        tone: "success",
        title: drawerMode === "create" ? "模板创建成功" : "模板更新成功",
        message:
          drawerMode === "create"
            ? "模板已同步到模板库，并会立即出现在 C 端模板选择中。"
            : "模板内容已更新，C 端用户后续使用时会读取最新版本。",
      });
    } catch (error) {
      onToast({
        tone: "error",
        title: drawerMode === "create" ? "模板创建失败" : "模板更新失败",
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
    if (deleteConfirmState?.kind === "single" && mutationKey === `delete:${deleteConfirmState.template.id}`) {
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
            : `已删除 ${response.deleted_count} 个模板，选中状态已自动清空。`,
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
      <div className="p-4 lg:p-6">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: theme.textPrimary }}>
              模板库
            </h1>
            <p className="mt-2 text-sm" style={{ color: theme.textSecondary }}>
              统一管理官方预置模板与运营共享模板，支持创建、编辑、单体删除和批量清理，让模板资产真正形成生命周期闭环。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-red-50"
              onClick={() => {
                void handleRefresh();
              }}
              style={{
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
                color: theme.textSecondary,
              }}
              type="button"
            >
              <RefreshCw className="h-4 w-4" />
              刷新数据
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(239,68,68,0.24)] transition-transform hover:-translate-y-0.5"
              onClick={openCreateDrawer}
              style={{
                background: "linear-gradient(135deg, #ef4444 0%, #fb923c 100%)",
              }}
              type="button"
            >
              <Plus className="h-4 w-4" />
              新建模板
            </button>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[
            {
              label: "模板总数",
              value: formatNumber(items.length),
              hint: "当前共享给团队与 C 端的模板资产总量。",
            },
            {
              label: "自定义模板",
              value: formatNumber(customTemplateCount),
              hint: "由后台运营新建并可继续编辑、清理的模板数量。",
            },
            {
              label: "累计使用",
              value: formatNumber(totalUsageCount),
              hint: `官方预置 ${formatNumber(presetTemplateCount)} 份，持续沉淀可复用 Prompt 资产。`,
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-[28px] border p-5"
              style={{
                backgroundColor: theme.cardBg,
                borderColor: theme.cardBorder,
              }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm" style={{ color: theme.textSecondary }}>
                    {card.label}
                  </div>
                  <div
                    className="mt-3 text-3xl font-bold"
                    style={{ color: theme.textPrimary }}
                  >
                    {card.value}
                  </div>
                  <div className="mt-3 text-sm leading-6" style={{ color: theme.textMuted }}>
                    {card.hint}
                  </div>
                </div>
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: "#fff7ed", color: theme.secondary }}
                >
                  <Sparkles className="h-5 w-5" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          className="rounded-[32px] border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.cardBorder }}
        >
          <div className="border-b px-5 py-5" style={{ borderColor: theme.cardBorder }}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
                  模板资产列表
                </div>
                <div className="mt-1 text-sm" style={{ color: theme.textMuted }}>
                  点击不同平台 Tab 可快速筛选模板类型；勾选后会出现批量操作栏，支持一次性清理废弃模板。
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {TAB_ORDER.map((tab) => {
                  const isActive = activeTab === tab;
                  return (
                    <button
                      key={tab}
                      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors"
                      onClick={() => setActiveTab(tab)}
                      style={{
                        backgroundColor: isActive ? "#fff1f2" : theme.surface,
                        color: isActive ? theme.primary : theme.textSecondary,
                        boxShadow: isActive
                          ? "inset 0 0 0 1px rgba(239, 68, 68, 0.16)"
                          : "inset 0 0 0 1px rgba(226, 232, 240, 0.9)",
                      }}
                      type="button"
                    >
                      <span>{getTabLabel(tab)}</span>
                      <span
                        className="rounded-full px-2 py-0.5 text-xs"
                        style={{
                          backgroundColor: "#ffffff",
                          color: isActive ? theme.primary : theme.textMuted,
                        }}
                      >
                        {formatNumber(tabCounts[tab])}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="p-5">
            <div
              aria-hidden={!hasSelection}
              className={`sticky top-4 z-20 mb-4 overflow-hidden transition-all duration-300 ${
                hasSelection
                  ? "max-h-40 translate-y-0 opacity-100"
                  : "pointer-events-none max-h-0 -translate-y-3 opacity-0"
              }`}
            >
              <div className="rounded-[28px] border border-red-100 bg-white/95 px-5 py-4 shadow-[0_20px_45px_rgba(15,23,42,0.12)] backdrop-blur-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
                      已选择 {formatNumber(selectedTemplateIds.length)} 项
                    </div>
                    <div className="mt-1 text-sm" style={{ color: theme.textMuted }}>
                      仅支持删除自定义共享模板。确认删除后，C 端用户将无法继续使用这些模板。
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="rounded-2xl border px-4 py-3 text-sm font-medium transition-colors hover:bg-slate-50"
                      disabled={isBatchDeleting}
                      onClick={() => setSelectedTemplateIds([])}
                      style={{
                        backgroundColor: theme.cardBg,
                        borderColor: theme.cardBorder,
                        color: theme.textSecondary,
                      }}
                      type="button"
                    >
                      取消选择
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-red-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_32px_rgba(239,68,68,0.24)] transition hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-70"
                      disabled={isBatchDeleting}
                      onClick={openBatchDeleteConfirm}
                      type="button"
                    >
                      {isBatchDeleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      批量删除
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <TemplateCardSkeleton key={index} />
                ))}
              </div>
            ) : filteredItems.length ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {filteredItems.map((item) => {
                  const tone = getPlatformTone(item.platform);
                  const isSelected = selectedTemplateIds.includes(item.id);
                  const isManageable = canManageTemplate(item);
                  const isDeleting = mutationKey === `delete:${item.id}`;
                  const isBusy = isDeleting || isSaving || isBatchDeleting;

                  return (
                    <div
                      key={item.id}
                      className={`group rounded-[28px] border p-6 transition-all hover:-translate-y-0.5 hover:shadow-[0_22px_50px_rgba(15,23,42,0.08)] ${
                        isSelected ? "ring-2 ring-red-300" : ""
                      }`}
                      style={{
                        backgroundColor: theme.cardBg,
                        borderColor: isSelected ? "#fda4af" : theme.cardBorder,
                      }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          {isManageable ? (
                            <label
                              className="mt-0.5 inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-lg border bg-white shadow-sm"
                              style={{ borderColor: isSelected ? "#ef4444" : theme.cardBorder }}
                            >
                              <input
                                checked={isSelected}
                                className="h-4 w-4 rounded border-slate-300 text-red-500 focus:ring-red-400"
                                disabled={isBusy}
                                onChange={() => toggleSelected(item.id)}
                                type="checkbox"
                              />
                            </label>
                          ) : (
                            <div className="mt-1 h-6 w-6" />
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap gap-2">
                              <span
                                className="rounded-full px-3 py-1 text-xs font-semibold"
                                style={{
                                  backgroundColor: tone.badgeBg,
                                  color: tone.badgeColor,
                                }}
                              >
                                {item.platform}
                              </span>
                              <span
                                className="rounded-full px-3 py-1 text-xs font-medium"
                                style={{
                                  backgroundColor: item.is_preset ? "#eff6ff" : "#fff7ed",
                                  color: item.is_preset ? "#2563eb" : "#ea580c",
                                }}
                              >
                                {item.is_preset ? "官方预置" : "自定义共享"}
                              </span>
                            </div>

                            <div
                              className="mt-5 truncate text-xl font-semibold"
                              style={{ color: theme.textPrimary }}
                            >
                              {item.title}
                            </div>
                            <div
                              className="mt-2 min-h-[48px] text-sm leading-6"
                              style={{ color: theme.textSecondary }}
                            >
                              {item.description || "该模板暂未填写描述，适合沉淀团队通用的生成策略与系统指令。"}
                            </div>
                          </div>
                        </div>

                        <div
                          className="flex h-11 w-11 items-center justify-center rounded-2xl"
                          style={{
                            backgroundColor: `${tone.accent}14`,
                            color: tone.accent,
                          }}
                        >
                          <FileText className="h-5 w-5" />
                        </div>
                      </div>

                      <div
                        className="mt-5 rounded-[24px] border p-4"
                        style={{
                          backgroundColor: "#fffdfa",
                          borderColor: "#fee2e2",
                        }}
                      >
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-red-400">
                          Prompt Snapshot
                        </div>
                        <div
                          className="mt-3 whitespace-pre-wrap break-words text-sm leading-6"
                          style={{ color: theme.textSecondary }}
                        >
                          {getPromptPreview(item.prompt_content)}
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-3 gap-3">
                        <div
                          className="rounded-2xl border px-4 py-3"
                          style={{
                            backgroundColor: theme.surface,
                            borderColor: theme.cardBorder,
                          }}
                        >
                          <div className="text-xs uppercase tracking-[0.18em]" style={{ color: theme.textMuted }}>
                            使用次数
                          </div>
                          <div className="mt-2 text-lg font-semibold" style={{ color: theme.textPrimary }}>
                            {formatNumber(item.usage_count)}
                          </div>
                        </div>

                        <div
                          className="rounded-2xl border px-4 py-3"
                          style={{
                            backgroundColor: theme.surface,
                            borderColor: theme.cardBorder,
                          }}
                        >
                          <div className="text-xs uppercase tracking-[0.18em]" style={{ color: theme.textMuted }}>
                            评分
                          </div>
                          <div
                            className="mt-2 inline-flex items-center gap-1 text-lg font-semibold"
                            style={{ color: theme.textPrimary }}
                          >
                            <Star className="h-4 w-4 fill-current text-amber-400" />
                            {item.rating.toFixed(1)}
                          </div>
                        </div>

                        <div
                          className="rounded-2xl border px-4 py-3"
                          style={{
                            backgroundColor: theme.surface,
                            borderColor: theme.cardBorder,
                          }}
                        >
                          <div className="text-xs uppercase tracking-[0.18em]" style={{ color: theme.textMuted }}>
                            创建日期
                          </div>
                          <div className="mt-2 text-sm font-semibold" style={{ color: theme.textPrimary }}>
                            {formatDate(item.created_at)}
                          </div>
                        </div>
                      </div>

                      {isManageable ? (
                        <div className="mt-6 flex gap-3">
                          <button
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
                            disabled={isBusy}
                            onClick={() => openEditDrawer(item)}
                            style={{
                              backgroundColor: theme.cardBg,
                              borderColor: theme.cardBorder,
                              color: theme.textPrimary,
                            }}
                            type="button"
                          >
                            <PencilLine className="h-4 w-4" />
                            编辑
                          </button>
                          <button
                            className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-70"
                            disabled={isBusy}
                            onClick={() => openSingleDeleteConfirm(item)}
                            type="button"
                          >
                            {isDeleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            删除
                          </button>
                        </div>
                      ) : (
                        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm" style={{ color: theme.textSecondary }}>
                          官方预置模板仅支持查看，不能编辑或删除。
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                className="rounded-[28px] border px-6 py-16 text-center"
                style={{
                  backgroundColor: theme.surface,
                  borderColor: theme.cardBorder,
                }}
              >
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-red-400 shadow-sm">
                  <Sparkles className="h-6 w-6" />
                </div>
                <div className="mt-5 text-lg font-semibold" style={{ color: theme.textPrimary }}>
                  当前分类暂无模板
                </div>
                <div className="mx-auto mt-2 max-w-xl text-sm leading-6" style={{ color: theme.textMuted }}>
                  {emptyStateMessage}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <TemplateCreateDrawer
        form={form}
        formErrors={formErrors}
        isOpen={isDrawerOpen}
        isSubmitting={isSaving}
        mode={drawerMode}
        onChange={(patch) => {
          setForm((current) => ({ ...current, ...patch }));
          if (patch.title !== undefined || patch.prompt_content !== undefined) {
            setFormErrors((current) => ({
              ...current,
              ...(patch.title !== undefined ? { title: undefined } : {}),
              ...(patch.prompt_content !== undefined ? { prompt_content: undefined } : {}),
            }));
          }
        }}
        onClose={closeDrawer}
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

type TemplateCreateDrawerProps = {
  form: AdminTemplateCreatePayload;
  formErrors: TemplateFormErrors;
  isOpen: boolean;
  isSubmitting: boolean;
  mode: TemplateDrawerMode;
  onChange: (patch: Partial<AdminTemplateCreatePayload>) => void;
  onClose: () => void;
  onSubmit: () => void;
};

function TemplateCreateDrawer(props: TemplateCreateDrawerProps) {
  const { form, formErrors, isOpen, isSubmitting, mode, onChange, onClose, onSubmit } = props;

  if (!isOpen) {
    return null;
  }

  const isEditMode = mode === "edit";
  const title = isEditMode ? "编辑模板" : "新建模板";
  const description = isEditMode
    ? "修改后会立即覆盖共享模板库中的内容，C 端用户后续使用时将读取最新版本。"
    : "创建后会立即写入共享模板库，并同步到 C 端模板选择器。";

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 z-[60] w-full max-w-2xl">
        <div
          className="flex h-full translate-x-0 flex-col border-l shadow-[0_24px_80px_rgba(15,23,42,0.18)] transition-transform duration-300"
          style={{
            backgroundColor: theme.cardBg,
            borderColor: theme.cardBorder,
          }}
        >
          <div
            className="flex items-center justify-between border-b px-6 py-5"
            style={{ borderColor: theme.cardBorder }}
          >
            <div>
              <div className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
                {title}
              </div>
              <div className="mt-1 text-sm" style={{ color: theme.textMuted }}>
                {description}
              </div>
            </div>
            <button
              className="rounded-full p-2 transition-colors hover:bg-red-50"
              onClick={onClose}
              type="button"
            >
              <X className="h-5 w-5" style={{ color: theme.textMuted }} />
            </button>
          </div>

          <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6 overflow-y-auto px-6 py-6">
              <div>
                <label
                  className="mb-2 block text-sm font-medium"
                  style={{ color: theme.textPrimary }}
                >
                  模板名称
                </label>
                <input
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                  onChange={(event) => onChange({ title: event.target.value })}
                  placeholder="如：小红书种草笔记"
                  style={{
                    backgroundColor: theme.surface,
                    borderColor: formErrors.title ? "#fca5a5" : theme.cardBorder,
                    color: theme.textPrimary,
                  }}
                  type="text"
                  value={form.title}
                />
                {formErrors.title ? (
                  <div className="mt-2 text-xs text-red-500">{formErrors.title}</div>
                ) : null}
              </div>

              <div>
                <div className="mb-3 text-sm font-medium" style={{ color: theme.textPrimary }}>
                  适用平台
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {PLATFORM_OPTIONS.map((option) => {
                    const isSelected = form.platform === option;
                    const tone = getPlatformTone(option);
                    return (
                      <button
                        key={option}
                        className="rounded-[22px] border px-4 py-4 text-left transition"
                        onClick={() => onChange({ platform: option })}
                        style={{
                          backgroundColor: isSelected ? tone.badgeBg : "#ffffff",
                          borderColor: isSelected ? tone.accent : theme.cardBorder,
                          boxShadow: isSelected
                            ? "0 16px 32px rgba(248, 113, 113, 0.12)"
                            : "none",
                        }}
                        type="button"
                      >
                        <div className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
                          {option}
                        </div>
                        <div className="mt-2 text-xs leading-5" style={{ color: theme.textMuted }}>
                          {option === "小红书"
                            ? "适合图文种草、笔记结构和情绪价值表达。"
                            : option === "抖音"
                              ? "适合短视频口播、脚本节奏和镜头引导。"
                              : "适合双端复用，或更通用的系统指令沉淀。"}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  className="mb-2 block text-sm font-medium"
                  style={{ color: theme.textPrimary }}
                >
                  简短描述
                </label>
                <input
                  className="w-full rounded-2xl border px-4 py-3 text-sm outline-none"
                  onChange={(event) => onChange({ description: event.target.value })}
                  placeholder="一句话说明这个模板适合什么场景"
                  style={{
                    backgroundColor: theme.surface,
                    borderColor: theme.cardBorder,
                    color: theme.textPrimary,
                  }}
                  type="text"
                  value={form.description}
                />
              </div>

              <div>
                <label
                  className="mb-2 block text-sm font-medium"
                  style={{ color: theme.textPrimary }}
                >
                  系统指令 / Prompt 内容
                </label>
                <textarea
                  className="min-h-[280px] w-full rounded-[24px] border px-4 py-4 text-sm leading-6 outline-none"
                  onChange={(event) => onChange({ prompt_content: event.target.value })}
                  placeholder="请输入系统提示词，例如：你是一名擅长把真实体验写成高转化率种草内容的内容策划师……"
                  style={{
                    backgroundColor: theme.surface,
                    borderColor: formErrors.prompt_content ? "#fca5a5" : theme.cardBorder,
                    color: theme.textPrimary,
                  }}
                  value={form.prompt_content}
                />
                {formErrors.prompt_content ? (
                  <div className="mt-2 text-xs text-red-500">{formErrors.prompt_content}</div>
                ) : null}
              </div>
            </div>

            <aside className="border-t border-red-100 bg-gradient-to-br from-[#fff8f4] via-white to-[#fff2ea] px-6 py-6 lg:border-l lg:border-t-0">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-orange-400">
                Sync Preview
              </div>

              <div className="mt-5 space-y-4">
                <PreviewMetric
                  label="同步范围"
                  value="Admin 模板库 + C 端工作台"
                />
                <PreviewMetric label="适用平台" value={form.platform || "待选择"} />
                <PreviewMetric
                  label="当前模式"
                  value={isEditMode ? "编辑并覆盖共享模板" : "新建并立即同步"}
                />
              </div>

              <div className="mt-5 rounded-[24px] border border-orange-100 bg-white/90 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                <div className="text-sm font-semibold" style={{ color: theme.textPrimary }}>
                  卡片预览
                </div>
                <div className="mt-3">
                  <span
                    className="rounded-full px-3 py-1 text-xs font-semibold"
                    style={{
                      backgroundColor: getPlatformTone(form.platform).badgeBg,
                      color: getPlatformTone(form.platform).badgeColor,
                    }}
                  >
                    {form.platform}
                  </span>
                </div>
                <div className="mt-4 text-lg font-semibold text-slate-900">
                  {form.title.trim() || "待命名模板"}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-500">
                  {form.description.trim() || "这里会展示模板的一句话描述，帮助运营快速理解用途。"}
                </div>
                <div className="mt-4 rounded-2xl bg-[#fff8f4] px-4 py-4 text-sm leading-6 text-slate-500">
                  {getPromptPreview(form.prompt_content, 140)}
                </div>
              </div>

              <div className="mt-5 rounded-[24px] border border-slate-200 bg-white/90 p-5 text-sm leading-6 text-slate-500 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                {isEditMode
                  ? "保存后将直接更新当前共享模板，后续所有使用该模板的用户都会看到新的标题、描述和 Prompt。"
                  : "新建的模板会作为共享模板落库，并和官方预置模板一起出现在 C 端模板选择列表中。"}
              </div>
            </aside>
          </div>

          <div
            className="flex items-center justify-end gap-3 border-t px-6 py-5"
            style={{ borderColor: theme.cardBorder }}
          >
            <button
              className="h-11 rounded-xl bg-slate-100 px-5 text-sm font-medium text-slate-600 transition hover:bg-slate-200"
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isSubmitting}
              onClick={onSubmit}
              style={{
                background: "linear-gradient(135deg, #ef4444 0%, #fb923c 100%)",
              }}
              type="button"
            >
              {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : null}
              {isEditMode ? "保存修改" : "保存模板"}
            </button>
          </div>
        </div>
      </div>
    </>
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
      : `即将删除已选的 ${confirmState.count} 个模板。删除后，C 端用户将无法继续使用这些模板，且无法恢复。`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/20 p-4 backdrop-blur-[2px]">
      <div
        className="w-full max-w-md rounded-[28px] border bg-white p-6 shadow-[0_28px_80px_rgba(15,23,42,0.18)]"
        style={{ borderColor: theme.cardBorder }}
      >
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold" style={{ color: theme.textPrimary }}>
              {title}
            </div>
            <div className="mt-2 text-sm leading-6" style={{ color: theme.textSecondary }}>
              {description}
            </div>
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

function PreviewMetric(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <div className="rounded-2xl bg-white/90 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}
