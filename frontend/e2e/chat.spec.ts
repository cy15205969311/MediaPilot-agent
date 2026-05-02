import { Buffer } from "node:buffer";

import { expect, test, type Page } from "@playwright/test";

import type { ContentGenerationArtifactPayload } from "../src/app/types";
import {
  buildAuthPayload,
  createMockDraftSummary,
  createMockHistoryMessage,
  createMockSession,
  createMockTemplate,
  createMockTopic,
  createMockThreadMessages,
  createMockThreadSummary,
  expectAuthenticated,
  mockBackend,
  seedAuthenticatedSession,
} from "./fixtures";

async function openWorkspace(
  page: Page,
  options: Parameters<typeof mockBackend>[1] = {},
) {
  const authPayload = buildAuthPayload(options.user?.username, options.user);
  await mockBackend(page, options);
  await seedAuthenticatedSession(page, authPayload);
  await page.goto("/");
  await expectAuthenticated(page);
}

test("creates a new titled conversation from the sidebar modal", async ({ page }) => {
  const threadTitle = `E2E thread ${Date.now()}`;

  await openWorkspace(page);
  await page.getByTestId("sidebar-create-thread").click();
  await expect(page.getByTestId("new-thread-modal")).toBeVisible();
  await page.getByPlaceholder("例如：五一福州周边文旅选题").fill(threadTitle);
  await page.getByRole("button", { name: "开始新会话" }).click();

  await expect(page.getByTestId("new-thread-modal")).toBeHidden();
  await expect(page.getByRole("button", { name: new RegExp(threadTitle) })).toBeVisible();
});

test("binds a knowledge scope from the new thread modal into the chat payload", async ({
  page,
}) => {
  let capturedScope = "";

  await openWorkspace(page, {
    knowledgeScopes: [
      {
        scope: "financial_planner_rag_one",
        chunk_count: 42,
        source_count: 1,
        updated_at: "2026-05-01T03:30:00Z",
      },
      {
        scope: "financial_planner_rag_two",
        chunk_count: 36,
        source_count: 1,
        updated_at: "2026-05-01T03:30:00Z",
      },
    ],
    streamEvents: (payload) => {
      capturedScope = payload.knowledge_base_scope ?? "";
      return [
        {
          event: "start",
          thread_id: payload.thread_id,
          platform: payload.platform,
          task_type: payload.task_type,
          materials_count: payload.materials.length,
        },
        { event: "message", delta: "已按绑定知识库生成内容。", index: 0 },
        { event: "done", thread_id: payload.thread_id },
      ];
    },
  });

  await page.getByTestId("sidebar-create-thread").click();
  await expect(page.getByTestId("new-thread-modal")).toBeVisible();
  await page
    .getByTestId("new-thread-knowledge-scope-select")
    .selectOption("financial_planner_rag_one");
  await page.getByRole("button", { name: "开始新会话" }).click();

  await page.getByTestId("composer-textarea").fill("请基于当前绑定知识库生成理财规划笔记。");
  await page.getByTestId("composer-send-button").click();

  await expect.poll(() => capturedScope).toBe("financial_planner_rag_one");
});

test("loads existing thread history and replays persisted messages on startup", async ({
  page,
}) => {
  const threadId = "thread-history-e2e";
  const userMessage = createMockHistoryMessage({
    id: "history-user-1",
    thread_id: threadId,
    role: "user",
    content: "Please replay yesterday's planning notes.",
    created_at: "2026-04-28T08:10:00Z",
  });
  const assistantMessage = createMockHistoryMessage({
    id: "history-assistant-1",
    thread_id: threadId,
    role: "assistant",
    content:
      "## Yesterday recap\n\n- Core takeaway: **lead with the differentiator**\n- Follow-up: add stronger CTA",
    created_at: "2026-04-28T08:11:00Z",
  });

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          const firstItem = items[0];
          if (!firstItem) {
            return;
          }

          if (firstItem.types.includes("text/plain")) {
            const plainBlob = await firstItem.getType("text/plain");
            (window as Window & { __copiedText?: string }).__copiedText =
              await plainBlob.text();
          }

          if (firstItem.types.includes("text/html")) {
            const htmlBlob = await firstItem.getType("text/html");
            (window as Window & { __copiedHtml?: string }).__copiedHtml =
              await htmlBlob.text();
          }
        },
        writeText: async (text: string) => {
          (window as Window & { __copiedText?: string }).__copiedText = text;
        },
      },
    });
  });

  await openWorkspace(page, {
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "Replay thread",
        latest_message_excerpt: assistantMessage.content,
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "Replay thread",
        system_prompt: "Replay persona: focused planning copilot",
        messages: [userMessage, assistantMessage],
      }),
    },
  });

  await expect(page.getByTestId(`sidebar-thread-${threadId}`)).toBeVisible();
  await expect(
    page.getByTestId("chat-message-user").filter({ hasText: userMessage.content }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("chat-message-assistant")
      .filter({ hasText: "Yesterday recap" }),
  ).toBeVisible();
  const assistantBubble = page
    .getByTestId("chat-message-assistant")
    .filter({ hasText: "Yesterday recap" });
  await expect(
    assistantBubble.getByRole("button", { name: "复制这条 AI 回复" }),
  ).toBeVisible();
  await assistantBubble.getByRole("button", { name: "复制这条 AI 回复" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __copiedText?: string }).__copiedText ?? "",
      ),
    )
    .toBe(assistantMessage.content);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __copiedHtml?: string }).__copiedHtml ?? "",
      ),
    )
    .toContain("<h2>Yesterday recap</h2>");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __copiedHtml?: string }).__copiedHtml ?? "",
      ),
    )
    .toContain("<strong>lead with the differentiator</strong>");
  await expect(page.getByTestId("workspace-persona-badge")).toContainText(
    "Replay persona: focused planning copilot",
  );
});

