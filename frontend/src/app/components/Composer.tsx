import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Send,
  StopCircle,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  ClipboardEvent,
  DragEvent,
  KeyboardEvent,
  RefObject,
} from "react";

import type {
  ComposerSubmitPayload,
  UploadedMaterial,
  UploadedMaterialKind,
} from "../types";
import { ImagePreviewModal } from "./ImagePreviewModal";

type ComposerProps = {
  message: string;
  uploadedMaterials: UploadedMaterial[];
  imageInputRef: RefObject<HTMLInputElement>;
  videoInputRef: RefObject<HTMLInputElement>;
  audioInputRef: RefObject<HTMLInputElement>;
  textInputRef: RefObject<HTMLInputElement>;
  isStreaming: boolean;
  isUploading: boolean;
  onMessageChange: (message: string) => void;
  onSubmit: (payload: ComposerSubmitPayload) => void;
  onStopStreaming: () => void;
  onTriggerFilePicker: (kind: UploadedMaterialKind) => void;
  onRemoveMaterial: (materialId: string) => void;
  onFilesSelected: (
    kind: UploadedMaterialKind,
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
  onFilesCaptured: (files: File[], source: "paste" | "drop") => void;
};

function renderMaterialStatus(material: UploadedMaterial) {
  if (material.status === "uploading") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-surface px-2 py-1 text-[11px] font-medium text-warning-foreground">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        上传中
      </span>
    );
  }

  if (material.status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger-surface px-2 py-1 text-[11px] font-medium text-danger-foreground">
        <AlertCircle className="h-3.5 w-3.5" />
        上传失败
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success-surface px-2 py-1 text-[11px] font-medium text-success-foreground">
      <CheckCircle2 className="h-3.5 w-3.5" />
      已就绪
    </span>
  );
}

