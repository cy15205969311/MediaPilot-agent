import {
  AlertCircle,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  Sparkles,
  User,
  Video,
} from "lucide-react";
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

  const imageMaterials = materials.filter(
    (material) => material.type === "image" && material.url,
  );
  const otherMaterials = materials.filter(
    (material) => material.type !== "image" || !material.url,
  );
  const isUser = item.role === "user";

  return (
    <div className="mb-3 space-y-2">
      {imageMaterials.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {imageMaterials.map((material, index) => (
            <a
              className={`group overflow-hidden rounded-2xl border ${
                isUser
                  ? "border-user-bubble-subtle-border bg-user-bubble-subtle"
                  : "border-border bg-muted"
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
              className={`inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1 text-xs ${
                isUser
                  ? "border border-user-bubble-subtle-border bg-user-bubble-subtle text-user-bubble-subtle-foreground"
                  : "bg-secondary text-secondary-foreground"
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
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 text-sm font-semibold text-foreground">
            正在加载历史会话
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={`history-loading-${index}`} className="space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-surface-subtle" />
                <div className="h-4 w-full animate-pulse rounded bg-muted" />
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
                  ? "border-danger-foreground/20 bg-danger-surface"
                  : item.role === "tool"
                    ? "border-warning-foreground/20 bg-warning-surface"
                    : "border-border bg-muted"
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
                {item.role === "tool" ? (
                  <Sparkles className="h-4 w-4 text-warning-foreground" />
                ) : item.role === "error" ? (
                  <AlertCircle className="h-4 w-4 text-danger-foreground" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                )}
                {item.title}
              </div>
              <div className="text-sm leading-6 text-muted-foreground">{item.content}</div>
              {timestamp ? (
                <div className="mt-2 text-[11px] text-muted-foreground/80">{timestamp}</div>
              ) : null}
            </div>
          );
        }

        return (
          <div
            key={item.id}
            className={`flex gap-3 ${item.role === "user" ? "justify-end" : "justify-start"}`}
            data-testid={`chat-message-${item.role}`}
          >
            {item.role === "assistant" ? (
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-brand-foreground shadow-sm"
                style={{ background: "var(--brand-gradient)" }}
              >
                <Sparkles className="h-5 w-5" />
              </div>
            ) : null}

            <div
              className={`max-w-[85%] rounded-[24px] border px-5 py-4 shadow-sm md:max-w-[70%] ${
                item.role === "user"
                  ? "border-user-bubble-subtle-border bg-user-bubble text-user-foreground"
                  : "border-border bg-ai-bubble text-ai-foreground"
              }`}
            >
              {renderMessageMaterials(item)}
              <div className="whitespace-pre-wrap text-sm leading-7">
                {item.content || (
                  <span className="inline-flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-brand" />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-brand"
                      style={{ animationDelay: "120ms" }}
                    />
                    <span
                      className="h-2 w-2 animate-bounce rounded-full bg-brand"
                      style={{ animationDelay: "240ms" }}
                    />
                  </span>
                )}
              </div>
              {timestamp ? (
                <div
                  className={`mt-3 text-xs ${
                    item.role === "user"
                      ? "text-user-bubble-timestamp"
                      : "text-muted-foreground/80"
                  }`}
                >
                  {timestamp}
                </div>
              ) : null}
            </div>

            {item.role === "user" ? (
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-secondary-foreground"
                data-testid="chat-message-user-avatar"
              >
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
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="flex gap-1">
            <div className="h-2 w-2 animate-bounce rounded-full bg-brand" />
            <div
              className="h-2 w-2 animate-bounce rounded-full bg-brand"
              style={{ animationDelay: "120ms" }}
            />
            <div
              className="h-2 w-2 animate-bounce rounded-full bg-brand"
              style={{ animationDelay: "240ms" }}
            />
          </div>
          <span>Agent 正在生成内容和结构化结果...</span>
        </div>
      ) : null}

      <div ref={endRef} />
    </div>
  );
}
