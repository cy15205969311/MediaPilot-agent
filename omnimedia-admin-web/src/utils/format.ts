import type { AuthenticatedUser, UserRole, UserStatus } from "../types";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const numberFormatter = new Intl.NumberFormat("zh-CN");
const relativeTimeFormatter = new Intl.RelativeTimeFormat("zh-CN", {
  numeric: "auto",
});

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatBytes(bytes: number, fractionDigits = 2): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export function formatDate(value?: string | null): string {
  if (!value) {
    return "暂无";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "暂无";
  }

  return dateFormatter.format(date);
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "暂无";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "暂无";
  }

  return dateTimeFormatter.format(date);
}

export function formatRelativeTime(value?: string | null): string {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  if (Math.abs(diffSeconds) < 60) {
    return relativeTimeFormatter.format(0, "second");
  }

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) {
    return relativeTimeFormatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return relativeTimeFormatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) {
    return relativeTimeFormatter.format(diffDays, "day");
  }

  return formatDateTime(value);
}

export function formatRoleLabel(role: UserRole): string {
  if (role === "super_admin") {
    return "超级管理员";
  }
  if (role === "admin") {
    return "平台管理员";
  }
  if (role === "finance") {
    return "财务人员";
  }
  if (role === "operator") {
    return "运营人员";
  }
  if (role === "premium") {
    return "高级用户";
  }
  return "普通用户";
}

export function formatStatusLabel(status: UserStatus): string {
  return status === "active" ? "正常" : "冻结";
}

export function getDisplayName(user: AuthenticatedUser): string {
  return user.nickname?.trim() || user.username;
}

export function getInitials(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "OM";
  }

  return normalized.slice(0, 2).toUpperCase();
}
