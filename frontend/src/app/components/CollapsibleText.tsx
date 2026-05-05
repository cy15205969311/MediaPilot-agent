import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

type CollapsibleTextProps = {
  children: ReactNode;
  maxLines?: number;
  collapseKey?: string | number | null;
  className?: string;
  contentClassName?: string;
  expandLabel?: string;
  collapseLabel?: string;
};

const COLLAPSED_STYLE: CSSProperties = {
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

export function CollapsibleText({
  children,
  maxLines = 5,
  collapseKey,
  className,
  contentClassName = "whitespace-pre-wrap break-words",
  expandLabel = "展开全文",
  collapseLabel = "收起全文",
}: CollapsibleTextProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [canCollapse, setCanCollapse] = useState(false);

  useEffect(() => {
    setIsExpanded(false);
    setCanCollapse(false);
  }, [collapseKey, maxLines]);

  useEffect(() => {
    const element = contentRef.current;
    if (!element || isExpanded) {
      return;
    }

    const measureOverflow = () => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight);
      if (Number.isFinite(lineHeight) && lineHeight > 0) {
        const maxHeight = lineHeight * maxLines + 1;
        setCanCollapse(element.scrollHeight > maxHeight);
        return;
      }

      setCanCollapse(element.scrollHeight > element.clientHeight + 1);
    };

    measureOverflow();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureOverflow) : null;
    resizeObserver?.observe(element);
    window.addEventListener("resize", measureOverflow);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureOverflow);
    };
  }, [children, isExpanded, maxLines]);

  return (
    <div className={className}>
      <div
        className={contentClassName}
        ref={contentRef}
        style={
          !isExpanded
            ? {
                ...COLLAPSED_STYLE,
                WebkitLineClamp: maxLines,
              }
            : undefined
        }
      >
        {children}
      </div>

      {canCollapse ? (
        <button
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          onClick={() => setIsExpanded((current) => !current)}
          type="button"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              {collapseLabel}
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              {expandLabel}
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}
