import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

import type {
  ArtifactAction,
  ArtifactPayload,
  UiPlatform,
  UiTaskType,
} from "../types";
import { CommentReplyArtifact } from "./artifacts/CommentReplyArtifact";
import { CitationAuditPanel } from "./CitationAuditPanel";
import { ContentGenerationArtifact } from "./artifacts/ContentGenerationArtifact";
import { HotPostAnalysisArtifact } from "./artifacts/HotPostAnalysisArtifact";
import { TopicPlanningArtifact } from "./artifacts/TopicPlanningArtifact";

type ArtifactTaskEntry = {
  taskType: UiTaskType;
  artifact: ArtifactPayload;
};

type RightPanelProps = {
  open: boolean;
  isDesktopCollapsed: boolean;
  platform: UiPlatform;
  activeTaskLabel: string;
  selectedArtifactTaskType: UiTaskType;
  selectedArtifact: ArtifactPayload | null;
  artifactEntries: ArtifactTaskEntry[];
  artifactActions: ArtifactAction[];
  isStreaming: boolean;
  onSelectArtifactTaskType: (taskType: UiTaskType) => void;
  onRequestArtifactHandoff: (taskType: UiTaskType) => void;
  onClose: () => void;
  onOpen: () => void;
  onToggleDesktopCollapse: () => void;
};

function renderArtifactPanel(
  platform: UiPlatform,
  taskType: UiTaskType,
  artifact: ArtifactPayload | null,
) {
  switch (taskType) {
    case "topic_planning":
      return (
        <TopicPlanningArtifact
          artifact={artifact?.artifact_type === "topic_list" ? artifact : null}
        />
      );
    case "hot_post_analysis":
      return (
        <HotPostAnalysisArtifact
          artifact={artifact?.artifact_type === "hot_post_analysis" ? artifact : null}
        />
      );
    case "comment_reply":
      return (
        <CommentReplyArtifact
          artifact={artifact?.artifact_type === "comment_reply" ? artifact : null}
        />
      );
    case "content_generation":
    default:
      return (
        <ContentGenerationArtifact
          artifact={artifact?.artifact_type === "content_draft" ? artifact : null}
          platform={platform}
        />
      );
  }
}

function getPlatformLabel(platform: UiPlatform) {
  if (platform === "both") {
    return "双平台";
  }
  return platform === "douyin" ? "抖音" : "小红书";
}

function getArtifactTabLabel(taskType: UiTaskType) {
  switch (taskType) {
    case "topic_planning":
      return "选题方案";
    case "hot_post_analysis":
      return "爆款拆解";
    case "comment_reply":
      return "互动评论";
    case "content_generation":
    default:
      return "正文草稿";
  }
}

function SmartHandoffCard(props: {
  title: string;
  description: string;
  buttonLabel: string;
  isSubmitting: boolean;
  onConfirm: () => void;
}) {
  const { title, description, buttonLabel, isSubmitting, onConfirm } = props;

  return (
    <div className="rounded-[28px] border border-brand/15 bg-[linear-gradient(135deg,rgba(255,247,237,0.96),rgba(255,255,255,0.98)_62%,rgba(254,242,242,0.98))] p-5 shadow-sm">
      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-soft text-brand shadow-sm">
          <Sparkles className="h-6 w-6" />
        </div>
        <div className="mt-4 text-lg font-semibold text-foreground">{title}</div>
        <div className="mt-2 text-sm leading-6 text-muted-foreground">{description}</div>
        <button
          className="mt-5 inline-flex min-w-[13rem] items-center justify-center rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          onClick={onConfirm}
          type="button"
        >
          {isSubmitting ? "正在生成互动评论..." : buttonLabel}
        </button>
      </div>
    </div>
  );
}