test("renders assistant citations as superscript references with source hints", async ({
  page,
}) => {
  const threadId = "thread-citation-e2e";
  const assistantMessage = createMockHistoryMessage({
    id: "history-assistant-citation-1",
    thread_id: threadId,
    role: "assistant",
    content:
      "火星一号基地贡献了 56.5% 的销量占比，是本季度最核心的增长来源。[1]\n\n参考资料：\n[1] 星际烤肠2026业务盘点.docx",
    created_at: "2026-04-28T08:11:00Z",
  });
  const citationArtifact = {
    artifact_type: "content_draft" as const,
    title: "销量结构复盘",
    title_candidates: ["本季度增长来源复盘"],
    body: "火星一号基地贡献了 56.5% 的销量占比，是本季度最核心的增长来源。[1]",
    platform_cta: "发布前建议复核引用审计面板。",
    citation_audit: [
      {
        citation_index: 1,
        source: "星际烤肠2026业务盘点.docx",
        snippet: "火星一号基地贡献了 56.5% 的销量占比，是本季度最核心的增长来源。",
        relevance_score: 0.92,
        chunk_index: 0,
        document_id: "rag-sales-1",
        scope: "sales_report",
      },
    ],
  };

  await openWorkspace(page, {
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "Citation thread",
        latest_message_excerpt: "销量占比分析",
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "Citation thread",
        system_prompt: "Citation persona",
        messages: [
          createMockHistoryMessage({
            id: "history-user-citation-1",
            thread_id: threadId,
            role: "user",
            content: "帮我总结一下这个季度的销量结构。",
            created_at: "2026-04-28T08:10:00Z",
          }),
          assistantMessage,
          createMockHistoryMessage({
            id: "history-artifact-citation-1",
            thread_id: threadId,
            role: "assistant",
            message_type: "artifact",
            content: citationArtifact.title,
            artifact: citationArtifact,
            created_at: "2026-04-28T08:11:10Z",
          }),
        ],
      }),
    },
  });

  const assistantBubble = page
    .getByTestId("chat-message-assistant")
    .filter({ hasText: "56.5% 的销量占比" });
  await expect(assistantBubble).toBeVisible();
  const citation = assistantBubble.locator('[data-testid="chat-citation-1"]').first();
  await expect(citation).toBeVisible();
  await expect(citation).toHaveAttribute("title", "来源：星际烤肠2026业务盘点.docx");
  await expect(page.getByTestId("citation-audit-panel").first()).toBeVisible();
  await expect(page.getByTestId("citation-audit-score-1").first()).toContainText(
    "92% 相关度",
  );
  await expect(page.getByTestId("citation-audit-item-1").first()).toContainText(
    "火星一号基地贡献了 56.5%",
  );
});

test("blocks unsupported knowledge uploads and shows an inline error", async ({
  page,
}) => {
  const knowledgeUploadRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/media/knowledge/upload")) {
      knowledgeUploadRequests.push(request.url());
    }
  });

  await openWorkspace(page, {
    knowledgeScopes: [],
  });

  await page.getByTestId("sidebar-shortcut-knowledge").click();
  await expect(page.getByTestId("knowledge-view")).toBeVisible();

  await page.getByTestId("knowledge-upload-input").setInputFiles({
    name: "marketing-brief.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from("fake pptx payload"),
  });

  await expect(page.getByTestId("knowledge-upload-error")).toContainText(
    ".txt / .md / .markdown / .pdf / .docx / .csv / .xlsx",
  );
  await expect(page.getByTestId("knowledge-upload-error")).toContainText(
    "marketing-brief.pptx",
  );
  expect(knowledgeUploadRequests).toHaveLength(0);
});

test("accepts supported docx knowledge uploads and refreshes the scope list", async ({
  page,
}) => {
  const knowledgeUploadRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/media/knowledge/upload")) {
      knowledgeUploadRequests.push(request.url());
    }
  });

  await openWorkspace(page, {
    knowledgeScopes: [],
  });

  await page.getByTestId("sidebar-shortcut-knowledge").click();
  await expect(page.getByTestId("knowledge-view")).toBeVisible();

  await page.getByTestId("knowledge-upload-input").setInputFiles({
    name: "marketing-brief.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("fake docx payload"),
  });

  await expect.poll(() => knowledgeUploadRequests.length).toBe(1);
  await expect(page.getByTestId("knowledge-upload-error")).toHaveCount(0);
  await expect(page.getByText("marketing_brief")).toBeVisible();
});

test("shows the drafts empty state when no saved artifacts exist", async ({ page }) => {
  await openWorkspace(page);

  await page.getByTestId("sidebar-shortcut-drafts").click();

  await expect(page.getByTestId("drafts-view")).toBeVisible();
  await expect(page.getByTestId("drafts-empty-state")).toBeVisible();
});

test("opens the template center and prefills a new thread modal from a template", async ({
  page,
}) => {
  const template = createMockTemplate({
    id: "template-preset-xianyu-secondhand-sku",
    title: "高转化二手闲置 SKU",
    description: "适合闲鱼二手发布，强调回血、真诚和转化效率。",
    platform: "闲鱼",
    category: "电商/闲鱼",
    system_prompt:
      "你是一名擅长闲鱼高转化文案的二手运营助手，请围绕精致穷、同龄人焦虑、真实成色与回血效率组织表达。",
    is_preset: true,
  });

  await openWorkspace(page, {
    templates: [
      template,
      createMockTemplate({
        id: "template-preset-tech-iot-markdown",
        title: "硬核技术教程（IoT / STM32）",
        platform: "技术博客",
        category: "数码科技",
        is_preset: true,
      }),
    ],
  });

  await page.getByTestId("sidebar-shortcut-templates").click();
  await expect(page.getByTestId("templates-view")).toBeVisible();
  await expect(page.getByTestId(`template-card-${template.id}`)).toContainText(
    template.title,
  );

  await page.getByTestId(`template-use-${template.id}`).click();

  await expect(page.getByTestId("templates-view")).toBeHidden();
  await expect(page.getByTestId("workspace-chat-view")).toBeVisible();
  await expect(page.getByTestId("new-thread-modal")).toBeVisible();
  await expect(page.getByTestId("new-thread-title-input")).toHaveValue(template.title);
  await expect(page.getByTestId("new-thread-system-prompt-input")).toContainText("精致穷");
  await expect(page.getByTestId("new-thread-system-prompt-input")).toContainText(
    "同龄人焦虑",
  );
});

