import { API_BASE_URL } from "./config";
import type {
  AdminDashboardData,
  AdminRoleSummaryResponse,
  AdminUserItem,
  AdminUserPasswordResetApiResponse,
  AdminUserRoleUpdatePayload,
  AdminUserStatusPayload,
  AdminUserTokenUpdateApiResponse,
  AdminUserTokenUpdatePayload,
  AdminUsersApiResponse,
  AuthResponse,
  AuthenticatedUser,
  LogoutResponse,
  UserRole,
} from "./types";

const ACCESS_TOKEN_STORAGE_KEY = "omnimedia_admin_access_token";
const REFRESH_TOKEN_STORAGE_KEY = "omnimedia_admin_refresh_token";
const USER_STORAGE_KEY = "omnimedia_admin_user";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

type APIErrorOptions = {
  status: number;
  code: string;
  cause?: unknown;
};

type RequestOptions = {
  attachAuth?: boolean;
  skipAuthRefresh?: boolean;
  timeoutMs?: number;
};

type ValidationIssue = {
  loc?: Array<string | number>;
  msg?: string;
};

let refreshInFlight: Promise<AuthResponse> | null = null;

export class APIError extends Error {
  status: number;
  code: string;
  cause?: unknown;

  constructor(message: string, options: APIErrorOptions) {
    super(message);
    this.name = "APIError";
    this.status = options.status;
    this.code = options.code;
    this.cause = options.cause;
  }
}

export function isAdminRole(role?: string | null): role is UserRole {
  return (
    role === "super_admin" ||
    role === "admin" ||
    role === "finance" ||
    role === "operator"
  );
}

export function getStoredToken(): string {
  return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ?? "";
}

function setStoredToken(token: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
}

function getStoredRefreshToken(): string {
  return window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? "";
}

function setStoredRefreshToken(token: string): void {
  window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
}

export function getStoredUser(): AuthenticatedUser | null {
  const raw = window.localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthenticatedUser;
  } catch {
    window.localStorage.removeItem(USER_STORAGE_KEY);
    return null;
  }
}

function setStoredUser(user: AuthenticatedUser): void {
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredSession(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  window.localStorage.removeItem(USER_STORAGE_KEY);
}

function buildApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export function buildAbsoluteMediaUrl(value?: string | null): string {
  const normalizedValue = (value || "").trim();
  if (!normalizedValue) {
    return "";
  }

  if (/^(https?:)?\/\//i.test(normalizedValue) || normalizedValue.startsWith("data:")) {
    return normalizedValue;
  }

  return new URL(normalizedValue, `${API_BASE_URL}/`).toString();
}

function formatValidationIssues(detail: ValidationIssue[]): string {
  return detail
    .map((issue) => {
      const path = Array.isArray(issue.loc) ? issue.loc.join(".") : "body";
      const message = typeof issue.msg === "string" ? issue.msg : "输入不合法";
      return `${path}: ${message}`;
    })
    .join(" | ");
}

async function readErrorDetail(
  response: Response,
  fallbackMessage: string,
): Promise<{ message: string; code: string }> {
  try {
    const data = (await response.json()) as {
      detail?: string | ValidationIssue[];
      code?: string;
    };

    if (typeof data.detail === "string" && data.detail.trim()) {
      return {
        message: data.detail,
        code: typeof data.code === "string" ? data.code : "HTTP_ERROR",
      };
    }

    if (Array.isArray(data.detail) && data.detail.length > 0) {
      return {
        message: formatValidationIssues(data.detail),
        code: "VALIDATION_ERROR",
      };
    }
  } catch {
    return { message: fallbackMessage, code: "HTTP_ERROR" };
  }

  return { message: fallbackMessage, code: "HTTP_ERROR" };
}

function buildHTTPErrorMessage(status: number): string {
  if (status === 401) {
    return "当前登录状态已失效，请重新登录。";
  }
  if (status === 403) {
    return "当前账号无权访问后台接口。";
  }
  if (status === 404) {
    return "请求的资源不存在。";
  }
  if (status === 409) {
    return "资源状态冲突，请刷新后重试。";
  }
  if (status === 422) {
    return "请求参数格式不正确，请检查输入内容。";
  }
  return `请求失败，状态码 ${status}。`;
}

function buildRequestHeaders(
  initHeaders: HeadersInit | undefined,
  attachAuth: boolean,
): Headers {
  const headers = new Headers(initHeaders ?? {});
  if (attachAuth && !headers.has("Authorization")) {
    const token = getStoredToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  return headers;
}

async function executeRequest(
  input: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const externalSignal = init.signal;
  let didTimeout = false;
  let timeoutId: number | null = null;

  const onAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onAbort);
    }
  }

  if (timeoutMs > 0) {
    timeoutId = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  try {
    const response = await fetch(buildApiUrl(input), {
      ...init,
      headers: buildRequestHeaders(init.headers, options.attachAuth !== false),
      signal: controller.signal,
    });

    if (!response.ok) {
      const fallbackMessage = buildHTTPErrorMessage(response.status);
      const detail = await readErrorDetail(response, fallbackMessage);
      throw new APIError(detail.message, {
        status: response.status,
        code: response.status === 401 ? "UNAUTHORIZED" : detail.code,
      });
    }

    return response;
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      if (externalSignal?.aborted && !didTimeout) {
        throw error;
      }

      if (didTimeout) {
        throw new APIError("请求超时，请稍后重试。", {
          status: 408,
          code: "REQUEST_TIMEOUT",
          cause: error,
        });
      }

      throw new APIError("请求已取消。", {
        status: 499,
        code: "REQUEST_ABORTED",
        cause: error,
      });
    }

    if (error instanceof TypeError) {
      throw new APIError("网络连接异常，请检查网络后重试。", {
        status: 0,
        code: "NETWORK_ERROR",
        cause: error,
      });
    }

    throw new APIError("请求失败，请稍后重试。", {
      status: 0,
      code: "UNKNOWN_ERROR",
      cause: error,
    });
  } finally {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onAbort);
    }
  }
}

