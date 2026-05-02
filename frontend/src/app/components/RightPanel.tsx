import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";

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

type RightPanelProps = {
  open: boolean;
  isDesktopCollapsed: boolean;
  platform: UiPlatform;
  taskType: UiTaskType;
  activeTaskLabel: string;
  artifact: ArtifactPayload | null;
  artifactActions: ArtifactAction[];
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
    case "content_generation":
      return (
        <ContentGenerationArtifact
          artifact={artifact?.artifact_type === "content_draft" ? artifact : null}
          platform={platform}
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

export function RightPanel({
  open,
  isDesktopCollapsed,
  platform,
  taskType,
  activeTaskLabel,
  artifact,
  artifactActions,
  onClose,
  onOpen,
  onToggleDesktopCollapse,
}: RightPanelProps) {
  return (
    <>
      <aside
        className={`fixed inset-y-16 right-0 z-40 w-full max-w-md border-l border-border bg-card shadow-sm transition-transform duration-300 xl:static xl:shrink-0 xl:translate-x-0 xl:transition-[width,border-color] xl:duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        } ${isDesktopCollapsed ? "xl:w-0 xl:max-w-none xl:border-l-transparent" : "xl:w-[28rem] xl:max-w-[28rem]"}`}
        data-testid="right-panel"
      >
        <div
          className={`flex h-full flex-col overflow-hidden transition-opacity duration-200 ${
            isDesktopCollapsed ? "xl:pointer-events-none xl:opacity-0" : "opacity-100"
          }`}
        >
          <div className="flex items-start justify-between border-b border-border px-5 py-5">
            <div>
              <div className="text-2xl font-bold tracking-tight text-foreground">
                生成结果
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {activeTaskLabel} · {getPlatformLabel(platform)}
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
                建议人工确认
              </div>
              <div className="text-sm leading-6 text-warning-foreground">
                当前结果适合继续编辑，但涉及表达策略、品牌语气和业务判断的部分，仍建议人工复核后再发布。
              </div>
            </div>

            {renderArtifactPanel(platform, taskType, artifact)}

            {artifact?.citation_audit && artifact.citation_audit.length > 0 ? (
              <div className="mt-4">
                <CitationAuditPanel items={artifact.citation_audit} />
              </div>
            ) : null}

            {artifact ? (
              <div className="mt-4 rounded-[28px] border border-border bg-muted p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <RefreshCw className="h-4 w-4 text-muted-foreground" />
                  协议状态
                </div>
                <div className="text-sm leading-6 text-muted-foreground">
                  当前右侧面板已经基于后端 `artifact` 事件进行渲染，不再依赖组件内部的硬编码模拟数据。
                </div>
              </div>
            ) : null}
          </div>

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
                  onClick={action.onClick}
                  type="button"
                  data-testid={`artifact-action-${action.id}`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
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
