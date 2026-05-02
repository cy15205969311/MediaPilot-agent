(function bridgePublisher() {
  const PUBLISH_ACTION = "OMNIMEDIA_PUBLISH";

  function postStatus(status, detail) {
    window.postMessage(
      {
        action: "OMNIMEDIA_PUBLISH_STATUS",
        payload: {
          status,
          detail,
        },
      },
      window.location.origin,
    );
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }

    if (event.origin !== window.location.origin) {
      return;
    }

    if (!event.data || event.data.action !== PUBLISH_ACTION) {
      return;
    }

    const payload = event.data.payload ?? {};

    chrome.runtime.sendMessage(
      {
        action: PUBLISH_ACTION,
        payload,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[OmniMedia Publisher] Background message failed", chrome.runtime.lastError);
          postStatus("error", chrome.runtime.lastError.message);
          return;
        }

        if (!response?.ok) {
          postStatus("error", response?.error ?? "Failed to queue publish task");
          return;
        }

        postStatus("queued", response);
      },
    );
  });
})();
