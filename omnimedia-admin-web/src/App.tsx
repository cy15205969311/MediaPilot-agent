import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  FileText,
  HardDrive,
  Settings,
  Shield,
  Wallet,
  XCircle,
} from "lucide-react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";

import { clearStoredSession, getStoredUser, isAdminRole, logoutAPI } from "./api";
import { AdminLayout } from "./components/AdminLayout";
import { AuthGuard } from "./components/AuthGuard";
import { ToastViewport } from "./components/ToastViewport";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminPlaceholderPage } from "./pages/AdminPlaceholderPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { Login } from "./pages/Login";
import type { AdminToast, AuthenticatedUser } from "./types";

type ToastState = AdminToast & {
  id: number;
};

function ProtectedShell(props: {
  currentUser: AuthenticatedUser;
  onLogout: () => Promise<void>;
}) {
  const { currentUser, onLogout } = props;

  return (
    <AdminLayout currentUser={currentUser} onLogout={onLogout}>
      <Outlet />
    </AdminLayout>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(() =>
    getStoredUser(),
  );
  const [toast, setToast] = useState<ToastState | null>(null);

  const pushToast = (payload: AdminToast) => {
    setToast({
      id: Date.now(),
      ...payload,
    });
  };

  const handleAuthenticated = (user: AuthenticatedUser, nextToast: AdminToast) => {
    setCurrentUser(user);
    pushToast(nextToast);
  };

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutMs = toast.tone === "success" ? 3600 : 5200;
    const timerId = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, timeoutMs);

    return () => window.clearTimeout(timerId);
  }, [toast]);

  const handleLogout = async () => {
    try {
      await logoutAPI();
    } catch {
      // If logout fails remotely we still clear the local admin session.
    } finally {
      clearStoredSession();
      setCurrentUser(null);
      pushToast({
        tone: "success",
        title: "已退出登录",
        message: "后台会话已安全清除。",
      });
    }
  };

  const isCurrentUserAllowed =
    currentUser !== null &&
    currentUser.status === "active" &&
    isAdminRole(currentUser.role);

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            isCurrentUserAllowed ? (
              <Navigate replace to="/dashboard" />
            ) : (
              <Login onAuthenticated={handleAuthenticated} onToast={pushToast} />
            )
          }
        />

        <Route path="/register" element={<Navigate replace to="/login" />} />

        <Route
          element={<AuthGuard onUnauthorized={() => setCurrentUser(null)} />}
        >
          <Route
            element={
              currentUser ? (
                <ProtectedShell currentUser={currentUser} onLogout={handleLogout} />
              ) : (
                <Navigate replace to="/login" />
              )
            }
          >
            <Route path="/" element={<Navigate replace to="/dashboard" />} />
            <Route path="/dashboard" element={<AdminDashboardPage onToast={pushToast} />} />
            <Route
              path="/users"
              element={
                currentUser ? (
                  <AdminUsersPage currentUser={currentUser} onToast={pushToast} />
                ) : (
                  <Navigate replace to="/login" />
                )
              }
            />
            <Route
              path="/roles"
              element={
                <AdminPlaceholderPage
                  badge="RBAC Roadmap"
                  ctaLabel="前往用户中心"
                  ctaTo="/users"
                  description="这里会继续承接角色组、菜单权限、操作授权和审批策略，后续可直接与后台权限模型对接。"
                  highlights={[
                    "建议将角色与菜单权限拆成独立资源，方便后续做细粒度授权。",
                    "高风险操作可以先统一沉淀到这里，再逐步补齐审批流。",
                    "当前路由守卫已经严格限制只有管理角色可以进入后台。",
                  ]}
                  icon={<Shield className="h-6 w-6" />}
                  title="角色权限模块建设中"
                />
              }
            />
            <Route
              path="/tokens"
              element={
                <AdminPlaceholderPage
                  badge="Balance Ledger"
                  ctaLabel="打开用户中心"
                  ctaTo="/users"
                  description="Token 流水页适合承接充值记录、扣减明细、按用户筛选和运营备注检索，后续可以直接接入后台台账接口。"
                  highlights={[
                    "建议记录操作人、原因、前后余额和事务 ID，方便审计与追踪。",
                    "可以在这里收口额度变更明细，而不是继续分散在用户页面。",
                    "如果后端新增专门的台账接口，这个模块可以无缝接入。",
                  ]}
                  icon={<Wallet className="h-6 w-6" />}
                  title="Token 流水模块即将接入"
                />
              }
            />
            <Route
              path="/audit"
              element={
                <AdminPlaceholderPage
                  badge="Ops Trace"
                  ctaLabel="查看数据总览"
                  ctaTo="/dashboard"
                  description="审计日志适合收口冻结账号、重置密码、调整 Token 额度以及系统配置变更等关键后台动作。"
                  highlights={[
                    "建议按动作类型、操作人、时间范围与目标账号提供组合筛选。",
                    "这类数据能显著提升运营追踪与复盘效率。",
                    "当前用户中心的真实操作入口已经具备沉淀审计事件的基础。",
                  ]}
                  icon={<FileText className="h-6 w-6" />}
                  title="审计日志模块建设中"
                />
              }
            />
            <Route
              path="/templates"
              element={
                <AdminPlaceholderPage
                  badge="Template Ops"
                  ctaLabel="打开用户中心"
                  ctaTo="/users"
                  description="模板库用于管理官方内容模板、发布状态、分类标签和试跑结果。"
                  highlights={[
                    "建议把模板类型、适用平台和启停状态统一沉淀为可筛选字段。",
                    "热门模板可以接入使用次数、评分和最近更新数据，辅助运营决策。",
                    "后续接入真实模板接口后，可以直接替换当前占位数据结构。",
                  ]}
                  icon={<Database className="h-6 w-6" />}
                  title="模板库模块建设中"
                />
              }
            />
            <Route
              path="/storage"
              element={
                <AdminPlaceholderPage
                  badge="Storage"
                  ctaLabel="查看数据总览"
                  ctaTo="/dashboard"
                  description="存储治理页用于汇总 OSS 容量、文件类型分布、用户占用排行和异常上传风险。"
                  highlights={[
                    "建议优先接入总容量、剩余容量和用户用量排行，形成治理闭环。",
                    "文件类型分布可以帮助判断图片、视频、文档等资源的增长趋势。",
                    "高风险上传记录可与审计日志联动，便于追踪异常操作。",
                  ]}
                  icon={<HardDrive className="h-6 w-6" />}
                  title="存储治理模块建设中"
                />
              }
            />
            <Route
              path="/settings"
              element={
                <AdminPlaceholderPage
                  badge="System Controls"
                  ctaLabel="返回数据总览"
                  ctaTo="/dashboard"
                  description="系统设置页可以统一管理后台环境变量、模型策略、功能开关和平台级说明，避免配置散落。"
                  highlights={[
                    "高风险配置建议拆成只读信息卡与受控修改流程。",
                    "如果后续要支持多环境切换，也适合在这里做统一展示。",
                    "当前页面已经预留完整的路由与轻量化视觉结构，后续可逐步补全。",
                  ]}
                  icon={<Settings className="h-6 w-6" />}
                  title="系统设置模块建设中"
                />
              }
            />
          </Route>
        </Route>

        <Route
          path="*"
          element={<Navigate replace to={isCurrentUserAllowed ? "/dashboard" : "/login"} />}
        />
      </Routes>

      <ToastViewport onClose={() => setToast(null)} toast={toast}>
        {toast ? (
          <>
            <div className="mt-0.5 shrink-0">
              {toast.tone === "success" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : toast.tone === "warning" ? (
                <AlertCircle className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">{toast.title}</div>
              <div className="mt-1 text-sm leading-6 text-slate-500">{toast.message}</div>
            </div>
          </>
        ) : null}
      </ToastViewport>
    </>
  );
}

export default App;
