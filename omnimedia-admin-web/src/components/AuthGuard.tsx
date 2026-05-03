import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { clearStoredSession, getStoredToken, getStoredUser, isAdminRole } from "../api";
import { canAccessAdminPath, getDefaultAdminRoute } from "../adminMeta";

type AuthGuardProps = {
  children?: ReactNode;
  onUnauthorized?: () => void;
};

type AuthRedirectState = {
  authError: string;
  from: string;
  routeGuardNotice?: string;
};

export function AuthGuard(props: AuthGuardProps) {
  const { children, onUnauthorized } = props;
  const location = useLocation();
  const token = getStoredToken();
  const user = getStoredUser();

  if (!token || !user) {
    return (
      <Navigate
        replace
        state={
          {
            authError: "请先登录后台账号。",
            from: location.pathname,
          } satisfies AuthRedirectState
        }
        to="/login"
      />
    );
  }

  if (user.status === "frozen") {
    clearStoredSession();
    onUnauthorized?.();
    return (
      <Navigate
        replace
        state={
          {
            authError: "账号已被冻结，无法访问后台。",
            from: location.pathname,
          } satisfies AuthRedirectState
        }
        to="/login"
      />
    );
  }

  if (!isAdminRole(user.role)) {
    clearStoredSession();
    onUnauthorized?.();
    return (
      <Navigate
        replace
        state={
          {
            authError: "权限不足：该账号非管理团队成员，禁止访问。",
            from: location.pathname,
          } satisfies AuthRedirectState
        }
        to="/login"
      />
    );
  }

  if (!canAccessAdminPath(user.role, location.pathname)) {
    const safeWorkspace = getDefaultAdminRoute(user.role);
    return (
      <Navigate
        replace
        state={
          {
            authError: "您的角色权限不足，已自动为您跳转至安全工作区。",
            from: location.pathname,
            routeGuardNotice: "您的角色权限不足，已自动为您跳转至安全工作区。",
          } satisfies AuthRedirectState
        }
        to={safeWorkspace}
      />
    );
  }

  return children ? <>{children}</> : <Outlet />;
}
