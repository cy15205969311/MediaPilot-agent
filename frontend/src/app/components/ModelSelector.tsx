import { useEffect, useMemo, useRef, useState } from "react";

import {
  Check,
  ChevronDown,
  CircleAlert,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";

import { APIError, fetchAvailableModels } from "../api";
import type { ModelDetail, ModelProvider } from "../types";

type ModelSelectorProps = {
  value: string | null;
  onChange: (modelId: string) => void;
};

const MODEL_GROUP_ORDER = [
  "大语言模型",
  "视觉理解",
  "全模态",
  "语音",
  "向量",
  "图像与视频",
];

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

function getStatusDotClass(provider: ModelProvider): string {
  return provider.status === "configured"
    ? "bg-emerald-500"
    : "bg-muted-foreground/35";
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

function findModelSelection(
  providers: ModelProvider[],
  value: string | null,
): { provider: ModelProvider; model: ModelDetail } | null {
  const normalizedValue = (value ?? "").trim();
  if (!normalizedValue) {
    return null;
  }

  for (const provider of providers) {
    for (const model of provider.models) {
      if (model.id === normalizedValue || model.model === normalizedValue) {
        return { provider, model };
      }
    }
  }

  return null;
}

function getPreferredConfiguredModel(providers: ModelProvider[]): ModelDetail | null {
  for (const provider of providers) {
    if (provider.status !== "configured") {
      continue;
    }

    const defaultModel = provider.models.find((model) => model.is_default);
    if (defaultModel) {
      return defaultModel;
    }

    if (provider.models.length > 0) {
      return provider.models[0];
    }
  }

  return null;
}

export function ModelSelector(props: ModelSelectorProps) {
  const { value, onChange } = props;
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);

  const loadModels = async () => {
    setIsLoading(true);
    setErrorText("");
    try {
      const payload = await fetchAvailableModels();
      setProviders(payload.items);
    } catch (error) {
      setProviders([]);
      setErrorText(
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "模型目录加载失败，请稍后重试。",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadModels();
  }, []);

  useEffect(() => {
    if (isLoading || errorText || providers.length === 0) {
      return;
    }

    const selected = findModelSelection(providers, value);
    if (selected && selected.provider.status === "configured") {
      return;
    }

    const fallbackModel = getPreferredConfiguredModel(providers);
    if (!fallbackModel) {
      return;
    }

    if (selected?.model.id === fallbackModel.id || value === fallbackModel.id) {
      return;
    }

    onChange(fallbackModel.id);
  }, [errorText, isLoading, onChange, providers, value]);

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

  const selectedModel = useMemo(() => {
    return findModelSelection(providers, value);
  }, [providers, value]);

  const filteredProviders = useMemo(() => {
    const normalizedSearch = normalizeQuery(searchQuery);
    return providers
      .map((provider) => ({
        ...provider,
        models: provider.models.filter((model) =>
          matchesModelQuery(model, normalizedSearch),
        ),
      }))
      .filter((provider) => provider.models.length > 0);
  }, [providers, searchQuery]);

  const buttonTitle = selectedModel?.model.name ?? "选择模型";
  const buttonSubtitle = isLoading
    ? "正在同步后端模型注册表..."
    : selectedModel
      ? `${selectedModel.provider.provider} · ${selectedModel.model.group}`
      : "支持搜索、分组浏览与状态感知";

  const buttonDotClass = getStatusDotClass(
    selectedModel?.provider ?? {
      provider_key: "dashscope",
      provider: "模型目录",
      status: "unconfigured",
      status_label: "未加载",
      models: [],
    },
  );

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
            <span className={`h-2 w-2 rounded-full ${buttonDotClass}`} />
            <span className="truncate">{buttonSubtitle}</span>
          </div>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition ${
            isOpen ? "rotate-180" : ""
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
                当前展示已配置的后端模型目录，并保留运行时切换与兜底能力。
              </div>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full rounded-2xl border border-border bg-input-background py-3 pl-10 pr-4 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索模型名、能力标签或分组"
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
                <button
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-danger-foreground/20 bg-card px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                  onClick={() => void loadModels()}
                  type="button"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  重新加载
                </button>
              </div>
            ) : null}

            {!isLoading && !errorText && filteredProviders.length === 0 ? (
              <div className="flex min-h-44 items-center justify-center rounded-2xl border border-dashed border-border bg-background px-4 text-sm text-muted-foreground">
                未找到匹配的模型
              </div>
            ) : null}

            {!isLoading && !errorText
              ? filteredProviders.map((provider) => {
                  const groupedModels = groupProviderModels(provider.models);
                  const isConfigured = provider.status === "configured";

                  return (
                    <section
                      className="mb-3 rounded-[24px] border border-border bg-card p-3 last:mb-0"
                      key={provider.provider_key}
                    >
                      <div className="mb-3 flex items-center justify-between gap-3 px-1">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {provider.provider}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            按能力分组浏览，可直接搜索模型名或标签
                          </div>
                        </div>
                        <div className="inline-flex shrink-0 items-center gap-2 rounded-full bg-background px-3 py-1 text-xs text-muted-foreground">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${getStatusDotClass(
                              provider,
                            )}`}
                          />
                          {provider.status_label}
                        </div>
                      </div>

                      <div className="space-y-3">
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
                                return (
                                  <button
                                    className={`flex w-full items-start justify-between gap-3 rounded-2xl px-3 py-3 text-left transition ${
                                      isSelected
                                        ? "bg-primary text-primary-foreground shadow-sm"
                                        : isConfigured
                                          ? "hover:bg-muted"
                                          : "cursor-not-allowed opacity-60"
                                    }`}
                                    disabled={!isConfigured}
                                    key={model.id}
                                    onClick={() => {
                                      onChange(model.id);
                                      setSearchQuery("");
                                      setIsOpen(false);
                                    }}
                                    type="button"
                                  >
                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="truncate text-sm font-medium">
                                          {model.name}
                                        </span>
                                        {model.is_default ? (
                                          <span
                                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                              isSelected
                                                ? "bg-primary-foreground/15 text-primary-foreground"
                                                : "bg-brand-soft text-brand"
                                            }`}
                                          >
                                            默认
                                          </span>
                                        ) : null}
                                      </div>

                                      <div
                                        className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${
                                          isSelected
                                            ? "text-primary-foreground/80"
                                            : "text-muted-foreground"
                                        }`}
                                      >
                                        <span className="font-mono">{model.model}</span>
                                        {model.tags.slice(0, 4).map((tag) => (
                                          <span
                                            className={`rounded-full px-2 py-0.5 ${
                                              isSelected
                                                ? "bg-primary-foreground/10 text-primary-foreground"
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
                                      {isSelected ? <Check className="h-4 w-4" /> : null}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
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
