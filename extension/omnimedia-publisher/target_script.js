(function targetPublisher() {
  const FILL_ACTION = "OMNIMEDIA_FILL_XIAOHONGSHU";
  const TARGET_READY_ACTION = "OMNIMEDIA_TARGET_READY";

  const TITLE_SELECTORS = [
    'input[placeholder*="\u6807\u9898"]',
    'textarea[placeholder*="\u6807\u9898"]',
    '.c-input_inner input',
    '.c-input_inner textarea',
    '[class*="title"] input',
    '[class*="title"] textarea',
  ];

  const CONTENT_SELECTORS = [
    '[contenteditable="true"][data-placeholder*="\u6b63\u6587"]',
    '[contenteditable="true"][placeholder*="\u6b63\u6587"]',
    '.ql-editor',
    '#editor [contenteditable="true"]',
    '[class*="editor"] [contenteditable="true"]',
    '[class*="post-content"] [contenteditable="true"]',
    '[role="textbox"][contenteditable="true"]',
  ];

  const IMAGE_INPUT_SELECTORS = [
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
  ];

  const IMAGE_DROPZONE_SELECTORS = [
    '[class*="upload-drag"]',
    '[class*="upload"]',
    '[class*="drag"]',
    '[data-testid*="upload"]',
  ];

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function queryFirst(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }

    return null;
  }

  function queryFirstVisible(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && isVisible(element)) {
        return element;
      }
    }

    return null;
  }

  async function waitForElement(selectors, timeoutMs = 20000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      const element = queryFirstVisible(selectors);
      if (element) {
        return element;
      }
      await sleep(300);
    }

    throw new Error(`Target element not found: ${selectors.join(", ")}`);
  }

  function dispatchTextEvents(element) {
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        cancelable: true,
      }),
    );
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  function setNativeInputValue(element, value) {
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor?.set) {
      descriptor.set.call(element, value);
      return;
    }

    element.value = value;
  }

  async function fillTitle(title) {
    if (!title) {
      return;
    }

    const titleElement = await waitForElement(TITLE_SELECTORS);

    if (titleElement instanceof HTMLInputElement || titleElement instanceof HTMLTextAreaElement) {
      titleElement.focus();
      setNativeInputValue(titleElement, title);
      dispatchTextEvents(titleElement);
      return;
    }

    if (titleElement instanceof HTMLElement) {
      titleElement.focus();
      titleElement.innerText = title;
      dispatchTextEvents(titleElement);
    }
  }

  function replaceContentEditableText(element, content) {
    element.focus();

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.addRange(range);
    }

    if (document.execCommand) {
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, content);
    } else {
      element.innerText = content;
    }

    if (element.innerText !== content) {
      element.innerText = content;
    }
  }

  async function fillContent(content) {
    if (!content) {
      return;
    }

    const editorElement = await waitForElement(CONTENT_SELECTORS);

    if (editorElement instanceof HTMLInputElement || editorElement instanceof HTMLTextAreaElement) {
      editorElement.focus();
      setNativeInputValue(editorElement, content);
      dispatchTextEvents(editorElement);
      return;
    }

    if (editorElement instanceof HTMLElement) {
      replaceContentEditableText(editorElement, content);
      dispatchTextEvents(editorElement);
    }
  }

  function inferFileExtension(url, mimeType) {
    const mimeMap = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    };

    if (mimeType && mimeMap[mimeType]) {
      return mimeMap[mimeType];
    }

    const matched = url.match(/\.([a-zA-Z0-9]+)(?:$|\?)/);
    return matched?.[1]?.toLowerCase() ?? "png";
  }

  async function fetchImageAsFile(url, index) {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
    });

    if (!response.ok) {
      throw new Error(`Image download failed: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const extension = inferFileExtension(url, blob.type);

    return new File([blob], `omnimedia-image-${index + 1}.${extension}`, {
      type: blob.type || "image/png",
      lastModified: Date.now(),
    });
  }

  function buildDataTransfer(files) {
    const dataTransfer = new DataTransfer();

    files.forEach((file) => {
      dataTransfer.items.add(file);
    });

    return dataTransfer;
  }

  function assignFilesToInput(input, dataTransfer) {
    try {
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch (error) {
      console.warn("[OmniMedia Publisher] File input upload failed, fallback to drag-and-drop", error);
      return false;
    }
  }

  function dispatchDropToZone(dropZone, dataTransfer) {
    ["dragenter", "dragover", "drop"].forEach((eventName) => {
      const event = new DragEvent(eventName, {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "dataTransfer", {
        value: dataTransfer,
      });
      dropZone.dispatchEvent(event);
    });
  }

  async function uploadImages(imageUrls) {
    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return;
    }

    const files = [];
    for (let index = 0; index < imageUrls.length; index += 1) {
      files.push(await fetchImageAsFile(imageUrls[index], index));
    }

    const dataTransfer = buildDataTransfer(files);
    const fileInput = queryFirst(IMAGE_INPUT_SELECTORS);

    if (fileInput instanceof HTMLInputElement && assignFilesToInput(fileInput, dataTransfer)) {
      return;
    }

    const dropZone = await waitForElement(IMAGE_DROPZONE_SELECTORS);
    dispatchDropToZone(dropZone, dataTransfer);
  }

  async function fillPublishForm(payload) {
    await fillTitle(payload.title ?? "");
    await sleep(200);
    await fillContent(payload.content ?? "");
    await sleep(200);
    await uploadImages(payload.imageUrls ?? []);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.action !== FILL_ACTION) {
      return false;
    }

    fillPublishForm(message.payload ?? {})
      .then(() => {
        sendResponse({
          ok: true,
        });
      })
      .catch((error) => {
        console.error("[OmniMedia Publisher] Failed to fill Xiaohongshu publish form", error);

        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Fill failed",
        });
      });

    return true;
  });

  function notifyReady() {
    chrome.runtime.sendMessage({
      action: TARGET_READY_ACTION,
    });
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    notifyReady();
  } else {
    window.addEventListener("DOMContentLoaded", notifyReady, { once: true });
  }
})();
