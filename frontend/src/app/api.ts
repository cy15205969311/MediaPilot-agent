import type {
  AuthSessionsResponse,
  AuthenticatedUser,
  AuthResponse,
  ChatStreamEvent,
  TemplateCreatePayload,
  TemplateDeleteApiResponse,
  TemplateDeletePayload,
  TemplateCategory,
  TemplateSkillsApiResponse,
  DraftsDeleteApiResponse,
  DraftsDeletePayload,
  DraftsApiResponse,
  KnowledgeScopeDeleteApiResponse,
  KnowledgeScopesApiResponse,
  KnowledgeUploadApiResponse,
  LogoutResponse,
  MediaChatRequestPayload,
  PasswordResetConfirmPayload,
  PasswordResetConfirmResponse,
  PasswordResetRequestApiResponse,
  PasswordResetRequestPayload,
  RegisterPayload,
  ResetPasswordPayload,
  ResetPasswordResponse,
  SessionRevokeResponse,
  TopicCreatePayload,
  TopicDeleteApiResponse,
  TopicItem,
  TopicStatus,
  TopicsApiResponse,
  TopicUpdatePayload,
  TemplateSummaryItem,
  TemplatesApiResponse,
  ThreadDeleteApiResponse,
  ThreadMessagesApiResponse,
  ThreadUpdatePayload,
  ThreadsApiResponse,
  UploadApiResponse,
  UserProfileUpdatePayload,
} from "./types";

const TOKEN_STORAGE_KEY = "omnimedia_token";
const REFRESH_TOKEN_STORAGE_KEY = "omnimedia_refresh_token";
const USER_STORAGE_KEY = "omnimedia_user";

type APIErrorOptions = {
  status: number;
  code: string;
  cause?: unknown;
};

type RequestOptions = {
  timeoutMs?: number;
  skipAuthRefresh?: boolean;
  attachAuth?: boolean;
};

type ValidationIssue = {
  loc?: Array<string | number>;
  msg?: string;
  type?: string;
};

let refreshInFlight: Promise<AuthResponse> | null = null;

export class APIError extends Error {
  status: number;
  code: string;

  constructor(message: string, options: APIErrorOptions) {
    super(message);
    this.name = "APIError";
    this.status = options.status;
    this.code = options.code;
    if (options.cause) {
      this.cause = options.cause;
    }
  }
}

export function getStoredToken(): string {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
}

export function setStoredToken(token: string): void {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function getStoredRefreshToken(): string {
  return window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? "";
}

export function setStoredRefreshToken(token: string): void {
  window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
}

export function clearStoredRefreshToken(): void {
  window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
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

export function setStoredUser(user: AuthenticatedUser): void {
  window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredUser(): void {
  window.localStorage.removeItem(USER_STORAGE_KEY);
}

function persistAuthSession(payload: AuthResponse): void {
  setStoredToken(payload.access_token);
  setStoredRefreshToken(payload.refresh_token);
  setStoredUser(payload.user);
}

function clearStoredSession(): void {
  clearStoredToken();
  clearStoredRefreshToken();
  clearStoredUser();
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof APIError && error.status === 401;
}

function formatValidationIssues(detail: ValidationIssue[]): string {
  return detail
    .map((issue) => {
      const path = Array.isArray(issue.loc) ? issue.loc.join(".") : "body";
      const message = typeof issue.msg === "string" ? issue.msg : "invalid input";
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
  if (status === 413) {
    return "上传文件过大，请压缩后重试。";
  }
  if (status === 415) {
    return "上传文件类型不受支持，请更换文件格式。";
  }
  if (status === 422) {
    return "请求数据格式不正确，请检查输入内容。";
  }
  return `请求失败，状态码 ${status}`;
}

function parseEventBlock(rawBlock: string): ChatStreamEvent | null {
  if (!rawBlock.trim()) {
    return null;
  }

  let eventName = "";
  let dataPayload = "";

  for (const line of rawBlock.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    }
    if (line.startsWith("data:")) {
      dataPayload += line.slice(5).trim();
    }
  }

  if (!eventName || !dataPayload) {
    return null;
  }

  try {
    const payload = JSON.parse(dataPayload) as Record<string, unknown>;
    return { ...payload, event: eventName } as ChatStreamEvent;
  } catch (error) {
    throw new APIError("收到无法解析的流式事件，请稍后重试。", {
      status: 0,
      code: "STREAM_PARSE_ERROR",
      cause: error,
    });
  }
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
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const externalSignal = init.signal;
  let didTimeout = false;

  const onAbort = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onAbort);
    }
  }

  const timeoutId = window.setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(input, {
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
    window.clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onAbort);
    }
  }
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
          timeoutMs: 15000,
          skipAuthRefresh: true,
          attachAuth: false,
        },
      );

      const payload = (await response.json()) as AuthResponse;
      persistAuthSession(payload);
      return payload;
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

