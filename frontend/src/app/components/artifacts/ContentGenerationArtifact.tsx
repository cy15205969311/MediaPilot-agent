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
    return "当前结果会优先保留更强的节奏感与口播感，适合继续追加“改写成抖音口播版”等指令。";
  }
  if (platform === "both") {
    return "当前结果先展示主版本草稿，后续可以继续拆成双平台适配稿。";
  }
  return "当前结果更偏小红书图文结构，适合继续补充封面文案、标签和互动引导。";
}

export function ContentGenerationArtifact({
  artifact,
  platform,
}: ContentGenerationArtifactProps) {
  if (!artifact) {
    return (
      <ArtifactSection title="内容生成结果">
        <div className="rounded-2xl bg-muted p-4 text-sm leading-6 text-muted-foreground">
          流式生成完成后，这里会根据后端返回的 `content_draft` artifact
          自动展示标题候选、正文草稿和平台引导语。
        </div>
      </ArtifactSection>
    );
  }

  return (
    <div className="space-y-4">
      <ArtifactSection
        action={
          <div className="flex items-center gap-2">
            <WandSparkles className="h-4 w-4 text-brand" />
            <CopyButton
              ariaLabel="复制全部标题候选"
              text={artifact.title_candidates.join("\n")}
            />
          </div>
        }
        title={artifact.title}
      >
        <div className="space-y-3">
          {artifact.title_candidates.map((title) => (
            <div key={title} className="rounded-2xl border border-border bg-muted p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-medium leading-6 text-foreground">{title}</div>
                <CopyButton ariaLabel="复制标题候选" text={title} />
              </div>
            </div>
          ))}
        </div>
      </ArtifactSection>

      <ArtifactSection
        action={<CopyButton ariaLabel="复制正文草稿" text={artifact.body} />}
        title="正文草稿"
      >
        <div className="whitespace-pre-wrap rounded-2xl bg-muted p-4 text-sm leading-7 text-card-foreground">
          {artifact.body}
        </div>
      </ArtifactSection>

      <ArtifactSection
        action={<CopyButton ariaLabel="复制平台引导语" text={artifact.platform_cta} />}
        title="平台引导语"
      >
        <div className="space-y-3">
          <div className="rounded-2xl bg-brand-soft p-4 text-sm leading-7 text-brand-soft-foreground">
            {artifact.platform_cta}
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <MessageSquareQuote className="h-4 w-4 text-muted-foreground" />
              当前平台提示
            </div>
            {getPlatformHint(platform)}
          </div>
        </div>
      </ArtifactSection>
    </div>
  );
}
