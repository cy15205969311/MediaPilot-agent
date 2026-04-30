import type { ArtifactPayload } from "./types";

type ArtifactMarkdownOptions = {
  taskLabel?: string;
  platformLabel?: string;
};

function sanitizeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
}

function joinSections(sections: string[]): string {
  return `${sections.filter(Boolean).join("\n\n").trim()}\n`;
}

function buildContentGenerationMarkdown(artifact: ArtifactPayload): string {
  if (artifact.artifact_type !== "content_draft") {
    return "";
  }

  const titleCandidates =
    artifact.title_candidates.length > 0
      ? artifact.title_candidates.map((title) => `- ${title}`).join("\n")
      : "- 暂无标题候选";

  const generatedImages = artifact.generated_images ?? [];
  const imageSection =
    generatedImages.length > 0
      ? joinSections([
          "## 配图",
          generatedImages
            .map((url, index) => `![AI 配图 ${index + 1}](${url})`)
            .join("\n\n"),
        ]).trim()
      : "";

  return joinSections([
    `# ${artifact.title}`,
    imageSection,
    "## 标题候选",
    titleCandidates,
    "## 正文",
    artifact.body,
    "## 平台引导语",
    artifact.platform_cta,
  ]);
}

function buildTopicPlanningMarkdown(artifact: ArtifactPayload): string {
  if (artifact.artifact_type !== "topic_list") {
    return "";
  }

  const topics = artifact.topics
    .map((topic, index) =>
      [
        `## 选题 ${index + 1}：${topic.title}`,
        `- 切入角度：${topic.angle}`,
        `- 预期目标：${topic.goal}`,
      ].join("\n"),
    )
    .join("\n\n");

  return joinSections([`# ${artifact.title}`, topics]);
}

function buildHotPostAnalysisMarkdown(artifact: ArtifactPayload): string {
  if (artifact.artifact_type !== "hot_post_analysis") {
    return "";
  }

  const analysisDimensions = artifact.analysis_dimensions
    .map((item) => [`## ${item.dimension}`, item.insight].join("\n\n"))
    .join("\n\n");

  const reusableTemplates =
    artifact.reusable_templates.length > 0
      ? artifact.reusable_templates.map((template) => `- ${template}`).join("\n")
      : "- 暂无可复用模板";

  return joinSections([
    `# ${artifact.title}`,
    "## 分析维度",
    analysisDimensions,
    "## 可复用表达模板",
    reusableTemplates,
  ]);
}

function buildCommentReplyMarkdown(artifact: ArtifactPayload): string {
  if (artifact.artifact_type !== "comment_reply") {
    return "";
  }

  const suggestions = artifact.suggestions
    .map((item, index) =>
      joinSections([
        `## 回复建议 ${index + 1}：${item.comment_type}`,
        `### 场景\n${item.scenario}`,
        `### 建议回复\n${item.reply}`,
        item.compliance_note ? `### 合规提醒\n${item.compliance_note}` : "",
      ]).trim(),
    )
    .join("\n\n");

  return joinSections([`# ${artifact.title}`, suggestions]);
}

export function buildArtifactMarkdown(
  artifact: ArtifactPayload,
  options: ArtifactMarkdownOptions = {},
): string {
  const metadataLines = [
    options.taskLabel ? `- 任务：${options.taskLabel}` : "",
    options.platformLabel ? `- 平台：${options.platformLabel}` : "",
  ].filter(Boolean);

  const metadataSection =
    metadataLines.length > 0
      ? joinSections(["## 导出信息", metadataLines.join("\n")]).trim()
      : "";

  const artifactSection =
    artifact.artifact_type === "content_draft"
      ? buildContentGenerationMarkdown(artifact)
      : artifact.artifact_type === "topic_list"
        ? buildTopicPlanningMarkdown(artifact)
        : artifact.artifact_type === "hot_post_analysis"
          ? buildHotPostAnalysisMarkdown(artifact)
          : buildCommentReplyMarkdown(artifact);

  return joinSections([metadataSection, artifactSection]);
}

export function downloadArtifactMarkdown(
  artifact: ArtifactPayload,
  markdownContent: string,
): string {
  const filenameBase = sanitizeFilename(artifact.title || "草稿") || "草稿";
  const filename = `${filenameBase}.md`;
  const blob = new Blob([markdownContent], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return filename;
}