test("creates a custom template and batch deletes selected templates", async ({
  page,
}) => {
  await openWorkspace(page, {
    templates: [
      createMockTemplate({
        id: "template-preset-travel-hotflow",
        title: "文旅探店爆款流",
        platform: "小红书",
        category: "美食文旅",
        is_preset: true,
      }),
    ],
  });

  await page.getByTestId("sidebar-shortcut-templates").click();
  await expect(page.getByTestId("templates-view")).toBeVisible();

  await page.getByTestId("template-create-open").click();
  await expect(page.getByTestId("template-create-modal")).toBeVisible();
  await page.getByTestId("template-create-title").fill("我的理财复盘模板");
  await page
    .getByTestId("template-create-description")
    .fill("适合 28-35 岁女性做月度预算复盘。");
  await page.getByTestId("template-create-platform").selectOption("小红书");
  await page.getByTestId("template-create-category").selectOption("职场金融");
  await page
    .getByTestId("template-create-system-prompt")
    .fill("请围绕精致穷、预算焦虑、温柔理财建议输出内容。");
  await page.getByTestId("template-create-submit").click();

  const financeCard = page.locator('[data-testid^="template-card-template-user-"]').filter({
    hasText: "我的理财复盘模板",
  });
  await expect(financeCard).toHaveCount(1);

  await page.getByTestId("template-create-open").click();
  await page.getByTestId("template-create-title").fill("我的教育标题模板");
  await page
    .getByTestId("template-create-description")
    .fill("适合初高中教辅资料做标题引流。");
  await page.getByTestId("template-create-platform").selectOption("抖音");
  await page.getByTestId("template-create-category").selectOption("教育/干货");
  await page
    .getByTestId("template-create-system-prompt")
    .fill("请围绕提分、逆袭、家长焦虑生成高点击标题。");
  await page.getByTestId("template-create-submit").click();

  await page.getByTestId("template-tab-全部").click();
  const customCards = page.locator('[data-testid^="template-card-template-user-"]');
  await expect(customCards).toHaveCount(2);

  const customCheckboxes = page.locator('[data-testid^="template-checkbox-template-user-"]');
  await customCheckboxes.nth(0).check();
  await customCheckboxes.nth(1).check();
  await expect(page.getByTestId("templates-selected-count")).toContainText("已选择 2 项");

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.accept();
  });

  await page.getByTestId("template-delete-selected").click();
  await expect(customCards).toHaveCount(0);
  await expect(page.getByTestId("template-card-template-preset-travel-hotflow")).toBeVisible();
});

test("saves the latest artifact into a prefilled template draft", async ({ page }) => {
  const threadId = "thread-save-template";
  const artifact = {
    artifact_type: "content_draft" as const,
    title: "福州周边周末探店模板",
    title_candidates: ["福州周边轻度假", "周末半日探店路线"],
    body: "正文围绕真实路线、预算感、出片机位、拍照氛围与自然 CTA 展开。",
    platform_cta: "评论区回复“福州”领取路线清单。",
  };

  await openWorkspace(page, {
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "福州周边周末探店",
        latest_message_excerpt: artifact.body,
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "福州周边周末探店",
        system_prompt: "你是一名擅长福州本地文旅内容的小红书编辑。",
        messages: [
          createMockHistoryMessage({
            id: "save-template-user-1",
            thread_id: threadId,
            role: "user",
            content: "帮我写一篇福州周边周末探店笔记。",
          }),
          createMockHistoryMessage({
            id: "save-template-assistant-1",
            thread_id: threadId,
            role: "assistant",
            content: "我先给你整理一份路线和正文骨架。",
          }),
          createMockHistoryMessage({
            id: "save-template-artifact-1",
            thread_id: threadId,
            role: "assistant",
            message_type: "artifact",
            content: artifact.title,
            artifact,
          }),
        ],
      }),
    },
  });

  await expect(page.getByTestId("chat-save-template")).toBeVisible();
  await page.getByTestId("chat-save-template").click();

  await expect(page.getByTestId("templates-view")).toBeVisible();
  await expect(page.getByTestId("template-create-modal")).toBeVisible();
  await expect(page.getByTestId("template-create-title")).toHaveValue(artifact.title);
  await expect(page.getByTestId("template-create-description")).toHaveValue(
    /福州周边周末探店/,
  );
  await expect(page.getByTestId("template-create-system-prompt")).toContainText("福州本地文旅内容");
  await expect(page.getByTestId("template-create-knowledge-base")).toHaveValue(
    "travel_local_guides",
  );
});

test("shows the local-only template workspace without skills controls", async ({ page }) => {
  await openWorkspace(page, {
    templates: [
      createMockTemplate({
        id: "template-preset-housing-foreclosure",
        title: "法拍房捡漏指南",
        platform: "双平台",
        category: "房产/家居",
        is_preset: true,
      }),
      createMockTemplate({
        id: "template-preset-emotion-peer-anxiety",
        title: "同龄人焦虑缓解指南",
        platform: "小红书",
        category: "情感/心理",
        is_preset: true,
      }),
    ],
  });

  await page.getByTestId("sidebar-shortcut-templates").click();
  await expect(page.getByTestId("templates-view")).toBeVisible();
  await expect(page.getByTestId("template-create-open")).toBeVisible();
  await expect(page.getByTestId("template-tab-房产/家居")).toBeVisible();
  await expect(page.getByTestId("template-tab-汽车/出行")).toBeVisible();
  await expect(page.getByTestId("template-tab-母婴/宠物")).toBeVisible();
  await expect(page.getByTestId("template-tab-情感/心理")).toBeVisible();
  await expect(page.locator('[data-testid^="template-collection-"]')).toHaveCount(0);
  await expect(page.getByTestId("template-skills-search-button")).toHaveCount(0);
  await expect(page.getByTestId("template-card-template-preset-housing-foreclosure")).toBeVisible();

  await page.getByTestId("template-tab-情感/心理").click();
  await expect(page.getByTestId("template-card-template-preset-emotion-peer-anxiety")).toBeVisible();
});

