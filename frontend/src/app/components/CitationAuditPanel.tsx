import { ChevronDown, ChevronUp, FileText, ShieldCheck, Sheet, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { CitationAuditItem } from "../types";

type CitationAuditPanelProps = {
  items?: CitationAuditItem[];
  compact?: boolean;
};

type SourceVisual = {
  Icon: LucideIcon;
  iconClassName: string;
  badgeClassName: string;
  label: string;
};

function getSourceExtension(source: string): string {
  const cleanSource = source.split("?")[0] ?? source;
  const lastDotIndex = cleanSource.lastIndexOf(".");
  if (lastDotIndex < 0) {
    return "";
  }
  return cleanSource.slice(lastDotIndex).toLowerCase();
}

function getSourceVisual(source: string): SourceVisual {
  const extension = getSourceExtension(source);

  if (extension === ".csv" || extension === ".xlsx") {
    return {
      Icon: Sheet,
      iconClassName: "text-emerald-500",
      badgeClassName:
        "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300",
      label: extension === ".csv" ? "CSV" : "XLSX",
    };
  }

  if (extension === ".docx") {
    return {
      Icon: FileText,
      iconClassName: "text-blue-500",
      badgeClassName:
        "border-blue-200 bg-blue-500/10 text-blue-700 dark:border-blue-900/60 dark:text-blue-300",
      label: "DOCX",
    };
  }

  if (extension === ".pdf") {
    return {
      Icon: FileText,
      iconClassName: "text-rose-500",
      badgeClassName:
        "border-rose-200 bg-rose-500/10 text-rose-700 dark:border-rose-900/60 dark:text-rose-300",
      label: "PDF",
    };
  }

  return {
    Icon: FileText,
    iconClassName: "text-muted-foreground",
    badgeClassName: "border-border bg-surface-muted text-muted-foreground",
    label: extension ? extension.slice(1).toUpperCase() : "TEXT",
  };
}

function getRelevancePercent(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(score * 100)));
}

function getRelevanceBadgeClass(percent: number): string {
  if (percent >= 85) {
    return "border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300";
  }
  if (percent >= 70) {
    return "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/60 dark:text-amber-300";
  }
  return "border-border bg-muted text-muted-foreground";
}

function normalizeAuditItems(items: CitationAuditItem[] | undefined): CitationAuditItem[] {
  if (!items) {
    return [];
  }
  return items
    .filter((item) => item.source && item.snippet)
    .slice()
    .sort((left, right) => {
      if (right.relevance_score !== left.relevance_score) {
        return right.relevance_score - left.relevance_score;
      }
      return left.citation_index - right.citation_index;
    });
}

export function CitationAuditPanel({
  items,
  compact = false,
}: CitationAuditPanelProps) {
  const auditItems = useMemo(() => normalizeAuditItems(items), [items]);
  const [isExpanded, setIsExpanded] = useState(!compact);

  if (auditItems.length === 0) {
    return null;
  }

  const averageScore = Math.round(
    auditItems.reduce((total, item) => total + getRelevancePercent(item.relevance_score), 0)
      / auditItems.length,
  );

  return (
    <section
      className="rounded-[24px] border border-border bg-card p-4 shadow-sm"
      data-testid="citation-audit-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldCheck className="h-4 w-4 text-brand" />
            引用审计
          </div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            共命中 {auditItems.length} 个知识切块，平均相关度 {averageScore}%
          </div>
        </div>
        <button
          aria-expanded={isExpanded}
          aria-label={isExpanded ? "收起引用审计" : "展开引用审计"}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:text-foreground"
          onClick={() => setIsExpanded((current) => !current)}
          type="button"
        >
          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <div
        className={`grid transition-all duration-300 ease-in-out ${
          isExpanded ? "mt-4 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="space-y-3">
            {auditItems.map((item, index) => {
              const visual = getSourceVisual(item.source);
              const relevancePercent = getRelevancePercent(item.relevance_score);
              return (
                <article
                  className="rounded-2xl border border-border bg-muted/70 p-3"
                  data-testid={`citation-audit-item-${index + 1}`}
                  key={`${item.document_id ?? item.source}-${item.chunk_index}-${index}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className={`rounded-xl bg-card p-2 ${visual.iconClassName}`}>
                          <visual.Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-foreground">
                            [{item.citation_index}] {item.source}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                            <span
                              className={`rounded-full border px-2 py-0.5 font-semibold ${visual.badgeClassName}`}
                            >
                              {visual.label}
                            </span>
                            <span>切块 #{item.chunk_index + 1}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getRelevanceBadgeClass(
                        relevancePercent,
                      )}`}
                      data-testid={`citation-audit-score-${index + 1}`}
                    >
                      {relevancePercent}% 相关度
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-4 text-xs leading-5 text-muted-foreground">
                    {item.snippet}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