export async function fetchWithInterceptor(
  input: RequestInfo | URL,
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

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/auth/register",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: 15000,
      skipAuthRefresh: true,
      attachAuth: false,
    },
  );

  const authPayload = (await response.json()) as AuthResponse;
  persistAuthSession(authPayload);
  return authPayload;
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
      timeoutMs: 15000,
      skipAuthRefresh: true,
      attachAuth: false,
    },
  );

  const authPayload = (await response.json()) as AuthResponse;
  persistAuthSession(authPayload);
  return authPayload;
}

export async function requestPasswordReset(
  payload: PasswordResetRequestPayload,
): Promise<PasswordResetRequestApiResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/auth/password-reset-request",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: 15000,
      skipAuthRefresh: true,
      attachAuth: false,
    },
  );

  return (await response.json()) as PasswordResetRequestApiResponse;
}

export async function completePasswordReset(
  payload: PasswordResetConfirmPayload,
): Promise<PasswordResetConfirmResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/auth/password-reset",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    {
      timeoutMs: 15000,
      skipAuthRefresh: true,
      attachAuth: false,
    },
  );

  return (await response.json()) as PasswordResetConfirmResponse;
}

export async function logoutAPI(): Promise<LogoutResponse | null> {
  const sendLogout = async (refreshToken: string): Promise<LogoutResponse> => {
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
        timeoutMs: 15000,
        skipAuthRefresh: true,
      },
    );

    return (await response.json()) as LogoutResponse;
  };

  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) {
    return null;
  }

  try {
    return await sendLogout(refreshToken);
  } catch (error) {
    if (error instanceof APIError && error.status === 401) {
      const refreshed = await refreshAuthSession();
      return sendLogout(refreshed.refresh_token);
    }

    throw error;
  }
}

export async function updateUserProfile(
  payload: UserProfileUpdatePayload,
): Promise<AuthenticatedUser> {
  const response = await fetchWithInterceptor(
    "/api/v1/auth/profile",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  const user = (await response.json()) as AuthenticatedUser;
  setStoredUser(user);
  return user;
}

export async function resetPassword(
  payload: ResetPasswordPayload,
): Promise<ResetPasswordResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/auth/reset-password",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as ResetPasswordResponse;
}

export async function fetchSessions(): Promise<AuthSessionsResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/auth/sessions",
    {
      method: "GET",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as AuthSessionsResponse;
}