test("opens the topic pool and cascades a topic into the new-thread drafting flow", async ({
  page,
}) => {
  await openWorkspace(page, {
    topics: [
      createMockTopic({
        id: "topic-idea-001",
        title: "法拍房新手第一次看房最容易踩的 5 个坑",
        inspiration: "强调第一次看房 checklist、司法流程误区和普通人最怕的坑。",
        platform: "双平台",
        status: "idea",
      }),
      createMockTopic({
        id: "topic-published-001",
        title: "已经发过的 citywalk 复盘",
        inspiration: "用于验证已发布列。",
        platform: "小红书",
        status: "published",
      }),
    ],
  });

  await page.getByTestId("sidebar-shortcut-topics").click();
  await expect(page.getByTestId("topic-column-idea")).toBeVisible();
  await expect(page.getByTestId("topic-column-published")).toBeVisible();
  await expect(page.getByTestId("topic-card-topic-idea-001")).toContainText("法拍房新手第一次看房");

  await page.getByTestId("topic-draft-topic-idea-001").click();

  await expect(page.getByTestId("new-thread-modal")).toBeVisible();
  await expect(page.getByTestId("new-thread-title-input")).toHaveValue(
    "法拍房新手第一次看房最容易踩的 5 个坑",
  );
  await expect(page.getByTestId("new-thread-system-prompt-input")).toContainText("法拍房新手第一次看房最容易踩的 5 个坑");
  await expect(page.getByTestId("new-thread-system-prompt-input")).toContainText("司法流程误区");

  await page.getByLabel("关闭新建会话弹窗").click();
  await page.getByTestId("sidebar-shortcut-topics").click();
  await expect(page.getByTestId("topic-column-drafting")).toBeVisible();
  await expect(page.getByTestId("topic-column-drafting")).toContainText(
    "法拍房新手第一次看房最容易踩的 5 个坑",
  );
  await expect(page.getByTestId("topic-draft-topic-idea-001")).toContainText("继续撰写");
});

test("resumes drafting from the bound topic thread instead of opening a new modal", async ({
  page,
}) => {
  const threadId = "thread-topic-resume-001";

  await openWorkspace(page, {
    topics: [
      createMockTopic({
        id: "topic-resume-001",
        title: "继续撰写的法拍房选题",
        inspiration: "这条选题已经和真实会话绑定。",
        platform: "小红书",
        status: "drafting",
        thread_id: threadId,
      }),
    ],
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "继续撰写的法拍房选题",
        latest_message_excerpt: "上一轮草稿已经生成。",
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "继续撰写的法拍房选题",
        system_prompt: "你是一位法拍房内容策划顾问。",
        messages: [
          createMockHistoryMessage({
            id: "topic-resume-user-1",
            thread_id: threadId,
            role: "user",
            content: "帮我继续完善这篇法拍房避坑内容。",
          }),
          createMockHistoryMessage({
            id: "topic-resume-assistant-1",
            thread_id: threadId,
            role: "assistant",
            content: "这里是上一次已经生成的草稿内容。",
          }),
        ],
      }),
    },
  });

  await page.getByTestId("sidebar-shortcut-topics").click();
  await expect(page.getByTestId("topic-draft-topic-resume-001")).toContainText("继续撰写");
  await page.getByTestId("topic-draft-topic-resume-001").click();

  await expect(page.getByTestId("new-thread-modal")).toHaveCount(0);
  await expect(page.getByTestId("workspace-chat-view")).toBeVisible();
  await expect(
    page.getByTestId("chat-message-user").filter({ hasText: "帮我继续完善这篇法拍房避坑内容。" }),
  ).toBeVisible();
  await expect(page.getByTestId("workspace-persona-badge")).toContainText(
    "法拍房内容策划顾问",
  );
});

test("opens a saved draft preview and jumps back into its conversation", async ({
  page,
}) => {
  const threadId = "thread-draft-e2e";
  const draftId = "draft-e2e-001";
  const draftArtifact: ContentGenerationArtifactPayload = {
    artifact_type: "content_draft",
    title: "福州周边文旅探店笔记",
    title_candidates: ["福州周边周末微度假", "福州人私藏探店路线"],
    body: "这是一篇已经保存下来的草稿正文，包含路线、拍照点和收尾 CTA。",
    platform_cta: "评论区回复“福州”领取完整路线。",
  };

  await openWorkspace(page, {
    drafts: [
      createMockDraftSummary({
        id: draftId,
        thread_id: threadId,
        thread_title: "福州文旅选题会话",
        platform: "xiaohongshu",
        artifact: draftArtifact,
      }),
    ],
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "福州文旅选题会话",
        latest_message_excerpt: "Artifact ready",
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "福州文旅选题会话",
        system_prompt: "小红书本地生活主理人",
        messages: [
          createMockHistoryMessage({
            id: "draft-user-1",
            thread_id: threadId,
            role: "user",
            content: "帮我策划一篇福州周边的文旅探店笔记。",
          }),
          createMockHistoryMessage({
            id: "draft-assistant-1",
            thread_id: threadId,
            role: "assistant",
            content: "这里是草稿生成前的上下文说明。",
          }),
          createMockHistoryMessage({
            id: "draft-artifact-1",
            thread_id: threadId,
            role: "assistant",
            message_type: "artifact",
            content: draftArtifact.title,
            artifact: draftArtifact,
          }),
        ],
      }),
    },
  });

  await page.getByTestId("sidebar-shortcut-drafts").click();
  await expect(page.getByTestId("drafts-view")).toBeVisible();
  await expect(page.getByTestId(`draft-card-${draftId}`)).toContainText(draftArtifact.title);

  await page.getByTestId(`draft-preview-${draftId}`).click();
  await expect(page.getByTestId("draft-detail-dialog")).toBeVisible();
  await expect(page.getByTestId("draft-detail-dialog")).toContainText(draftArtifact.body);

  await page
    .getByTestId("draft-detail-dialog")
    .getByRole("button", { name: "在会话中打开" })
    .click();

  await expect(page.getByTestId("workspace-chat-view")).toBeVisible();
  await expect(page.getByTestId("drafts-view")).toBeHidden();
  await expect(
    page
      .getByTestId("chat-message-user")
      .filter({ hasText: "帮我策划一篇福州周边的文旅探店笔记。" }),
  ).toBeVisible();
  await expect(page.getByTestId("workspace-persona-badge")).toContainText(
    "小红书本地生活主理人",
  );
});

