const REFERENCE_SECTION_HEADER_PATTERN =
  /^\s{0,3}(?:#{1,6}\s*)?(参考资料|参考来源|引用来源|references)\s*[:：]?\s*.*$/i;

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function shouldKeepWordSpacing(previousChar: string, nextChar: string): boolean {
  if (!previousChar || !nextChar) {
    return false;
  }

  return /[A-Za-z0-9]/.test(previousChar) && /[A-Za-z0-9]/.test(nextChar);
}

function stripReferenceTail(text: string): string {
  const lines = text.split("\n");
  let cutoffIndex = -1;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (REFERENCE_SECTION_HEADER_PATTERN.test(lines[index])) {
      cutoffIndex = index;
      break;
    }
  }

  if (cutoffIndex === -1) {
    return text;
  }

  return lines.slice(0, cutoffIndex).join("\n");
}

function stripInlineCitations(text: string): string {
  return text.replace(/\s*\[\d+\]\s*/g, (match, offset, fullText) => {
    const previousChar = offset > 0 ? fullText[offset - 1] : "";
    const nextIndex = offset + match.length;
    const nextChar = nextIndex < fullText.length ? fullText[nextIndex] : "";

    return shouldKeepWordSpacing(previousChar, nextChar) ? " " : "";
  });
}

export function cleanForPublishing(text: string): string {
  if (!text) {
    return "";
  }

  const normalized = normalizeLineEndings(text);
  const withoutReferenceTail = stripReferenceTail(normalized);
  const withoutInlineCitations = stripInlineCitations(withoutReferenceTail);

  return withoutInlineCitations
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
