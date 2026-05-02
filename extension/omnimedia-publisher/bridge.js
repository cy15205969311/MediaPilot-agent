(function bridgePublisher() {
  const PUBLISH_ACTION = "OMNIMEDIA_PUBLISH";
  const PUBLISH_TASK_TYPE = "@@OMNIMEDIA/PUBLISH_TASK";
  const PUBLISH_STATUS_TYPE = "OMNIMEDIA_PUBLISH_STATUS";
  const PUBLISH_RESULT_ACTION = "PUBLISH_RESULT";
  const BRIDGE_SOURCE = "omnimedia-publisher";

  const EXTENSION_INVALIDATED_ERROR = "EXTENSION_CONTEXT_INVALIDATED";
  const EXTENSION_INVALIDATED_MESSAGE = "插件上下文已失效，请刷新当前网页。";
  const BRIDGE_UNAVAILABLE_MESSAGE = "发布插件不可用，请确认扩展已正确加载。";
  const MESSAGE_PORT_CLOSED_HINT = "通信通道已提前关闭，请刷新当前网页后重试。";

  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  function hasRuntimeSendMessage() {
    return (
      typeof chrome !== "undefined" &&
      isRecord(chrome.runtime) &&
      typeof chrome.runtime.sendMessage === "function"
    );
  }

  function hasRuntimeMessageListener() {
    return (
      typeof chrome !== "undefined" &&
      isRecord(chrome.runtime) &&
      isRecord(chrome.runtime.onMessage) &&
      typeof chrome.runtime.onMessage.addListener === "function"
    );
  }

  function safePostPublishResult(payload) {
    if (typeof window === "undefined" || typeof window.postMessage !== "function") {
      return;
    }

    try {
      window.postMessage(
        {
          source: BRIDGE_SOURCE,
          action: PUBLISH_RESULT_ACTION,
          payload,
        },
        window.location.origin,
      );
    } catch (error) {
      console.warn("[OmniMedia Bridge] Failed to post message back to workspace", error);
    }
  }

  function isExtensionInvalidatedMessage(message) {
    return typeof message === "string" && message.includes("Extension context invalidated");
  }

  function postExtensionInvalidatedResult(detailMessage) {
    console.warn("[OmniMedia Bridge] 插件上下文已失效，请刷新当前网页。");
    safePostPublishResult({
      status: "error",
      error: EXTENSION_INVALIDATED_ERROR,
      message: detailMessage || EXTENSION_INVALIDATED_MESSAGE,
    });
  }

  function postRuntimeFailure(errorCode, message) {
    safePostPublishResult({
      status: "error",
      error: errorCode,
      message,
    });
  }

  function handleRuntimeErrorMessage(runtimeErrorMessage) {
    if (isExtensionInvalidatedMessage(runtimeErrorMessage)) {
      postExtensionInvalidatedResult(EXTENSION_INVALIDATED_MESSAGE);
      return;
    }

    postRuntimeFailure("BRIDGE_DISCONNECTED", runtimeErrorMessage || MESSAGE_PORT_CLOSED_HINT);
  }

  function safeRuntimeSendMessage(message, onSuccess) {
    if (!hasRuntimeSendMessage()) {
      postRuntimeFailure("BRIDGE_UNAVAILABLE", BRIDGE_UNAVAILABLE_MESSAGE);
      return;
    }

    try {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeErrorMessage =
          typeof chrome !== "undefined" && chrome.runtime?.lastError?.message
            ? chrome.runtime.lastError.message
            : "";

        if (runtimeErrorMessage) {
          handleRuntimeErrorMessage(runtimeErrorMessage);
          return;
        }

        try {
          onSuccess(response);
        } catch (error) {
          console.warn("[OmniMedia Bridge] Failed to handle extension response", error);
          postRuntimeFailure("BRIDGE_CALLBACK_ERROR", "插件响应处理失败，请刷新页面后重试。");
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (isExtensionInvalidatedMessage(errorMessage)) {
        postExtensionInvalidatedResult(EXTENSION_INVALIDATED_MESSAGE);
        return;
      }

      console.warn("[OmniMedia Bridge] Failed to talk to extension runtime", error);
      postRuntimeFailure("BRIDGE_DISCONNECTED", errorMessage || MESSAGE_PORT_CLOSED_HINT);
    }
  }

  function handleWorkspacePublishTask(event) {
    if (event.source !== window) {
      return;
    }

    if (event.origin !== window.location.origin) {
      return;
    }

    if (!isRecord(event.data) || event.data.type !== PUBLISH_TASK_TYPE) {
      return;
    }

    const payload = isRecord(event.data.payload) ? event.data.payload : {};

    safeRuntimeSendMessage(
      {
        action: PUBLISH_ACTION,
        payload,
      },
      (response) => {
        if (!response?.success) {
          safePostPublishResult({
            status: "error",
            error: response?.errorCode ?? "QUEUE_FAILED",
            message: response?.message ?? "发布任务入队失败，请稍后重试。",
          });
          return;
        }

        safePostPublishResult({
          status: "queued",
          message:
            response?.message ?? "已打开小红书发布页，发布辅助面板会自动弹出，请手动复制粘贴。",
          detail: response,
        });
      },
    );
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("message", (event) => {
      try {
        handleWorkspacePublishTask(event);
      } catch (error) {
        console.warn("[OmniMedia Bridge] Failed to process workspace message", error);
        postRuntimeFailure("BRIDGE_MESSAGE_HANDLER_ERROR", "发布请求处理失败，请刷新页面后重试。");
      }
    });
  }

  if (hasRuntimeMessageListener()) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      try {
        if (!isRecord(message) || message.type !== PUBLISH_STATUS_TYPE) {
          return false;
        }

        safePostPublishResult({
          status: typeof message.status === "string" ? message.status : "error",
          message:
            typeof message.message === "string" && message.message.trim()
              ? message.message
              : "发布插件返回了未知状态。",
          error: typeof message.error === "string" ? message.error : undefined,
          taskId: typeof message.taskId === "string" ? message.taskId : undefined,
        });

        sendResponse({
          success: true,
          message: "工作台已接收发布状态。",
        });
      } catch (error) {
        console.warn("[OmniMedia Bridge] Failed to handle runtime message", error);

        try {
          sendResponse({
            success: false,
            message: "发布状态处理失败，请刷新当前网页后重试。",
          });
        } catch (_responseError) {
          // 吞掉 sendResponse 二次异常，避免污染宿主页面。
        }
      }

      return false;
    });
  }
})();