test("deletes a single draft card from the drafts view", async ({ page }) => {
  const draftArtifact: ContentGenerationArtifactPayload = {
    artifact_type: "content_draft",
    title: "Single delete draft",
    title_candidates: ["Single delete title"],
    body: "Draft body for single delete coverage.",
    platform_cta: "Comment for the checklist.",
  };

  await openWorkspace(page, {
    drafts: [
      createMockDraftSummary({
        id: "draft-delete-one",
        message_id: "message-delete-one",
        thread_id: "thread-delete-one",
        thread_title: "Thread delete one",
        platform: "xiaohongshu",
        artifact: draftArtifact,
      }),
      createMockDraftSummary({
        id: "draft-delete-two",
        message_id: "message-delete-two",
        thread_id: "thread-delete-two",
        thread_title: "Thread delete two",
        platform: "douyin",
        artifact: {
          ...draftArtifact,
          title: "Draft that should remain",
        },
      }),
    ],
  });

  await page.getByTestId("sidebar-shortcut-drafts").click();
  await expect(page.getByTestId("drafts-view")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.accept();
  });

  await page.getByTestId("draft-delete-draft-delete-one").click();

  await expect(page.getByTestId("draft-card-draft-delete-one")).toBeHidden();
  await expect(page.getByTestId("draft-card-draft-delete-two")).toBeVisible();
});

test("deletes selected drafts from the bulk action bar", async ({ page }) => {
  const draftArtifact: ContentGenerationArtifactPayload = {
    artifact_type: "content_draft",
    title: "Bulk delete seed",
    title_candidates: ["Bulk delete candidate"],
    body: "Bulk delete body for selection mode.",
    platform_cta: "Collect more examples in comments.",
  };

  await openWorkspace(page, {
    drafts: [
      createMockDraftSummary({
        id: "draft-bulk-a",
        message_id: "message-bulk-a",
        thread_id: "thread-bulk-a",
        thread_title: "Bulk thread A",
        artifact: {
          ...draftArtifact,
          title: "Bulk delete A",
        },
      }),
      createMockDraftSummary({
        id: "draft-bulk-b",
        message_id: "message-bulk-b",
        thread_id: "thread-bulk-b",
        thread_title: "Bulk thread B",
        artifact: {
          ...draftArtifact,
          title: "Bulk delete B",
        },
      }),
      createMockDraftSummary({
        id: "draft-bulk-c",
        message_id: "message-bulk-c",
        thread_id: "thread-bulk-c",
        thread_title: "Bulk thread C",
        artifact: {
          ...draftArtifact,
          title: "Bulk delete survivor",
        },
      }),
    ],
  });

  await page.getByTestId("sidebar-shortcut-drafts").click();
  await page.getByTestId("draft-checkbox-draft-bulk-a").check();
  await page.getByTestId("draft-checkbox-draft-bulk-b").check();
  await expect(page.getByTestId("drafts-selected-count")).toContainText("已选择 2 项");

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.accept();
  });

  await page.getByTestId("draft-delete-selected").click();

  await expect(page.getByTestId("draft-card-draft-bulk-a")).toBeHidden();
  await expect(page.getByTestId("draft-card-draft-bulk-b")).toBeHidden();
  await expect(page.getByTestId("draft-card-draft-bulk-c")).toBeVisible();
});

test("clears all drafts from the drafts header action", async ({ page }) => {
  const draftArtifact: ContentGenerationArtifactPayload = {
    artifact_type: "content_draft",
    title: "Clear all draft",
    title_candidates: ["Clear all candidate"],
    body: "Draft body for clear all coverage.",
    platform_cta: "Reply to get the template.",
  };

  await openWorkspace(page, {
    drafts: [
      createMockDraftSummary({
        id: "draft-clear-a",
        message_id: "message-clear-a",
        thread_id: "thread-clear-a",
        thread_title: "Clear thread A",
        artifact: {
          ...draftArtifact,
          title: "Clear me A",
        },
      }),
      createMockDraftSummary({
        id: "draft-clear-b",
        message_id: "message-clear-b",
        thread_id: "thread-clear-b",
        thread_title: "Clear thread B",
        artifact: {
          ...draftArtifact,
          title: "Clear me B",
        },
      }),
    ],
  });

  await page.getByTestId("sidebar-shortcut-drafts").click();
  await expect(page.getByTestId("draft-card-draft-clear-a")).toBeVisible();
  await expect(page.getByTestId("draft-card-draft-clear-b")).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.accept();
  });

  await page.getByTestId("draft-clear-all").click();

  await expect(page.getByTestId("draft-card-draft-clear-a")).toBeHidden();
  await expect(page.getByTestId("draft-card-draft-clear-b")).toBeHidden();
  await expect(page.getByTestId("drafts-empty-state")).toBeVisible();
});

