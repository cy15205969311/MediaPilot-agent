import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { getDefaultAdminRoute } from "./adminMeta";
import { clearStoredSession, getStoredUser, isAdminRole, logoutAPI } from "./api";
import { AdminLayout } from "./components/AdminLayout";
import { AuthGuard } from "./components/AuthGuard";
import { ToastViewport } from "./components/ToastViewport";
import { AdminAuditLogsPage } from "./pages/AdminAuditLogsPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminRolesPage } from "./pages/AdminRolesPage";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { AdminStoragePage } from "./pages/AdminStoragePage";
import { AdminTemplatesPage } from "./pages/AdminTemplatesPage";
import { AdminTokensPage } from "./pages/AdminTokensPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { Login } from "./pages/Login";
import type { AdminToast, AuthenticatedUser } from "./types";

type ToastState = AdminToast & {
  id: number;
};

function ProtectedShell(props: {
  currentUser: AuthenticatedUser;
  onLogout: () => Promise<void>;
  onToast: (toast: AdminToast) => void;
}) {
  const { currentUser, onLogout, onToast } = props;
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const notice = (location.state as { routeGuardNotice?: string } | null)?.routeGuardNotice;
    if (!notice) {
      return;
    }

    onToast({
      tone: "warning",
      title: "已切换至安全工作区",
      message: notice,
    });

    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      },
      { replace: true, state: null },
    );
  }, [location.hash, location.pathname, location.search, location.state, navigate, onToast]);

  return (
    <AdminLayout currentUser={currentUser} onLogout={onLogout} onToast={onToast}>
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
      // Even if remote logout fails, local state should still be cleared.
    } finally {
      clearStoredSession();
      setCurrentUser(null);
      pushToast({
        tone: "success",
        title: "已退出登录",
        message: "后台会话已经安全清除。",
      });
    }
  };

  const isCurrentUserAllowed =
    currentUser !== null &&
    currentUser.status === "active" &&
    isAdminRole(currentUser.role);
  const defaultAdminRoute = currentUser ? getDefaultAdminRoute(currentUser.role) : "/login";

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            isCurrentUserAllowed ? (
              <Navigate replace to={defaultAdminRoute} />
            ) : (
              <Login onAuthenticated={handleAuthenticated} onToast={pushToast} />
            )
          }
        />

        <Route path="/register" element={<Navigate replace to="/login" />} />

        <Route element={<AuthGuard onUnauthorized={() => setCurrentUser(null)} />}>
          <Route
            element={
              currentUser ? (
                <ProtectedShell
                  currentUser={currentUser}
                  onLogout={handleLogout}
                  onToast={pushToast}
                />
              ) : (
                <Navigate replace to="/login" />
              )
            }
          >
            <Route path="/" element={<Navigate replace to={defaultAdminRoute} />} />
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
            <Route path="/roles" element={<AdminRolesPage onToast={pushToast} />} />
            <Route path="/tokens" element={<AdminTokensPage onToast={pushToast} />} />
            <Route path="/audit" element={<AdminAuditLogsPage onToast={pushToast} />} />
            <Route path="/templates" element={<AdminTemplatesPage onToast={pushToast} />} />
            <Route path="/storage" element={<AdminStoragePage onToast={pushToast} />} />
            <Route path="/settings" element={<AdminSettingsPage onToast={pushToast} />} />
            <Route path="*" element={<Navigate replace to={defaultAdminRoute} />} />
          </Route>
        </Route>

        <Route
          path="*"
          element={<Navigate replace to={isCurrentUserAllowed ? defaultAdminRoute : "/login"} />}
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
