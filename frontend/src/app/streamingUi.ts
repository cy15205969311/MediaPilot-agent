import type { ToolCallTraceItem, UiTaskType } from "./types";

export type StreamingUiState = {
  variant: "default" | "image";
  compactLabel: string;
  headline: string;
  detail: string;
  auxiliaryLabel: string;
  elapsedLabel: string;
  phaseLabel: string;
  footerText: string;
  progressPercent: number;
};

type BuildStreamingUiStateParams = {
  isStreaming: boolean;
  taskType: UiTaskType | null;
  statusText: string;
  toolCallTimeline: ToolCallTraceItem[];
  elapsedSeconds: number;
};

const IMAGE_TOOL_NAMES = new Set(["build_image_prompt", "generate_cover_images"]);
const DEFAULT_STOP_HINT =
  "如果方向不对，可以随时停止，本次已输出内容会保留在当前对话中。";
const IMAGE_WAIT_HINT = "高质量生图通常需要 1-2 分钟，请耐心等待。";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatElapsedDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 60) {
    return `${safeSeconds} 秒`;
  }

  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes} 分钟`;
  }

  return `${minutes} 分 ${remainingSeconds} 秒`;
}

function formatElapsedLabel(seconds: number): string {
  return `已等待 ${formatElapsedDuration(seconds)}`;
}

function getLatestImageStep(
  toolCallTimeline: ToolCallTraceItem[],
): ToolCallTraceItem | null {
  for (let index = toolCallTimeline.length - 1; index >= 0; index -= 1) {
    const step = toolCallTimeline[index];
    if (IMAGE_TOOL_NAMES.has(step.name)) {
      return step;
    }
  }

  return null;
}

function buildImageStreamingState(
  latestImageStep: ToolCallTraceItem | null,
  elapsedSeconds: number,
): StreamingUiState {
  let headline = "已提交精绘出图请求";
  let detail = IMAGE_WAIT_HINT;
  let auxiliaryLabel = "请求已提交";
  let phaseLabel = "排队中";

  if (latestImageStep?.name === "build_image_prompt") {
    headline = "正在整理画面提示词";
    detail = "系统会先提炼主体、构图和视觉风格，再发往图像引擎。";
    auxiliaryLabel = "提示词准备中";
    phaseLabel = "提示词整理";
  } else if (latestImageStep?.name === "generate_cover_images") {
    if (elapsedSeconds < 20) {
      headline = "图像引擎已接单，正在准备渲染";
      detail = IMAGE_WAIT_HINT;
      auxiliaryLabel = "引擎已接单";
      phaseLabel = "准备渲染";
    } else if (elapsedSeconds < 60) {
      headline = "正在精细渲染画面";
      detail = "旗舰精绘模式耗时更长，但会保留更完整的构图和细节。";
      auxiliaryLabel = "精细渲染中";
      phaseLabel = "精细渲染";
    } else if (elapsedSeconds < 100) {
      headline = "仍在渲染高质量画面";
      detail = "当前仍属于正常等待区间，我们会优先等待精绘结果返回。";
      auxiliaryLabel = "正常长等待";
      phaseLabel = "持续渲染";
    } else {
      headline = "已进入较长等待区间";
      detail = "如果继续无结果，系统会在安全阈值后自动触发兜底策略。";
      auxiliaryLabel = "安全观察中";
      phaseLabel = "较长等待";
    }
  }

  const elapsedLabel = formatElapsedLabel(elapsedSeconds);

  return {
    variant: "image",
    compactLabel: `精绘出图 · ${elapsedLabel}`,
    headline,
    detail,
    auxiliaryLabel,
    elapsedLabel,
    phaseLabel,
    footerText: `${headline}。${detail}`,
    progressPercent: clamp(Math.round((elapsedSeconds / 120) * 88) + 8, 8, 96),
  };
}

function buildDefaultStreamingState(
  statusText: string,
  elapsedSeconds: number,
): StreamingUiState {
  const normalizedStatusText = statusText.trim() || "正在生成内容";

  return {
    variant: "default",
    compactLabel: normalizedStatusText,
    headline: normalizedStatusText,
    detail: DEFAULT_STOP_HINT,
    auxiliaryLabel: "流式生成中",
    elapsedLabel: formatElapsedLabel(elapsedSeconds),
    phaseLabel: "处理中",
    footerText: "Agent 正在生成内容和结构化结果...",
    progressPercent: clamp(20 + elapsedSeconds * 2, 20, 92),
  };
}

export function buildStreamingUiState(
  params: BuildStreamingUiStateParams,
): StreamingUiState | null {
  const { isStreaming, taskType, statusText, toolCallTimeline, elapsedSeconds } = params;
  if (!isStreaming) {
    return null;
  }

  const latestImageStep = getLatestImageStep(toolCallTimeline);
  const isImageFlow = taskType === "image_generation" || latestImageStep !== null;
  if (isImageFlow) {
    return buildImageStreamingState(latestImageStep, elapsedSeconds);
  }

  return buildDefaultStreamingState(statusText, elapsedSeconds);
}