test("updates thread settings and reflects the saved title and system prompt", async ({
  page,
}) => {
  const threadId = "thread-settings-e2e";

  await openWorkspace(page, {
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "Original settings thread",
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "Original settings thread",
        system_prompt: "Original persona",
      }),
    },
  });

  await page.getByTestId("open-thread-settings").click();
  await expect(page.getByTestId("thread-settings-modal")).toBeVisible();
  await page.getByTestId("thread-settings-title-input").fill("Updated thread settings title");
  await page
    .getByTestId("thread-settings-system-prompt-input")
    .fill("Updated persona for high-conversion education campaigns.");
  await page.getByTestId("thread-settings-save").click();

  await expect(page.getByTestId("thread-settings-modal")).toBeHidden();
  await expect(page.getByTestId(`sidebar-thread-${threadId}`)).toContainText(
    "Updated thread settings title",
  );
  await expect(page.getByTestId("workspace-persona-badge")).toContainText(
    "Updated persona for high-conversion education campaigns.",
  );
});

test("renames a thread from the sidebar prompt action", async ({ page }) => {
  const threadId = "thread-rename-e2e";

  await openWorkspace(page, {
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "Prompt rename seed",
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "Prompt rename seed",
        system_prompt: "Rename flow persona",
      }),
    },
  });

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("prompt");
    await dialog.accept("Prompt renamed thread");
  });

  await page.getByTestId(`sidebar-thread-${threadId}`).hover();
  await page.getByTestId(`sidebar-thread-rename-${threadId}`).click();

  await expect(page.getByTestId(`sidebar-thread-${threadId}`)).toContainText(
    "Prompt renamed thread",
  );
});

test("deletes the active thread and falls back to the next available history", async ({
  page,
}) => {
  const deletedThreadId = "thread-delete-e2e";
  const fallbackThreadId = "thread-fallback-e2e";
  const fallbackMessage = createMockHistoryMessage({
    id: "fallback-user-1",
    thread_id: fallbackThreadId,
    role: "assistant",
    content: "Fallback thread is now active.",
  });

  await openWorkspace(page, {
    threads: [
      createMockThreadSummary({
        id: deletedThreadId,
        title: "Delete me first",
      }),
      createMockThreadSummary({
        id: fallbackThreadId,
        title: "Fallback thread",
      }),
    ],
    threadMessagesById: {
      [deletedThreadId]: createMockThreadMessages({
        thread_id: deletedThreadId,
        title: "Delete me first",
        system_prompt: "Delete flow persona",
      }),
      [fallbackThreadId]: createMockThreadMessages({
        thread_id: fallbackThreadId,
        title: "Fallback thread",
        system_prompt: "Fallback persona",
        messages: [fallbackMessage],
      }),
    },
  });

  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("confirm");
    await dialog.accept();
  });

  await page.getByTestId(`sidebar-thread-${deletedThreadId}`).hover();
  await page.getByTestId(`sidebar-thread-delete-${deletedThreadId}`).click();

  await expect(page.getByTestId(`sidebar-thread-${deletedThreadId}`)).toBeHidden();
  await expect(page.getByTestId(`sidebar-thread-${fallbackThreadId}`)).toBeVisible();
  await expect(page.getByTestId("workspace-persona-badge")).toContainText(
    "Fallback persona",
  );
  await expect(
    page.getByTestId("chat-message-assistant").filter({ hasText: fallbackMessage.content }),
  ).toBeVisible();
});

test("updates nickname, bio, and avatar from the profile modal", async ({ page }) => {
  await openWorkspace(page, {
    user: {
      nickname: "Legacy name",
      bio: "Legacy bio",
    },
  });

  await page.getByTestId("sidebar-open-profile").click();
  await expect(page.getByTestId("user-profile-modal")).toBeVisible();
  await page.getByTestId("profile-avatar-input").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-avatar"),
  });
  await page.getByTestId("profile-nickname-input").fill("Updated profile name");
  await page
    .getByTestId("profile-bio-input")
    .fill("Updated profile bio for regression verification.");
  await page.getByTestId("profile-save-button").click();

  await expect(page.getByTestId("user-profile-modal")).toBeHidden();
  await expect(page.getByTestId("sidebar-open-profile")).toContainText(
    "Updated profile name",
  );
  await expect(page.getByTestId("sidebar-open-profile")).toContainText(
    "Updated profile bio for regression verification.",
  );
  await expect(page.locator('[data-testid="sidebar-open-profile"] img')).toBeVisible();
});

test("refreshes active sessions and revokes a non-current device", async ({ page }) => {
  await openWorkspace(page, {
    sessions: [
      createMockSession({
        id: "session-current",
        device_info: "Chrome on Windows",
        is_current: true,
      }),
      createMockSession({
        id: "session-other",
        device_info: "Mobile Safari",
        is_current: false,
      }),
    ],
  });

  await page.getByTestId("sidebar-open-profile").click();
  await expect(page.getByTestId("user-profile-modal")).toBeVisible();
  await page.getByTestId("user-profile-tab-sessions").click();
  await expect(page.getByTestId("session-card-session-other")).toBeVisible();
  await page.getByTestId("session-refresh-button").click();
  await page.getByTestId("session-revoke-session-other").click();

  await expect(page.getByTestId("session-card-session-other")).toBeHidden();
  await expect(page.getByTestId("session-card-session-current")).toBeVisible();
});

