import { AlertCircle, ChevronRight, RefreshCw, X } from "lucide-react";

import type {
  ArtifactAction,
  ArtifactPayload,
  UiPlatform,
  UiTaskType,
} from "../types";
import { CommentReplyArtifact } from "./artifacts/CommentReplyArtifact";
import { ContentGenerationArtifact } from "./artifacts/ContentGenerationArtifact";
import { HotPostAnalysisArtifact } from "./artifacts/HotPostAnalysisArtifact";
import { TopicPlanningArtifact } from "./artifacts/TopicPlanningArtifact";

type RightPanelProps = {
  open: boolean;
  platform: UiPlatform;
  taskType: UiTaskType;
  activeTaskLabel: string;
  artifact: ArtifactPayload | null;
  artifactActions: ArtifactAction[];
  onClose: () => void;
  onOpen: () => void;
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
  platform,
  taskType,
  activeTaskLabel,
  artifact,
  artifactActions,
  onClose,
  onOpen,
}: RightPanelProps) {
  return (
    <>
      <aside
        className={`fixed inset-y-16 right-0 z-40 w-full max-w-md border-l border-slate-200 bg-white transition-transform duration-300 xl:static xl:translate-x-0 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <div className="text-2xl font-bold tracking-tight text-slate-800">生成结果</div>
              <div className="mt-1 text-sm text-slate-500">
                {activeTaskLabel} · {getPlatformLabel(platform)}
              </div>
            </div>
            <button
              className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 xl:hidden"
              onClick={onClose}
              type="button"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-amber-800">
                <AlertCircle className="h-4 w-4" />
                建议人工确认
              </div>
              <div className="text-sm leading-6 text-amber-700">
                当前结果适合继续编辑，但涉及表达策略、品牌语气和业务判断的部分，仍建议人工复核后再发布。
              </div>
            </div>

            {renderArtifactPanel(platform, taskType, artifact)}

            {artifact ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <RefreshCw className="h-4 w-4 text-slate-500" />
                  协议状态
                </div>
                <div className="text-sm leading-6 text-slate-600">
                  当前右侧面板已经基于后端 `artifact` 事件进行渲染，不再依赖组件内的硬编码主数据。
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-slate-200 px-5 py-4">
            <div className="grid gap-2">
              {artifactActions.map((action) => (
                <button
                  key={action.label}
                  className={`rounded-xl px-4 py-3 text-sm font-medium transition ${
                    action.variant === "primary"
                      ? "bg-slate-900 text-white hover:bg-slate-800"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                  onClick={action.onClick}
                  type="button"
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
          className="fixed inset-0 top-16 z-30 bg-slate-950/20 xl:hidden"
          onClick={onClose}
          type="button"
        />
      ) : null}

      {!open ? (
        <button
          className="fixed bottom-24 right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-lg xl:hidden"
          onClick={onOpen}
          type="button"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      ) : null}
    </>
  );
}
