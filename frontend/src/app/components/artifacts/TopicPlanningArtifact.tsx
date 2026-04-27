import { Goal, Lightbulb } from "lucide-react";

import type { TopicPlanningArtifactPayload } from "../../types";
import { ArtifactSection } from "../ArtifactSection";
import { CopyButton } from "../CopyButton";

type TopicPlanningArtifactProps = {
  artifact: TopicPlanningArtifactPayload | null;
};

export function TopicPlanningArtifact({ artifact }: TopicPlanningArtifactProps) {
  if (!artifact) {
    return (
      <ArtifactSection title="选题策划结果">
        <div className="rounded-2xl bg-muted p-4 text-sm leading-6 text-muted-foreground">
          任务提交后，这里会展示后端返回的结构化选题列表、切入角度和预期目标。
        </div>
      </ArtifactSection>
    );
  }

  return (
    <div className="space-y-4">
      <ArtifactSection title={artifact.title}>
        <div className="space-y-3">
          {artifact.topics.map((topic) => (
            <div key={topic.title} className="rounded-2xl border border-border bg-muted p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="text-sm font-semibold leading-6 text-foreground">
                  {topic.title}
                </div>
                <CopyButton text={topic.title} />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-card p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                    <Lightbulb className="h-3.5 w-3.5" />
                    切入角度
                  </div>
                  <div className="text-sm leading-6 text-muted-foreground">{topic.angle}</div>
                </div>
                <div className="rounded-2xl bg-card p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-secondary-foreground">
                    <Goal className="h-3.5 w-3.5" />
                    预期目标
                  </div>
                  <div className="text-sm leading-6 text-muted-foreground">{topic.goal}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </ArtifactSection>
    </div>
  );
}