test("updates the password in-session and prunes revoked devices", async ({ page }) => {
  await openWorkspace(page, {
    sessions: [
      createMockSession({
        id: "session-current",
        device_info: "Chrome on Windows",
        is_current: true,
      }),
      createMockSession({
        id: "session-other",
        device_info: "Android Chrome",
        is_current: false,
      }),
    ],
  });

  await page.getByTestId("sidebar-open-profile").click();
  await expect(page.getByTestId("user-profile-modal")).toBeVisible();
  await page.getByTestId("user-profile-tab-security").click();
  await page.getByTestId("profile-current-password-input").fill("OldPassword123!");
  await page.getByTestId("profile-new-password-input").fill("NewPassword456!");
  await page.getByTestId("profile-confirm-password-input").fill("NewPassword456!");
  await page.getByTestId("profile-password-save-button").click();

  await expect(page.getByTestId("profile-password-success")).toBeVisible();
  await page.getByTestId("user-profile-tab-sessions").click();
  await expect(page.getByTestId("session-card-session-other")).toBeHidden();
  await expect(page.getByTestId("session-card-session-current")).toBeVisible();
});

test("sends a streamed chat message and renders user thinking progress and AI feedback", async ({
  page,
}) => {
  await openWorkspace(page, {
    responseDelayMsByPath: {
      "/api/v1/media/threads": 800,
    },
    streamEvents: (payload) => [
      {
        event: "start",
        thread_id: payload.thread_id,
        platform: payload.platform,
        task_type: payload.task_type,
        materials_count: payload.materials.length,
      },
      { event: "tool_call", name: "analyze_market_trends", status: "processing" },
      { event: "tool_call", name: "analyze_market_trends", status: "completed" },
      {
        event: "message",
        delta: "Assistant merged the uploaded material and market signals.",
        index: 0,
      },
      { event: "done", thread_id: payload.thread_id },
    ],
  });

  await page.getByTestId("composer-image-input").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-image"),
  });
  await expect(
    page.getByTestId("composer-uploaded-material").filter({ hasText: "cover.png" }),
  ).toBeVisible();

  const composer = page.getByTestId("composer-textarea");
  await composer.fill("Generate a tourism-note headline from this uploaded cover.");
  await page.getByTestId("composer-send-button").click();

  await expect(composer).toHaveValue("");
  await expect(
    page
      .getByTestId("chat-message-user")
      .filter({ hasText: "Generate a tourism-note headline from this uploaded cover." }),
  ).toBeVisible();
  await expect(page.getByTestId("thinking-panel")).toBeVisible();
  await expect(page.getByTestId("thinking-panel")).toContainText("AI 思考完成");
  await expect(page.getByTestId("thinking-panel")).toContainText("分析市场趋势");
  await expect(page.getByTestId("chat-message-tool")).toHaveCount(0);
  await expect(
    page
      .getByTestId("chat-message-assistant")
      .filter({ hasText: "Assistant merged the uploaded material and market signals." }),
  ).toBeVisible();
});

test("stops an in-flight streamed chat request without clearing the user message", async ({
  page,
}) => {
  await openWorkspace(page, {
    responseDelayMsByPath: {
      "/api/v1/media/chat/stream": 8000,
    },
  });

  const composer = page.getByTestId("composer-textarea");
  await composer.fill("这条生成马上停止。");
  await page.getByTestId("composer-send-button").click();

  await expect(page.getByTestId("composer-stop-button")).toBeVisible();
  await page.getByTestId("composer-stop-button").click();

  await expect(page.getByTestId("composer-stop-button")).toHaveCount(0);
  await expect(
    page.getByTestId("chat-message-user").filter({ hasText: "这条生成马上停止。" }),
  ).toBeVisible();
});

test("surfaces SSE errors and removes empty assistant placeholders", async ({ page }) => {
  await openWorkspace(page, {
    streamEvents: (payload) => [
      {
        event: "start",
        thread_id: payload.thread_id,
        platform: payload.platform,
        task_type: payload.task_type,
        materials_count: payload.materials.length,
      },
      {
        event: "error",
        code: "QWEN_ARTIFACT_VALIDATION_ERROR",
        message: "Qwen 返回的结构化结果不符合契约，请稍后重试。",
      },
      { event: "done", thread_id: payload.thread_id },
    ],
  });

  const composer = page.getByTestId("composer-textarea");
  await composer.fill("请把这版内容改写到另一平台。");
  await page.getByTestId("composer-send-button").click();

  await expect(page.getByTestId("chat-message-error")).toContainText(
    "模型结构化结果生成失败，请尝试切换更高级模型（如 Qwen-Max）后重试。",
  );
  await expect(page.getByTestId("chat-message-error")).toContainText(
    "错误代码：QWEN_ARTIFACT_VALIDATION_ERROR",
  );
  await expect(page.getByTestId("chat-message-assistant")).toHaveCount(0);
});

test("uses artifact actions to queue follow-up prompts and flip the workspace platform", async ({
  page,
}) => {
  const threadId = "thread-artifact-e2e";
  const artifact: ContentGenerationArtifactPayload = {
    artifact_type: "content_draft",
    title: "Artifact draft",
    title_candidates: ["Artifact headline A", "Artifact headline B"],
    body: "Artifact body copy for the right panel.",
    platform_cta: "Artifact CTA block",
  };

  await openWorkspace(page, {
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "Artifact follow-up thread",
        latest_message_excerpt: "Artifact ready",
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "Artifact follow-up thread",
        system_prompt: "Artifact persona",
        messages: [
          createMockHistoryMessage({
            id: "artifact-user-1",
            thread_id: threadId,
            role: "user",
            content: "Please keep refining this artifact.",
          }),
          createMockHistoryMessage({
            id: "artifact-assistant-1",
            thread_id: threadId,
            role: "assistant",
            message_type: "artifact",
            content: "Artifact snapshot",
            artifact,
          }),
        ],
      }),
    },
  });

  await expect(page.getByTestId("right-panel")).toBeVisible();
  await expect(page.getByText("Artifact draft")).toBeVisible();

  const composer = page.getByTestId("composer-textarea");
  const initialPrompt = await composer.inputValue();
  expect(initialPrompt.length).toBeGreaterThan(0);

  await page.getByTestId("artifact-action-continue-optimization").click();
  const firstPrompt = await composer.inputValue();
  expect(firstPrompt).not.toBe(initialPrompt);

  const initialWorkspaceTitle = (await page.getByTestId("workspace-title").textContent())?.trim();
  await page.getByTestId("artifact-action-rewrite-other-platform").click();
  await expect.poll(() => composer.inputValue()).not.toBe(firstPrompt);
  await expect
    .poll(async () => (await page.getByTestId("workspace-title").textContent())?.trim())
    .not.toBe(initialWorkspaceTitle);

  const secondPrompt = await composer.inputValue();
  await page.getByTestId("artifact-action-generate-three-versions").click();
  await expect.poll(() => composer.inputValue()).not.toBe(secondPrompt);
});

