import { useEffect, useState } from "react";

import {
  ChevronDown,
  ExternalLink,
  ImageIcon,
  MessageSquareQuote,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";

import type { ContentGenerationArtifactPayload, UiPlatform } from "../../types";
import { ArtifactSection } from "../ArtifactSection";
import { CollapsibleText } from "../CollapsibleText";
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

function normalizePromptValue(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function PromptOptimizationNotice(props: {
  originalPrompt: string;
  revisedPrompt: string;
}) {
  const { originalPrompt, revisedPrompt } = props;
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    setIsExpanded(false);
  }, [originalPrompt, revisedPrompt]);

  return (
    <div
      className="rounded-2xl border border-sky-100 bg-sky-50/80 p-3 shadow-sm"
      data-testid="artifact-prompt-optimization"
    >
      <button
        className="flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setIsExpanded((current) => !current)}
        type="button"
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/90 text-sky-600 shadow-sm">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-sky-950">
              已自动优化提示词以提升画质与合规性
            </div>
            <div className="mt-1 text-xs leading-5 text-sky-800/80">
              系统保留了你的创作意图，并生成了最终执行版提示词。
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs font-medium text-sky-700">
          <span>{isExpanded ? "收起详情" : "查看详情"}</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </button>

      <div
        className={`grid transition-all duration-300 ease-out ${
          isExpanded ? "mt-3 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div
            className="relative rounded-xl border border-slate-200 bg-white/85 p-3 pr-14"
            data-testid="artifact-prompt-optimization-details"
          >
            <div className="absolute right-2 top-2">
              <CopyButton ariaLabel="复制优化后的提示词" text={revisedPrompt} />
            </div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Prompt Optimization
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">原始描述</div>
                <CollapsibleText
                  className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600"
                  collapseKey={`content-original:${originalPrompt}`}
                  contentClassName="whitespace-pre-wrap break-words"
                  maxLines={4}
                >
                  {originalPrompt}
                </CollapsibleText>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">系统执行提示词</div>
                <CollapsibleText
                  className="rounded-xl bg-white p-3 text-sm leading-6 text-slate-700"
                  collapseKey={`content-revised:${revisedPrompt}`}
                  contentClassName="whitespace-pre-wrap break-words"
                  maxLines={6}
                >
                  {revisedPrompt}
                </CollapsibleText>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ContentGenerationArtifact({
  artifact,
  platform,
}: ContentGenerationArtifactProps) {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const originalPrompt = normalizePromptValue(artifact?.original_prompt);
  const revisedPrompt = normalizePromptValue(artifact?.revised_prompt);
  const promptOptimization =
    revisedPrompt && revisedPrompt !== originalPrompt
      ? {
          originalPrompt,
          revisedPrompt,
        }
      : null;

  if (!artifact) {
    return (
      <ArtifactSection title="内容生成结果">
        <div className="rounded-2xl bg-muted p-4 text-sm leading-6 text-muted-foreground">
          流式生成完成后，这里会根据后端返回的 `content_draft` artifact 自动展示标题候选、配图、正文草稿和平台引导语。
        </div>
      </ArtifactSection>
    );
  }

  const generatedImages = artifact.generated_images ?? [];

  return (
    <>
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
                  <CollapsibleText
                    className="min-w-0 flex-1 text-sm font-medium leading-6 text-foreground"
                    collapseKey={`title:${title}`}
                    contentClassName="whitespace-pre-wrap break-words"
                    maxLines={3}
                  >
                    {title}
                  </CollapsibleText>
                  <CopyButton ariaLabel="复制标题候选" text={title} />
                </div>
              </div>
            ))}
          </div>
        </ArtifactSection>

        {generatedImages.length > 0 ? (
          <ArtifactSection
            action={
              <CopyButton ariaLabel="复制全部配图链接" text={generatedImages.join("\n")} />
            }
            title="AI 配图"
          >
            <div className="space-y-4">
              {promptOptimization ? (
                <PromptOptimizationNotice
                  originalPrompt={promptOptimization.originalPrompt}
                  revisedPrompt={promptOptimization.revisedPrompt}
                />
              ) : null}

              <div className="rounded-3xl border border-border bg-[linear-gradient(135deg,rgba(255,244,214,0.96),rgba(255,255,255,0.98)_58%,rgba(255,236,214,0.96))] p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">配图画廊</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      已生成 {generatedImages.length} 张图片，点击任意卡片即可预览。
                    </div>
                  </div>
                  <div className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-brand shadow-sm">
                    {generatedImages.length} 张
                  </div>
                </div>
              </div>

              <div
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                data-testid="artifact-image-gallery"
              >
                {generatedImages.map((imageUrl, index) => (
                  <div
                    key={imageUrl}
                    className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm transition duration-300 hover:-translate-y-0.5 hover:shadow-lg"
                    data-testid={`artifact-image-card-${index + 1}`}
                  >
                    <button
                      className="group relative block w-full overflow-hidden bg-muted"
                      onClick={() => setPreviewImageUrl(imageUrl)}
                      type="button"
                    >
                      <img
                        alt={`${artifact.title} 配图 ${index + 1}`}
                        className="aspect-[3/4] h-auto w-full rounded-xl object-cover shadow-md transition duration-300 group-hover:scale-[1.02] group-hover:shadow-lg"
                        loading="lazy"
                        src={imageUrl}
                      />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 via-black/10 to-transparent px-3 py-3 text-left text-white">
                        <div>
                          <div className="text-sm font-semibold">配图 {index + 1}</div>
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
                      <CopyButton ariaLabel={`复制配图 ${index + 1} 链接`} text={imageUrl} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ArtifactSection>
        ) : null}

        <ArtifactSection
          action={<CopyButton ariaLabel="复制正文草稿" text={artifact.body} />}
          title="正文草稿"
        >
          <CollapsibleText
            className="rounded-2xl bg-muted p-4 text-sm leading-7 text-card-foreground"
            collapseKey={`content-body:${artifact.body}`}
            contentClassName="whitespace-pre-wrap break-words"
            maxLines={8}
          >
            {artifact.body}
          </CollapsibleText>
        </ArtifactSection>

        <ArtifactSection
          action={<CopyButton ariaLabel="复制平台引导语" text={artifact.platform_cta} />}
          title="平台引导语"
        >
          <div className="space-y-3">
            <CollapsibleText
              className="rounded-2xl bg-brand-soft p-4 text-sm leading-7 text-brand-soft-foreground"
              collapseKey={`platform-cta:${artifact.platform_cta}`}
              contentClassName="whitespace-pre-wrap break-words"
              maxLines={5}
            >
              {artifact.platform_cta}
            </CollapsibleText>
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

      {previewImageUrl ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <button
            aria-label="关闭图片预览"
            className="absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/40 text-white transition hover:bg-black/60"
            onClick={() => setPreviewImageUrl(null)}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
          <button
            className="absolute inset-0"
            onClick={() => setPreviewImageUrl(null)}
            type="button"
          />
          <div className="relative z-10 max-h-[90vh] max-w-5xl overflow-hidden rounded-[28px] border border-white/10 bg-black/20 shadow-2xl backdrop-blur-sm">
            <img
              alt="AI 配图预览"
              className="max-h-[90vh] w-full object-contain"
              src={previewImageUrl}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
