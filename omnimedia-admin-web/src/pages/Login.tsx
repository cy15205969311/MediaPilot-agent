import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, Lock, RefreshCw, ShieldCheck, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  APIError,
  clearStoredSession,
  fetchCurrentUser,
  isAdminRole,
  login,
  persistAdminSession,
} from "../api";
import type { AdminToast, AuthenticatedUser } from "../types";

type LoginProps = {
  onAuthenticated: (user: AuthenticatedUser, toast: AdminToast) => void;
  onToast: (toast: AdminToast) => void;
};

type LoginRouteState = {
  authError?: string;
  from?: string;
};

const REMEMBERED_USERNAME_KEY = "omnimedia_admin_remembered_username";

export function Login(props: LoginProps) {
  const { onAuthenticated, onToast } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const routeState = (location.state ?? null) as LoginRouteState | null;
  const rememberedUsername =
    window.localStorage.getItem(REMEMBERED_USERNAME_KEY)?.trim() ?? "";

  const [username, setUsername] = useState(rememberedUsername);
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(Boolean(rememberedUsername));
  const [showPassword, setShowPassword] = useState(false);
  const [errorText, setErrorText] = useState(routeState?.authError ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (routeState?.authError) {
      setErrorText(routeState.authError);
    }
  }, [routeState?.authError]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setErrorText("请输入账号和密码。");
      return;
    }

    setIsSubmitting(true);
    setErrorText("");

    try {
      const authPayload = await login(normalizedUsername, password);
      const currentUser = await fetchCurrentUser(authPayload.access_token);

      if (currentUser.status === "frozen") {
        clearStoredSession();
        setErrorText("账号已被冻结，无法访问后台。");
        return;
      }

      if (!isAdminRole(currentUser.role)) {
        clearStoredSession();
        const forbiddenMessage = "权限不足：该账号非管理团队成员，禁止访问。";
        setErrorText(forbiddenMessage);
        onToast({
          tone: "error",
          title: "越权访问已拦截",
          message: forbiddenMessage,
        });
        return;
      }

      if (rememberMe) {
        window.localStorage.setItem(REMEMBERED_USERNAME_KEY, normalizedUsername);
      } else {
        window.localStorage.removeItem(REMEMBERED_USERNAME_KEY);
      }

      persistAdminSession({
        ...authPayload,
        user: currentUser,
      });

      onAuthenticated(currentUser, {
        tone: "success",
        title: "登录成功",
        message: "欢迎进入 OmniMedia Console。",
      });
      navigate(routeState?.from || "/", { replace: true });
    } catch (error) {
      const message =
        error instanceof APIError
          ? error.message
          : error instanceof Error
            ? error.message
            : "登录失败，请稍后重试。";
      clearStoredSession();
      setErrorText(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfaf7] px-4 py-10 text-gray-900">
      <section className="w-full max-w-[620px] overflow-hidden rounded-[28px] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.10)]">
        <div className="flex min-h-[200px] flex-col items-center justify-center bg-gradient-to-br from-red-500 via-rose-500 to-orange-400 px-8 py-8 text-center text-white">
          <div className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] backdrop-blur">
            <ShieldCheck className="h-9 w-9 stroke-[2.4]" />
          </div>
          <h1 className="mt-5 text-3xl font-bold tracking-tight">OmniMedia Console</h1>
          <p className="mt-3 text-base font-medium text-white/90">全媒体内容管理后台</p>
        </div>

        <div className="border-b border-gray-100 bg-white px-10">
          <div className="inline-flex border-b-2 border-red-500 px-1 py-5 text-lg font-bold text-red-500">
            管理员登录
          </div>
        </div>

        <form className="space-y-5 px-10 pb-8 pt-6" onSubmit={handleSubmit}>
          <label className="block">
            <span className="mb-3 block text-base font-medium text-gray-800">
              用户名 / 邮箱
            </span>
            <span className="relative block">
              <User className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                autoComplete="username"
                className="h-14 w-full rounded-xl border border-slate-200 bg-white pl-14 pr-5 text-base text-gray-900 outline-none transition placeholder:text-slate-400 focus:border-red-300 focus:ring-4 focus:ring-red-100"
                onChange={(event) => setUsername(event.target.value)}
                placeholder="请输入用户名或邮箱"
                value={username}
              />
            </span>
          </label>

          <label className="block">
            <span className="mb-3 block text-base font-medium text-gray-800">密码</span>
            <span className="relative block">
              <Lock className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                autoComplete="current-password"
                className="h-14 w-full rounded-xl border border-slate-200 bg-white pl-14 pr-14 text-base text-gray-900 outline-none transition placeholder:text-slate-400 focus:border-red-300 focus:ring-4 focus:ring-red-100"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                className="absolute right-4 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </span>
          </label>

          {errorText ? (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
              {errorText}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4 text-base">
            <label className="inline-flex items-center gap-3 text-gray-700">
              <input
                checked={rememberMe}
                className="h-5 w-5 rounded-md border-slate-300 text-red-500 focus:ring-red-200"
                onChange={(event) => setRememberMe(event.target.checked)}
                type="checkbox"
              />
              记住我
            </label>
            <button
              className="font-medium text-red-500 transition hover:text-red-600"
              onClick={() =>
                onToast({
                  tone: "warning",
                  title: "请联系超级管理员",
                  message: "后台暂未开放自助找回密码，请联系超级管理员重置密码。",
                })
              }
              type="button"
            >
              忘记密码？
            </button>
          </div>

          <button
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-orange-400 text-base font-bold text-white shadow-[0_16px_34px_rgba(244,63,94,0.24)] transition hover:shadow-[0_20px_42px_rgba(244,63,94,0.30)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? <RefreshCw className="h-5 w-5 animate-spin" /> : null}
            {isSubmitting ? "登录中..." : "立即登录"}
          </button>
        </form>
      </section>
    </div>
  );
}
