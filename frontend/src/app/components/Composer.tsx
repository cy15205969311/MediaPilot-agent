import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Send,
  Video,
  X,
} from "lucide-react";
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";

import type {
  ComposerSubmitPayload,
  UploadedMaterial,
  UploadedMaterialKind,
} from "../types";

type ComposerProps = {
  message: string;
  uploadedMaterials: UploadedMaterial[];
  imageInputRef: RefObject<HTMLInputElement>;
  videoInputRef: RefObject<HTMLInputElement>;
  textInputRef: RefObject<HTMLInputElement>;
  isStreaming: boolean;
  isUploading: boolean;
  onMessageChange: (message: string) => void;
  onSubmit: (payload: ComposerSubmitPayload) => void;
  onTriggerFilePicker: (kind: UploadedMaterialKind) => void;
  onRemoveMaterial: (materialId: string) => void;
  onFilesSelected: (kind: UploadedMaterialKind, event: ChangeEvent<HTMLInputElement>) => void;
};

function renderMaterialStatus(material: UploadedMaterial) {
  if (material.status === "uploading") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        上传中
      </span>
    );
  }

  if (material.status === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[11px] font-medium text-red-600">
        <AlertCircle className="h-3.5 w-3.5" />
        上传失败
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
      <CheckCircle2 className="h-3.5 w-3.5" />
      已就绪
    </span>
  );
}

export function Composer({
  message,
  uploadedMaterials,
  imageInputRef,
  videoInputRef,
  textInputRef,
  isStreaming,
  isUploading,
  onMessageChange,
  onSubmit,
  onTriggerFilePicker,
  onRemoveMaterial,
  onFilesSelected,
}: ComposerProps) {
  const isLoading = isStreaming || isUploading;
  const canSubmit = message.trim().length > 0 && !isLoading;

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
    if (event.key !== "Enter") {
      return;
    }

    if (event.shiftKey) {
      return;
    }

    event.preventDefault();
    handleSubmit();
  };

  return (
    <>
      <div className="mx-auto max-w-4xl">
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:border-rose-300 hover:bg-rose-50"
            onClick={() => onTriggerFilePicker("image")}
            type="button"
          >
            <ImageIcon className="h-4 w-4" />
            上传图片
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:border-rose-300 hover:bg-rose-50"
            onClick={() => onTriggerFilePicker("video")}
            type="button"
          >
            <Video className="h-4 w-4" />
            视频素材
          </button>
          <button
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:border-rose-300 hover:bg-rose-50"
            onClick={() => onTriggerFilePicker("text")}
            type="button"
          >
            <FileText className="h-4 w-4" />
            文档文件
          </button>
        </div>

        {uploadedMaterials.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-3">
            {uploadedMaterials.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                {item.previewUrl ? (
                  <img
                    alt={item.name}
                    className="h-12 w-12 rounded-xl object-cover"
                    src={item.previewUrl}
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-500">
                    {item.kind === "video" ? (
                      <Video className="h-5 w-5" />
                    ) : (
                      <FileText className="h-5 w-5" />
                    )}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{item.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>{item.sizeLabel}</span>
                    {renderMaterialStatus(item)}
                  </div>
                  {item.errorMessage ? (
                    <div className="mt-1 text-xs text-red-500">{item.errorMessage}</div>
                  ) : null}
                </div>
                <button
                  className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
                  onClick={() => onRemoveMaterial(item.id)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {isUploading ? (
          <div className="mb-3 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            素材正在上传，上传完成后会自动加入本次任务。
          </div>
        ) : null}

        <div className="relative">
          <textarea
            className="min-h-32 w-full resize-none rounded-[28px] border border-slate-200 bg-white px-5 py-4 pr-16 text-sm leading-7 text-slate-800 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
            onChange={(event) => onMessageChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你的内容需求，或上传素材让 Agent 帮你分析"
            value={message}
          />
          <button
            className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-lg transition hover:scale-[1.02] hover:from-rose-600 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
            disabled={!canSubmit}
            onClick={handleSubmit}
            type="button"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-2 px-2 text-xs text-slate-400">Enter 发送，Shift + Enter 换行</div>
      </div>

      <input
        accept="image/*"
        className="hidden"
        multiple
        onChange={(event) => onFilesSelected("image", event)}
        ref={imageInputRef}
        type="file"
      />
      <input
        accept="video/*,.mp4,.mov"
        className="hidden"
        multiple
        onChange={(event) => onFilesSelected("video", event)}
        ref={videoInputRef}
        type="file"
      />
      <input
        accept=".txt,.pdf,.md"
        className="hidden"
        multiple
        onChange={(event) => onFilesSelected("text", event)}
        ref={textInputRef}
        type="file"
      />
    </>
  );
}
