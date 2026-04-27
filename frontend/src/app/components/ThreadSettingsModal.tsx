import { LoaderCircle, Settings2, X } from "lucide-react";
import { useEffect, useState } from "react";

type ThreadSettingsModalProps = {
  open: boolean;
  isDraft: boolean;
  initialTitle: string;
  initialSystemPrompt: string;
  isSubmitting: boolean;
  onClose: () => void;
  onSave: (payload: { title: string; systemPrompt: string }) => Promise<void> | void;
};

export function ThreadSettingsModal({
  open,
  isDraft,
  initialTitle,
  initialSystemPrompt,
  isSubmitting,
  onClose,
  onSave,
}: ThreadSettingsModalProps) {
  const [title, setTitle] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setTitle(initialTitle);
    setSystemPrompt(initialSystemPrompt);
  }, [initialSystemPrompt, initialTitle, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <div className="w-full max-w-2xl rounded-[28px] border border-border bg-card p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-2xl text-brand-foreground shadow-sm"
              style={{ background: "var(--brand-gradient)" }}
            >
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-semibold text-foreground">会话设置</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {isDraft
                  ? "当前还是草稿会话，保存后会立即更新这次会话的标题和人设。"
                  : "保存后，当前线程后续发出的消息会立刻使用最新的人设约束。"}
              </div>
            </div>
          </div>

          <button
            className="rounded-xl p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <div className="mb-2 text-sm font-medium text-card-foreground">会话标题</div>
            <input
              className="w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：年度资产配置复盘选题会"
              value={title}
            />
          </label>

          <label className="block">
            <div className="mb-2 text-sm font-medium text-card-foreground">
              机器人人设 / 品牌定位
            </div>
            <textarea
              className="min-h-40 w-full rounded-2xl border border-border bg-input-background px-4 py-3 text-sm leading-7 text-foreground outline-none transition focus:border-brand/40 focus:ring-4 focus:ring-brand-soft"
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="请输入你希望我扮演的角色，留空则回退到通用助手。"
              value={systemPrompt}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-2xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            onClick={() => void onSave({ title, systemPrompt })}
            type="button"
          >
            {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
}