function hasFileTransfer(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function extractClipboardFiles(event: ClipboardEvent<HTMLTextAreaElement>): File[] {
  const directFiles = Array.from(event.clipboardData.files);
  if (directFiles.length > 0) {
    return directFiles;
  }

  return Array.from(event.clipboardData.items)
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

export function Composer({
  message,
  uploadedMaterials,
  imageInputRef,
  videoInputRef,
  audioInputRef,
  textInputRef,
  isStreaming,
  isUploading,
  onMessageChange,
  onSubmit,
  onStopStreaming,
  onTriggerFilePicker,
  onRemoveMaterial,
  onFilesSelected,
  onFilesCaptured,
}: ComposerProps) {
  const [previewData, setPreviewData] = useState<{
    images: string[];
    startIndex: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const isLoading = isStreaming || isUploading;
  const canSubmit = message.trim().length > 0 && !isLoading;
  const imageMaterials = useMemo(
    () => uploadedMaterials.filter((item) => item.kind === "image"),
    [uploadedMaterials],
  );
  const nonImageMaterials = useMemo(
    () => uploadedMaterials.filter((item) => item.kind !== "image"),
    [uploadedMaterials],
  );
  const imagePreviewUrls = useMemo(
    () =>
      imageMaterials
        .map((item) => item.previewUrl)
        .filter((url): url is string => Boolean(url)),
    [imageMaterials],
  );
  const sendButtonLabel = isUploading
    ? "上传中..."
    : isStreaming
      ? "生成中..."
      : "发送消息";

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }

    onSubmit({
      message,
      uploadedMaterials,
    });
    onMessageChange("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    handleSubmit();
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = extractClipboardFiles(event);
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    onFilesCaptured(files, "paste");
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);

    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) {
      return;
    }

    onFilesCaptured(files, "drop");
  };

  const openImagePreview = (startIndex: number) => {
    if (imagePreviewUrls.length === 0) {
      return;
    }

    const normalizedStartIndex =
      imageMaterials
        .slice(0, startIndex + 1)
        .filter((item) => Boolean(item.previewUrl)).length - 1;

    if (normalizedStartIndex < 0) {
      return;
    }

    setPreviewData({
      images: imagePreviewUrls,
      startIndex: normalizedStartIndex,
    });
  };

  const renderImageCard = (item: UploadedMaterial, index: number) => (
    <div
      key={item.id}
      className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border border-black/10 bg-muted shadow-sm transition-transform hover:scale-[1.02] sm:h-[72px] sm:w-[72px] dark:border-white/10"
      data-testid="composer-uploaded-image"
    >
      {item.previewUrl ? (
        <button
          aria-label={`预览图片 ${item.name}`}
          className="h-full w-full cursor-pointer bg-transparent p-0 transition-opacity hover:opacity-80"
          onClick={() => openImagePreview(index)}
          type="button"
        >
          <img
            alt={item.name}
            className="h-full w-full object-cover"
            src={item.previewUrl}
          />
        </button>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-card text-muted-foreground">
          <ImageIcon className="h-6 w-6" />
        </div>
      )}

      <button
        aria-label={`删除图片 ${item.name}`}
        className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/75"
        onClick={() => onRemoveMaterial(item.id)}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const renderAttachmentCard = (item: UploadedMaterial) => (
    <div
      key={item.id}
      className="flex min-w-[16rem] max-w-full items-center gap-3 rounded-2xl border border-border bg-muted px-3 py-2 shadow-sm"
      data-testid="composer-uploaded-material"
    >
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-card text-muted-foreground">
        {item.kind === "video" ? (
          <Video className="h-5 w-5" />
        ) : item.kind === "audio" ? (
          <Volume2 className="h-5 w-5" />
        ) : (
          <FileText className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{item.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{item.sizeLabel}</span>
          {renderMaterialStatus(item)}
        </div>
        {item.errorMessage ? (
          <div className="mt-1 text-xs text-danger-foreground">
            {item.errorMessage}
          </div>
        ) : null}
      </div>
      <button
        aria-label={`删除素材 ${item.name}`}
        className="rounded-lg p-1 text-muted-foreground transition hover:bg-surface-subtle hover:text-foreground"
        onClick={() => onRemoveMaterial(item.id)}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <>
      <div className="mx-auto max-w-4xl">
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-card-foreground transition hover:border-brand/40 hover:bg-brand-soft"
            data-testid="composer-upload-image"
            onClick={() => onTriggerFilePicker("image")}
            type="button"
          >
            <ImageIcon className="h-4 w-4" />
            上传图片
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-card-foreground transition hover:border-brand/40 hover:bg-brand-soft"
            data-testid="composer-upload-video"
            onClick={() => onTriggerFilePicker("video")}
            type="button"
          >
            <Video className="h-4 w-4" />
            上传视频
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-card-foreground transition hover:border-brand/40 hover:bg-brand-soft"
            data-testid="composer-upload-audio"
            onClick={() => onTriggerFilePicker("audio")}
            type="button"
          >
            <Volume2 className="h-4 w-4" />
            上传音频
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm text-card-foreground transition hover:border-brand/40 hover:bg-brand-soft"
            data-testid="composer-upload-text"
            onClick={() => onTriggerFilePicker("text")}
            type="button"
          >
            <FileText className="h-4 w-4" />
            文本文档
          </button>
        </div>

        {nonImageMaterials.length > 0 ? (
          <div className="scrollbar-hide mb-3 flex gap-3 overflow-x-auto overscroll-x-contain pb-1">
            {nonImageMaterials.map(renderAttachmentCard)}
          </div>
        ) : null}

        {isUploading ? (
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-warning-foreground/20 bg-warning-surface px-4 py-3 text-sm text-warning-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            素材正在上传，上传完成后会自动加入本次任务。
          </div>
        ) : null}

        {isStreaming ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-danger-foreground/20 bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
            <div className="min-w-0">
              <div className="font-semibold">正在生成内容</div>
              <div className="mt-1 text-xs leading-5">
                如果发现提示词写错了或方向偏了，可以立刻停止，已输出内容会保留在当前对话中。
              </div>
            </div>
            <button
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-danger-foreground px-3 py-2 text-xs font-semibold text-danger-surface transition hover:opacity-90"
              data-testid="composer-stop-button"
              onClick={onStopStreaming}
              type="button"
            >
              <StopCircle className="h-4 w-4" />
              停止生成
            </button>
          </div>
        ) : null}

        <div
          className={`relative overflow-hidden rounded-[28px] border bg-card shadow-sm transition ${
            isDragging
              ? "border-brand/60 bg-brand-soft ring-4 ring-brand/10"
              : "border-border focus-within:border-primary"
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {imageMaterials.length > 0 ? (
            <div className="px-4 pt-4">
              <div className="scrollbar-hide flex w-full flex-row gap-3 overflow-x-auto overscroll-x-contain px-1 pb-2 pt-1">
                {imageMaterials.map((item, index) => renderImageCard(item, index))}
              </div>
            </div>
          ) : null}

          {isDragging ? (
            <div className="pointer-events-none absolute inset-x-4 top-4 z-10 rounded-3xl border border-dashed border-brand/50 bg-brand-soft/80 px-4 py-3 text-sm text-brand shadow-sm backdrop-blur-sm">
              松开鼠标即可上传，支持图片、音频、视频与文档素材
            </div>
          ) : null}

          <textarea
            className="min-h-32 w-full resize-none bg-transparent px-5 py-4 pr-20 text-sm leading-7 text-card-foreground outline-none focus:outline-none focus:ring-0"
            data-testid="composer-textarea"
            onChange={(event) => onMessageChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="描述你的内容需求，或上传素材让 Agent 帮你分析..."
            value={message}
          />
          <button
            aria-label={sendButtonLabel}
            className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="composer-send-button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            type="button"
          >
            {isLoading ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>

        <div className="mt-2 px-2 text-xs text-muted-foreground">
          Enter 发送，Shift + Enter 换行。支持拖拽文件与 Ctrl+V 粘贴截图/文档。
        </div>
        {isUploading ? (
          <div className="mt-1 px-2 text-xs text-warning-foreground">
            大文件上传和 OSS 转存可能需要 10-120 秒，请等待上传完成后再发送。
          </div>
        ) : null}
      </div>

      <input
        accept="image/*"
        className="hidden"
        data-testid="composer-image-input"
        multiple
        onChange={(event) => onFilesSelected("image", event)}
        ref={imageInputRef}
        type="file"
      />
      <input
        accept="video/*,.mp4,.mov,.avi,.wmv"
        className="hidden"
        data-testid="composer-video-input"
        multiple
        onChange={(event) => onFilesSelected("video", event)}
        ref={videoInputRef}
        type="file"
      />
      <input
        accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg"
        className="hidden"
        data-testid="composer-audio-input"
        multiple
        onChange={(event) => onFilesSelected("audio", event)}
        ref={audioInputRef}
        type="file"
      />
      <input
        accept=".txt,.pdf,.md,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        data-testid="composer-text-input"
        multiple
        onChange={(event) => onFilesSelected("text", event)}
        ref={textInputRef}
        type="file"
      />

      {previewData ? (
        <ImagePreviewModal
          images={previewData.images}
          initialIndex={previewData.startIndex}
          onClose={() => setPreviewData(null)}
        />
      ) : null}
    </>
  );
}
