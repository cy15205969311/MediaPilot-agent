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

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
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

export function formatRoleLabel(role: UserRole): string {
  if (role === "super_admin") {
    return "超级管理员";
  }
  if (role === "admin") {
    return "管理员";
  }
  if (role === "operator") {
    return "运营成员";
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
