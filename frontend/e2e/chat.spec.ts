import { expect, test } from "@playwright/test";

import { mockBackend, seedAuthenticatedSession } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
  await seedAuthenticatedSession(page);
  await page.goto("/");
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
});

test("creates a new titled conversation from the sidebar modal", async ({ page }) => {
  const threadTitle = `E2E 新会话 ${Date.now()}`;

  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(page.getByTestId("new-thread-modal")).toBeVisible();
  await page.getByPlaceholder("For example: Annual portfolio review ideas").fill(threadTitle);
  await page.getByRole("button", { name: "开始新会话" }).click();

  await expect(page.getByTestId("new-thread-modal")).toBeHidden();
  await expect(page.getByRole("button", { name: new RegExp(threadTitle) })).toBeVisible();
});

test("sends a streamed chat message and renders user and AI bubbles", async ({ page }) => {
  const composer = page.getByPlaceholder("描述你的内容需求，或上传素材让 Agent 帮你分析...");

  await composer.fill("你好");
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(composer).toHaveValue("");
  await expect(page.getByTestId("chat-message-user").filter({ hasText: "你好" })).toBeVisible();
  await expect(page.getByTestId("chat-message-user-avatar")).toBeVisible();
  await expect(page.getByTestId("chat-message-assistant").filter({ hasText: "Playwright 自动化回复" })).toBeVisible();
});
