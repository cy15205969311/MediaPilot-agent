import { Buffer } from "node:buffer";

import { expect, test, type Page } from "@playwright/test";

import type { ContentGenerationArtifactPayload } from "../src/app/types";
import {
  buildAuthPayload,
  createMockHistoryMessage,
  createMockSession,
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
  const authPayload = buildAuthPayload(
    options.user?.username,
    options.user,
  );
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
  await page.getByPlaceholder("For example: Annual portfolio review ideas").fill(threadTitle);
  await page.getByRole("button", { name: "开始新会话" }).click();

  await expect(page.getByTestId("new-thread-modal")).toBeHidden();
  await expect(page.getByRole("button", { name: new RegExp(threadTitle) })).toBeVisible();
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
    content: "Here is the saved planning summary from yesterday.",
    created_at: "2026-04-28T08:11:00Z",
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
    page.getByTestId("chat-message-assistant").filter({ hasText: assistantMessage.content }),
  ).toBeVisible();
  await expect(page.getByTestId("workspace-persona-badge")).toContainText(
    "Replay persona: focused planning copilot",
  );
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
  await page.getByTestId("profile-bio-input").fill(
    "Updated profile bio for regression verification.",
  );
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

test("sends a streamed chat message and renders user, tool, and AI feedback", async ({
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
  await expect(page.getByText("cover.png")).toBeVisible();

  const composer = page.getByTestId("composer-textarea");
  await composer.fill("Generate a tourism-note headline from this uploaded cover.");
  await page.getByTestId("composer-send-button").click();

  await expect(composer).toHaveValue("");
  await expect(
    page
      .getByTestId("chat-message-user")
      .filter({ hasText: "Generate a tourism-note headline from this uploaded cover." }),
  ).toBeVisible();
  const toolMessages = page
    .getByTestId("chat-message-tool")
    .filter({ hasText: "analyze_market_trends" });
  await expect(toolMessages).toHaveCount(2);
  await expect(toolMessages.first()).toBeVisible();
  await expect(
    page
      .getByTestId("chat-message-assistant")
      .filter({ hasText: "Assistant merged the uploaded material and market signals." }),
  ).toBeVisible();
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
