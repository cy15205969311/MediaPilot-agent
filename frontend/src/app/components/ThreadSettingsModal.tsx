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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/70 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-sm">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xl font-semibold text-slate-900">会话设置</div>
              <div className="mt-1 text-sm text-slate-500">
                {isDraft
                  ? "当前还是草稿会话，保存后会立即更新这次会话的标题和人设。"
                  : "保存后，当前线程后续发出的消息会立即使用最新的人设约束。"}
              </div>
            </div>
          </div>

          <button
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <div className="mb-2 text-sm font-medium text-slate-700">会话标题</div>
            <input
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：年度财务复盘选题会"
              value={title}
            />
          </label>

          <label className="block">
            <div className="mb-2 text-sm font-medium text-slate-700">机器人人设 / 品牌定位</div>
            <textarea
              className="min-h-40 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-7 outline-none transition focus:border-rose-300 focus:ring-4 focus:ring-rose-100"
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="请输入你希望我扮演的角色，留空则回退到通用助手。"
              value={systemPrompt}
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-orange-500 px-4 py-3 text-sm font-medium text-white transition hover:from-rose-600 hover:to-orange-600 disabled:cursor-not-allowed disabled:opacity-70"
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
