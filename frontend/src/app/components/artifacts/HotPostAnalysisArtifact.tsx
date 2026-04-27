import { BadgeAlert, LineChart } from "lucide-react";

import type { HotPostAnalysisArtifactPayload } from "../../types";
import { ArtifactSection } from "../ArtifactSection";
import { CopyButton } from "../CopyButton";

type HotPostAnalysisArtifactProps = {
  artifact: HotPostAnalysisArtifactPayload | null;
};

export function HotPostAnalysisArtifact({
  artifact,
}: HotPostAnalysisArtifactProps) {
  if (!artifact) {
    return (
      <ArtifactSection title="爆款分析结果">
        <div className="rounded-2xl bg-muted p-4 text-sm leading-6 text-muted-foreground">
          流式生成完成后，这里会展示后端返回的结构化拆解维度和可复用表达模板。
        </div>
      </ArtifactSection>
    );
  }

  return (
    <div className="space-y-4">
      <ArtifactSection
        action={<LineChart className="h-4 w-4 text-brand" />}
        title={artifact.title}
      >
        <div className="space-y-3">
          {artifact.analysis_dimensions.map((item) => (
            <div
              key={item.dimension}
              className="rounded-2xl border border-border bg-muted p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                <BadgeAlert className="h-3.5 w-3.5" />
                {item.dimension}
              </div>
              <div className="text-sm leading-6 text-card-foreground">{item.insight}</div>
            </div>
          ))}
        </div>
      </ArtifactSection>

      <ArtifactSection title="可复用表达模板">
        <div className="space-y-3">
          {artifact.reusable_templates.map((template) => (
            <div
              key={template}
              className="rounded-2xl border border-border bg-muted p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm leading-6 text-card-foreground">{template}</div>
                <CopyButton text={template} />
              </div>
            </div>
          ))}
        </div>
      </ArtifactSection>
    </div>
  );
}
