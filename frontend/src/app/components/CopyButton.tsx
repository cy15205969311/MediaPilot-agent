import { Copy } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
  return (
    <button
      className="rounded-lg p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
      onClick={() => void navigator.clipboard.writeText(text)}
      type="button"
    >
      <Copy className="h-4 w-4" />
    </button>
  );
}
