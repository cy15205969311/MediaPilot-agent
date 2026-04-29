import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";

import {
  BookOpenText,
  Database,
  FileText,
  FileUp,
  FolderOpen,
  Eye,
  LoaderCircle,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";

import type {
  KnowledgeScopeItem,
  KnowledgeScopeSourceItem,
  KnowledgeSourcePreviewApiResponse,
} from "../../types";

type KnowledgeViewProps = {
  scopes: KnowledgeScopeItem[];
  isLoading: boolean;
  isMutating: boolean;
  mutatingScope: string | null;
  onDeleteScope: (scope: string) => Promise<boolean>;
  onDeleteSource: (scope: string, source: string) => Promise<boolean>;
  onLoadScopeSources: (scope: string) => Promise<KnowledgeScopeSourceItem[] | null>;
  onPreviewSource: (
    scope: string,
    source: string,
  ) => Promise<KnowledgeSourcePreviewApiResponse | null>;
  onRenameScope: (scope: string, nextScopeName: string) => Promise<string | null>;
  onUploadFiles: (scope: string, files: File[]) => Promise<void>;
};

function formatUpdatedAt(value?: string | null): string {
  if (!value) {
    return "刚刚更新";
  }
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

export function KnowledgeView(props: KnowledgeViewProps) {
  const {
    scopes,
    isLoading,
    isMutating,
    mutatingScope,
    onDeleteScope,
    onDeleteSource,
    onLoadScopeSources,
    onPreviewSource,
    onRenameScope,
    onUploadFiles,
  } = props;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scopeFileInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const sourceRequestIdRef = useRef(0);
  const [scopeInput, setScopeInput] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [editingScope, setEditingScope] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [selectedScopeName, setSelectedScopeName] = useState<string | null>(null);
  const [selectedScopeSources, setSelectedScopeSources] = useState<KnowledgeScopeSourceItem[]>([]);
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [previewSourceName, setPreviewSourceName] = useState<string | null>(null);
  const [sourcePreview, setSourcePreview] = useState<KnowledgeSourcePreviewApiResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");

  useEffect(() => {
    if (!editingScope) {
      return;
    }
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [editingScope]);

  const filteredScopes = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLowerCase();
    if (!normalizedSearch) {
      return scopes;
    }
    return scopes.filter((scope) =>
      [scope.scope, `${scope.chunk_count}`, `${scope.source_count}`]
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [scopes, searchValue]);

  const selectedScopeSummary = useMemo(
    () => scopes.find((scope) => scope.scope === selectedScopeName) ?? null,
    [scopes, selectedScopeName],
  );

  const handleFileSelection = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    await onUploadFiles(scopeInput, Array.from(files));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleScopedFileSelection = async (files: FileList | null) => {
    if (!selectedScopeName || !files || files.length === 0) {
      return;
    }
    await onUploadFiles(selectedScopeName, Array.from(files));
    if (scopeFileInputRef.current) {
      scopeFileInputRef.current.value = "";
    }
    await refreshScopeSources(selectedScopeName);
  };

  const handleDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    await handleFileSelection(event.dataTransfer.files);
  };

  const handleDeleteScope = async (scope: string) => {
    const confirmed = window.confirm(
      `确认清空知识库 Scope「${scope}」吗？此操作会删除该 Scope 下的全部文本切片。`,
    );
    if (!confirmed) {
      return;
    }
    const deleted = await onDeleteScope(scope);
    if (deleted && selectedScopeName === scope) {
      setSelectedScopeName(null);
      setSelectedScopeSources([]);
      setSourceError("");
      setPreviewSourceName(null);
      setSourcePreview(null);
      setPreviewError("");
    }
  };

  const refreshScopeSources = async (scope: string) => {
    const requestId = sourceRequestIdRef.current + 1;
    sourceRequestIdRef.current = requestId;
    setIsLoadingSources(true);
    setSourceError("");

    const items = await onLoadScopeSources(scope);
    if (sourceRequestIdRef.current !== requestId) {
      return;
    }

    if (items) {
      setSelectedScopeSources(items);
      setSourceError("");
    } else {
      setSelectedScopeSources([]);
      setSourceError("加载文件明细失败，请稍后重试。");
    }
    setIsLoadingSources(false);
  };

  const openScopeDetails = async (scope: string) => {
    setSelectedScopeName(scope);
    setSelectedScopeSources([]);
    setSourceError("");
    setPreviewSourceName(null);
    setSourcePreview(null);
    setPreviewError("");
    await refreshScopeSources(scope);
  };

  const closeScopeDetails = () => {
    sourceRequestIdRef.current += 1;
    setSelectedScopeName(null);
    setSelectedScopeSources([]);
    setSourceError("");
    setIsLoadingSources(false);
    setPreviewSourceName(null);
    setSourcePreview(null);
    setPreviewError("");
    setIsLoadingPreview(false);
  };

  const startRename = (scope: string) => {
    setEditingScope(scope);
    setRenameValue(scope);
  };

  const cancelRename = () => {
    setEditingScope(null);
    setRenameValue("");
  };

  const submitRename = async (scope: string) => {
    if (editingScope !== scope || isMutating) {
      return;
    }

    const nextScopeName = renameValue.trim();
    if (!nextScopeName) {
      cancelRename();
      return;
    }

    const renamedScope = await onRenameScope(scope, nextScopeName);
    if (!renamedScope) {
      return;
    }

    setEditingScope(null);
    setRenameValue("");

    if (selectedScopeName === scope) {
      setSelectedScopeName(renamedScope);
      await refreshScopeSources(renamedScope);
    }
  };

  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>, scope: string) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submitRename(scope);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  };

  const handleDeleteSource = async (scope: string, source: string) => {
    const confirmed = window.confirm(
      `确认从 Scope「${scope}」移除文件「${source}」吗？系统会删除该文件对应的全部知识切片。`,
    );
    if (!confirmed) {
      return;
    }

    const deleted = await onDeleteSource(scope, source);
    if (deleted) {
      if (previewSourceName === source) {
        setPreviewSourceName(null);
        setSourcePreview(null);
        setPreviewError("");
      }
      await refreshScopeSources(scope);
    }
  };

  const handlePreviewSource = async (scope: string, source: string) => {
    if (isLoadingPreview && previewSourceName === source) {
      return;
    }

    if (sourcePreview?.source === source && previewSourceName === source) {
      setPreviewSourceName(null);
      setSourcePreview(null);
      setPreviewError("");
      return;
    }

    setPreviewSourceName(source);
    setSourcePreview(null);
    setPreviewError("");
    setIsLoadingPreview(true);

    const preview = await onPreviewSource(scope, source);
    if (preview) {
      setSourcePreview(preview);
      setPreviewError("");
    } else {
      setSourcePreview(null);
      setPreviewError("加载切片预览失败，请稍后重试。");
    }
    setIsLoadingPreview(false);
  };

  return (
    <>
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
        data-testid="knowledge-view"
      >
        <div className="border-b border-border bg-surface-elevated px-4 py-4 backdrop-blur-sm lg:px-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  知识库工作台
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  为模板和会话绑定私有资料，把品牌语气、产品参数和行业手册沉淀成可检索的外挂知识。
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                当前仅支持 `.txt` / `.md` 文件，系统会自动切分为约 500 字左右的知识块。
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,320px)_1fr]">
              <label className="relative block">
                <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Scope 名称
                </span>
                <input
                  className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                  onChange={(event) => setScopeInput(event.target.value)}
                  placeholder="例如：brand_guide_2026"
                  value={scopeInput}
                />
              </label>

              <label
                className={`flex min-h-[132px] cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed px-6 py-6 text-center transition ${
                  isDragging
                    ? "border-brand bg-brand-soft"
                    : "border-border bg-card hover:border-brand/40 hover:bg-surface-tint"
                } ${isMutating ? "pointer-events-none opacity-60" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => void handleDrop(event)}
              >
                <input
                  ref={fileInputRef}
                  accept=".txt,.md,.markdown,text/plain,text/markdown"
                  className="hidden"
                  multiple
                  onChange={(event) => void handleFileSelection(event.target.files)}
                  type="file"
                />
                <div className="mb-3 rounded-2xl bg-primary/10 p-3 text-primary">
                  <FileUp className="h-6 w-6" />
                </div>
                <div className="text-base font-semibold text-foreground">
                  拖拽文件到这里，或点击选择资料上传
                </div>
                <div className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  如果不填写 Scope，系统会自动使用文件名生成一个新的 Scope；如果填写了 Scope，
                  则会把文件切片追加到该知识库里。
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-hidden px-4 py-4 lg:px-6">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label className="relative block max-w-xl flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className="w-full rounded-2xl border border-border bg-input-background px-11 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="搜索 Scope 或切片数量"
                value={searchValue}
              />
            </label>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Database className="h-4 w-4" />
              <span>当前共 {scopes.length} 个用户私有 Scope</span>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={`knowledge-skeleton-${index}`}
                    className="rounded-[28px] border border-border bg-card p-5"
                  >
                    <div className="mb-4 h-5 w-1/2 animate-pulse rounded bg-surface-subtle" />
                    <div className="mb-3 h-4 w-2/3 animate-pulse rounded bg-surface-subtle" />
                    <div className="h-20 animate-pulse rounded-2xl bg-surface-subtle" />
                  </div>
                ))}
              </div>
            ) : null}

            {!isLoading && filteredScopes.length === 0 ? (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-[32px] border border-dashed border-border bg-card px-6 text-center">
                <div className="mb-4 rounded-3xl bg-surface-tint p-4 text-brand">
                  <BookOpenText className="h-8 w-8" />
                </div>
                <div className="text-xl font-semibold text-foreground">知识库还没有内容</div>
                <div className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  上传品牌语气规范、产品参数、培训资料或研究笔记后，这里会按 Scope
                  展示切片数量，供模板和会话安全检索。
                </div>
              </div>
            ) : null}

            {!isLoading && filteredScopes.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filteredScopes.map((scope) => {
                  const isWorking = mutatingScope === scope.scope;
                  const isEditing = editingScope === scope.scope;
                  return (
                    <article
                      key={scope.scope}
                      className="rounded-[28px] border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {isEditing ? (
                            <>
                              <input
                                ref={renameInputRef}
                                aria-label={`重命名知识库 Scope ${scope.scope}`}
                                className="w-full rounded-2xl border border-brand/40 bg-input-background px-3 py-2 text-sm font-semibold text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-soft"
                                disabled={isMutating}
                                onBlur={() => void submitRename(scope.scope)}
                                onChange={(event) => setRenameValue(event.target.value)}
                                onKeyDown={(event) => handleRenameKeyDown(event, scope.scope)}
                                value={renameValue}
                              />
                              <div className="mt-2 text-xs text-muted-foreground">
                                失焦或按 Enter 保存，Esc 取消；保存时会自动规范化为 snake_case。
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="truncate text-lg font-semibold text-foreground">
                                {scope.scope}
                              </div>
                              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                                私有知识 Scope
                              </div>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <button
                              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={isMutating}
                              onClick={cancelRename}
                              onMouseDown={(event) => event.preventDefault()}
                              type="button"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          ) : (
                            <>
                              <button
                                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border text-muted-foreground transition hover:border-brand/30 hover:bg-brand-soft hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={isMutating}
                                onClick={() => startRename(scope.scope)}
                                type="button"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border text-muted-foreground transition hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={isMutating}
                                onClick={() => void handleDeleteScope(scope.scope)}
                                type="button"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <button
                        className="block w-full text-left disabled:cursor-not-allowed"
                        disabled={isMutating || isEditing}
                        onClick={() => void openScopeDetails(scope.scope)}
                        type="button"
                      >
                        <div className="rounded-[24px] bg-surface-tint p-4 transition hover:bg-surface-muted">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <FolderOpen className="h-4 w-4 text-brand" />
                            <span>{scope.chunk_count} 个知识切片</span>
                          </div>
                          <div className="mt-2 text-sm text-muted-foreground">
                            来源文件数：{scope.source_count}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            最后更新：{formatUpdatedAt(scope.updated_at)}
                          </div>
                        </div>

                        <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                          <span>{isWorking ? "正在处理…" : "点击查看文件明细与精细化管理"}</span>
                          <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
                            tenant-safe
                          </span>
                        </div>
                      </button>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {selectedScopeName ? (
        <div className="fixed inset-0 z-50 bg-overlay" onClick={closeScopeDetails}>
          <div
            className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-border bg-card p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-xl font-semibold text-foreground">
                  知识库明细 - {selectedScopeName}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  按源文件聚合展示当前 Scope 内的上传资料，并支持精确删除单文件。
                </div>
              </div>
              <button
                aria-label="关闭知识库明细"
                className="rounded-xl p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                onClick={closeScopeDetails}
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-[24px] border border-border bg-surface-muted p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <FolderOpen className="h-4 w-4 text-brand" />
                <span>{selectedScopeSummary?.chunk_count ?? selectedScopeSources.length} 个知识切片</span>
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                聚合源文件数：{selectedScopeSummary?.source_count ?? selectedScopeSources.length}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                最后更新：{formatUpdatedAt(selectedScopeSummary?.updated_at)}
              </div>
            </div>

            <label
              className={`mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-[24px] border border-dashed border-brand/30 bg-brand-soft/60 px-4 py-4 transition hover:border-brand hover:bg-brand-soft ${
                isMutating ? "pointer-events-none opacity-60" : ""
              }`}
            >
              <input
                ref={scopeFileInputRef}
                accept=".txt,.md,.markdown,text/plain,text/markdown"
                className="hidden"
                multiple
                onChange={(event) => void handleScopedFileSelection(event.target.files)}
                type="file"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FileUp className="h-4 w-4 text-brand" />
                  上传/覆盖到此知识库
                </div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  自动绑定 Scope「{selectedScopeName}」；同名文件会先删除旧切片再写入新版本。
                </div>
              </div>
              <span className="shrink-0 rounded-2xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
                选择文件
              </span>
            </label>

            <div className="mt-6 min-h-0 flex-1 overflow-y-auto">
              {isLoadingSources ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={`knowledge-source-skeleton-${index}`}
                      className="rounded-[24px] border border-border bg-card p-4"
                    >
                      <div className="mb-3 h-4 w-2/3 animate-pulse rounded bg-surface-subtle" />
                      <div className="h-3 w-1/3 animate-pulse rounded bg-surface-subtle" />
                    </div>
                  ))}
                </div>
              ) : null}

              {!isLoadingSources && sourceError ? (
                <div className="rounded-[24px] border border-dashed border-destructive/30 bg-destructive/5 px-5 py-6 text-sm leading-6 text-destructive">
                  {sourceError}
                </div>
              ) : null}

              {!isLoadingSources && !sourceError && selectedScopeSources.length === 0 ? (
                <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[28px] border border-dashed border-border bg-card px-6 text-center">
                  <div className="mb-4 rounded-3xl bg-surface-tint p-4 text-brand">
                    <FileText className="h-8 w-8" />
                  </div>
                  <div className="text-lg font-semibold text-foreground">这个 Scope 里还没有源文件</div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">
                    可以直接使用上方按钮上传文件到当前 Scope，无需手动输入知识库名称。
                  </div>
                </div>
              ) : null}

              {!isLoadingSources && !sourceError && selectedScopeSources.length > 0 ? (
                <div className="space-y-3">
                  {selectedScopeSources.map((source) => {
                    const isPreviewOpen = previewSourceName === source.filename;
                    return (
                    <div
                      key={source.filename}
                      className="rounded-[24px] border border-border bg-card p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-foreground">
                            {source.filename}
                          </div>
                          <div className="mt-2 text-sm text-muted-foreground">
                            共 {source.chunk_count} 个知识切片
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                          <button
                            className="inline-flex items-center gap-2 rounded-2xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-brand/30 hover:bg-brand-soft hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isLoadingPreview || (isMutating && mutatingScope === selectedScopeName)}
                            onClick={() => void handlePreviewSource(selectedScopeName, source.filename)}
                            type="button"
                          >
                            {isLoadingPreview && isPreviewOpen ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                            {isPreviewOpen ? "收起预览" : "预览"}
                          </button>

                          <button
                            className="inline-flex items-center gap-2 rounded-2xl border border-destructive/20 px-3 py-2 text-sm font-medium text-destructive transition hover:bg-destructive/5 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isMutating && mutatingScope === selectedScopeName}
                            onClick={() =>
                              void handleDeleteSource(selectedScopeName, source.filename)
                            }
                            type="button"
                          >
                            {isMutating && mutatingScope === selectedScopeName ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                            移除该文件
                          </button>
                        </div>
                      </div>

                      {isPreviewOpen ? (
                        <div className="mt-4 rounded-[20px] border border-border bg-surface-muted p-4">
                          {previewError ? (
                            <div className="text-sm text-destructive">{previewError}</div>
                          ) : null}

                          {isLoadingPreview ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                              正在加载切片预览…
                            </div>
                          ) : null}

                          {!isLoadingPreview && sourcePreview ? (
                            <div>
                              <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                <span className="truncate">{sourcePreview.source}</span>
                                <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
                                  {sourcePreview.chunk_count} chunks
                                </span>
                              </div>
                              <pre className="prose dark:prose-invert max-h-[420px] max-w-none overflow-auto whitespace-pre-wrap rounded-2xl bg-card px-4 py-3 font-sans text-sm leading-7 text-foreground">
                                {sourcePreview.content}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
