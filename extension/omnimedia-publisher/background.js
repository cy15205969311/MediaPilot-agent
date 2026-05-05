const PUBLISH_ACTION = "OMNIMEDIA_PUBLISH";
const TARGET_SCRIPT_READY_TYPE = "TARGET_SCRIPT_READY";
const FILL_ACTION = "OMNIMEDIA_FILL_XIAOHONGSHU";
const PUBLISH_STATUS_TYPE = "OMNIMEDIA_PUBLISH_STATUS";
const TASKS_STORAGE_KEY = "omnimedia_publish_tasks";
const READY_TABS_STORAGE_KEY = "omnimedia_ready_tabs";
const XIAOHONGSHU_PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish";
const BRIDGE_SCRIPT_FILE = "bridge.js";
const WORKSPACE_URL_PREFIXES = [
  "http://localhost:5173/",
  "http://127.0.0.1:5173/",
  "http://localhost:8000/",
  "http://127.0.0.1:8000/",
];

function createResponse(success, message, extra = {}) {
  return {
    success,
    message,
    ...extra,
  };
}

async function getStoredTasks() {
  const result = await chrome.storage.local.get(TASKS_STORAGE_KEY);
  return result[TASKS_STORAGE_KEY] ?? {};
}

async function setStoredTasks(tasks) {
  await chrome.storage.local.set({
    [TASKS_STORAGE_KEY]: tasks,
  });
}

async function getReadyTabs() {
  const result = await chrome.storage.local.get(READY_TABS_STORAGE_KEY);
  return result[READY_TABS_STORAGE_KEY] ?? {};
}

async function setReadyTabs(readyTabs) {
  await chrome.storage.local.set({
    [READY_TABS_STORAGE_KEY]: readyTabs,
  });
}

async function saveTask(task) {
  const tasks = await getStoredTasks();
  tasks[task.id] = task;
  await setStoredTasks(tasks);
}

async function removeTask(taskId) {
  const tasks = await getStoredTasks();
  delete tasks[taskId];
  await setStoredTasks(tasks);
}

async function markTabReady(tabId) {
  const readyTabs = await getReadyTabs();
  readyTabs[String(tabId)] = {
    readyAt: Date.now(),
  };
  await setReadyTabs(readyTabs);
}

async function clearTabReady(tabId) {
  const readyTabs = await getReadyTabs();
  delete readyTabs[String(tabId)];
  await setReadyTabs(readyTabs);
}

async function isTabReady(tabId) {
  const readyTabs = await getReadyTabs();
  return Boolean(readyTabs[String(tabId)]);
}

async function findTaskByTabId(tabId) {
  const tasks = await getStoredTasks();

  for (const task of Object.values(tasks)) {
    if (task.tabId === tabId) {
      return task;
    }
  }

  return null;
}

async function findTaskById(taskId) {
  if (typeof taskId !== "string" || !taskId.trim()) {
    return null;
  }

  const tasks = await getStoredTasks();
  return tasks[taskId] ?? null;
}

function normalizePayload(payload) {
  const title = typeof payload?.title === "string" ? payload.title.trim() : "";
  const content = typeof payload?.content === "string" ? payload.content.trim() : "";
  const imageUrls = Array.isArray(payload?.imageUrls)
    ? payload.imageUrls.filter((item) => typeof item === "string" && item.trim())
    : [];

  return {
    title,
    content,
    imageUrls,
  };
}

function isWorkspaceTab(tab) {
  return (
    typeof tab?.url === "string" &&
    WORKSPACE_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix))
  );
}

async function findWorkspaceTab() {
  const activeTabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const activeWorkspaceTab = activeTabs.find(isWorkspaceTab);

  if (activeWorkspaceTab?.id) {
    return activeWorkspaceTab;
  }

  const allTabs = await chrome.tabs.query({});
  return allTabs.find((tab) => tab.active && isWorkspaceTab(tab)) ?? allTabs.find(isWorkspaceTab) ?? null;
}

async function injectBridgeIntoTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [BRIDGE_SCRIPT_FILE],
    });
  } catch (error) {
    console.warn("[OmniMedia Publisher] Failed to inject bridge script into workspace tab", {
      tabId,
      error,
    });
  }
}

async function injectBridgeIntoOpenWorkspaceTabs() {
  const tabs = await chrome.tabs.query({});
  const workspaceTabs = tabs.filter((tab) => typeof tab.id === "number" && isWorkspaceTab(tab));

  await Promise.all(workspaceTabs.map((tab) => injectBridgeIntoTab(tab.id)));
}

