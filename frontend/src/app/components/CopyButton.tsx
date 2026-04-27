import { Copy } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
  return (
    <button
      className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      onClick={() => void navigator.clipboard.writeText(text)}
      type="button"
    >
      <Copy className="h-4 w-4" />
    </button>
  );
}
