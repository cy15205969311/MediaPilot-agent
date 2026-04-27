import { MessageCircleMore, ShieldCheck } from "lucide-react";

import type { CommentReplyArtifactPayload } from "../../types";
import { ArtifactSection } from "../ArtifactSection";
import { CopyButton } from "../CopyButton";

type CommentReplyArtifactProps = {
  artifact: CommentReplyArtifactPayload | null;
};

export function CommentReplyArtifact({ artifact }: CommentReplyArtifactProps) {
  if (!artifact) {
    return (
      <ArtifactSection title="评论回复建议">
        <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          流式生成完成后，这里会展示按评论类型分类的标准化回复话术。
        </div>
      </ArtifactSection>
    );
  }

  return (
    <ArtifactSection
      action={<MessageCircleMore className="h-4 w-4 text-rose-400" />}
      title={artifact.title}
    >
      <div className="space-y-3">
        {artifact.suggestions.map((item) => (
          <div
            key={`${item.comment_type}-${item.scenario}`}
            className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">
                {item.comment_type}
              </div>
              <CopyButton text={item.reply} />
            </div>

            <div className="mb-2 text-sm font-medium leading-6 text-slate-800">
              {item.scenario}
            </div>
            <div className="text-sm leading-6 text-slate-700">{item.reply}</div>

            {item.compliance_note ? (
              <div className="mt-3 rounded-xl border border-emerald-100 bg-white px-3 py-2 text-xs leading-5 text-slate-600">
                <div className="mb-1 flex items-center gap-2 font-semibold text-emerald-700">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  合规提醒
                </div>
                {item.compliance_note}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </ArtifactSection>
  );
}
