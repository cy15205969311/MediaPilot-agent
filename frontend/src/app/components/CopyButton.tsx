import { useEffect, useRef, useState } from "react";

import { Check, Copy } from "lucide-react";

type CopyButtonProps = {
  text: string;
  ariaLabel?: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2">$1</a>',
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+)_/g, "<em>$1</em>");
}

function buildClipboardHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return "<p></p>";
  }

  const blocks: string[] = [];
  const paragraphLines: string[] = [];
  let activeListType: "ul" | "ol" | null = null;
  let activeListItems: string[] = [];
  let blockquoteLines: string[] = [];
  let codeFenceLines: string[] = [];
  let inCodeFence = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }
    blocks.push(
      `<p>${paragraphLines.map((line) => renderInlineMarkdown(line)).join("<br />")}</p>`,
    );
    paragraphLines.length = 0;
  };

  const flushList = () => {
    if (!activeListType || activeListItems.length === 0) {
      activeListType = null;
      activeListItems = [];
      return;
    }
    blocks.push(
      `<${activeListType}>${activeListItems
        .map((item) => `<li>${renderInlineMarkdown(item)}</li>`)
        .join("")}</${activeListType}>`,
    );
    activeListType = null;
    activeListItems = [];
  };

  const flushBlockquote = () => {
    if (blockquoteLines.length === 0) {
      return;
    }
    blocks.push(
      `<blockquote><p>${blockquoteLines
        .map((line) => renderInlineMarkdown(line))
        .join("<br />")}</p></blockquote>`,
    );
    blockquoteLines = [];
  };

  const flushCodeFence = () => {
    if (codeFenceLines.length === 0) {
      return;
    }
    blocks.push(
      `<pre><code>${escapeHtml(codeFenceLines.join("\n"))}</code></pre>`,
    );
    codeFenceLines = [];
  };

  for (const rawLine of normalized.split("\n")) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      flushBlockquote();
      if (inCodeFence) {
        flushCodeFence();
        inCodeFence = false;
      } else {
        inCodeFence = true;
      }
      continue;
    }

    if (inCodeFence) {
      codeFenceLines.push(rawLine);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushBlockquote();
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushBlockquote();
      const level = headingMatch[1].length;
      blocks.push(
        `<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`,
      );
      continue;
    }

    const unorderedListMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (unorderedListMatch) {
      flushParagraph();
      flushBlockquote();
      if (activeListType !== "ul") {
        flushList();
        activeListType = "ul";
      }
      activeListItems.push(unorderedListMatch[1]);
      continue;
    }

    const orderedListMatch = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (orderedListMatch) {
      flushParagraph();
      flushBlockquote();
      if (activeListType !== "ol") {
        flushList();
        activeListType = "ol";
      }
      activeListItems.push(orderedListMatch[1]);
      continue;
    }

    const blockquoteMatch = /^>\s?(.*)$/.exec(trimmed);
    if (blockquoteMatch) {
      flushParagraph();
      flushList();
      blockquoteLines.push(blockquoteMatch[1]);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraphLines.push(trimmed);
  }

  if (inCodeFence) {
    flushCodeFence();
  }
  flushParagraph();
  flushList();
  flushBlockquote();

  return `<div>${blocks.join("")}</div>`;
}

function fallbackCopyText(text: string) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.select();
  textArea.setSelectionRange(0, text.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);

  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}

async function writeClipboardContent(text: string) {
  const html = buildClipboardHtml(text);

  if (
    navigator.clipboard?.write &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      const clipboardItem = new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      });
      await navigator.clipboard.write([clipboardItem]);
      return;
    } catch {
      // Fall back to plain text below for browsers that expose the API surface
      // but still reject rich clipboard writes in the current context.
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  fallbackCopyText(text);
}

export function CopyButton({
  text,
  ariaLabel = "复制内容",
}: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await writeClipboardContent(text);

      setIsCopied(true);
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    } catch {
      setIsCopied(false);
    }
  };

  return (
    <button
      aria-label={ariaLabel}
      className={`rounded-lg p-2 transition ${
        isCopied
          ? "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
      onClick={() => void handleCopy()}
      type="button"
    >
      {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}
