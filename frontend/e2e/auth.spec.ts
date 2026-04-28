import { expect, test } from "@playwright/test";

import {
  authStorageKeys,
  buildAuthPayload,
  createMockThreadMessages,
  createMockThreadSummary,
  expectAuthenticated,
  mockBackend,
  seedAuthenticatedSession,
} from "./fixtures";

test("registers a user, enters the workspace, and stores tokens", async ({ page }) => {
  const username = `e2e_${Date.now()}`;

  await mockBackend(page);
  await page.goto("/");
  await page.getByRole("button", { name: "注册" }).click();
  await page.getByPlaceholder("请输入用户名").fill(username);
  await page.getByPlaceholder("请输入密码").fill("Playwright123!");
  await page.getByRole("button", { name: "注册并进入工作台" }).click();

  await expectAuthenticated(page);
  await expect(page.getByText(`@${username}`)).toBeVisible();
});

test("requests password reset and switches to token reset form", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");
  await page.getByRole("button", { name: "忘记密码？" }).click();
  await expect(page.getByText("第一步：申请重置令牌")).toBeVisible();

  await page.getByPlaceholder("请输入用户名").fill("reset_user");
  await page.getByRole("button", { name: "生成重置令牌" }).click();

  await expect(page.getByText("第二步：使用令牌重置密码")).toBeVisible();
  await expect(page.getByPlaceholder("请粘贴后端控制台输出的重置 Token")).toBeVisible();
  await expect(page.getByText(/15 分钟内有效/)).toBeVisible();
});

test("logs out, clears local storage, and returns to auth gate", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/");
  await page.getByPlaceholder("请输入用户名").fill("logout_user");
  await page.getByPlaceholder("请输入密码").fill("Playwright123!");
  await page.getByRole("button", { name: "登录并进入工作台" }).click();
  await expectAuthenticated(page);

  await page.getByRole("button", { name: "退出登录" }).click();

  await expect(page.getByTestId("auth-card")).toBeVisible();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), authStorageKeys.token)).toBeNull();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), authStorageKeys.refreshToken)).toBeNull();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), authStorageKeys.user)).toBeNull();
});

test("refreshes the auth session after a protected 401 and retries workspace bootstrap", async ({
  page,
}) => {
  const threadId = "thread-refresh-e2e";

  await mockBackend(page, {
    failOnceUnauthorizedPaths: ["/api/v1/media/threads"],
    threads: [
      createMockThreadSummary({
        id: threadId,
        title: "刷新链路验证",
        latest_message_excerpt: "刷新后拉起历史列表",
      }),
    ],
    threadMessagesById: {
      [threadId]: createMockThreadMessages({
        thread_id: threadId,
        title: "刷新链路验证",
        system_prompt: "你是一位可靠的内容工作流助手",
      }),
    },
  });
  await seedAuthenticatedSession(page, buildAuthPayload());

  await page.goto("/");

  await expectAuthenticated(page);
  await expect(page.getByTestId(`sidebar-thread-${threadId}`)).toBeVisible();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), authStorageKeys.token)).toBe(
    "access-token-refreshed-1",
  );
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), authStorageKeys.refreshToken)).toBe(
    "refresh-token-refreshed-1",
  );
});