async function forwardPublishStatus(message) {
  const relatedTask = await findTaskById(message.taskId);
  let workspaceTab = null;

  if (typeof relatedTask?.workspaceTabId === "number") {
    try {
      workspaceTab = await chrome.tabs.get(relatedTask.workspaceTabId);
    } catch (error) {
      console.warn("[OmniMedia Publisher] Original workspace tab is no longer available", {
        taskId: message.taskId,
        workspaceTabId: relatedTask.workspaceTabId,
        error,
      });
    }
  }

  if (!workspaceTab?.id) {
    workspaceTab = await findWorkspaceTab();
  }

  if (!workspaceTab?.id) {
    console.warn("[OmniMedia Publisher] Workspace tab not found for publish status", message);
    return createResponse(false, "未找到工作台页面，无法回传发布状态。");
  }

  try {
    const response = await chrome.tabs.sendMessage(workspaceTab.id, {
      type: PUBLISH_STATUS_TYPE,
      status: message.status,
      message: message.message,
      error: message.error,
      taskId: message.taskId,
    });

    if (!response?.success) {
      return createResponse(
        false,
        response?.message ?? "工作台未确认收到发布状态。",
      );
    }

    return createResponse(true, "发布状态已转发到工作台。");
  } catch (error) {
    console.warn("[OmniMedia Publisher] Failed to forward publish status", error);
    return createResponse(
      false,
      error instanceof Error ? error.message : "发布状态转发失败。",
    );
  }
}

async function dispatchTaskToTab(tabId) {
  const task = await findTaskByTabId(tabId);

  if (!task || task.status === "dispatching") {
    return createResponse(false, "当前标签页没有待下发任务。");
  }

  try {
    await saveTask({
      ...task,
      status: "dispatching",
      dispatchedAt: Date.now(),
    });

    const response = await chrome.tabs.sendMessage(tabId, {
      action: FILL_ACTION,
      taskId: task.id,
      payload: task.payload,
    });

    const accepted = response?.success || response?.status === "received";
    if (!accepted) {
      throw new Error(response?.message ?? "Target tab rejected the publish task.");
    }

    await removeTask(task.id);
    await clearTabReady(tabId);

    return createResponse(true, response.message ?? "发布任务已完成。", {
      taskId: task.id,
    });
  } catch (error) {
    await saveTask({
      ...task,
      status: "pending",
      lastError: error instanceof Error ? error.message : "Unknown dispatch error",
      retryCount: (task.retryCount ?? 0) + 1,
    });
    console.warn("[OmniMedia Publisher] Failed to dispatch task to target tab", error);
    return createResponse(
      false,
      error instanceof Error ? error.message : "向内容脚本下发任务失败。",
      {
        errorCode: "TASK_DISPATCH_FAILED",
        taskId: task.id,
      },
    );
  }
}

async function queuePublishTask(payload, workspaceTabId = null) {
  const normalizedPayload = normalizePayload(payload);

  if (
    !normalizedPayload.title &&
    !normalizedPayload.content &&
    normalizedPayload.imageUrls.length === 0
  ) {
    throw new Error("Publish payload is empty.");
  }

  const tab = await chrome.tabs.create({
    url: XIAOHONGSHU_PUBLISH_URL,
    active: true,
  });

  const task = {
    id: crypto.randomUUID(),
    tabId: tab.id,
    workspaceTabId: typeof workspaceTabId === "number" ? workspaceTabId : null,
    payload: normalizedPayload,
    status: "pending",
    createdAt: Date.now(),
  };

  await saveTask(task);

  if (tab.id && (await isTabReady(tab.id))) {
    void dispatchTaskToTab(tab.id);
  }

  return {
    taskId: task.id,
    tabId: tab.id,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  void injectBridgeIntoOpenWorkspaceTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void injectBridgeIntoOpenWorkspaceTabs();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === PUBLISH_ACTION) {
    void queuePublishTask(message.payload, sender.tab?.id)
      .then((result) => {
        sendResponse(
          createResponse(true, "发布辅助任务已入队，正在打开小红书发布页。", result),
        );
      })
      .catch((error) => {
        console.error("[OmniMedia Publisher] Failed to create publish task", error);
        sendResponse(
          createResponse(
            false,
            error instanceof Error ? error.message : "发布任务创建失败。",
            {
              errorCode: "QUEUE_FAILED",
            },
          ),
        );
      });

    return true;
  }

  if (message?.type === TARGET_SCRIPT_READY_TYPE && sender.tab?.id) {
    const tabId = sender.tab.id;
    sendResponse(
      createResponse(true, "已收到内容脚本 READY 信号，后台将尝试下发发布辅助任务。"),
    );

    void (async () => {
      try {
        await markTabReady(tabId);
      } catch (error) {
        console.warn("[OmniMedia Publisher] Failed to process ready handshake", error);
        return;
      }

      const dispatchResult = await dispatchTaskToTab(tabId);
      if (!dispatchResult.success && dispatchResult.message !== "当前标签页没有待下发任务。") {
        console.warn(
          "[OmniMedia Publisher] Task dispatch after READY was not successful",
          dispatchResult,
        );
      }
    })();

    return false;
  }

  if (message?.type === PUBLISH_STATUS_TYPE) {
    sendResponse(createResponse(true, "发布状态已收到，后台将尝试转发。"));

    void forwardPublishStatus(message)
      .then((result) => {
        if (!result.success) {
          console.warn("[OmniMedia Publisher] Publish status forwarding was not successful", result);
        }
      })
      .catch((error) => {
        console.warn("[OmniMedia Publisher] Unexpected status forwarding failure", error);
      });

    return false;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  Promise.all([findTaskByTabId(tabId), clearTabReady(tabId)])
    .then(([task]) => {
      if (task?.id) {
        return removeTask(task.id);
      }
      return null;
    })
    .catch((error) => {
      console.warn("[OmniMedia Publisher] Failed to cleanup closed-tab task", error);
    });
});
