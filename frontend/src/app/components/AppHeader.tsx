import {
  Download,
  Menu,
  Moon,
  Search,
  Sun,
  User,
  Zap,
} from "lucide-react";

import { ModelSelector } from "./ModelSelector";
import { useTheme } from "../ThemeContext";
import { taskOptions } from "../data";
import type { UiPlatform, UiTaskType } from "../types";

type AppHeaderProps = {
  platform: UiPlatform;
  taskType: UiTaskType;
  modelOverride: string | null;
  currentDisplayName: string;
  onPlatformChange: (platform: UiPlatform) => void;
  onTaskTypeChange: (taskType: UiTaskType) => void;
  onModelOverrideChange: (model: string) => void;
  onOpenLeftSidebar: () => void;
  onOpenRightPanel: () => void;
};

const platformOptions: Array<{ id: UiPlatform; label: string }> = [
  { id: "xiaohongshu", label: "小红书" },
  { id: "douyin", label: "抖音" },
  { id: "both", label: "双平台" },
];

function getPlatformButtonClass(id: UiPlatform, activePlatform: UiPlatform) {
  if (activePlatform === id) {
    return "bg-primary text-primary-foreground shadow-sm";
  }

  return "text-muted-foreground hover:bg-background/50 hover:text-foreground";
}

export function AppHeader({
  platform,
  taskType,
  modelOverride,
  currentDisplayName,
  onPlatformChange,
  onTaskTypeChange,
  onModelOverrideChange,
  onOpenLeftSidebar,
  onOpenRightPanel,
}: AppHeaderProps) {
  const { theme, toggleTheme } = useTheme();
  const isLightTheme = theme === "light";
  const ThemeIcon = isLightTheme ? Moon : Sun;
  const themeButtonLabel = isLightTheme ? "夜间" : "日间";
  const themeButtonAriaLabel = isLightTheme
    ? "切换到夜间模式"
    : "切换到日间模式";

  return (
    <header className="relative z-50 flex h-16 shrink-0 items-center overflow-visible border-b border-border bg-surface-elevated px-4 backdrop-blur-md lg:px-6">
      <button
        aria-label="打开左侧边栏"
        className="mr-3 rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground lg:hidden"
        onClick={onOpenLeftSidebar}
        type="button"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="mr-6 flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl shadow-sm"
          style={{ background: "var(--brand-gradient)" }}
        >
          <Zap className="h-5 w-5 text-brand-foreground" />
        </div>
        <div className="hidden sm:block">
          <div className="text-2xl font-bold tracking-tight text-foreground">
            MediaPilot
          </div>
        </div>
      </div>

      <div className="hidden items-center space-x-1 rounded-full bg-muted p-1 md:flex">
        {platformOptions.map((option) => (
          <button
            aria-pressed={platform === option.id}
            key={option.id}
            className={`relative inline-flex cursor-pointer select-none items-center justify-center rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 ease-out ${getPlatformButtonClass(
              option.id,
              platform,
            )}`}
            onClick={() => onPlatformChange(option.id)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="hidden px-4 md:block">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <select
            className="rounded-xl border border-border bg-card py-2 pl-10 pr-4 text-sm font-medium text-foreground outline-none transition hover:bg-muted focus:border-primary focus:outline-none focus:ring-0"
            onChange={(event) => onTaskTypeChange(event.target.value as UiTaskType)}
            value={taskType}
          >
            {taskOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ModelSelector onChange={onModelOverrideChange} value={modelOverride} />

      <div className="ml-auto flex items-center gap-3">
        <button
          className="hidden items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-muted sm:flex"
          type="button"
        >
          <Download className="h-4 w-4" />
          导出
        </button>
        <button
          aria-label={themeButtonAriaLabel}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          onClick={toggleTheme}
          type="button"
        >
          <ThemeIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{themeButtonLabel}</span>
        </button>
        <button
          aria-label="打开结果面板"
          className="rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted xl:hidden"
          onClick={onOpenRightPanel}
          type="button"
        >
          结果
        </button>
        <div className="flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-sm text-secondary-foreground">
          <User className="h-4 w-4" />
          <span className="hidden max-w-32 truncate sm:inline">
            {currentDisplayName}
          </span>
        </div>
      </div>
    </header>
  );
}
