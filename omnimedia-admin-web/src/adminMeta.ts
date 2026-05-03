import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Database,
  FileText,
  HardDrive,
  LayoutDashboard,
  Settings,
  Shield,
  Users,
} from "lucide-react";

export type AdminModuleKey =
  | "dashboard"
  | "users"
  | "roles"
  | "tokens"
  | "audit"
  | "templates"
  | "storage"
  | "settings";

export type AdminNavigationItem = {
  key: AdminModuleKey;
  title: string;
  description: string;
  to: string;
  icon: LucideIcon;
  status: "ready" | "in-progress";
  badge?: string;
};

export type AdminPageMeta = {
  key: AdminModuleKey;
  eyebrow: string;
  title: string;
  description: string;
};

export const adminNavigation: AdminNavigationItem[] = [
  {
    key: "dashboard",
    title: "数据总览",
    description: "关键指标与风险提醒",
    to: "/dashboard",
    icon: LayoutDashboard,
    status: "ready",
  },
  {
    key: "users",
    title: "用户中心",
    description: "账号、角色与额度",
    to: "/users",
    icon: Users,
    status: "ready",
    badge: "156",
  },
  {
    key: "roles",
    title: "角色权限",
    description: "RBAC 权限策略",
    to: "/roles",
    icon: Shield,
    status: "in-progress",
  },
  {
    key: "tokens",
    title: "Token流水",
    description: "余额与消耗审计",
    to: "/tokens",
    icon: Activity,
    status: "in-progress",
  },
  {
    key: "audit",
    title: "审计日志",
    description: "后台操作追踪",
    to: "/audit",
    icon: FileText,
    status: "in-progress",
  },
  {
    key: "templates",
    title: "模板库",
    description: "内容模板管理",
    to: "/templates",
    icon: Database,
    status: "in-progress",
  },
  {
    key: "storage",
    title: "存储治理",
    description: "OSS 容量与资源",
    to: "/storage",
    icon: HardDrive,
    status: "in-progress",
  },
  {
    key: "settings",
    title: "系统设置",
    description: "平台配置中心",
    to: "/settings",
    icon: Settings,
    status: "in-progress",
  },
];

export const adminPageMetaMap: Record<AdminModuleKey, AdminPageMeta> = {
  dashboard: {
    key: "dashboard",
    eyebrow: "Overview",
    title: "数据总览",
    description: "把用户增长、Token 消耗、内容产出和存储容量集中到一张运营驾驶舱。",
  },
  users: {
    key: "users",
    eyebrow: "User Center",
    title: "用户中心",
    description: "围绕账号、角色、状态、额度和最近活跃建立统一的用户资产管理台。",
  },
  roles: {
    key: "roles",
    eyebrow: "RBAC",
    title: "角色权限管理",
    description: "统一管理超级管理员、运营人员、财务人员等后台角色与权限集合。",
  },
  tokens: {
    key: "tokens",
    eyebrow: "Ledger",
    title: "Token流水管理",
    description: "追踪用户充值、系统赠送、模型消耗与余额变更。",
  },
  audit: {
    key: "audit",
    eyebrow: "Ops Trace",
    title: "审计日志",
    description: "记录冻结账号、重置密码、额度调整和系统配置变更等关键操作。",
  },
  templates: {
    key: "templates",
    eyebrow: "Template Ops",
    title: "模板库",
    description: "管理内容 Agent 官方模板、发布状态、试跑结果和运营标签。",
  },
  storage: {
    key: "storage",
    eyebrow: "Storage",
    title: "存储治理",
    description: "治理 OSS 容量、用户文件占用、资源类型分布和上传风险。",
  },
  settings: {
    key: "settings",
    eyebrow: "System",
    title: "系统设置",
    description: "集中配置模型策略、内容安全、通知规则和平台级开关。",
  },
};

export function getAdminPageMeta(pathname: string): AdminPageMeta {
  if (pathname.startsWith("/users")) {
    return adminPageMetaMap.users;
  }
  if (pathname.startsWith("/roles")) {
    return adminPageMetaMap.roles;
  }
  if (pathname.startsWith("/tokens")) {
    return adminPageMetaMap.tokens;
  }
  if (pathname.startsWith("/audit")) {
    return adminPageMetaMap.audit;
  }
  if (pathname.startsWith("/templates")) {
    return adminPageMetaMap.templates;
  }
  if (pathname.startsWith("/storage")) {
    return adminPageMetaMap.storage;
  }
  if (pathname.startsWith("/settings")) {
    return adminPageMetaMap.settings;
  }
  return adminPageMetaMap.dashboard;
}
