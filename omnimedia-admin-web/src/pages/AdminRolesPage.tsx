import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Save,
  Shield,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";

import { APIError, fetchAdminRoleSummary } from "../api";
import type { AdminToast, Permission, PermissionModule, Role } from "../types";

type AdminRolesPageProps = {
  onToast: (toast: AdminToast) => void;
};

type DrawerState =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
      roleId: string;
    }
  | null;

const PERMISSIONS: Permission[] = [
  {
    id: "users.manage",
    label: "用户管理",
    description: "查看、检索与维护用户账号信息。",
    module: "users",
  },
  {
    id: "users.freeze",
    label: "冻结与解冻",
    description: "执行账号冻结、解冻与风险阻断。",
    module: "users",
  },
  {
    id: "assets.tokens.manage",
    label: "Token 管理",
    description: "调整 Token 额度并写入审计备注。",
    module: "assets",
  },
  {
    id: "assets.ledger.view",
    label: "Token 流水",
    description: "查看 Token 资产流水与模型消耗明细。",
    module: "assets",
  },
  {
    id: "content.review",
    label: "内容审核",
    description: "查看并审核平台生成内容与素材。",
    module: "content",
  },
  {
    id: "content.publish",
    label: "内容配置",
    description: "管理模板、选题与内容分发策略。",
    module: "content",
  },
  {
    id: "content.analytics",
    label: "数据查看",
    description: "查看后台概览、趋势与内容表现数据。",
    module: "content",
  },
  {
    id: "finance.reports",
    label: "财务报表",
    description: "查看运营与财务报表摘要。",
    module: "finance",
  },
  {
    id: "finance.recharge",
    label: "用户充值",
    description: "处理充值记录、赠送额度与客户补偿。",
    module: "finance",
  },
  {
    id: "finance.export",
    label: "数据导出",
    description: "导出账单、流水与统计数据。",
    module: "finance",
  },
];

const MODULE_META: Record<PermissionModule, { title: string; description: string }> = {
  users: {
    title: "用户模块",
    description: "围绕账号、状态与风险处置的治理权限。",
  },
  assets: {
    title: "资产模块",
    description: "围绕 Token 余额、流水与额度调度的资产权限。",
  },
  content: {
    title: "内容模块",
    description: "围绕内容审核、模板配置与数据查看的运营权限。",
  },
  finance: {
    title: "财务模块",
    description: "围绕报表、充值与导出的经营分析权限。",
  },
};

const MODULE_ORDER: PermissionModule[] = ["users", "assets", "content", "finance"];

const PERMISSION_INDEX = new Map(PERMISSIONS.map((permission, index) => [permission.id, index]));

function buildInitialRoles(): Role[] {
  return [
    {
      id: "super-admin",
      name: "超级管理员",
      memberCount: 0,
      permissions: PERMISSIONS.map((permission) => permission.id),
      isSystem: true,
    },
    {
      id: "operations",
      name: "运营人员",
      memberCount: 0,
      permissions: [
        "users.manage",
        "content.review",
        "content.analytics",
        "assets.tokens.manage",
      ],
      isSystem: false,
    },
    {
      id: "finance",
      name: "财务人员",
      memberCount: 0,
      permissions: [
        "finance.reports",
        "assets.ledger.view",
        "finance.recharge",
        "finance.export",
      ],
      isSystem: false,
    },
  ];
}

function resolveMemberCount(role: Role, summary: Record<string, number>): number {
  if (role.id === "super-admin") {
    return summary.super_admin ?? 0;
  }
  if (role.id === "operations") {
    return summary.operator ?? 0;
  }
  if (role.id === "finance") {
    return summary.finance ?? 0;
  }
  return role.memberCount;
}