test("renders generated image galleries in the right panel and drafts detail view", async ({
  page,
}) => {
  const threadId = "thread-artifact-gallery";
  const draftId = "draft-artifact-gallery";
  const generatedImages = [
    "https://example.com/generated-cover-1.png",
    "https://example.com/generated-cover-2.png",
  ];
  const artifact: ContentGenerationArtifactPayload = {
    artifact_type: "content_draft",
    title: "Gallery artifact",
    title_candidates: ["Gallery headline A", "Gallery headline B"],
    body: "Artifact body copy for image gallery verification.",
    platform_cta: "Artifact CTA block",
    generated_images: generatedImages,
  };

  await openWorkspace(page, {
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "Artifact gallery thread",
        latest_message_excerpt: "Artifact gallery ready",
      }),
    ],
    drafts: [
      createMockDraftSummary({
        id: draftId,
        message_id: "message-artifact-gallery",
        thread_id: threadId,
        thread_title: "Artifact gallery thread",
        artifact,
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "Artifact gallery thread",
        system_prompt: "Artifact gallery persona",
        messages: [
          createMockHistoryMessage({
            id: "artifact-gallery-user-1",
            thread_id: threadId,
            role: "user",
            content: "Please show me the generated cover gallery.",
          }),
          createMockHistoryMessage({
            id: "artifact-gallery-assistant-1",
            thread_id: threadId,
            role: "assistant",
            message_type: "artifact",
            content: artifact.title,
            artifact,
          }),
        ],
      }),
    },
  });

  await expect(page.getByTestId("artifact-image-gallery")).toBeVisible();
  await expect(page.getByTestId("artifact-image-card-1")).toBeVisible();
  await expect(page.getByTestId("artifact-image-card-2")).toBeVisible();
  await expect(page.getByTestId("artifact-image-card-1").locator("img")).toBeVisible();

  await page.getByTestId("sidebar-shortcut-drafts").click();
  await page.getByTestId(`draft-preview-${draftId}`).click();
  await expect(page.getByTestId("draft-detail-dialog")).toBeVisible();
  await expect(page.getByTestId("draft-detail-image-gallery")).toBeVisible();
  await expect(
    page.getByTestId("draft-detail-image-gallery").locator("img"),
  ).toHaveCount(2);
});

test("renders generated images inline inside the assistant chat bubble", async ({
  page,
}) => {
  const threadId = "thread-chat-inline-gallery";
  const generatedImages = [
    "https://example.com/generated-inline-1.png",
    "https://example.com/generated-inline-2.png",
  ];
  const artifact: ContentGenerationArtifactPayload = {
    artifact_type: "content_draft",
    title: "Inline gallery artifact",
    title_candidates: ["Inline headline A", "Inline headline B"],
    body: "Inline gallery artifact body.",
    platform_cta: "Inline gallery CTA.",
    generated_images: generatedImages,
  };

  await openWorkspace(page, {
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "Inline gallery thread",
        latest_message_excerpt: "Inline gallery ready",
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "Inline gallery thread",
        system_prompt: "Inline gallery persona",
        messages: [
          createMockHistoryMessage({
            id: "inline-gallery-user-1",
            thread_id: threadId,
            role: "user",
            content: "Please generate a visual cover for me.",
          }),
          createMockHistoryMessage({
            id: "inline-gallery-assistant-text-1",
            thread_id: threadId,
            role: "assistant",
            content: "Here is the finished draft and the generated cover set.",
          }),
          createMockHistoryMessage({
            id: "inline-gallery-artifact-1",
            thread_id: threadId,
            role: "assistant",
            message_type: "artifact",
            content: artifact.title,
            artifact,
          }),
          createMockHistoryMessage({
            id: "inline-gallery-user-2",
            thread_id: threadId,
            role: "user",
            content: "Thanks, now help me rewrite the ending.",
          }),
          createMockHistoryMessage({
            id: "inline-gallery-assistant-text-2",
            thread_id: threadId,
            role: "assistant",
            content: "Sure, I can help revise the ending next.",
          }),
        ],
      }),
    },
  });

  const firstAssistantBubble = page
    .getByTestId("chat-message-assistant")
    .filter({ hasText: "Here is the finished draft and the generated cover set." });
  await expect(firstAssistantBubble).toBeVisible();
  await expect(firstAssistantBubble.getByTestId("chat-artifact-image-gallery")).toBeVisible();
  await expect(firstAssistantBubble.getByTestId("chat-artifact-image-card-1")).toBeVisible();
  await expect(firstAssistantBubble.getByTestId("chat-artifact-image-card-2")).toBeVisible();
  await expect(
    firstAssistantBubble.locator(`img[src="${generatedImages[0]}"]`),
  ).toBeVisible();

  const latestAssistantBubble = page
    .getByTestId("chat-message-assistant")
    .filter({ hasText: "Sure, I can help revise the ending next." });
  await expect(latestAssistantBubble).toBeVisible();
  await expect(latestAssistantBubble.getByTestId("chat-artifact-image-gallery")).toHaveCount(0);
});
