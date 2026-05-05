import { useMemo, useState } from "react";

import {
  ExternalLink,
  Image as ImageIcon,
  Sparkles,
  WandSparkles,
} from "lucide-react";

import type { ImageGenerationArtifactPayload } from "../../types";
import { ArtifactSection } from "../ArtifactSection";
import { CopyButton } from "../CopyButton";
import { ImagePreviewModal } from "../ImagePreviewModal";

type ImageGenerationArtifactProps = {
  artifact: ImageGenerationArtifactPayload | null;
};

function normalizePromptValue(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function normalizeProgressPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function ImageGenerationArtifact({
  artifact,
}: ImageGenerationArtifactProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const generatedImages = useMemo(
    () => artifact?.generated_images?.filter((url) => url.trim()) ?? [],
    [artifact],
  );
  const originalPrompt = normalizePromptValue(artifact?.original_prompt);
  const revisedPrompt = normalizePromptValue(artifact?.revised_prompt);
  const promptText = normalizePromptValue(artifact?.prompt);
  const progressMessage =
    normalizePromptValue(artifact?.progress_message) || "云端 GPU 正在分配算力，马上开始渲染首版画面。";
  const progressPercent = normalizeProgressPercent(artifact?.progress_percent);
  const isProcessing = artifact?.status === "processing";
  const shouldRenderProcessingSkeleton = isProcessing && generatedImages.length === 0;

  if (!artifact) {
    return (
      <ArtifactSection title="图片生成结果">
        <div className="rounded-2xl bg-muted p-4 text-sm leading-6 text-muted-foreground">
          流式生成完成后，这里会自动展示 `image_result` artifact，包含出图提示词、生成图片和后续建议。
        </div>
      </ArtifactSection>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <ArtifactSection
          action={
            <div className="flex items-center gap-2">
              <WandSparkles className="h-4 w-4 text-brand" />
              <CopyButton ariaLabel="复制出图提示词" text={promptText} />
            </div>
          }
          title={artifact.title}
        >
          <div className="space-y-3">
            <div className="rounded-2xl border border-border bg-muted p-4 text-sm leading-7 text-card-foreground">
              {promptText}
            </div>
            {revisedPrompt && revisedPrompt !== originalPrompt ? (
              <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-4 text-sm leading-6 text-sky-950">
                <div className="mb-2 flex items-center gap-2 font-medium">
                  <Sparkles className="h-4 w-4 text-sky-600" />
                  提示词优化
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700/80">
                      原始版本
                    </div>
                    <div className="rounded-xl bg-white/80 p-3 text-slate-600">
                      {originalPrompt}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700/80">
                      优化后
                    </div>
                    <div className="rounded-xl bg-white/90 p-3 text-slate-700">
                      {revisedPrompt}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </ArtifactSection>

        <ArtifactSection
          action={
            generatedImages.length > 0 ? (
            <CopyButton
              ariaLabel="复制全部图片链接"
              text={generatedImages.join("\n")}
            />
            ) : null
          }
          title="生成图片"
        >
          {shouldRenderProcessingSkeleton ? (
            <div className="space-y-4">
              <div className="overflow-hidden rounded-[28px] border border-border/80 bg-[linear-gradient(145deg,rgba(255,248,240,0.96),rgba(255,255,255,0.98)_52%,rgba(255,244,214,0.96))] p-4 shadow-sm">
                <div className="relative overflow-hidden rounded-[24px] border border-white/70 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.95),rgba(255,241,220,0.9)_42%,rgba(255,224,188,0.92))]">
                  <div className="aspect-square w-full" />
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02)_40%,rgba(255,214,153,0.18))] animate-pulse" />
                  <div className="absolute inset-5 flex flex-col justify-between">
                    <div className="inline-flex w-fit items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-xs font-medium text-brand shadow-sm">
                      <Sparkles className="h-3.5 w-3.5" />
                      1024 x 1024 云端渲染中
                    </div>
                    <div className="space-y-3">
                      <div className="h-3 w-32 rounded-full bg-white/85" />
                      <div className="h-3 w-3/4 rounded-full bg-white/70" />
                      <div className="h-3 w-2/3 rounded-full bg-white/55" />
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-foreground">旗舰引擎正在精绘画面</div>
                    <div className="mt-1 text-sm leading-6 text-muted-foreground">
                      {progressMessage}
                    </div>
                  </div>
                  <div className="rounded-full bg-white/85 px-3 py-1 text-xs font-medium text-brand shadow-sm">
                    {progressPercent !== null ? `${progressPercent}%` : "处理中"}
                  </div>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/80">
                  <div
                    className="h-full rounded-full bg-[var(--brand-gradient)] transition-[width] duration-500"
                    style={{ width: `${progressPercent ?? 18}%` }}
                  />
                </div>

                <div className="mt-3 text-xs leading-5 text-muted-foreground">
                  你可以先查看上方优化后的提示词，真实图片返回后这里会自动替换成最终结果。
                </div>
              </div>
            </div>
          ) : generatedImages.length > 0 ? (
            <div className="space-y-4">
              <div className="rounded-3xl border border-border bg-[linear-gradient(135deg,rgba(255,244,214,0.96),rgba(255,255,255,0.98)_58%,rgba(255,236,214,0.96))] p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">图片画廊</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      已生成 {generatedImages.length} 张图片，可直接放大预览或在新标签中查看。
                    </div>
                  </div>
                  <div className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-brand shadow-sm">
                    共 {generatedImages.length} 张
                  </div>
                </div>
              </div>

              <div
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                data-testid="image-result-gallery"
              >
                {generatedImages.map((imageUrl, index) => (
                  <div
                    key={`${imageUrl}-${index}`}
                    className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <button
                      className="group relative block w-full overflow-hidden bg-muted"
                      onClick={() => setPreviewIndex(index)}
                      type="button"
                    >
                      <img
                        alt={`${artifact.title} ${index + 1}`}
                        className="aspect-[3/4] h-auto w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                        loading="lazy"
                        src={imageUrl}
                      />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 via-black/10 to-transparent px-3 py-3 text-left text-white">
                        <div>
                          <div className="text-sm font-semibold">图片 {index + 1}</div>
                          <div className="text-xs text-white/80">点击放大预览</div>
                        </div>
                        <ImageIcon className="h-4 w-4 text-white/90" />
                      </div>
                    </button>
                    <div className="flex items-center justify-between gap-2 px-4 py-3">
                      <button
                        className="inline-flex items-center gap-1 text-xs font-medium text-brand transition hover:opacity-80"
                        onClick={() => window.open(imageUrl, "_blank", "noopener,noreferrer")}
                        type="button"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        新标签打开
                      </button>
                      <CopyButton
                        ariaLabel={`复制图片 ${index + 1} 链接`}
                        text={imageUrl}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl bg-muted p-4 text-sm leading-6 text-muted-foreground">
              当前还没有可用的图片返回，你可以继续让我换一种风格，或重新生成一版。
            </div>
          )}
        </ArtifactSection>

        {artifact.platform_cta ? (
          <ArtifactSection
            action={
              <CopyButton
                ariaLabel="复制下一步建议"
                text={artifact.platform_cta}
              />
            }
            title="下一步建议"
          >
            <div className="rounded-2xl bg-brand-soft p-4 text-sm leading-7 text-brand-soft-foreground">
              {artifact.platform_cta}
            </div>
          </ArtifactSection>
        ) : null}
      </div>

      {previewIndex !== null ? (
        <ImagePreviewModal
          images={generatedImages}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      ) : null}
    </>
  );
}
