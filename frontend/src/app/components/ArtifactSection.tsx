import type { ReactNode } from "react";

export function ArtifactSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}
