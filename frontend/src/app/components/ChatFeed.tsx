import { AlertCircle, CheckCircle2, FileText, Image as ImageIcon, Sparkles, User, Video } from "lucide-react";
import { useEffect, useState } from "react";
import type { RefObject } from "react";

import type {
  AuthenticatedUser,
  ConversationMessage,
  MediaChatMaterialPayload,
} from "../types";
import { buildAbsoluteUrl, formatChatTimestamp, getDisplayName } from "../utils";

type ChatFeedProps = {
  currentUser: AuthenticatedUser | null;
  messages: ConversationMessage[];
  isStreaming: boolean;
  isLoadingHistory?: boolean;
  endRef: RefObject<HTMLDivElement>;
};

function materialLabel(material: MediaChatMaterialPayload): string {
  return material.text || material.url || "附件";
}

function renderMessageMaterials(item: ConversationMessage) {
  const materials = item.materials ?? [];
  if (materials.length === 0) {
    return null;
  }

  const imageMaterials = materials.filter((material) => material.type === "image" && material.url);
  const otherMaterials = materials.filter((material) => material.type !== "image" || !material.url);
  const isUser = item.role === "user";

  return (
    <div className="mb-3 space-y-2">
      {imageMaterials.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {imageMaterials.map((material, index) => (
            <a
              className={`group overflow-hidden rounded-2xl border ${isUser ? "border-white/25 bg-white/10" : "border-slate-200 bg-slate-50"
                }`}
              href={material.url}
              key={`${material.url}-${index}`}
              rel="noreferrer"
              target="_blank"
            >
              <img
                alt={materialLabel(material)}
                className="aspect-square w-full object-cover transition duration-200 group-hover:scale-105"
                src={material.url}
              />
            </a>
          ))}
        </div>
      ) : null}

      {otherMaterials.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {otherMaterials.map((material, index) => (
            <a
              className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs ${isUser ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"
                }`}
              href={material.url || undefined}
              key={`${material.type}-${material.url || material.text}-${index}`}
              rel="noreferrer"
              target={material.url ? "_blank" : undefined}
            >
              {material.type === "video_url" ? (
                <Video className="h-3.5 w-3.5 shrink-0" />
              ) : material.type === "text_link" ? (
                <FileText className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{materialLabel(material)}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChatFeed({
  currentUser,
  messages,
  isStreaming,
  isLoadingHistory = false,
  endRef,
}: ChatFeedProps) {
  const resolvedUserAvatarUrl = currentUser?.avatar_url
    ? buildAbsoluteUrl(currentUser.avatar_url)
    : "";
  const [hasUserAvatarError, setHasUserAvatarError] = useState(false);

  useEffect(() => {
    setHasUserAvatarError(false);
  }, [resolvedUserAvatarUrl]);

  const userDisplayName = getDisplayName(currentUser) || "User";
  const showUserAvatar = Boolean(resolvedUserAvatarUrl) && !hasUserAvatarError;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      {isLoadingHistory ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-slate-700">正在加载历史会话</div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`history-loading-${index}`} className="space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
                <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {messages.map((item) => {
        const timestamp = formatChatTimestamp(item.createdAt);

        if (item.role === "tool" || item.role === "note" || item.role === "error") {
          return (
            <div
              key={item.id}
              className={`rounded-2xl border px-4 py-3 shadow-sm ${
                item.role === "error"
                  ? "border-red-200 bg-red-50"
                  : item.role === "tool"
                    ? "border-amber-200 bg-amber-50"
                    : "border-slate-200 bg-slate-50"
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
                {item.role === "tool" ? (
                  <Sparkles className="h-4 w-4 text-amber-500" />
                ) : item.role === "error" ? (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-slate-500" />
                )}
                {item.title}
              </div>
              <div className="text-sm leading-6 text-slate-600">{item.content}</div>
              {timestamp ? (
                <div className="mt-2 text-[11px] text-slate-400">{timestamp}</div>
              ) : null}
            </div>
          );
        }

        return (
          <div
            key={item.id}
            className={`flex gap-3 ${item.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {item.role === "assistant" ? (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-sm">
                <Sparkles className="h-5 w-5" />
              </div>
            ) : null}

            <div
              className={`max-w-[85%] rounded-[24px] px-5 py-4 shadow-sm md:max-w-[70%] ${
                item.role === "user"
                  ? "bg-gradient-to-br from-rose-500 to-orange-500 text-white"
                  : "border border-slate-200 bg-white"
              }`}
            >
              {renderMessageMaterials(item)}
              <div
                className={`whitespace-pre-wrap text-sm leading-7 ${
                  item.role === "user" ? "text-white" : "text-slate-800"
                }`}
              >
                {item.content || (
                  <span className="inline-flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-rose-400" />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-rose-400"
                      style={{ animationDelay: "120ms" }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-rose-400"
                      style={{ animationDelay: "240ms" }}
                    />
                  </span>
                )}
              </div>
              {timestamp ? (
                <div
                  className={`mt-3 text-xs ${
                    item.role === "user" ? "text-white/70" : "text-slate-400"
                  }`}
                >
                  {timestamp}
                </div>
              ) : null}
            </div>

            {item.role === "user" ? (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-slate-600">
                {showUserAvatar ? (
                  <img
                    alt={`${userDisplayName} avatar`}
                    className="h-full w-full object-cover"
                    onError={() => setHasUserAvatarError(true)}
                    src={resolvedUserAvatarUrl}
                  />
                ) : (
                  <User className="h-5 w-5" />
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      {isStreaming ? (
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <div className="flex gap-1">
            <div className="h-2 w-2 animate-bounce rounded-full bg-rose-400" />
            <div
              className="h-2 w-2 animate-bounce rounded-full bg-rose-400"
              style={{ animationDelay: "120ms" }}
            />
            <div
              className="h-2 w-2 animate-bounce rounded-full bg-rose-400"
              style={{ animationDelay: "240ms" }}
            />
          </div>
          <span>Agent 正在生成内容和结构化结果…</span>
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  );
}