function sortPermissionIds(permissionIds: string[]): string[] {
  return [...permissionIds].sort(
    (left, right) =>
      (PERMISSION_INDEX.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (PERMISSION_INDEX.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

function getRoleAccent(role: Role) {
  if (role.isSystem) {
    return {
      iconBg: "bg-red-50",
      iconText: "text-red-500",
      buttonBg: "bg-slate-100",
      buttonText: "text-slate-400",
      badgeBg: "bg-red-50",
      badgeText: "text-red-500",
    };
  }

  if (role.id === "finance") {
    return {
      iconBg: "bg-blue-50",
      iconText: "text-blue-500",
      buttonBg: "bg-red-50",
      buttonText: "text-red-500",
      badgeBg: "bg-blue-50",
      badgeText: "text-blue-600",
    };
  }

  return {
    iconBg: "bg-amber-50",
    iconText: "text-amber-500",
    buttonBg: "bg-red-50",
    buttonText: "text-red-500",
    badgeBg: "bg-amber-50",
    badgeText: "text-amber-600",
  };
}

export function AdminRolesPage(props: AdminRolesPageProps) {
  const { onToast } = props;
  const [roles, setRoles] = useState<Role[]>(() => buildInitialRoles());
  const [drawerState, setDrawerState] = useState<DrawerState>(null);
  const [roleName, setRoleName] = useState("");
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);

  const permissionMap = useMemo(
    () => new Map(PERMISSIONS.map((permission) => [permission.id, permission])),
    [],
  );

  const permissionsByModule = useMemo(() => {
    return MODULE_ORDER.reduce<Record<PermissionModule, Permission[]>>((result, module) => {
      result[module] = PERMISSIONS.filter((permission) => permission.module === module);
      return result;
    }, {} as Record<PermissionModule, Permission[]>);
  }, []);

  const activeRole = useMemo(() => {
    if (!drawerState || drawerState.mode !== "edit") {
      return null;
    }

    return roles.find((role) => role.id === drawerState.roleId) ?? null;
  }, [drawerState, roles]);

  useEffect(() => {
    let disposed = false;

    const loadRoleSummary = async () => {
      try {
        const summary = await fetchAdminRoleSummary();
        if (disposed) {
          return;
        }

        setRoles((current) =>
          current.map((role) => ({
            ...role,
            memberCount: resolveMemberCount(role, summary),
          })),
        );
      } catch (error) {
        if (disposed) {
          return;
        }

        onToast({
          tone: "warning",
          title: "角色成员数据加载失败",
          message:
            error instanceof APIError
              ? error.message
              : error instanceof Error
                ? error.message
                : "角色成员聚合暂时不可用，当前先以 0 个成员展示。",
        });
      }
    };

    void loadRoleSummary();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!drawerState) {
      return;
    }

    if (drawerState.mode === "edit" && activeRole) {
      setRoleName(activeRole.name);
      setSelectedPermissionIds(sortPermissionIds(activeRole.permissions));
      return;
    }

    setRoleName("");
    setSelectedPermissionIds([]);
  }, [drawerState, activeRole]);

  useEffect(() => {
    if (!drawerState) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerState(null);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [drawerState]);

  const roleCards = useMemo(() => {
    return roles.map((role) => ({
      ...role,
      permissionDetails: role.permissions
        .map((permissionId) => permissionMap.get(permissionId))
        .filter((permission): permission is Permission => Boolean(permission)),
    }));
  }, [permissionMap, roles]);

  const handleProtectedRoleAction = (role: Role) => {
    onToast({
      tone: "warning",
      title: "系统角色已锁定",
      message: `${role.name} 为系统原生角色，当前不允许编辑或删除。`,
    });
  };

  const handleOpenCreateDrawer = () => {
    setDrawerState({ mode: "create" });
  };

  const handleOpenEditDrawer = (role: Role) => {
    if (role.isSystem) {
      handleProtectedRoleAction(role);
      return;
    }

    setDrawerState({ mode: "edit", roleId: role.id });
  };

  const handleCloseDrawer = () => {
    setDrawerState(null);
  };

  const handleTogglePermission = (permissionId: string) => {
    setSelectedPermissionIds((current) => {
      if (current.includes(permissionId)) {
        return current.filter((item) => item !== permissionId);
      }

      return sortPermissionIds([...current, permissionId]);
    });
  };

  const handleSaveRole = () => {
    const normalizedName = roleName.trim();
    if (!normalizedName) {
      onToast({
        tone: "warning",
        title: "角色名称不能为空",
        message: "请输入角色名称后再保存权限配置。",
      });
      return;
    }

    if (selectedPermissionIds.length === 0) {
      onToast({
        tone: "warning",
        title: "请至少选择一项权限",
        message: "企业级 RBAC 角色不能保存为空权限集。",
      });
      return;
    }

    const duplicatedRole = roles.find(
      (role) =>
        role.id !== activeRole?.id &&
        role.name.trim().toLowerCase() === normalizedName.toLowerCase(),
    );

    if (duplicatedRole) {
      onToast({
        tone: "warning",
        title: "角色名称已存在",
        message: `请使用不同的角色名称，避免与 ${duplicatedRole.name} 冲突。`,
      });
      return;
    }

    if (drawerState?.mode === "edit" && activeRole) {
      setRoles((current) =>
        current.map((role) =>
          role.id === activeRole.id
            ? {
                ...role,
                name: normalizedName,
                permissions: sortPermissionIds(selectedPermissionIds),
              }
            : role,
        ),
      );

      onToast({
        tone: "success",
        title: "角色权限已更新",
        message: `${normalizedName} 的权限矩阵已经保存。`,
      });
      handleCloseDrawer();
      return;
    }

    const nextRole: Role = {
      id: `custom-${Date.now().toString(36)}`,
      name: normalizedName,
      memberCount: 0,
      permissions: sortPermissionIds(selectedPermissionIds),
      isSystem: false,
    };

    setRoles((current) => [nextRole, ...current]);
    onToast({
      tone: "success",
      title: "角色创建成功",
      message: `${normalizedName} 已加入角色权限矩阵，后续可继续分配成员。`,
    });
    handleCloseDrawer();
  };

  const drawerTitle = drawerState?.mode === "edit" ? "编辑角色权限" : "新建角色";
  const drawerDescription =
    drawerState?.mode === "edit"
      ? "调整角色名称与权限矩阵，系统角色默认锁定不可编辑。"
      : "为团队创建新的职责角色，并按模块精细化配置访问能力。";

  return (
    <>
      <div className="p-4 lg:p-6">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">角色权限管理</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              以卡片方式统一维护系统角色、自定义角色与模块级权限点，让团队协作、资产调度与风险隔离更清晰。
            </p>
          </div>

          <button
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-red-500 to-orange-400 px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_36px_rgba(248,113,113,0.28)] transition hover:brightness-105"
            onClick={handleOpenCreateDrawer}
            type="button"
          >
            <Plus className="h-4 w-4" />
            新建角色
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {roleCards.map((role) => {
            const accent = getRoleAccent(role);

            return (
              <article
                key={role.id}
                className="flex min-h-[420px] flex-col rounded-[28px] border border-slate-100 bg-white p-6 shadow-sm shadow-slate-200/50"
              >
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-2xl ${accent.iconBg}`}
                  >
                    {role.isSystem ? (
                      <ShieldCheck className={`h-6 w-6 ${accent.iconText}`} />
                    ) : (
                      <Shield className={`h-6 w-6 ${accent.iconText}`} />
                    )}
                  </div>

                  <button
                    className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-slate-400 transition hover:border-red-100 hover:bg-red-50 hover:text-red-500"
                    onClick={() =>
                      role.isSystem ? handleProtectedRoleAction(role) : handleOpenEditDrawer(role)
                    }
                    type="button"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>

                <div className="mb-5">
                  <div className="text-2xl font-bold tracking-tight text-slate-900">
                    {role.name}
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm text-slate-400">
                    <Users className="h-4 w-4" />
                    <span>{role.memberCount} 个成员</span>
                  </div>
                </div>

                <div className="mb-6 space-y-3">
                  {role.permissionDetails.map((permission) => (
                    <div
                      key={permission.id}
                      className="flex items-start gap-3 text-sm leading-6 text-slate-600"
                    >
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                      <span>{permission.label}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-auto">
                  {role.isSystem ? (
                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-400">
                      <span className="font-medium">系统角色不可编辑</span>
                      <Lock className="h-4 w-4" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        className="flex-1 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-500 transition hover:bg-red-100"
                        onClick={() => handleOpenEditDrawer(role)}
                        type="button"
                      >
                        编辑权限
                      </button>
                      <button
                        className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                        onClick={() => handleOpenEditDrawer(role)}
                        type="button"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {drawerState ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/20 backdrop-blur-[2px]">
          <button
            aria-label="关闭角色权限抽屉"
            className="flex-1"
            onClick={handleCloseDrawer}
            type="button"
          />

          <aside className="relative flex h-screen w-full max-w-2xl flex-col overflow-hidden bg-white shadow-[0_28px_90px_rgba(15,23,42,0.18)]">
            <div className="border-b border-slate-100 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium uppercase tracking-[0.18em] text-red-400">
                    RBAC Configuration
                  </div>
                  <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
                    {drawerTitle}
                  </div>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
                    {drawerDescription}
                  </p>
                </div>

                <button
                  aria-label="关闭"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 transition hover:bg-red-100"
                  onClick={handleCloseDrawer}
                  type="button"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <section className="rounded-[28px] border border-slate-100 bg-[#fffdfa] p-5">
                <label className="block">
                  <div className="mb-2 text-sm font-semibold text-slate-800">角色名称</div>
                  <input
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-900 outline-none transition focus:border-red-300 focus:ring-4 focus:ring-red-100"
                    onChange={(event) => setRoleName(event.target.value)}
                    placeholder="请输入角色名称，例如：内容运营主管"
                    type="text"
                    value={roleName}
                  />
                </label>

                <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
                  <span>已选择 {selectedPermissionIds.length} 项权限</span>
                  <span>
                    {drawerState.mode === "edit" && activeRole ? `${activeRole.memberCount} 个成员` : "新角色待分配成员"}
                  </span>
                </div>
              </section>

              <div className="mt-6 space-y-4">
                {MODULE_ORDER.map((module) => (
                  <section
                    key={module}
                    className="rounded-[28px] border border-slate-100 bg-white p-5 shadow-sm shadow-slate-200/40"
                  >
                    <div className="mb-4">
                      <div className="text-base font-semibold text-slate-900">
                        {MODULE_META[module].title}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-500">
                        {MODULE_META[module].description}
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {permissionsByModule[module].map((permission) => {
                        const checked = selectedPermissionIds.includes(permission.id);

                        return (
                          <label
                            key={permission.id}
                            className={`flex cursor-pointer gap-3 rounded-2xl border px-4 py-4 transition ${
                              checked
                                ? "border-red-200 bg-red-50/70 shadow-[0_10px_28px_rgba(248,113,113,0.08)]"
                                : "border-slate-200 bg-white hover:border-red-100 hover:bg-red-50/30"
                            }`}
                          >
                            <input
                              checked={checked}
                              className="mt-1 h-4 w-4 accent-red-500"
                              onChange={() => handleTogglePermission(permission.id)}
                              type="checkbox"
                            />
                            <div>
                              <div className="text-sm font-semibold text-slate-900">
                                {permission.label}
                              </div>
                              <div className="mt-1 text-xs leading-5 text-slate-500">
                                {permission.description}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-100 bg-white px-6 py-4">
              <div className="flex items-center justify-end gap-3">
                <button
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                  onClick={handleCloseDrawer}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-red-500 to-orange-400 px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_36px_rgba(248,113,113,0.24)] transition hover:brightness-105"
                  onClick={handleSaveRole}
                  type="button"
                >
                  <Save className="h-4 w-4" />
                  保存
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