function ensureAdminUser(user: AuthenticatedUser): AuthenticatedUser {
  if (user.status === "frozen") {
    clearStoredSession();
    throw new APIError("账号已被冻结，无法进入后台。", {
      status: 403,
      code: "ACCOUNT_FROZEN",
    });
  }

  if (!isAdminRole(user.role)) {
    clearStoredSession();
    throw new APIError("权限不足：该账号非管理团队成员，禁止访问！", {
      status: 403,
      code: "ROLE_FORBIDDEN",
    });
  }

  return user;
}

function persistAuthSession(payload: AuthResponse): AuthResponse {
  ensureAdminUser(payload.user);
  setStoredToken(payload.access_token);
  setStoredRefreshToken(payload.refresh_token);
  setStoredUser(payload.user);
  return payload;
}

export function persistAdminSession(payload: AuthResponse): AuthResponse {
  return persistAuthSession(payload);
}

async function refreshAuthSession(): Promise<AuthResponse> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    clearStoredSession();
    throw new APIError("当前登录状态已失效，请重新登录。", {
      status: 401,
      code: "UNAUTHORIZED",
    });
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const response = await executeRequest(
        "/api/v1/auth/refresh",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
        },
        {
          attachAuth: false,
          skipAuthRefresh: true,
          timeoutMs: 15000,
        },
      );

      const payload = (await response.json()) as AuthResponse;
      return persistAuthSession(payload);
    } catch (error) {
      clearStoredSession();
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError("刷新登录状态失败，请重新登录。", {
        status: 401,
        code: "REFRESH_FAILED",
        cause: error,
      });
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function fetchWithInterceptor(
  input: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<Response> {
  try {
    return await executeRequest(input, init, options);
  } catch (error) {
    if (
      error instanceof APIError &&
      error.status === 401 &&
      !options.skipAuthRefresh
    ) {
      await refreshAuthSession();
      return executeRequest(input, init, {
        ...options,
        skipAuthRefresh: true,
      });
    }

    throw error;
  }
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const formData = new URLSearchParams();
  formData.set("username", username);
  formData.set("password", password);

  const response = await fetchWithInterceptor(
    "/api/v1/auth/login",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    },
    {
      attachAuth: false,
      skipAuthRefresh: true,
      timeoutMs: 15000,
    },
  );

  return (await response.json()) as AuthResponse;
}

export async function fetchCurrentUser(token: string): Promise<AuthenticatedUser> {
  const response = await fetchWithInterceptor(
    "/api/v1/users/me",
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    {
      attachAuth: false,
      skipAuthRefresh: true,
      timeoutMs: 15000,
    },
  );

  return (await response.json()) as AuthenticatedUser;
}

export async function logoutAPI(): Promise<LogoutResponse | null> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    return null;
  }

  const response = await fetchWithInterceptor(
    "/api/v1/auth/logout",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
    {
      skipAuthRefresh: true,
      timeoutMs: 15000,
    },
  );

  return (await response.json()) as LogoutResponse;
}

export async function fetchAdminUsers(params?: {
  skip?: number;
  limit?: number;
  search?: string;
}): Promise<AdminUsersApiResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("skip", String(params?.skip ?? 0));
  searchParams.set("limit", String(params?.limit ?? 20));
  if (params?.search?.trim()) {
    searchParams.set("search", params.search.trim());
  }

  const response = await fetchWithInterceptor(
    `/api/v1/admin/users?${searchParams.toString()}`,
    { method: "GET" },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as AdminUsersApiResponse;
}

export async function fetchAdminDashboardSummary(): Promise<AdminDashboardData> {
  const response = await fetchWithInterceptor(
    "/api/v1/admin/dashboard",
    { method: "GET" },
    { timeoutMs: 20000 },
  );

  return (await response.json()) as AdminDashboardData;
}

export async function fetchAdminRoleSummary(): Promise<AdminRoleSummaryResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/admin/roles/summary",
    { method: "GET" },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as AdminRoleSummaryResponse;
}

export async function updateAdminUserStatus(
  userId: string,
  payload: AdminUserStatusPayload,
): Promise<AdminUserItem> {
  const response = await fetchWithInterceptor(
    `/api/v1/admin/users/${userId}/status`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as AdminUserItem;
}

export async function resetAdminUserPassword(
  userId: string,
): Promise<AdminUserPasswordResetApiResponse> {
  const response = await fetchWithInterceptor(
    `/api/v1/admin/users/${userId}/reset-password`,
    { method: "POST" },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as AdminUserPasswordResetApiResponse;
}

export async function updateAdminUserTokens(
  userId: string,
  payload: AdminUserTokenUpdatePayload,
): Promise<AdminUserTokenUpdateApiResponse> {
  const response = await fetchWithInterceptor(
    `/api/v1/admin/users/${userId}/tokens`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as AdminUserTokenUpdateApiResponse;
}

export async function updateAdminUserRole(
  userId: string,
  payload: AdminUserRoleUpdatePayload,
): Promise<AdminUserItem> {
  const response = await fetchWithInterceptor(
    `/api/v1/admin/users/${userId}/role`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as AdminUserItem;
}
