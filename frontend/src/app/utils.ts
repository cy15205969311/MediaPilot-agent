import type {
  AuthenticatedUser,
  BackendPlatform,
  BackendTaskType,
  HistoryMaterialItem,
  UiPlatform,
  UiTaskType,
  UploadedMaterialKind,
} from "./types";

function hasTimezoneSuffix(value: string): boolean {
  return /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value);
}

export function parseTimestamp(input: Date | string | null | undefined): Date | null {
  if (!input) {
    return null;
  }

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = hasTimezoneSuffix(trimmed) ? trimmed : `${trimmed}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatTime(date = new Date()): string {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatChatTimestamp(input: Date | string | null | undefined): string {
  const date = parseTimestamp(input);
  if (!date) {
    return "";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (date >= startOfToday) {
    return `今天 ${timeFormatter.format(date)}`;
  }

  if (date >= startOfYesterday) {
    return `昨天 ${timeFormatter.format(date)}`;
  }

  const isSameYear = now.getFullYear() === date.getFullYear();
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    ...(isSameYear
      ? {
          month: "2-digit",
          day: "2-digit",
        }
      : {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
  });

  return `${dateFormatter.format(date)} ${timeFormatter.format(date)}`;
}

export function formatRelativeTime(input: Date | string | null | undefined): string {
  const date = parseTimestamp(input);
  if (!date) {
    return "";
  }

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));

  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays} 天前`;
  }

  return formatChatTimestamp(date) || "较早";
}

export function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function mapTaskToBackend(taskType: UiTaskType): BackendTaskType {
  return taskType;
}

export function mapPlatformToBackend(platform: UiPlatform): BackendPlatform {
  return platform === "both" ? "xiaohongshu" : platform;
}

export function mapMaterialKindToSchema(kind: UploadedMaterialKind) {
  if (kind === "image") {
    return "image";
  }
  if (kind === "video") {
    return "video_url";
  }
  if (kind === "audio") {
    return "audio_url";
  }
  return "text_link";
}

export function mapSchemaMaterialToKind(
  materialType: HistoryMaterialItem["type"],
): UploadedMaterialKind {
  if (materialType === "image") {
    return "image";
  }
  if (materialType === "video_url") {
    return "video";
  }
  if (materialType === "audio_url") {
    return "audio";
  }
  return "text";
}

export function buildAbsoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  if (typeof window === "undefined") {
    return path;
  }
  return new URL(path, window.location.origin).toString();
}

export function getDisplayName(user: AuthenticatedUser | null): string {
  if (!user) {
    return "";
  }

  const nickname = user.nickname?.trim();
  return nickname || user.username;
}
