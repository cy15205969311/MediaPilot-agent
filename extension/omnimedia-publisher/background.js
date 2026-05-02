const PUBLISH_ACTION = "OMNIMEDIA_PUBLISH";
const TARGET_READY_ACTION = "OMNIMEDIA_TARGET_READY";
const FILL_ACTION = "OMNIMEDIA_FILL_XIAOHONGSHU";
const TASKS_STORAGE_KEY = "omnimedia_publish_tasks";
const XIAOHONGSHU_PUBLISH_URL = "https://creator.xiaohongshu.com/publish/publish";

async function getStoredTasks() {
  const result = await chrome.storage.local.get(TASKS_STORAGE_KEY);
  return result[TASKS_STORAGE_KEY] ?? {};
}

async function setStoredTasks(tasks) {
  await chrome.storage.local.set({
    [TASKS_STORAGE_KEY]: tasks,
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

async function findTaskByTabId(tabId) {
  const tasks = await getStoredTasks();

  for (const task of Object.values(tasks)) {
    if (task.tabId === tabId) {
      return task;
    }
  }

  return null;
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

async function dispatchTaskToTab(tabId) {
  const task = await findTaskByTabId(tabId);

  if (!task || task.status === "dispatching") {
    return false;
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

    if (!response?.ok) {
      throw new Error(response?.error ?? "Target tab rejected the publish task.");
    }

    await removeTask(task.id);

    return true;
  } catch (error) {
    await saveTask({
      ...task,
      status: "pending",
      lastError: error instanceof Error ? error.message : "Unknown dispatch error",
      retryCount: (task.retryCount ?? 0) + 1,
    });
    console.warn("[OmniMedia Publisher] Failed to dispatch task to target tab", error);
    return false;
  }
}

async function queuePublishTask(payload) {
  const normalizedPayload = normalizePayload(payload);

  if (!normalizedPayload.title && !normalizedPayload.content && normalizedPayload.imageUrls.length === 0) {
    throw new Error("Publish payload is empty.");
  }

  const tab = await chrome.tabs.create({
    url: XIAOHONGSHU_PUBLISH_URL,
    active: true,
  });

  const task = {
    id: crypto.randomUUID(),
    tabId: tab.id,
    payload: normalizedPayload,
    status: "pending",
    createdAt: Date.now(),
  };

  await saveTask(task);

  return {
    taskId: task.id,
    tabId: tab.id,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === PUBLISH_ACTION) {
    queuePublishTask(message.payload)
      .then((result) => {
        sendResponse({
          ok: true,
          ...result,
        });
      })
      .catch((error) => {
        console.error("[OmniMedia Publisher] Failed to create publish task", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Failed to create publish task",
        });
      });

    return true;
  }

  if (message?.action === TARGET_READY_ACTION && sender.tab?.id) {
    void dispatchTaskToTab(sender.tab.id);
    return false;
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") {
    return;
  }

  void dispatchTaskToTab(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  findTaskByTabId(tabId)
    .then((task) => {
      if (task?.id) {
        return removeTask(task.id);
      }
      return null;
    })
    .catch((error) => {
      console.warn("[OmniMedia Publisher] Failed to cleanup closed-tab task", error);
    });
});