export function RightPanel({
  open,
  isDesktopCollapsed,
  platform,
  activeTaskLabel,
  selectedArtifactTaskType,
  selectedArtifact,
  artifactEntries,
  artifactActions,
  isStreaming,
  onSelectArtifactTaskType,
  onRequestArtifactHandoff,
  onClose,
  onOpen,
  onToggleDesktopCollapse,
}: RightPanelProps) {
  const contentArtifact = artifactEntries.find(
    (entry) => entry.taskType === "content_generation",
  )?.artifact;

  const showCommentReplyHandoff =
    selectedArtifactTaskType === "comment_reply" &&
    !selectedArtifact &&
    Boolean(contentArtifact);

  return (
    <>
      <aside
        className={`fixed inset-y-16 right-0 z-40 w-full max-w-md border-l border-border bg-card shadow-sm transition-transform duration-300 xl:static xl:shrink-0 xl:translate-x-0 xl:transition-[width,border-color] xl:duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        } ${
          isDesktopCollapsed
            ? "xl:w-0 xl:max-w-none xl:border-l-transparent"
            : "xl:w-[28rem] xl:max-w-[28rem]"
        }`}
        data-testid="right-panel"
      >
        <div
          className={`flex h-full flex-col overflow-hidden transition-opacity duration-200 ${
            isDesktopCollapsed ? "xl:pointer-events-none xl:opacity-0" : "opacity-100"
          }`}
        >
          <div className="flex items-start justify-between border-b border-border px-5 py-5">
            <div className="min-w-0">
              <div className="text-2xl font-bold tracking-tight text-foreground">
                资产包
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                当前工作流：{activeTaskLabel} · {getPlatformLabel(platform)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                当前查看：{getArtifactTabLabel(selectedArtifactTaskType)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                aria-expanded={!isDesktopCollapsed}
                aria-label="折叠右侧结果面板"
                className="hidden h-10 w-10 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:border-brand/40 hover:text-foreground xl:inline-flex"
                onClick={onToggleDesktopCollapse}
                type="button"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                aria-label="关闭结果面板"
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground transition hover:bg-muted xl:hidden"
                onClick={onClose}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="mb-4 rounded-[28px] border border-warning-foreground/20 bg-warning-surface p-4">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-warning-foreground">
                <AlertCircle className="h-4 w-4" />
                发布前建议人工确认
              </div>
              <div className="text-sm leading-6 text-warning-foreground">
                当前结果适合继续编辑与导出，但涉及品牌语气、表达策略与业务判断的内容，仍建议人工复核后再发布。
              </div>
            </div>

            {artifactEntries.length > 0 ? (
              <div className="mb-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Thread Asset Matrix
                </div>
                <div className="flex flex-wrap gap-2 rounded-[24px] bg-muted p-2">
                  {artifactEntries.map((entry) => {
                    const isActive = entry.taskType === selectedArtifactTaskType;
                    return (
                      <button
                        key={entry.taskType}
                        className={`rounded-2xl px-4 py-2 text-sm font-medium transition ${
                          isActive
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => onSelectArtifactTaskType(entry.taskType)}
                        type="button"
                      >
                        {getArtifactTabLabel(entry.taskType)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {showCommentReplyHandoff ? (
              <SmartHandoffCard
                buttonLabel="一键生成互动评论"
                description={`检测到当前会话已经产出正文草稿“${contentArtifact?.title || "未命名正文"}”。是否基于这份内容，继续生成高转化率的互动评论与回复话术？`}
                isSubmitting={isStreaming}
                onConfirm={() => onRequestArtifactHandoff("comment_reply")}
                title="正文已就绪，继续接力评论"
              />
            ) : (
              renderArtifactPanel(platform, selectedArtifactTaskType, selectedArtifact)
            )}

            {selectedArtifact?.citation_audit && selectedArtifact.citation_audit.length > 0 ? (
              <div className="mt-4">
                <CitationAuditPanel items={selectedArtifact.citation_audit} />
              </div>
            ) : null}

            {selectedArtifact ? (
              <div className="mt-4 rounded-[28px] border border-border bg-muted p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                  资产包状态
                </div>
                <div className="text-sm leading-6 text-muted-foreground">
                  当前会话里的结构化产物会保留在此处。你可以在本地 Tab 之间切换查看不同阶段的结果，再决定继续改写、导出或发起下一棒接力任务。
                </div>
              </div>
            ) : null}
          </div>

          {artifactActions.length > 0 ? (
            <div className="border-t border-border px-5 py-4">
              <div className="grid gap-2">
                {artifactActions.map((action) => (
                  <button
                    key={action.id}
                    className={`rounded-2xl px-4 py-3 text-sm font-medium transition ${
                      action.variant === "primary"
                        ? "bg-primary text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
                        : "border border-border bg-card text-card-foreground hover:bg-muted"
                    }`}
                    data-testid={`artifact-action-${action.id}`}
                    onClick={action.onClick}
                    type="button"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </aside>

      {open ? (
        <button
          className="fixed inset-0 top-16 z-30 bg-overlay xl:hidden"
          onClick={onClose}
          type="button"
        />
      ) : null}

      {!open ? (
        <button
          aria-label="展开结果面板"
          className="fixed bottom-24 right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md xl:hidden"
          onClick={onOpen}
          type="button"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : null}

      {isDesktopCollapsed ? (
        <button
          aria-label="展开右侧结果面板"
          className="fixed bottom-24 right-6 z-20 hidden h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition hover:scale-[1.02] xl:flex"
          onClick={onOpen}
          type="button"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      ) : null}
    </>
  );
}
