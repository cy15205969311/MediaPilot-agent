import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Image as ImageIcon,
  RefreshCw,
  Sparkles,
  User,
  Video,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { RefObject } from "react";

import type {
  ArtifactPayload,
  AuthenticatedUser,
  ConversationMessage,
  MediaChatMaterialPayload,
  ToolCallTraceItem,
} from "../types";
import { CitationAuditPanel } from "./CitationAuditPanel";
import { CopyButton } from "./CopyButton";
import { buildAbsoluteUrl, formatChatTimestamp, getDisplayName } from "../utils";

type ChatFeedProps = {
  currentUser: AuthenticatedUser | null;
  messages: ConversationMessage[];
  artifact: ArtifactPayload | null;
  toolCallTimeline: ToolCallTraceItem[];
  isStreaming: boolean;
  isLoadingHistory?: boolean;
  endRef: RefObject<HTMLDivElement>;
  onSaveArtifactAsTemplate?: () => void;
};

const TOOL_LABEL_MAP: Record<string, string> = {
  parse_materials: "整理附件素材",
  parse_document: "解析文档内容",
  video_transcription: "转写视频语音",
  ocr: "识别图片文字",
  web_search: "检索全网信息",
  retrieve_knowledge_base: "检索知识库",
  analyze_market_trends: "分析市场趋势",
  generate_content_outline: "生成内容大纲",
  generate_draft: "生成正文草稿",
  review_draft: "审查草稿质量",
  format_artifact: "整理结构化产物",
};

const STATUS_LABEL_MAP: Record<string, string> = {
  processing: "进行中",
  completed: "已完成",
  passed: "已通过",
  skipped: "已跳过",
  fallback: "已降级",
  failed: "失败",
  timeout: "超时",
  retry: "重试中",
  max_retries: "达到上限",
};

function materialLabel(material: MediaChatMaterialPayload): string {
  return material.text || material.url || "附件";
}

function isThinkingStepPending(status: string): boolean {
  return status === "processing" || status === "retry";
}

function getThinkingStepLabel(name: string): string {
  return TOOL_LABEL_MAP[name] ?? name;
}

function getThinkingStepStatusLabel(status: string): string {
  return STATUS_LABEL_MAP[status] ?? status;
}

function getThinkingStepBadgeClass(status: string): string {
  if (status === "failed" || status === "timeout" || status === "max_retries") {
    return "bg-danger-surface text-danger-foreground";
  }
  if (status === "processing" || status === "retry") {
    return "bg-brand-soft text-brand";
  }
  if (status === "fallback") {
    return "bg-warning-surface text-warning-foreground";
  }
  return "bg-success-surface text-success-foreground";
}

function renderThinkingStepIcon(status: string) {
  if (status === "failed" || status === "timeout" || status === "max_retries") {
    return <AlertCircle className="h-4 w-4 text-danger-foreground" />;
  }
  if (status === "processing" || status === "retry") {
    return <RefreshCw className="h-4 w-4 animate-spin text-brand" />;
  }
  if (status === "fallback") {
    return <Sparkles className="h-4 w-4 text-warning-foreground" />;
  }
  return <CheckCircle2 className="h-4 w-4 text-success-foreground" />;
}

function extractCitationSourceMap(content: string): Map<string, string> {
  const lines = content.split(/\r?\n/);
  const sourceMap = new Map<string, string>();
  const referenceMarkerIndex = lines.findIndex((line) =>
    /^(参考资料|引用来源|references)\s*[:：]?\s*$/i.test(line.trim()),
  );

  if (referenceMarkerIndex >= 0) {
    for (const line of lines.slice(referenceMarkerIndex + 1)) {
      const match = /^\[(\d+)\]\s*(.+?)\s*$/.exec(line.trim());
      if (!match) {
        continue;
      }
      sourceMap.set(match[1], match[2]);
    }
    return sourceMap;
  }

  for (const line of lines) {
    const match = /^\[(\d+)\]\s*\(([^)]+)\)/.exec(line.trim());
    if (!match) {
      continue;
    }
    sourceMap.set(match[1], match[2].trim());
  }

  return sourceMap;
}

