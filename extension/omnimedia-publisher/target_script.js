(function targetPublisher() {
  const FILL_ACTION = "OMNIMEDIA_FILL_XIAOHONGSHU";
  const TARGET_SCRIPT_READY_TYPE = "TARGET_SCRIPT_READY";
  const COPY_PANEL_ID = "omnimedia-publisher-copy-panel";

  let activeTaskId = null;
  let hasRequestedPendingTask = false;

  function log(step, detail) {
    if (detail === undefined) {
      console.log(`[OmniMedia Publisher] ${step}`);
      return;
    }
    console.log(`[OmniMedia Publisher] ${step}`, detail);
  }

  function cleanLLMText(text) {
    if (typeof text !== "string") {
      return "";
    }

    return text
      .replace(/\\n/g, "\n")
      .replace(/^#+\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/\\\[/g, "[")
      .replace(/\\\]/g, "]")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function normalizeCopyPanelPayload(payload) {
    return {
      title: cleanLLMText(payload?.title),
      content: cleanLLMText(payload?.content),
      imageUrls: Array.isArray(payload?.imageUrls)
        ? payload.imageUrls.filter((item) => typeof item === "string" && item.trim())
        : [],
    };
  }

  async function copyTextToClipboard(text) {
    if (!text) {
      return false;
    }

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (error) {
        console.warn("[OmniMedia Publisher] Clipboard API copy failed, fallback to execCommand", error);
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }

  function setButtonFeedback(button, text) {
    const originalText = button.textContent;
    button.textContent = text;
    window.setTimeout(() => {
      button.textContent = originalText;
    }, 1200);
  }

  function createCopyButton(label, text) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.width = "100%";
    button.style.border = "0";
    button.style.borderRadius = "6px";
    button.style.padding = "10px 12px";
    button.style.background = "#111827";
    button.style.color = "#ffffff";
    button.style.fontSize = "14px";
    button.style.fontWeight = "600";
    button.style.cursor = text ? "pointer" : "not-allowed";
    button.style.opacity = text ? "1" : "0.45";
    button.disabled = !text;

    button.addEventListener("click", () => {
      void copyTextToClipboard(text).then((copied) => {
        setButtonFeedback(button, copied ? "已复制" : "复制失败");
      });
    });

    return button;
  }

  function createPanelSection(label, value, buttonText) {
    const section = document.createElement("section");
    section.style.display = "grid";
    section.style.gap = "8px";

    const heading = document.createElement("div");
    heading.textContent = label;
    heading.style.fontSize = "13px";
    heading.style.fontWeight = "700";
    heading.style.color = "#111827";

    const preview = document.createElement("div");
    preview.textContent = value || "暂无内容";
    preview.style.maxHeight = label === "正文" ? "180px" : "92px";
    preview.style.overflow = "auto";
    preview.style.whiteSpace = "pre-wrap";
    preview.style.wordBreak = "break-all";
    preview.style.border = "1px solid #e5e7eb";
    preview.style.borderRadius = "6px";
    preview.style.padding = "10px";
    preview.style.background = "#f9fafb";
    preview.style.color = value ? "#1f2937" : "#9ca3af";
    preview.style.fontSize = "13px";
    preview.style.lineHeight = "1.5";

    section.append(heading, preview, createCopyButton(buttonText, value));
    return section;
  }

  function renderCopyPanel(payload) {
    const normalizedPayload = normalizeCopyPanelPayload(payload);
    const existingPanel = document.getElementById(COPY_PANEL_ID);
    if (existingPanel) {
      existingPanel.remove();
    }

    const panel = document.createElement("aside");
    panel.id = COPY_PANEL_ID;
    panel.style.position = "fixed";
    panel.style.top = "88px";
    panel.style.right = "24px";
    panel.style.zIndex = "2147483647";
    panel.style.width = "340px";
    panel.style.maxWidth = "calc(100vw - 32px)";
    panel.style.maxHeight = "calc(100vh - 120px)";
    panel.style.overflow = "auto";
    panel.style.display = "grid";
    panel.style.gap = "14px";
    panel.style.padding = "16px";
    panel.style.border = "1px solid #d1d5db";
    panel.style.borderRadius = "8px";
    panel.style.background = "#ffffff";
    panel.style.boxShadow = "0 18px 45px rgba(15, 23, 42, 0.18)";
    panel.style.fontFamily =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.gap = "10px";

    const title = document.createElement("div");
    title.textContent = "OmniMedia 发布辅助";
    title.style.fontSize = "15px";
    title.style.fontWeight = "800";
    title.style.color = "#111827";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "关闭";
    closeButton.style.border = "1px solid #d1d5db";
    closeButton.style.borderRadius = "6px";
    closeButton.style.padding = "6px 8px";
    closeButton.style.background = "#ffffff";
    closeButton.style.color = "#374151";
    closeButton.style.cursor = "pointer";
    closeButton.addEventListener("click", () => {
      panel.remove();
    });

    header.append(title, closeButton);

    const status = document.createElement("div");
    status.textContent = "请在小红书页面手动切换到上传图文后粘贴内容。";
    status.style.fontSize = "12px";
    status.style.lineHeight = "1.5";
    status.style.color = "#6b7280";

    const imageText = normalizedPayload.imageUrls.join("\n");
    panel.append(
      header,
      status,
      createPanelSection("标题", normalizedPayload.title, "复制标题"),
      createPanelSection("正文", normalizedPayload.content, "复制正文"),
    );

    if (normalizedPayload.imageUrls.length > 0) {
      panel.append(createPanelSection("图片链接", imageText, "复制图片链接"));
    }

    document.body.appendChild(panel);
    log("半自动复制面板已打开", {
      titleLength: normalizedPayload.title.length,
      contentLength: normalizedPayload.content.length,
      imageCount: normalizedPayload.imageUrls.length,
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action !== FILL_ACTION) {
      return false;
    }

    activeTaskId = typeof message.taskId === "string" ? message.taskId : null;
    sendResponse({
      status: "received",
      message: "Task started",
      taskId: activeTaskId,
    });

    log("收到发布任务", {
      taskId: activeTaskId,
      imageCount: Array.isArray(message.payload?.imageUrls)
        ? message.payload.imageUrls.length
        : 0,
    });

    try {
      renderCopyPanel(message.payload ?? {});
    } catch (error) {
      console.error("[OmniMedia Publisher] Failed to render copy panel", error);
    } finally {
      activeTaskId = null;
    }

    return false;
  });

  function requestPendingTask() {
    if (hasRequestedPendingTask) {
      return;
    }

    hasRequestedPendingTask = true;
    console.log("[OmniMedia Publisher] Content script injected, requesting task...");

    try {
      chrome.runtime.sendMessage(
        {
          type: TARGET_SCRIPT_READY_TYPE,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn(
              "[OmniMedia Publisher] Failed to request pending task",
              chrome.runtime.lastError,
            );
            return;
          }

          console.log("[OmniMedia Publisher] Ready signal sent", response ?? {});
        },
      );
    } catch (error) {
      console.warn("[OmniMedia Publisher] Ready handshake failed", error);
    }
  }

  requestPendingTask();
})();
