import { useEffect, useMemo, useRef, useState } from "react";

import {
  Check,
  ChevronDown,
  CircleAlert,
  Crown,
  Lock,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";

import {
  findModelSelection,
  hasPremiumModelAccess,
  isModelLockedForRole,
  PREMIUM_MODEL_ACCESS_DENIED_MESSAGE,
} from "../modelAccess";
import type { AuthenticatedUser, ModelDetail, ModelProvider } from "../types";

type ModelSelectorProps = {
  value: string | null;
  modelProviders: ModelProvider[];
  isLoading?: boolean;
  errorText?: string;
  currentUserRole?: AuthenticatedUser["role"] | null;
  onChange: (modelId: string) => void;
  onReloadModels?: () => void;
  onPremiumUpgradePrompt?: (message: string) => void;
  onUnavailableProviderPrompt?: (message: string) => void;
};

type ProviderBadge = {
  label: string;
  className: string;
};

type DisplayProvider = ModelProvider & {
  displayName: string;
  description: string;
  featureBadge?: ProviderBadge;
};

const MODEL_GROUP_ORDER = [
  "大语言模型",
  "视觉理解",
  "全模态",
  "语音",
  "向量",
  "图像与视频",
];

const PROVIDER_NAMES: Record<string, string> = {
  compatible: "小米 MiMo (Default)",
  dashscope: "阿里百炼 (DashScope)",
  deepseek: "DeepSeek (深度求索)",
  proxy_gpt: "OpenAI (中转集群)",
  openai: "OpenAI",
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  compatible: "默认推荐链路，适合保持当前 MiMo 创作体验。",
  dashscope: "阿里模型矩阵，适合多能力并行探索与扩展。",
  deepseek: "主打高性价比与稳定推理，适合日常高频创作。",
  proxy_gpt: "高阶旗舰推理通道，适合复杂任务与重点内容打磨。",
  openai: "高阶 OpenAI 模型通道，适合重点场景精细化创作。",
};

const PROVIDER_BADGES: Record<string, ProviderBadge> = {
  compatible: {
    label: "默认优选",
    className: "bg-brand-soft text-brand",
  },
  dashscope: {
    label: "模型矩阵",
    className: "bg-violet-100 text-violet-700",
  },
  deepseek: {
    label: "高性价比",
    className: "bg-sky-100 text-sky-700",
  },
  proxy_gpt: {
    label: "旗舰推理",
    className: "bg-amber-100 text-amber-700",
  },
  openai: {
    label: "旗舰推理",
    className: "bg-amber-100 text-amber-700",
  },
};

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function matchesModelQuery(model: ModelDetail, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true;
  }

  return [model.name, model.id, model.model, model.group, ...model.tags]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

function getStatusDotClass(hasModels: boolean): string {
  return hasModels ? "bg-emerald-500" : "bg-muted-foreground/35";
}

function isProviderConfigured(provider: ModelProvider): boolean {
  return provider.status === "configured";
}

function getProviderDisplayName(provider: ModelProvider): string {
  return PROVIDER_NAMES[provider.provider_key] ?? provider.provider;
}

function getProviderDescription(provider: ModelProvider): string {
  return (
    PROVIDER_DESCRIPTIONS[provider.provider_key] ??
    "按能力分组浏览，可直接搜索模型名与能力标签。"
  );
}

function getProviderFeatureBadge(provider: ModelProvider): ProviderBadge | undefined {
  return PROVIDER_BADGES[provider.provider_key];
}

function getSubModelBadges(model: ModelDetail): string[] {
  const lowered = model.model.toLowerCase();
  const badges: string[] = [];

  if (lowered.includes("flash")) {
    badges.push("Flash");
  }
  if (lowered.includes("pro")) {
    badges.push("Pro");
  }

  return badges;
}

function groupProviderModels(
  models: ModelDetail[],
): Array<{ group: string; models: ModelDetail[] }> {
  const grouped = new Map<string, ModelDetail[]>();

  for (const model of models) {
    const existing = grouped.get(model.group) ?? [];
    existing.push(model);
    grouped.set(model.group, existing);
  }

  return Array.from(grouped.entries())
    .sort((left, right) => {
      const leftIndex = MODEL_GROUP_ORDER.indexOf(left[0]);
      const rightIndex = MODEL_GROUP_ORDER.indexOf(right[0]);
      const normalizedLeftIndex =
        leftIndex >= 0 ? leftIndex : MODEL_GROUP_ORDER.length;
      const normalizedRightIndex =
        rightIndex >= 0 ? rightIndex : MODEL_GROUP_ORDER.length;
      return normalizedLeftIndex - normalizedRightIndex;
    })
    .map(([group, groupedModels]) => ({
      group,
      models: groupedModels,
    }));
}

function buildDisplayProviders(providers: ModelProvider[]): DisplayProvider[] {
  return providers.map((provider) => ({
    ...provider,
    displayName: getProviderDisplayName(provider),
    description: getProviderDescription(provider),
    featureBadge: getProviderFeatureBadge(provider),
  }));
}

export function ModelSelector({
  value,
  modelProviders,
  isLoading = false,
  errorText = "",
  currentUserRole,
  onChange,
  onReloadModels,
  onPremiumUpgradePrompt,
  onUnavailableProviderPrompt,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedProviders, setExpandedProviders] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const premiumEligible = hasPremiumModelAccess(currentUserRole);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || modelProviders.length === 0) {
      return;
    }

    const selected = findModelSelection(modelProviders, value);
    if (!selected) {
      return;
    }

    setExpandedProviders((current) => {
      if (current.includes(selected.provider.provider_key)) {
        return current;
      }
      return [selected.provider.provider_key];
    });
  }, [isOpen, modelProviders, value]);

  const providerModelCountMap = useMemo(() => {
    const nextMap = new Map<string, number>();
    for (const provider of modelProviders) {
      nextMap.set(provider.provider_key, provider.models.length);
    }
    return nextMap;
  }, [modelProviders]);

  const selectedModel = useMemo(
    () => findModelSelection(modelProviders, value),
    [modelProviders, value],
  );

  const filteredProviders = useMemo(() => {
    const normalizedSearch = normalizeQuery(searchQuery);

    return buildDisplayProviders(modelProviders)
      .map((provider) => {
        const providerMatches =
          !normalizedSearch ||
          [provider.displayName, provider.description, provider.provider]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch);

        const matchedModels = providerMatches
          ? provider.models
          : provider.models.filter((model) =>
            matchesModelQuery(model, normalizedSearch),
          );

        return {
          ...provider,
          models: matchedModels,
        };
      })
      .filter((provider) => {
        if (!normalizedSearch) {
          return true;
        }

        return (
          provider.models.length > 0 ||
          [provider.displayName, provider.description, provider.provider]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        );
      });
  }, [modelProviders, searchQuery]);

  const expandedProviderSet = useMemo(() => {
    if (normalizeQuery(searchQuery)) {
      return new Set(
        filteredProviders
          .filter((provider) => (providerModelCountMap.get(provider.provider_key) ?? 0) > 0)
          .map((provider) => provider.provider_key),
      );
    }

    return new Set(expandedProviders);
  }, [expandedProviders, filteredProviders, providerModelCountMap, searchQuery]);

  const selectedProviderHasModels = selectedModel
    ? isProviderConfigured(selectedModel.provider) &&
      (providerModelCountMap.get(selectedModel.provider.provider_key) ?? 0) > 0
    : false;
  const buttonTitle = selectedModel?.model.name ?? "选择模型";
  const buttonSubtitle = isLoading
    ? "正在同步后端模型注册表..."
    : selectedModel
      ? `${getProviderDisplayName(selectedModel.provider)} · ${selectedModel.model.group}`
      : "支持搜索、分组浏览与运行时切换";

  const toggleProvider = (providerKey: string) => {
    if ((providerModelCountMap.get(providerKey) ?? 0) === 0) {
      return;
    }

    setExpandedProviders((current) =>
      current.includes(providerKey)
        ? current.filter((item) => item !== providerKey)
        : [...current, providerKey],
    );
  };

  const handleModelClick = (provider: ModelProvider, model: ModelDetail) => {
    if ((providerModelCountMap.get(provider.provider_key) ?? 0) === 0) {
      return;
    }

    if (!isProviderConfigured(provider)) {
      onUnavailableProviderPrompt?.(
        `${getProviderDisplayName(provider)} 当前${provider.status_label}，请先检查后端凭证与 Provider 配置。`,
      );
      return;
    }

    if (isModelLockedForRole(model, currentUserRole)) {
      onPremiumUpgradePrompt?.(PREMIUM_MODEL_ACCESS_DENIED_MESSAGE);
      return;
    }

    onChange(model.id);
    setSearchQuery("");
    setIsOpen(false);
  };

  return (
    <div className="relative z-20 hidden md:block" ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-label="打开模型选择器"
        className="flex w-[310px] items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 text-left text-foreground transition hover:bg-muted xl:w-[340px]"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{buttonTitle}</div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`h-2 w-2 rounded-full ${getStatusDotClass(selectedProviderHasModels)}`}
            />
            <span className="truncate">{buttonSubtitle}</span>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition ${isOpen ? "rotate-180" : ""
            }`}
        />
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[390px] max-w-[calc(100vw-2rem)] rounded-[28px] border border-border bg-background p-4 shadow-xl">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
                <Sparkles className="h-3.5 w-3.5" />
                后端模型注册表
              </div>
              <div className="mt-3 text-lg font-semibold text-foreground">
                选择推理模型
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                当前展示已配置的后端模型目录，并保留运行时切换与默认兜底能力。
              </div>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-2xl border border-border bg-input-background py-3 pl-10 pr-4 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索模型名、能力标签或厂商"
              value={searchQuery}
            />
          </div>

          <div className="mt-4 max-h-[60vh] overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                正在加载模型目录...
              </div>
            ) : null}

            {!isLoading && errorText ? (
              <div className="rounded-2xl border border-danger-foreground/20 bg-danger-surface p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-danger-foreground">
                  <CircleAlert className="h-4 w-4" />
                  模型目录加载失败
                </div>
                <div className="mt-2 text-sm leading-6 text-danger-foreground/90">
                  {errorText}
                </div>
                {onReloadModels ? (
                  <button
                    className="mt-4 inline-flex items-center gap-2 rounded-full border border-danger-foreground/20 bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                    onClick={onReloadModels}
                    type="button"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    重新加载
                  </button>
                ) : null}
              </div>
            ) : null}

            {!isLoading && !errorText && filteredProviders.length === 0 ? (
              <div className="flex min-h-44 items-center justify-center rounded-2xl border border-dashed border-border bg-background px-4 text-sm text-muted-foreground">
                未找到匹配的模型
              </div>
            ) : null}

            {!isLoading && !errorText
              ? filteredProviders.map((provider) => {
                const totalModelCount =
                  providerModelCountMap.get(provider.provider_key) ?? 0;
                const providerConfigured = isProviderConfigured(provider);
                const hasModels = totalModelCount > 0 && providerConfigured;
                const groupedModels = groupProviderModels(provider.models);
                const isExpanded =
                  hasModels && expandedProviderSet.has(provider.provider_key);

                return (
                  <section
                    className="mb-3 rounded-[24px] border border-border bg-card p-3 last:mb-0"
                    key={provider.provider_key}
                  >
                    <button
                      aria-disabled={!hasModels}
                      className={`flex w-full items-center justify-between gap-3 px-1 text-left ${hasModels ? "" : "cursor-not-allowed opacity-70"
                        }`}
                      disabled={!hasModels}
                      onClick={() => toggleProvider(provider.provider_key)}
                      type="button"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {provider.displayName}
                          </div>
                          {provider.featureBadge ? (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${provider.featureBadge.className}`}
                            >
                              {provider.featureBadge.label}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {provider.description}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        <div
                          className={`inline-flex items-center gap-2 rounded-full bg-background px-3 py-1 text-xs ${providerConfigured ? "text-emerald-600" : "text-gray-400"
                            }`}
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${getStatusDotClass(providerConfigured)}`}
                          />
                          {hasModels ? "已配置" : "需要配置"}
                        </div>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-200 ${hasModels
                            ? `text-muted-foreground ${isExpanded ? "rotate-180" : ""}`
                            : "text-gray-300"
                            }`}
                        />
                      </div>
                    </button>

                    <div
                      className={`grid transition-all duration-300 ${isExpanded
                        ? "mt-3 grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                        }`}
                    >
                      <div className="overflow-hidden">
                        {hasModels ? (
                          <div className="space-y-3 border-t border-border/70 pt-3">
                            {groupedModels.map((groupedModel) => (
                              <div
                                className="space-y-2"
                                key={`${provider.provider_key}-${groupedModel.group}`}
                              >
                                <div className="px-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                  {groupedModel.group}
                                </div>

                                <div className="space-y-1">
                                  {groupedModel.models.map((model) => {
                                    const isSelected =
                                      value === model.id || value === model.model;
                                    const isLocked = isModelLockedForRole(
                                      model,
                                      currentUserRole,
                                    );
                                    const subModelBadges = getSubModelBadges(model);
                                    const rowCanSelect = !isLocked;
                                    const LockIcon = premiumEligible ? Crown : Lock;

                                    return (
                                      <button
                                        aria-disabled={!rowCanSelect}
                                        className={`flex w-full items-start justify-between gap-3 rounded-2xl px-3 py-3 text-left transition ${isSelected
                                          ? "bg-primary text-primary-foreground shadow-sm"
                                          : isLocked
                                            ? "bg-muted/40 text-gray-400 hover:bg-amber-50/70"
                                            : "hover:bg-muted"
                                          }`}
                                        key={model.id}
                                        onClick={() => handleModelClick(provider, model)}
                                        type="button"
                                      >
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-sm font-medium">
                                              {model.model}
                                            </span>
                                            {model.name !== model.model ? (
                                              <span
                                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isSelected
                                                  ? "bg-primary-foreground/15 text-primary-foreground"
                                                  : "bg-muted text-muted-foreground"
                                                  }`}
                                              >
                                                {model.name}
                                              </span>
                                            ) : null}
                                            {model.is_default ? (
                                              <span
                                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isSelected
                                                  ? "bg-primary-foreground/15 text-primary-foreground"
                                                  : "bg-brand-soft text-brand"
                                                  }`}
                                              >
                                                默认
                                              </span>
                                            ) : null}
                                            {subModelBadges.map((badge) => (
                                              <span
                                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isSelected
                                                  ? "bg-primary-foreground/15 text-primary-foreground"
                                                  : "bg-slate-100 text-slate-600"
                                                  }`}
                                                key={`${model.id}-${badge}`}
                                              >
                                                {badge}
                                              </span>
                                            ))}
                                            {provider.featureBadge ? (
                                              <span
                                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isSelected
                                                  ? "bg-primary-foreground/15 text-primary-foreground"
                                                  : provider.featureBadge.className
                                                  }`}
                                              >
                                                {provider.featureBadge.label}
                                              </span>
                                            ) : null}
                                            {isLocked ? (
                                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                                <LockIcon className="h-3 w-3" />
                                                Premium
                                              </span>
                                            ) : null}
                                          </div>

                                          <div
                                            className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${isSelected
                                              ? "text-primary-foreground/80"
                                              : isLocked
                                                ? "text-gray-400"
                                                : "text-muted-foreground"
                                              }`}
                                          >
                                            <span className="font-mono">{model.id}</span>
                                            {model.tags.slice(0, 4).map((tag) => (
                                              <span
                                                className={`rounded-full px-2 py-0.5 ${isSelected
                                                  ? "bg-primary-foreground/10 text-primary-foreground"
                                                  : isLocked
                                                    ? "bg-white text-gray-400"
                                                    : "bg-background text-muted-foreground"
                                                  }`}
                                                key={`${model.id}-${tag}`}
                                              >
                                                {tag}
                                              </span>
                                            ))}
                                          </div>
                                        </div>

                                        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                                          {isSelected ? (
                                            <Check className="h-4 w-4" />
                                          ) : isLocked ? (
                                            <LockIcon className="h-4 w-4 text-amber-500" />
                                          ) : null}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="border-t border-border/70 pt-3 text-sm text-gray-400">
                            当前厂商暂无可用模型，请先完成配置。
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                );
              })
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
