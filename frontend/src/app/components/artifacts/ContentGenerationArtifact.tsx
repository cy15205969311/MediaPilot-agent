import { MessageSquareQuote, WandSparkles } from "lucide-react";

import type { ContentGenerationArtifactPayload, UiPlatform } from "../../types";
import { ArtifactSection } from "../ArtifactSection";
import { CopyButton } from "../CopyButton";

type ContentGenerationArtifactProps = {
  artifact: ContentGenerationArtifactPayload | null;
  platform: UiPlatform;
};

function getPlatformHint(platform: UiPlatform) {
  if (platform === "douyin") {
    return "当前结果会优先保留节奏感更强的表达，可继续追加“改写成抖音口播版”。";
  }
  if (platform === "both") {
    return "当前结果先展示主版本草稿，后续可以继续拆成双平台适配稿。";
  }
  return "当前结果更偏小红书图文结构，适合继续补充封面文案和标签。";
}

export function ContentGenerationArtifact({
  artifact,
  platform,
}: ContentGenerationArtifactProps) {
  if (!artifact) {
    return (
      <ArtifactSection title="内容生成结果">
        <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          流式生成完成后，这里会根据后端返回的 `content_draft` Artifact 自动展示标题候选、正文草稿和平台引导语。
        </div>
      </ArtifactSection>
    );
  }

  return (
    <div className="space-y-4">
      <ArtifactSection
        action={<WandSparkles className="h-4 w-4 text-rose-400" />}
        title={artifact.title}
      >
        <div className="space-y-3">
          {artifact.title_candidates.map((title) => (
            <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-medium leading-6 text-slate-800">{title}</div>
                <CopyButton text={title} />
              </div>
            </div>
          ))}
        </div>
      </ArtifactSection>

      <ArtifactSection title="正文草稿">
        <div className="whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-sm leading-7 text-slate-700">
          {artifact.body}
        </div>
      </ArtifactSection>

      <ArtifactSection title="平台引导语">
        <div className="space-y-3">
          <div className="rounded-2xl bg-rose-50 p-4 text-sm leading-7 text-slate-800">
            {artifact.platform_cta}
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
            <div className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
              <MessageSquareQuote className="h-4 w-4 text-slate-500" />
              当前平台提示
            </div>
            {getPlatformHint(platform)}
          </div>
        </div>
      </ArtifactSection>
    </div>
  );
}
