import type { Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";

import type {
  ArtifactPayload,
  AuthResponse,
  AuthSessionItem,
  AuthenticatedUser,
  ChatStreamEvent,
  DraftSummaryItem,
  HistoryMessageItem,
  HistoryThreadSummary,
  MediaChatRequestPayload,
  TemplateSkillDiscoveryItem,
  TemplateSummaryItem,
  ThreadMessagesApiResponse,
  UploadApiResponse,
} from "../src/app/types";

export const authStorageKeys = {
  token: "omnimedia_token",
  refreshToken: "omnimedia_refresh_token",
  user: "omnimedia_user",
} as const;

export const testUser: AuthenticatedUser = {
  id: "user-e2e-001",
  username: "e2e_user",
  nickname: "E2E User",
  bio: "Playwright smoke profile",
  avatar_url: null,
  created_at: "2026-04-28T00:00:00Z",
};

export type MockBackendOptions = {
  user?: Partial<AuthenticatedUser>;
  threads?: HistoryThreadSummary[];
  drafts?: DraftSummaryItem[];
  templates?: TemplateSummaryItem[];
  templateSkills?: TemplateSkillDiscoveryItem[];
  threadMessagesById?: Record<string, ThreadMessagesApiResponse>;
  sessions?: AuthSessionItem[];
  failOnceUnauthorizedPaths?: string[];
  responseDelayMsByPath?: Record<string, number>;
  uploadResponse?:
    | Partial<UploadApiResponse>
    | ((context: {
        purpose: "avatar" | "material";
        threadId?: string | null;
        filename: string;
        uploadCount: number;
      }) => UploadApiResponse);
  streamEvents?:
    | ChatStreamEvent[]
    | ((payload: MediaChatRequestPayload) => ChatStreamEvent[]);
};

type MockBackendState = {
  user: AuthenticatedUser;
  threads: HistoryThreadSummary[];
  drafts: DraftSummaryItem[];
  templates: TemplateSummaryItem[];
  templateSkills: TemplateSkillDiscoveryItem[];
  threadMessagesById: Record<string, ThreadMessagesApiResponse>;
  sessions: AuthSessionItem[];
  unauthorizedOncePending: Set<string>;
  refreshCount: number;
  uploadCount: number;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultStreamEvents(payload: MediaChatRequestPayload): ChatStreamEvent[] {
  return [
    {
      event: "start",
      thread_id: payload.thread_id,
      platform: payload.platform,
      task_type: payload.task_type,
      materials_count: payload.materials.length,
    },
    { event: "message", delta: "你好，", index: 0 },
    { event: "message", delta: "这是 Playwright 自动化回复。", index: 1 },
    { event: "done", thread_id: payload.thread_id },
  ];
}

export function createMockThreadSummary(
  overrides: Partial<HistoryThreadSummary> = {},
): HistoryThreadSummary {
  return {
    id: overrides.id ?? "thread-e2e-001",
    title: overrides.title ?? "E2E 默认会话",
    latest_message_excerpt: overrides.latest_message_excerpt ?? "Playwright 自动化回复",
    is_archived: overrides.is_archived ?? false,
    knowledge_base_scope: overrides.knowledge_base_scope ?? null,
    updated_at: overrides.updated_at ?? "2026-04-28T08:00:00Z",
  };
}

export function createMockThreadMessages(
  overrides: Partial<ThreadMessagesApiResponse> = {},
): ThreadMessagesApiResponse {
  const threadId = overrides.thread_id ?? "thread-e2e-001";
  return {
    thread_id: threadId,
    title: overrides.title ?? "E2E 默认会话",
    system_prompt: overrides.system_prompt ?? "你是一位专业内容策划助手。",
    knowledge_base_scope: overrides.knowledge_base_scope ?? null,
    messages: overrides.messages ?? [],
    materials: overrides.materials ?? [],
  };
}

export function createMockHistoryMessage(
  overrides: Partial<HistoryMessageItem> = {},
): HistoryMessageItem {
  return {
    id: overrides.id ?? `message-${Math.random().toString(36).slice(2, 8)}`,
    thread_id: overrides.thread_id ?? "thread-e2e-001",
    role: overrides.role ?? "assistant",
    message_type: overrides.message_type ?? "text",
    content: overrides.content ?? "Playwright 自动化回复",
    created_at: overrides.created_at ?? nowIso(),
    artifact: overrides.artifact ?? null,
    materials: overrides.materials ?? [],
  };
}

function buildDraftExcerpt(artifact: ArtifactPayload): string {
  if (artifact.artifact_type === "content_draft") {
    return artifact.body;
  }
  if (artifact.artifact_type === "topic_list") {
    return artifact.topics.map((topic) => `${topic.title}：${topic.angle}`).join("；");
  }
  if (artifact.artifact_type === "hot_post_analysis") {
    return artifact.analysis_dimensions
      .map((dimension) => `${dimension.dimension}：${dimension.insight}`)
      .join("；");
  }
  return artifact.suggestions
    .map((suggestion) => `${suggestion.comment_type}：${suggestion.reply}`)
    .join("；");
}

export function createMockDraftSummary(
  overrides: Partial<DraftSummaryItem> & { artifact: ArtifactPayload },
): DraftSummaryItem {
  return {
    id: overrides.id ?? `draft-${Math.random().toString(36).slice(2, 8)}`,
    thread_id: overrides.thread_id ?? "thread-e2e-001",
    thread_title: overrides.thread_title ?? "E2E 默认会话",
    message_id:
      overrides.message_id ?? `message-${Math.random().toString(36).slice(2, 8)}`,
    artifact_type: overrides.artifact_type ?? overrides.artifact.artifact_type,
    title: overrides.title ?? overrides.artifact.title,
    excerpt: overrides.excerpt ?? buildDraftExcerpt(overrides.artifact),
    platform: overrides.platform ?? "xiaohongshu",
    created_at: overrides.created_at ?? nowIso(),
    artifact: overrides.artifact,
  };
}

export function createMockSession(
  overrides: Partial<AuthSessionItem> = {},
): AuthSessionItem {
  return {
    id: overrides.id ?? `session-${Math.random().toString(36).slice(2, 8)}`,
    device_info: overrides.device_info ?? "Chrome on Windows",
    ip_address: overrides.ip_address ?? "127.0.0.1",
    expires_at: overrides.expires_at ?? "2026-05-01T00:00:00Z",
    last_seen_at: overrides.last_seen_at ?? "2026-04-28T08:00:00Z",
    created_at: overrides.created_at ?? "2026-04-28T07:00:00Z",
    is_current: overrides.is_current ?? false,
  };
}

export function createMockTemplate(
  overrides: Partial<TemplateSummaryItem> = {},
): TemplateSummaryItem {
  return {
    id: overrides.id ?? `template-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title ?? "模板标题",
    description: overrides.description ?? "模板描述",
    platform: overrides.platform ?? "小红书",
    category: overrides.category ?? "美食文旅",
    knowledge_base_scope: overrides.knowledge_base_scope ?? null,
    system_prompt:
      overrides.system_prompt ??
      "你是一个可复用的内容生产模板，用于快速生成符合场景的人设与提示词。",
    is_preset: overrides.is_preset ?? false,
    created_at: overrides.created_at ?? nowIso(),
  };
}

export function createMockTemplateSkill(
  overrides: Partial<TemplateSkillDiscoveryItem> = {},
): TemplateSkillDiscoveryItem {
  return {
    id: overrides.id ?? `skill-${Math.random().toString(36).slice(2, 8)}`,
    title: overrides.title ?? "技能发现卡片",
    description:
      overrides.description ?? "适合导入为模板的实时 Prompt 灵感。",
    platform: overrides.platform ?? "小红书",
    category: overrides.category ?? "美食文旅",
    knowledge_base_scope: overrides.knowledge_base_scope ?? "travel_local_guides",
    system_prompt:
      overrides.system_prompt ??
      "你是一名擅长输出高点击内容结构的编辑，请围绕目标人群、情绪触发点和转化动作组织内容。",
    source_title: overrides.source_title ?? "Mock Skills Discovery",
    source_url: overrides.source_url ?? null,
    data_mode: overrides.data_mode ?? "mock",
  };
}

function createDefaultTemplates(): TemplateSummaryItem[] {
  return [
    createMockTemplate({
      id: "template-preset-travel-hotflow",
      title: "文旅探店爆款流",
      description: "突出情绪价值与在地体验，适合周末短途游与城市周边探店内容。",
      platform: "小红书",
      category: "美食文旅",
      system_prompt:
        "你是一名擅长小红书文旅探店内容策划的生活方式编辑，请围绕真实路线、氛围细节、出片机位与自然互动 CTA 组织内容。",
      is_preset: true,
    }),
    createMockTemplate({
      id: "template-preset-finance-recovery",
      title: "精致穷回血理财方案",
      description: "聚焦 28-35 岁女性的预算管理与温和理财表达，语气温柔且专业。",
      platform: "小红书",
      category: "职场金融",
      system_prompt:
        "你是一名擅长女性理财内容的品牌顾问，面对的是 28-35 岁、处于精致穷阶段并承受同龄人焦虑的职场女性。",
      is_preset: true,
    }),
    createMockTemplate({
      id: "template-preset-beauty-overnight-repair",
      title: "熬夜党护肤急救方案",
      description: "面向高压熬夜人群的护肤文案模板，强调情绪价值与即时改善感。",
      platform: "小红书",
      category: "美妆护肤",
      system_prompt:
        "你是一名懂成分也懂情绪价值的小红书护肤主编，请输出专业可信又带安慰感的护肤内容。",
      is_preset: true,
    }),
    createMockTemplate({
      id: "template-preset-tech-iot-markdown",
      title: "硬核技术教程（IoT / STM32）",
      description: "结构严谨的技术教程模板，适合 STM32、嵌入式与物联网工程实践分享。",
      platform: "技术博客",
      category: "数码科技",
      system_prompt:
        "你是一名擅长输出硬核技术教程的工程作者，请使用严格、清晰的 Markdown 结构组织内容。",
      is_preset: true,
    }),
    createMockTemplate({
      id: "template-preset-xianyu-secondhand-sku",
      title: "高转化二手闲置 SKU",
      description: "主打断舍离回血与同龄人焦虑语境下的真诚转化文案，适合闲鱼二手发布。",
      platform: "闲鱼",
      category: "电商/闲鱼",
      system_prompt:
        "你是一名擅长闲鱼高转化文案的二手运营助手，请站在断舍离回血、真实说明成色与使用场景的角度写文案。",
      is_preset: true,
    }),
    createMockTemplate({
      id: "template-preset-education-score-boost",
      title: "初高中教辅引流标题",
      description: "强调提分、逆袭与方法感，适合教辅资料、电商详情和家长沟通场景。",
      platform: "抖音",
      category: "教育/干货",
      system_prompt:
        "你是一名擅长教育内容增长的选题编辑，请围绕提分、逆袭、家长焦虑等真实场景生成标题与引流文案。",
      is_preset: true,
    }),
  ];
}

function createDefaultTemplateSkills(): TemplateSkillDiscoveryItem[] {
  return [
    createMockTemplateSkill({
      id: "skill-travel-emotion-route",
      title: "在地情绪路线笔记",
      description: "适合周末短途和城市 Citywalk 的文旅 Prompt 模板。",
      platform: "小红书",
      category: "美食文旅",
      knowledge_base_scope: "travel_local_guides",
    }),
    createMockTemplateSkill({
      id: "skill-xianyu-recovery-close",
      title: "闲鱼回血成交话术",
      description: "适合断舍离回血和二手转化文案。",
      platform: "闲鱼",
      category: "电商/闲鱼",
      knowledge_base_scope: "secondhand_trade_playbook",
    }),
    createMockTemplateSkill({
      id: "skill-tech-lab-markdown",
      title: "实验室复盘 Markdown",
      description: "适合 STM32 / IoT / 嵌入式教程的工程化模板。",
      platform: "技术博客",
      category: "数码科技",
      knowledge_base_scope: "iot_embedded_lab",
    }),
  ];
}

export function buildAuthPayload(
  username = testUser.username,
  overrides: Partial<AuthenticatedUser> = {},
  tokenSuffix = username,
): AuthResponse {
  return {
    access_token: `access-token-${tokenSuffix}`,
    refresh_token: `refresh-token-${tokenSuffix}`,
    token_type: "bearer",
    user: {
      ...testUser,
      username,
      ...overrides,
    },
  };
}

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function buildSseBody(events: ChatStreamEvent[]): string {
  return events
    .map((event) => {
      const { event: eventName, ...payload } = event;
      return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    })
    .join("");
}

function parseJsonBody<T>(route: Route): T {
  return JSON.parse(route.request().postData() || "{}") as T;
}

function parseMultipartField(rawBody: string, fieldName: string): string | null {
  const match = rawBody.match(
    new RegExp(`name="${fieldName}"\\r\\n\\r\\n([^\\r\\n]+)`),
  );
  return match?.[1] ?? null;
}

function parseMultipartFilename(rawBody: string): string {
  const match = rawBody.match(/name="file"; filename="([^"]+)"/);
  return match?.[1] ?? "upload.bin";
}

function inferFileType(filename: string): string {
  const lowered = filename.toLowerCase();
  if (/\.(png|jpg|jpeg|webp)$/.test(lowered)) {
    return "image";
  }
  if (/\.(mp4|mov)$/.test(lowered)) {
    return "video";
  }
  return "document";
}

function inferContentType(filename: string): string {
  const lowered = filename.toLowerCase();
  if (lowered.endsWith(".png")) {
    return "image/png";
  }
  if (/\.(jpg|jpeg)$/.test(lowered)) {
    return "image/jpeg";
  }
  if (lowered.endsWith(".webp")) {
    return "image/webp";
  }
  if (lowered.endsWith(".mp4")) {
    return "video/mp4";
  }
  if (lowered.endsWith(".mov")) {
    return "video/quicktime";
  }
  if (lowered.endsWith(".md")) {
    return "text/markdown";
  }
  if (lowered.endsWith(".txt")) {
    return "text/plain";
  }
  if (lowered.endsWith(".pdf")) {
    return "application/pdf";
  }
  return "application/octet-stream";
}

function upsertThreadSummary(
  state: MockBackendState,
  summary: HistoryThreadSummary,
): void {
  const existingIndex = state.threads.findIndex((thread) => thread.id === summary.id);
  if (existingIndex === -1) {
    state.threads = [summary, ...state.threads];
    return;
  }

  const nextThreads = [...state.threads];
  nextThreads[existingIndex] = summary;
  state.threads = nextThreads;
}

function removeDraftsByMessageIds(
  state: MockBackendState,
  messageIds: string[],
): DraftSummaryItem[] {
  const deletedSet = new Set(messageIds);
  const deletedDrafts = state.drafts.filter((draft) => deletedSet.has(draft.message_id));

  if (deletedDrafts.length === 0) {
    return [];
  }

  state.drafts = state.drafts.filter((draft) => !deletedSet.has(draft.message_id));

  Object.entries(state.threadMessagesById).forEach(([threadId, payload]) => {
    state.threadMessagesById[threadId] = {
      ...payload,
      messages: payload.messages.filter((message) => !deletedSet.has(message.id)),
    };
  });

  return deletedDrafts;
}

function resolveStreamEvents(
  options: MockBackendOptions,
  payload: MediaChatRequestPayload,
): ChatStreamEvent[] {
  if (typeof options.streamEvents === "function") {
    return options.streamEvents(payload);
  }
  if (Array.isArray(options.streamEvents)) {
    return options.streamEvents;
  }
  return defaultStreamEvents(payload);
}

function resolveUploadResponse(
  options: MockBackendOptions,
  context: {
    purpose: "avatar" | "material";
    threadId?: string | null;
    filename: string;
    uploadCount: number;
  },
): UploadApiResponse {
  if (typeof options.uploadResponse === "function") {
    return options.uploadResponse(context);
  }

  if (options.uploadResponse) {
    return {
      url:
        options.uploadResponse.url ??
        `https://signed-media.example.com/uploads/${context.filename}?Expires=3600`,
      file_type: options.uploadResponse.file_type ?? inferFileType(context.filename),
      content_type:
        options.uploadResponse.content_type ?? inferContentType(context.filename),
      filename: options.uploadResponse.filename ?? context.filename,
      original_filename:
        options.uploadResponse.original_filename ?? context.filename,
      purpose: options.uploadResponse.purpose ?? context.purpose,
      thread_id: options.uploadResponse.thread_id ?? context.threadId ?? null,
    };
  }

  const objectPrefix = context.purpose === "avatar" ? "avatars" : "uploads";
  return {
    url: `https://signed-media.example.com/${objectPrefix}/${context.filename}?Expires=3600`,
    file_type: inferFileType(context.filename),
    content_type: inferContentType(context.filename),
    filename: context.filename,
    original_filename: context.filename,
    purpose: context.purpose,
    thread_id: context.threadId ?? null,
  };
}

function createTemplateFromPayload(
  body: {
    title?: string;
    description?: string;
    platform?: TemplateSummaryItem["platform"];
    category?: TemplateSummaryItem["category"];
    knowledge_base_scope?: string | null;
    system_prompt?: string;
  },
): TemplateSummaryItem {
  return createMockTemplate({
    id: `template-user-${Math.random().toString(36).slice(2, 10)}`,
    title: body.title ?? "未命名模板",
    description: body.description ?? "",
    platform: body.platform ?? "小红书",
    category: body.category ?? "美食文旅",
    knowledge_base_scope: body.knowledge_base_scope ?? null,
    system_prompt: body.system_prompt ?? "",
    is_preset: false,
    created_at: nowIso(),
  });
}

export async function mockBackend(page: Page, options: MockBackendOptions = {}) {
  const initialUser = {
    ...testUser,
    ...(options.user ?? {}),
  };

  const state: MockBackendState = {
    user: initialUser,
    threads: clone(options.threads ?? []),
    drafts: clone(options.drafts ?? []),
    templates: clone(options.templates ?? createDefaultTemplates()),
    templateSkills: clone(options.templateSkills ?? createDefaultTemplateSkills()),
    threadMessagesById: clone(options.threadMessagesById ?? {}),
    sessions: clone(
      options.sessions ?? [
        createMockSession({ id: "session-current", is_current: true }),
      ],
    ),
    unauthorizedOncePending: new Set(options.failOnceUnauthorizedPaths ?? []),
    refreshCount: 0,
    uploadCount: 0,
  };

  await page.route("**/api/v1/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (state.unauthorizedOncePending.has(path)) {
      state.unauthorizedOncePending.delete(path);
      await fulfillJson(route, { detail: "当前登录状态已失效，请重新登录。" }, 401);
      return;
    }

    const configuredDelay = options.responseDelayMsByPath?.[path] ?? 0;
    if (configuredDelay > 0) {
      await delay(configuredDelay);
    }

    if (path === "/api/v1/auth/register" && request.method() === "POST") {
      const body = parseJsonBody<{ username?: string }>(route);
      const username = body.username || testUser.username;
      state.user = { ...state.user, username };
      await fulfillJson(route, buildAuthPayload(username, state.user, username));
      return;
    }

    if (path === "/api/v1/auth/login" && request.method() === "POST") {
      const form = new URLSearchParams(request.postData() || "");
      const username = form.get("username") || testUser.username;
      state.user = { ...state.user, username };
      await fulfillJson(route, buildAuthPayload(username, state.user, username));
      return;
    }

    if (path === "/api/v1/auth/refresh" && request.method() === "POST") {
      state.refreshCount += 1;
      await fulfillJson(
        route,
        buildAuthPayload(
          state.user.username,
          state.user,
          `refreshed-${state.refreshCount}`,
        ),
      );
      return;
    }

    if (path === "/api/v1/auth/password-reset-request" && request.method() === "POST") {
      await fulfillJson(route, { accepted: true, expires_in_minutes: 15 });
      return;
    }

    if (path === "/api/v1/auth/password-reset" && request.method() === "POST") {
      await fulfillJson(route, { password_reset: true, revoked_sessions: 2 });
      return;
    }

    if (path === "/api/v1/auth/logout" && request.method() === "POST") {
      await fulfillJson(route, { logged_out: true });
      return;
    }

    if (path === "/api/v1/auth/profile" && request.method() === "PATCH") {
      const body = parseJsonBody<Partial<AuthenticatedUser>>(route);
      state.user = {
        ...state.user,
        ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
        ...(body.bio !== undefined ? { bio: body.bio } : {}),
        ...(body.avatar_url !== undefined ? { avatar_url: body.avatar_url } : {}),
      };
      await fulfillJson(route, state.user);
      return;
    }

    if (path === "/api/v1/auth/reset-password" && request.method() === "POST") {
      const revokedSessions = state.sessions.filter((session) => !session.is_current).length;
      state.sessions = state.sessions.filter((session) => session.is_current);
      await fulfillJson(route, { password_reset: true, revoked_sessions: revokedSessions });
      return;
    }

    if (path === "/api/v1/auth/sessions" && request.method() === "GET") {
      await fulfillJson(route, { items: state.sessions });
      return;
    }

    const sessionMatch = path.match(/^\/api\/v1\/auth\/sessions\/([^/]+)$/);
    if (sessionMatch && request.method() === "DELETE") {
      const sessionId = sessionMatch[1];
      state.sessions = state.sessions.filter((session) => session.id !== sessionId);
      await fulfillJson(route, { id: sessionId, revoked: true });
      return;
    }

    if (path === "/api/v1/media/upload" && request.method() === "POST") {
      state.uploadCount += 1;
      const rawBody = request.postData() || "";
      const purpose =
        (parseMultipartField(rawBody, "purpose") as "avatar" | "material" | null) ??
        "material";
      const threadId = parseMultipartField(rawBody, "thread_id");
      const filename = parseMultipartFilename(rawBody);
      const payload = resolveUploadResponse(options, {
        purpose,
        threadId,
        filename,
        uploadCount: state.uploadCount,
      });
      await fulfillJson(route, payload);
      return;
    }

    if (path === "/api/v1/media/threads" && request.method() === "GET") {
      await fulfillJson(route, {
        items: state.threads,
        total: state.threads.length,
        page: 1,
        page_size: 20,
      });
      return;
    }

    if (path === "/api/v1/media/artifacts" && request.method() === "GET") {
      await fulfillJson(route, {
        items: state.drafts,
        total: state.drafts.length,
      });
      return;
    }

    if (path === "/api/v1/media/templates" && request.method() === "GET") {
      await fulfillJson(route, {
        items: state.templates,
        total: state.templates.length,
      });
      return;
    }

    if (path === "/api/v1/media/skills/search" && request.method() === "GET") {
      const url = new URL(request.url());
      await fulfillJson(route, {
        query: url.searchParams.get("q") ?? "爆款 Prompt",
        category: url.searchParams.get("category"),
        templates: state.templateSkills,
        total: state.templateSkills.length,
        data_mode: "mock",
        fallback_reason: null,
      });
      return;
    }

    if (path === "/api/v1/media/templates" && request.method() === "POST") {
      const body = parseJsonBody<{
        title?: string;
        description?: string;
        platform?: TemplateSummaryItem["platform"];
        category?: TemplateSummaryItem["category"];
        knowledge_base_scope?: string | null;
        system_prompt?: string;
      }>(route);
      const createdTemplate = createTemplateFromPayload(body);
      const presets = state.templates.filter((template) => template.is_preset);
      const customs = state.templates.filter((template) => !template.is_preset);
      state.templates = [...presets, createdTemplate, ...customs];
      await fulfillJson(route, createdTemplate, 201);
      return;
    }

    const templateMatch = path.match(/^\/api\/v1\/media\/templates\/([^/]+)$/);
    if (templateMatch && request.method() === "DELETE") {
      const templateId = templateMatch[1];
      const template = state.templates.find((item) => item.id === templateId);

      if (!template) {
        await fulfillJson(route, { detail: "未找到对应模板。" }, 404);
        return;
      }

      if (template.is_preset) {
        await fulfillJson(route, { detail: "系统预置模板不支持删除。" }, 403);
        return;
      }

      state.templates = state.templates.filter((item) => item.id !== templateId);
      await fulfillJson(route, {
        deleted_count: 1,
        deleted_ids: [templateId],
      });
      return;
    }

    if (path === "/api/v1/media/templates" && request.method() === "DELETE") {
      const body = parseJsonBody<{ template_ids?: string[] }>(route);
      const requestedIds = Array.from(new Set(body.template_ids ?? []));

      if (requestedIds.length === 0) {
        await fulfillJson(route, { detail: "请至少选择一个模板。" }, 400);
        return;
      }

      const selectedTemplates = state.templates.filter((template) =>
        requestedIds.includes(template.id),
      );

      if (selectedTemplates.length !== requestedIds.length) {
        await fulfillJson(route, { detail: "部分模板不存在或已被删除。" }, 404);
        return;
      }

      if (selectedTemplates.some((template) => template.is_preset)) {
        await fulfillJson(route, { detail: "系统预置模板不支持删除。" }, 403);
        return;
      }

      state.templates = state.templates.filter(
        (template) => !requestedIds.includes(template.id),
      );
      await fulfillJson(route, {
        deleted_count: requestedIds.length,
        deleted_ids: requestedIds,
      });
      return;
    }

    const artifactMessageMatch = path.match(/^\/api\/v1\/media\/artifacts\/([^/]+)$/);
    if (artifactMessageMatch && request.method() === "DELETE") {
      const messageId = artifactMessageMatch[1];
      const deletedDrafts = removeDraftsByMessageIds(state, [messageId]);

      if (deletedDrafts.length === 0) {
        await fulfillJson(route, { detail: "Artifact draft not found." }, 404);
        return;
      }

      await fulfillJson(route, {
        deleted_count: 1,
        deleted_message_ids: [messageId],
        cleared_all: false,
      });
      return;
    }

    if (path === "/api/v1/media/artifacts" && request.method() === "DELETE") {
      const body = parseJsonBody<{
        message_ids?: string[];
        clear_all?: boolean;
      }>(route);
      const clearAll = Boolean(body.clear_all);
      const requestedIds = Array.from(new Set(body.message_ids ?? []));

      if (!clearAll && requestedIds.length === 0) {
        await fulfillJson(
          route,
          { detail: "At least one artifact message_id is required." },
          400,
        );
        return;
      }

      const deletedMessageIds = clearAll
        ? state.drafts.map((draft) => draft.message_id)
        : requestedIds;

      if (
        !clearAll &&
        state.drafts.filter((draft) => requestedIds.includes(draft.message_id)).length !==
          requestedIds.length
      ) {
        await fulfillJson(route, { detail: "Some artifact drafts were not found." }, 404);
        return;
      }

      const deletedDrafts = removeDraftsByMessageIds(state, deletedMessageIds);

      await fulfillJson(route, {
        deleted_count: deletedDrafts.length,
        deleted_message_ids: deletedDrafts.map((draft) => draft.message_id),
        cleared_all: clearAll,
      });
      return;
    }

    const threadMessagesMatch = path.match(/^\/api\/v1\/media\/threads\/([^/]+)\/messages$/);
    if (threadMessagesMatch && request.method() === "GET") {
      const threadId = threadMessagesMatch[1];
      const payload =
        state.threadMessagesById[threadId] ??
        createMockThreadMessages({
          thread_id: threadId,
          title:
            state.threads.find((thread) => thread.id === threadId)?.title ?? "Untitled thread",
        });
      await fulfillJson(route, payload);
      return;
    }

    const threadMutationMatch = path.match(/^\/api\/v1\/media\/threads\/([^/]+)$/);
    if (threadMutationMatch && request.method() === "PATCH") {
      const threadId = threadMutationMatch[1];
      const body = parseJsonBody<{
        title?: string;
        is_archived?: boolean;
        system_prompt?: string;
        knowledge_base_scope?: string | null;
      }>(route);
      const existingSummary =
        state.threads.find((thread) => thread.id === threadId) ??
        createMockThreadSummary({ id: threadId });
      const nextSummary: HistoryThreadSummary = {
        ...existingSummary,
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.is_archived !== undefined ? { is_archived: body.is_archived } : {}),
        ...(body.knowledge_base_scope !== undefined
          ? { knowledge_base_scope: body.knowledge_base_scope }
          : {}),
        updated_at: nowIso(),
      };
      upsertThreadSummary(state, nextSummary);

      const existingMessages =
        state.threadMessagesById[threadId] ??
        createMockThreadMessages({ thread_id: threadId, title: nextSummary.title });
      state.threadMessagesById[threadId] = {
        ...existingMessages,
        title: body.title ?? existingMessages.title,
        system_prompt:
          body.system_prompt !== undefined
            ? body.system_prompt
            : existingMessages.system_prompt,
        knowledge_base_scope:
          body.knowledge_base_scope !== undefined
            ? body.knowledge_base_scope
            : existingMessages.knowledge_base_scope,
      };

      await fulfillJson(route, nextSummary);
      return;
    }

    if (threadMutationMatch && request.method() === "DELETE") {
      const threadId = threadMutationMatch[1];
      state.threads = state.threads.filter((thread) => thread.id !== threadId);
      state.drafts = state.drafts.filter((draft) => draft.thread_id !== threadId);
      delete state.threadMessagesById[threadId];
      await fulfillJson(route, { id: threadId, deleted: true });
      return;
    }

    if (path === "/api/v1/media/chat/stream" && request.method() === "POST") {
      const body = parseJsonBody<MediaChatRequestPayload>(route);
      const events = resolveStreamEvents(options, body);
      const assistantContent = events
        .filter(
          (
            event,
          ): event is Extract<ChatStreamEvent, { event: "message" }> =>
            event.event === "message",
        )
        .map((event) => event.delta)
        .join("");
      const artifactEvent = events.find(
        (
          event,
        ): event is Extract<ChatStreamEvent, { event: "artifact" }> =>
          event.event === "artifact",
      );
      const createdAt = nowIso();

      const requestMaterials = body.materials.map((material, index) => ({
        id: `material-${body.thread_id}-${index + 1}`,
        thread_id: body.thread_id,
        message_id: `message-user-${body.thread_id}`,
        type: material.type,
        url: material.url ?? null,
        text: material.text,
        created_at: createdAt,
      }));

      const existingThreadMessages =
        state.threadMessagesById[body.thread_id] ??
        createMockThreadMessages({
          thread_id: body.thread_id,
          title: body.thread_title ?? "Untitled thread",
          knowledge_base_scope: body.knowledge_base_scope ?? null,
          system_prompt: body.system_prompt ?? "",
        });

      const userMessage = createMockHistoryMessage({
        id: `message-user-${body.thread_id}-${Date.now()}`,
        thread_id: body.thread_id,
        role: "user",
        message_type: "text",
        content: body.message,
        created_at: createdAt,
        materials: requestMaterials,
      });
      const assistantMessage = createMockHistoryMessage({
        id: `message-assistant-${body.thread_id}-${Date.now()}`,
        thread_id: body.thread_id,
        role: "assistant",
        message_type: "text",
        content: assistantContent || "Playwright 自动化回复",
        created_at: createdAt,
      });

      state.threadMessagesById[body.thread_id] = {
        thread_id: body.thread_id,
        title:
          body.thread_title ??
          existingThreadMessages.title ??
          state.threads.find((thread) => thread.id === body.thread_id)?.title ??
          "Untitled thread",
        system_prompt: body.system_prompt ?? existingThreadMessages.system_prompt ?? "",
        knowledge_base_scope:
          body.knowledge_base_scope ?? existingThreadMessages.knowledge_base_scope ?? null,
        messages: [
          ...existingThreadMessages.messages,
          userMessage,
          assistantMessage,
        ],
        materials: [...existingThreadMessages.materials, ...requestMaterials],
      };

      upsertThreadSummary(state, {
        id: body.thread_id,
        title:
          body.thread_title ??
          existingThreadMessages.title ??
          state.threads.find((thread) => thread.id === body.thread_id)?.title ??
          "Untitled thread",
        latest_message_excerpt: assistantContent || body.message,
        is_archived: false,
        knowledge_base_scope:
          body.knowledge_base_scope ?? existingThreadMessages.knowledge_base_scope ?? null,
        updated_at: createdAt,
      });

      if (artifactEvent) {
        state.drafts = [
          createMockDraftSummary({
            id: `draft-${body.thread_id}-${Date.now()}`,
            thread_id: body.thread_id,
            thread_title:
              body.thread_title ??
              existingThreadMessages.title ??
              state.threads.find((thread) => thread.id === body.thread_id)?.title ??
              "Untitled thread",
            message_id: assistantMessage.id,
            platform: body.platform,
            created_at: createdAt,
            artifact: artifactEvent.artifact,
          }),
          ...state.drafts.filter((draft) => draft.thread_id !== body.thread_id),
        ];
      }

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream; charset=utf-8",
        body: buildSseBody(events),
      });
      return;
    }

    await fulfillJson(route, { detail: `Unhandled E2E route: ${path}` }, 404);
  });

  return { state };
}

export async function seedAuthenticatedSession(
  page: Page,
  payload: AuthResponse = buildAuthPayload(),
) {
  await page.addInitScript(
    ({ keys, authPayload }) => {
      window.localStorage.setItem(keys.token, authPayload.access_token);
      window.localStorage.setItem(keys.refreshToken, authPayload.refresh_token);
      window.localStorage.setItem(keys.user, JSON.stringify(authPayload.user));
    },
    { keys: authStorageKeys, authPayload: payload },
  );
}

export async function expectAuthenticated(page: Page) {
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), authStorageKeys.token)).toBeTruthy();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), authStorageKeys.refreshToken)).toBeTruthy();
}
