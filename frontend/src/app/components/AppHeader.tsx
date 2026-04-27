import { Download, Menu, Search, User, Zap } from "lucide-react";

import { taskOptions } from "../data";
import type { UiPlatform, UiTaskType } from "../types";

type AppHeaderProps = {
  platform: UiPlatform;
  taskType: UiTaskType;
  currentDisplayName: string;
  onPlatformChange: (platform: UiPlatform) => void;
  onTaskTypeChange: (taskType: UiTaskType) => void;
  onOpenLeftSidebar: () => void;
  onOpenRightPanel: () => void;
};

export function AppHeader({
  platform,
  taskType,
  currentDisplayName,
  onPlatformChange,
  onTaskTypeChange,
  onOpenLeftSidebar,
  onOpenRightPanel,
}: AppHeaderProps) {
  return (
    <header className="flex h-16 items-center border-b border-slate-200 bg-white/85 px-4 backdrop-blur-md lg:px-6">
      <button
        className="mr-3 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        onClick={onOpenLeftSidebar}
        type="button"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="mr-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 shadow-sm">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <div className="hidden sm:block">
          <div className="text-2xl font-bold tracking-tight">MediaPilot</div>
        </div>
      </div>

      <div className="hidden items-center gap-2 md:flex">
        {[
          ["xiaohongshu", "小红书"],
          ["douyin", "抖音"],
          ["both", "双平台"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
              platform === id
                ? id === "douyin"
                  ? "bg-slate-800 text-white shadow-sm"
                  : id === "both"
                    ? "bg-gradient-to-r from-rose-500 to-slate-800 text-white shadow-sm"
                    : "bg-rose-500 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
            onClick={() => onPlatformChange(id as UiPlatform)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div className="hidden px-4 md:block">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <select
            className="rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm font-medium text-slate-700 outline-none transition hover:bg-slate-50"
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

      <div className="ml-auto flex items-center gap-3">
        <button
          className="hidden items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 sm:flex"
          type="button"
        >
          <Download className="h-4 w-4" />
          导出
        </button>
        <button
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 xl:hidden"
          onClick={onOpenRightPanel}
          type="button"
        >
          结果
        </button>
        <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
          <User className="h-4 w-4" />
          <span className="hidden max-w-32 truncate sm:inline">{currentDisplayName}</span>
        </div>
      </div>
    </header>
  );
}
