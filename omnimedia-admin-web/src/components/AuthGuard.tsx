import type { ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { clearStoredSession, getStoredToken, getStoredUser, isAdminRole } from "../api";

type AuthGuardProps = {
  children?: ReactNode;
  onUnauthorized?: () => void;
};

type AuthRedirectState = {
  authError: string;
  from: string;
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

  return children ? <>{children}</> : <Outlet />;
}
