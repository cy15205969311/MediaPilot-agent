import type { Page, Route } from "@playwright/test";
import { expect } from "@playwright/test";

export const authStorageKeys = {
  token: "omnimedia_token",
  refreshToken: "omnimedia_refresh_token",
  user: "omnimedia_user",
} as const;

export const testUser = {
  id: "user-e2e-001",
  username: "e2e_user",
  nickname: "E2E User",
  bio: "Playwright smoke profile",
  avatar_url: null,
  created_at: "2026-04-28T00:00:00Z",
};

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function fulfillStream(route: Route, threadId: string) {
  const body = [
    `event: start\ndata: ${JSON.stringify({ thread_id: threadId, platform: "xiaohongshu", task_type: "content_generation", materials_count: 0 })}\n\n`,
    `event: message\ndata: ${JSON.stringify({ delta: "你好，", index: 0 })}\n\n`,
    `event: message\ndata: ${JSON.stringify({ delta: "这是 Playwright 自动化回复。", index: 1 })}\n\n`,
    `event: done\ndata: ${JSON.stringify({ thread_id: threadId })}\n\n`,
  ].join("");

  await route.fulfill({
    status: 200,
    contentType: "text/event-stream; charset=utf-8",
    body,
  });
}

function authPayload(username = testUser.username) {
  return {
    access_token: `access-token-${username}`,
    refresh_token: `refresh-token-${username}`,
    token_type: "bearer",
    user: {
      ...testUser,
      username,
    },
  };
}

export async function mockBackend(page: Page) {
  await page.route("**/api/v1/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/v1/auth/register" && request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}") as { username?: string };
      await fulfillJson(route, authPayload(body.username || testUser.username));
      return;
    }

    if (path === "/api/v1/auth/login" && request.method() === "POST") {
      const form = new URLSearchParams(request.postData() || "");
      await fulfillJson(route, authPayload(form.get("username") || testUser.username));
      return;
    }

    if (path === "/api/v1/auth/password-reset-request" && request.method() === "POST") {
      await fulfillJson(route, { accepted: true, expires_in_minutes: 15 });
      return;
    }

    if (path === "/api/v1/auth/logout" && request.method() === "POST") {
      await fulfillJson(route, { logged_out: true });
      return;
    }

    if (path === "/api/v1/media/threads" && request.method() === "GET") {
      await fulfillJson(route, { items: [], total: 0, page: 1, page_size: 20 });
      return;
    }

    if (path === "/api/v1/media/chat/stream" && request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}") as { thread_id?: string };
      await fulfillStream(route, body.thread_id || "thread-e2e");
      return;
    }

    await fulfillJson(route, { detail: `Unhandled E2E route: ${path}` }, 404);
  });
}

export async function seedAuthenticatedSession(page: Page) {
  await page.addInitScript(
    ({ keys, payload }) => {
      window.localStorage.setItem(keys.token, payload.access_token);
      window.localStorage.setItem(keys.refreshToken, payload.refresh_token);
      window.localStorage.setItem(keys.user, JSON.stringify(payload.user));
    },
    { keys: authStorageKeys, payload: authPayload() },
  );
}

export async function expectAuthenticated(page: Page) {
  await expect(page.getByTestId("workspace-shell")).toBeVisible();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), authStorageKeys.token)).toBeTruthy();
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), authStorageKeys.refreshToken)).toBeTruthy();
}