"use client";

import type { ReactNode } from "react";

import { useLocalize } from "@/components/reader-locale-provider";
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
  labels: readonly [string, string];
}> = [
  { key: "whatHappened", labels: ["Co się wydarzyło", "What happened"] },
  { key: "whyItMatters", labels: ["Dlaczego to ważne", "Why it matters"] },
  { key: "clickIf", labels: ["Przeczytaj, jeśli", "Read if"] },
];

export function NewsPreviewCard({ className, compact = false, preview, summary, summaryAction }: NewsPreviewCardProps) {
  const l = useLocalize();
  const cleanSummary = summary.replace(/^View CSAF Summary\s*/i, "").trim();

  if (!preview) {
    return (
      <p className={cn("min-w-0 max-w-full break-words text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]", compact && "text-xs leading-5", className)}>
        {cleanSummary}
        {summaryAction ? <span className="ml-1 inline-flex align-middle">{summaryAction}</span> : null}
      </p>
    );
  }

  return (
    <section className={cn("grid min-w-0 max-w-full gap-2 overflow-hidden rounded-md border border-border bg-muted/20 p-2.5", compact && "gap-1.5 p-2", className)}>
      {PREVIEW_SECTIONS.map((section) => (
        <div key={section.key} className="grid gap-1">
          <h3 className={cn("text-xs font-semibold uppercase tracking-normal text-foreground", compact && "text-[11px]")}>
            {l(section.labels[0], section.labels[1])}
          </h3>
          <p className={cn("min-w-0 max-w-full break-words text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]", compact && "text-xs leading-5")}>
            {preview[section.key]}
          </p>
        </div>
      ))}
    </section>
  );
}