function renderTextWithCitations(content: string) {
  const citationPattern = /\[(\d+)\]/g;
  const sourceMap = extractCitationSourceMap(content);
  const nodes: Array<string | JSX.Element> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = citationPattern.exec(content);

  while (match) {
    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }

    const citationNumber = match[1];
    const citationSource = sourceMap.get(citationNumber);
    nodes.push(
      <sup
        aria-label={citationSource ? `引用 ${citationNumber}，来源 ${citationSource}` : `引用 ${citationNumber}`}
        className={`ml-0.5 align-super text-[11px] font-semibold text-sky-600 ${
          citationSource ? "cursor-help" : ""
        }`}
        data-testid={`chat-citation-${citationNumber}`}
        key={`citation-${citationNumber}-${match.index}`}
        title={citationSource ? `来源：${citationSource}` : `引用 [${citationNumber}]`}
      >
        [{citationNumber}]
      </sup>,
    );
    lastIndex = match.index + match[0].length;
    match = citationPattern.exec(content);
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes;
}

function renderMessageMaterials(item: ConversationMessage) {
  const materials = item.materials ?? [];
  if (materials.length === 0) {
    return null;
  }

  const imageMaterials = materials.filter(
    (material) => material.type === "image" && material.url,
  );
  const otherMaterials = materials.filter(
    (material) => material.type !== "image" || !material.url,
  );
  const isUser = item.role === "user";

  return (
    <div className="mb-3 space-y-2">
      {imageMaterials.length > 0 ? (
        <div className="scrollbar-hide flex max-w-full flex-row gap-2 overflow-x-auto overscroll-x-contain pb-2 snap-x">
          {imageMaterials.map((material, index) => (
            <a
              className={`group h-16 w-16 flex-shrink-0 snap-start overflow-hidden rounded-xl border border-black/5 shadow-sm transition-opacity hover:opacity-80 dark:border-white/10 ${
                isUser
                  ? "bg-user-bubble-subtle"
                  : "bg-muted"
              }`}
              href={material.url}
              key={`${material.url}-${index}`}
              rel="noreferrer"
              target="_blank"
            >
              <img
                alt={materialLabel(material)}
                className="h-full w-full cursor-pointer rounded-xl object-cover"
                src={material.url}
              />
            </a>
          ))}
        </div>
      ) : null}

      {otherMaterials.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {otherMaterials.map((material, index) => (
            <a
              className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs ${
                isUser
                  ? "border border-user-bubble-subtle-border bg-user-bubble-subtle text-user-bubble-subtle-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}
              href={material.url || undefined}
              key={`${material.type}-${material.url || material.text}-${index}`}
              rel="noreferrer"
              target={material.url ? "_blank" : undefined}
            >
              {material.type === "video_url" ? (
                <Video className="h-3.5 w-3.5 shrink-0" />
              ) : material.type === "text_link" ? (
                <FileText className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{materialLabel(material)}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getArtifactGeneratedImages(artifact: ArtifactPayload | null): string[] {
  if (!artifact || artifact.artifact_type !== "content_draft") {
    return [];
  }
  return artifact.generated_images ?? [];
}

function ThinkingPanel({
  steps,
  isStreaming,
}: {
  steps: ToolCallTraceItem[];
  isStreaming: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (steps.length === 0) {
      setIsExpanded(false);
      return;
    }

    if (isStreaming) {
      setIsExpanded(true);
      return;
    }

    setIsExpanded(false);
  }, [steps, isStreaming]);

  if (steps.length === 0) {
    return null;
  }

  const latestStep = steps[steps.length - 1];
  const completedCount = steps.filter((step) => !isThinkingStepPending(step.status)).length;
  const summaryText = isStreaming
    ? `已记录 ${steps.length} 个步骤，当前：${getThinkingStepLabel(latestStep.name)}`
    : `共完成 ${completedCount}/${steps.length} 个步骤，最后一步：${getThinkingStepLabel(
        latestStep.name,
      )}`;

  return (
    <div
      className="w-full max-w-[85%] md:max-w-[70%]"
      data-testid="thinking-panel"
    >
      <div className="rounded-[24px] border border-border bg-card/95 px-4 py-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                isStreaming
                  ? "bg-brand-soft text-brand"
                  : "bg-success-surface text-success-foreground"
              }`}
            >
              {isStreaming ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3.5 w-3.5" />
              )}
              {isStreaming ? "AI 思考中" : "AI 思考完成"}
            </div>
            <div className="mt-3 text-sm font-semibold text-foreground">
              {summaryText}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {latestStep.message}
            </div>
          </div>

          <button
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "收起思考过程" : "展开思考过程"}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:text-foreground"
            onClick={() => setIsExpanded((current) => !current)}
            type="button"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>

        <div
          className={`grid transition-all duration-300 ease-in-out ${
            isExpanded
              ? "mt-4 grid-rows-[1fr] opacity-100"
              : "mt-0 grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="space-y-2">
              {steps.map((step) => (
                <div
                  className="rounded-2xl border border-border bg-muted/70 p-3"
                  data-testid={`thinking-step-${step.id}`}
                  key={step.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card">
                          {renderThinkingStepIcon(step.status)}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">
                            {getThinkingStepLabel(step.name)}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {step.message}
                          </div>
                        </div>
                      </div>
                    </div>

                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-medium ${getThinkingStepBadgeClass(
                        step.status,
                      )}`}
                    >
                      {getThinkingStepStatusLabel(step.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ChatFeed({
  currentUser,
  messages,
  artifact,
  toolCallTimeline,
  isStreaming,
  isLoadingHistory = false,
  endRef,
  onSaveArtifactAsTemplate,
}: ChatFeedProps) {
  const resolvedUserAvatarUrl = currentUser?.avatar_url
    ? buildAbsoluteUrl(currentUser.avatar_url)
    : "";
  const [hasUserAvatarError, setHasUserAvatarError] = useState(false);

  useEffect(() => {
    setHasUserAvatarError(false);
  }, [resolvedUserAvatarUrl]);

  const userDisplayName = getDisplayName(currentUser) || "User";
  const showUserAvatar = Boolean(resolvedUserAvatarUrl) && !hasUserAvatarError;
  const latestAssistantMessageId = [...messages]
    .reverse()
    .find((item) => item.role === "assistant")?.id;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {isLoadingHistory ? (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-foreground">
            正在加载历史会话
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`history-loading-${index}`} className="space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-surface-subtle" />
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {messages.map((item) => {
        const timestamp = formatChatTimestamp(item.createdAt);

        if (item.role === "tool" || item.role === "note" || item.role === "error") {
          return (
            <div
              key={item.id}
              className={`rounded-2xl border px-4 py-3 shadow-sm ${
                item.role === "error"
                  ? "border-danger-foreground/20 bg-danger-surface"
                  : item.role === "tool"
                    ? "border-warning-foreground/20 bg-warning-surface"
                    : "border-border bg-muted"
              }`}
              data-testid={`chat-message-${item.role}`}
            >
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                {item.role === "tool" ? (
                  <Sparkles className="h-4 w-4 text-warning-foreground" />
                ) : item.role === "error" ? (
                  <AlertCircle className="h-4 w-4 text-danger-foreground" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                )}
                {item.title}
              </div>
              <div className="text-sm leading-6 text-muted-foreground">{item.content}</div>
              {timestamp ? (
                <div className="mt-2 text-[11px] text-muted-foreground/80">{timestamp}</div>
              ) : null}
            </div>
          );
        }

        const shouldRenderThinkingPanel =
          item.role === "assistant" &&
          item.id === latestAssistantMessageId &&
          toolCallTimeline.length > 0;
        const canCopyAssistantMessage =
          item.role === "assistant" && item.content.trim().length > 0;
        const canSaveArtifactAsTemplate =
          item.role === "assistant" &&
          Boolean(artifact) &&
          Boolean(onSaveArtifactAsTemplate) &&
          item.id === latestAssistantMessageId;
        const artifactGeneratedImages =
          item.role === "assistant" ? getArtifactGeneratedImages(item.artifact ?? null) : [];
        const shouldRenderAssistantActions =
          canCopyAssistantMessage || canSaveArtifactAsTemplate;

        return (
          <div key={item.id} className="space-y-3">
            {shouldRenderThinkingPanel ? (
              <div className="flex justify-start pl-12">
                <ThinkingPanel isStreaming={isStreaming} steps={toolCallTimeline} />
              </div>
            ) : null}

            <div
              className={`flex gap-3 ${
                item.role === "user" ? "justify-end" : "justify-start"
              }`}
              data-testid={`chat-message-${item.role}`}
            >
              {item.role === "assistant" ? (
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-brand-foreground shadow-sm"
                  style={{ background: "var(--brand-gradient)" }}
                >
                  <Sparkles className="h-5 w-5" />
                </div>
              ) : null}

              <div
                className={`max-w-[85%] rounded-[24px] border px-5 py-4 shadow-sm md:max-w-[70%] ${
                  item.role === "user"
                    ? "border-user-bubble-subtle-border bg-user-bubble text-user-foreground"
                    : "border-border bg-ai-bubble text-ai-foreground"
                } min-w-0 overflow-hidden`}
              >
                {renderMessageMaterials(item)}
                <div className="whitespace-pre-wrap text-sm leading-7">
                  {item.content ? (
                    item.role === "assistant" ? (
                      renderTextWithCitations(item.content)
                    ) : (
                      item.content
                    )
                  ) : (
                    <span className="inline-flex gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-brand" />
                      <span
                        className="h-2 w-2 animate-bounce rounded-full bg-brand"
                        style={{ animationDelay: "120ms" }}
                      />
                      <span
                        className="h-2 w-2 animate-bounce rounded-full bg-brand"
                        style={{ animationDelay: "240ms" }}
                      />
                    </span>
                  )}
                </div>
                {artifactGeneratedImages.length > 0 ? (
                  <div className="mt-4">
                    <div
                      className={`grid max-w-md gap-2 ${
                        artifactGeneratedImages.length === 1
                          ? "grid-cols-1"
                          : artifactGeneratedImages.length === 2
                            ? "grid-cols-2"
                            : "grid-cols-2 sm:grid-cols-3"
                      }`}
                      data-testid="chat-artifact-image-gallery"
                    >
                      {artifactGeneratedImages.map((imageUrl, index) => (
                        <a
                          key={`${imageUrl}-${index}`}
                          className="group overflow-hidden rounded-lg border border-border/60 bg-card/70 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
                          data-testid={`chat-artifact-image-card-${index + 1}`}
                          href={imageUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <img
                            alt={`AI generated image ${index + 1}`}
                            className={`w-full object-cover transition duration-200 group-hover:scale-[1.02] ${
                              artifactGeneratedImages.length === 1
                                ? "aspect-[4/5]"
                                : "aspect-square"
                            }`}
                            loading="lazy"
                            src={imageUrl}
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
                {item.role === "assistant" &&
                item.artifact?.citation_audit &&
                item.artifact.citation_audit.length > 0 ? (
                  <div className="mt-4">
                    <CitationAuditPanel compact items={item.artifact.citation_audit} />
                  </div>
                ) : null}
                {shouldRenderAssistantActions ? (
                  <div className="mt-3 flex items-center justify-end gap-2 border-t border-border/50 pt-2">
                    {canCopyAssistantMessage ? (
                      <div data-testid="chat-message-assistant-copy">
                        <CopyButton
                          ariaLabel="复制这条 AI 回复"
                          text={item.content}
                        />
                      </div>
                    ) : null}
                    {canSaveArtifactAsTemplate && onSaveArtifactAsTemplate ? (
                      <button
                        className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-brand-soft px-3.5 py-2 text-xs font-medium text-brand transition hover:opacity-90"
                        data-testid="chat-save-template"
                        onClick={onSaveArtifactAsTemplate}
                        type="button"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        存为模板
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {timestamp ? (
                  <div
                    className={`mt-3 text-xs ${
                      item.role === "user"
                        ? "text-user-bubble-timestamp"
                        : "text-muted-foreground/80"
                    }`}
                  >
                    {timestamp}
                  </div>
                ) : null}
              </div>

              {item.role === "user" ? (
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-secondary-foreground"
                  data-testid="chat-message-user-avatar"
                >
                  {showUserAvatar ? (
                    <img
                      alt={`${userDisplayName} avatar`}
                      className="h-full w-full object-cover"
                      onError={() => setHasUserAvatarError(true)}
                      src={resolvedUserAvatarUrl}
                    />
                  ) : (
                    <User className="h-5 w-5" />
                  )}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}

      {isStreaming ? (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="flex gap-1">
            <div className="h-2 w-2 animate-bounce rounded-full bg-brand" />
            <div
              className="h-2 w-2 animate-bounce rounded-full bg-brand"
              style={{ animationDelay: "120ms" }}
            />
            <div
              className="h-2 w-2 animate-bounce rounded-full bg-brand"
              style={{ animationDelay: "240ms" }}
            />
          </div>
          <span>Agent 正在生成内容和结构化结果...</span>
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  );
}