export async function revokeSession(
  sessionId: string,
): Promise<SessionRevokeResponse> {
  const response = await fetchWithInterceptor(
    `/api/v1/auth/sessions/${sessionId}`,
    {
      method: "DELETE",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as SessionRevokeResponse;
}

export async function uploadMedia(
  file: File,
  purpose: "avatar" | "material" = "material",
  threadId?: string,
): Promise<UploadApiResponse> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("purpose", purpose);
  if (threadId) {
    formData.append("thread_id", threadId);
  }

  const response = await fetchWithInterceptor(
    "/api/v1/media/upload",
    {
      method: "POST",
      body: formData,
    },
    { timeoutMs: 20000 },
  );

  return (await response.json()) as UploadApiResponse;
}

export async function fetchThreads(
  page = 1,
  pageSize = 20,
  includeArchived = false,
): Promise<ThreadsApiResponse> {
  const response = await fetchWithInterceptor(
    `/api/v1/media/threads?page=${page}&page_size=${pageSize}&include_archived=${includeArchived}`,
    {
      method: "GET",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as ThreadsApiResponse;
}

export async function fetchThreadMessages(
  threadId: string,
): Promise<ThreadMessagesApiResponse> {
  const response = await fetchWithInterceptor(
    `/api/v1/media/threads/${threadId}/messages`,
    {
      method: "GET",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as ThreadMessagesApiResponse;
}

export async function fetchArtifacts(): Promise<DraftsApiResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/media/artifacts",
    {
      method: "GET",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as DraftsApiResponse;
}

export async function fetchTopics(status?: TopicStatus): Promise<TopicsApiResponse> {
  const searchParams = new URLSearchParams();
  if (status) {
    searchParams.set("status", status);
  }

  const response = await fetchWithInterceptor(
    `/api/v1/media/topics${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
    {
      method: "GET",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as TopicsApiResponse;
}

export async function createTopic(payload: TopicCreatePayload): Promise<TopicItem> {
  const response = await fetchWithInterceptor(
    "/api/v1/media/topics",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as TopicItem;
}

export async function updateTopic(
  topicId: string,
  payload: TopicUpdatePayload,
): Promise<TopicItem> {
  const response = await fetchWithInterceptor(
    `/api/v1/media/topics/${topicId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as TopicItem;
}

export async function deleteTopic(topicId: string): Promise<TopicDeleteApiResponse> {
  const response = await fetchWithInterceptor(
    `/api/v1/media/topics/${topicId}`,
    {
      method: "DELETE",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as TopicDeleteApiResponse;
}

export async function fetchKnowledgeScopes(): Promise<KnowledgeScopesApiResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/media/knowledge/scopes",
    {
      method: "GET",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as KnowledgeScopesApiResponse;
}

export async function uploadKnowledgeDocument(
  file: File,
  scope?: string,
): Promise<KnowledgeUploadApiResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (scope?.trim()) {
    formData.append("scope", scope.trim());
  }

  const response = await fetchWithInterceptor(
    "/api/v1/media/knowledge/upload",
    {
      method: "POST",
      body: formData,
    },
    { timeoutMs: 30000 },
  );

  return (await response.json()) as KnowledgeUploadApiResponse;
}

export async function deleteKnowledgeScope(
  scope: string,
): Promise<KnowledgeScopeDeleteApiResponse> {
  const response = await fetchWithInterceptor(
    `/api/v1/media/knowledge/scopes/${encodeURIComponent(scope)}`,
    {
      method: "DELETE",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as KnowledgeScopeDeleteApiResponse;
}

export async function fetchTemplates(): Promise<TemplatesApiResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/media/templates",
    {
      method: "GET",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as TemplatesApiResponse;
}

function extractTemplateSkillsArray(
  value: unknown,
): TemplateSkillsApiResponse["items"] {
  if (typeof value === "string") {
    const nestedValue = parseTemplateSkillsPayload(value);
    if (nestedValue !== value) {
      return extractTemplateSkillsArray(nestedValue);
    }
    return [];
  }

  if (Array.isArray(value)) {
    return value as TemplateSkillsApiResponse["items"];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.templates)) {
    return record.templates as TemplateSkillsApiResponse["items"];
  }

  if (record.data && typeof record.data === "object") {
    const nestedTemplates = extractTemplateSkillsArray(record.data);
    if (nestedTemplates.length > 0) {
      return nestedTemplates;
    }
  }

  if (Array.isArray(record.items)) {
    return record.items as TemplateSkillsApiResponse["items"];
  }

  if (Array.isArray(record.data)) {
    return record.data as TemplateSkillsApiResponse["items"];
  }

  for (const nestedValue of Object.values(record)) {
    if (!nestedValue || typeof nestedValue !== "object") {
      continue;
    }

    const nestedTemplates = extractTemplateSkillsArray(nestedValue);
    if (nestedTemplates.length > 0) {
      return nestedTemplates;
    }
  }

  return [];
}

function parseTemplateSkillsPayload(rawText: string): unknown {
  let current: unknown = rawText;

  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "string") {
      break;
    }

    const trimmed = current.trim();
    if (!trimmed) {
      return {};
    }

    try {
      current = JSON.parse(trimmed) as unknown;
    } catch {
      return current;
    }
  }

  return current;
}

export async function fetchTemplateSkills(params: {
  q: string;
  category?: TemplateCategory;
}): Promise<TemplateSkillsApiResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("q", params.q);
  if (params.category) {
    searchParams.set("category", params.category);
  }

  const response = await fetchWithInterceptor(
    `/api/v1/media/skills/search?${searchParams.toString()}`,
    {
      method: "GET",
    },
    { timeoutMs: 20000 },
  );

  const rawText = await response.text();
  console.log("云端 API 原始返回文本:", rawText);

  const payload = parseTemplateSkillsPayload(rawText) as
    | TemplateSkillsApiResponse
    | {
        templates?: TemplateSkillsApiResponse["items"];
        items?: TemplateSkillsApiResponse["items"];
        data?:
          | {
              templates?: TemplateSkillsApiResponse["items"];
              items?: TemplateSkillsApiResponse["items"];
              data?: TemplateSkillsApiResponse["items"];
            }
          | TemplateSkillsApiResponse["items"]
          | string;
      }
    | TemplateSkillsApiResponse["items"]
    | string;

  console.log("前端收到的云端原始数据:", payload);
  const extractedItems = extractTemplateSkillsArray(payload);

  console.log("解包后的数组:", extractedItems);

  if (Array.isArray(payload)) {
    return {
      query: params.q,
      category: params.category ?? null,
      items: extractedItems,
      templates: extractedItems,
      total: extractedItems.length,
      data_mode: "mock",
      fallback_reason: null,
    };
  }

  if (!payload || typeof payload !== "object") {
    return {
      query: params.q,
      category: params.category ?? null,
      items: extractedItems,
      templates: extractedItems,
      total: extractedItems.length,
      data_mode: "mock",
      fallback_reason: null,
    };
  }

  const payloadRecord = payload as Record<string, unknown>;

  return {
    query:
      typeof payloadRecord.query === "string" ? payloadRecord.query : params.q,
    category:
      "category" in payloadRecord
        ? (payloadRecord.category as TemplateSkillsApiResponse["category"])
        : (params.category ?? null),
    items: extractedItems,
    templates: extractedItems,
    total:
      typeof payloadRecord.total === "number"
        ? payloadRecord.total
        : extractedItems.length,
    data_mode:
      payloadRecord.data_mode === "mock" ||
      payloadRecord.data_mode === "mock_fallback" ||
      payloadRecord.data_mode === "live_tavily" ||
      payloadRecord.data_mode === "llm_fallback"
        ? payloadRecord.data_mode
        : "mock",
    fallback_reason:
      typeof payloadRecord.fallback_reason === "string"
        ? payloadRecord.fallback_reason
        : null,
  };
}

export async function createTemplate(
  payload: TemplateCreatePayload,
): Promise<TemplateSummaryItem> {
  const response = await fetchWithInterceptor(
    "/api/v1/media/templates",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as TemplateSummaryItem;
}

export async function deleteTemplate(
  templateId: string,
): Promise<TemplateDeleteApiResponse> {
  const response = await fetchWithInterceptor(
    `/api/v1/media/templates/${templateId}`,
    {
      method: "DELETE",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as TemplateDeleteApiResponse;
}

export async function deleteTemplates(
  payload: TemplateDeletePayload,
): Promise<TemplateDeleteApiResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/media/templates",
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as TemplateDeleteApiResponse;
}

export async function deleteArtifact(
  messageId: string,
): Promise<DraftsDeleteApiResponse> {
  const response = await fetchWithInterceptor(
    `/api/v1/media/artifacts/${messageId}`,
    {
      method: "DELETE",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as DraftsDeleteApiResponse;
}

export async function deleteArtifacts(
  payload: DraftsDeletePayload,
): Promise<DraftsDeleteApiResponse> {
  const response = await fetchWithInterceptor(
    "/api/v1/media/artifacts",
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as DraftsDeleteApiResponse;
}

export async function updateThread(
  threadId: string,
  payload: ThreadUpdatePayload,
): Promise<ThreadsApiResponse["items"][number]> {
  const response = await fetchWithInterceptor(
    `/api/v1/media/threads/${threadId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as ThreadsApiResponse["items"][number];
}

export async function deleteThread(
  threadId: string,
): Promise<ThreadDeleteApiResponse> {
  const response = await fetchWithInterceptor(
    `/api/v1/media/threads/${threadId}`,
    {
      method: "DELETE",
    },
    { timeoutMs: 15000 },
  );

  return (await response.json()) as ThreadDeleteApiResponse;
}

export async function createChatStream(
  request: MediaChatRequestPayload,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchWithInterceptor(
    "/api/v1/media/chat/stream",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    },
    { timeoutMs: 20000 },
  );

  if (!response.body) {
    throw new APIError("当前浏览器不支持流式响应读取。", {
      status: 0,
      code: "STREAM_UNSUPPORTED",
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let receivedDoneEvent = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      while (buffer.includes("\n\n")) {
        const separatorIndex = buffer.indexOf("\n\n");
        const block = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const parsedEvent = parseEventBlock(block);
        if (parsedEvent) {
          onEvent(parsedEvent);
          if (parsedEvent.event === "done") {
            receivedDoneEvent = true;
          }
        }
      }
    }
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    throw new APIError("流式传输中断，请稍后重试。", {
      status: 0,
      code: "STREAM_BROKEN",
      cause: error,
    });
  }

  if (buffer.trim()) {
    const parsedEvent = parseEventBlock(buffer);
    if (parsedEvent) {
      onEvent(parsedEvent);
      if (parsedEvent.event === "done") {
        receivedDoneEvent = true;
      }
    }
  }

  if (!receivedDoneEvent) {
    throw new APIError("流式传输提前结束，请稍后重试。", {
      status: 0,
      code: "STREAM_INCOMPLETE",
    });
  }
}
