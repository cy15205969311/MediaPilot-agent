import type { ReactNode } from "react";
import { X } from "lucide-react";

type ToastState = {
  tone: "success" | "error" | "warning";
};

type ToastViewportProps = {
  children: ReactNode;
  onClose: () => void;
  toast: ToastState | null;
};

export function ToastViewport(props: ToastViewportProps) {
  const { children, onClose, toast } = props;

  if (!toast) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[120] w-[min(92vw,26rem)]">
      <div
        className={`pointer-events-auto rounded-[26px] border px-4 py-4 shadow-[0_24px_60px_rgba(15,23,42,0.14)] backdrop-blur-xl ${
          toast.tone === "success"
            ? "border-emerald-200 bg-white/92 text-emerald-700"
            : toast.tone === "warning"
              ? "border-amber-200 bg-white/92 text-amber-700"
              : "border-rose-200 bg-white/92 text-rose-700"
        }`}
      >
        <div className="flex items-start gap-3">
          {children}
          <button
            aria-label="关闭提示"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
