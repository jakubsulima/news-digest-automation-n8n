import type { ReactNode } from "react";

import type { NewsItemPreview } from "@/lib/news";
import { cn } from "@/lib/utils";

type NewsPreviewCardProps = {
  className?: string;
  compact?: boolean;
  preview: NewsItemPreview | null;
  summary: string;
  summaryAction?: ReactNode;
};

const PREVIEW_SECTIONS: Array<{
  key: keyof Pick<NewsItemPreview, "clickIf" | "whatHappened" | "whyItMatters">;
  label: string;
}> = [
  { key: "whatHappened", label: "What happened" },
  { key: "whyItMatters", label: "Why it matters" },
  { key: "clickIf", label: "Click if" },
];

export function NewsPreviewCard({ className, compact = false, preview, summary, summaryAction }: NewsPreviewCardProps) {
  if (!preview) {
    return (
      <p className={cn("text-sm leading-5 text-muted-foreground", compact && "text-xs leading-5", className)}>
        {summary}
        {summaryAction ? <span className="ml-1 inline-flex align-middle">{summaryAction}</span> : null}
      </p>
    );
  }

  return (
    <section className={cn("grid gap-2 rounded-md border border-border bg-muted/20 p-2.5", compact && "gap-1.5 p-2", className)}>
      {PREVIEW_SECTIONS.map((section) => (
        <div key={section.key} className="grid gap-1">
          <h3 className={cn("text-xs font-semibold uppercase tracking-normal text-foreground", compact && "text-[11px]")}>
            {section.label}
          </h3>
          <p className={cn("text-sm leading-5 text-muted-foreground", compact && "text-xs leading-5")}>
            {preview[section.key]}
          </p>
        </div>
      ))}
    </section>
  );
}
