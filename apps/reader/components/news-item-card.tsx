"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewsItemActions } from "@/components/news-item-actions";
import type { NewsItemWithState } from "@/lib/news";
import { cn } from "@/lib/utils";

const SUMMARY_MAX_CHARS = 260;
const DISPLAY_TIME_ZONE = "Europe/Warsaw";

type NewsItemCardProps = {
  item: NewsItemWithState;
  onItemStateChange?: (
    itemId: string,
    state: Pick<NewsItemWithState, "archivedAt" | "readAt" | "savedAt">,
  ) => void;
};

function formatDate(value: string | null) {
  if (!value) {
    return "No publication date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: value.includes("T") ? "2-digit" : undefined,
    minute: value.includes("T") ? "2-digit" : undefined,
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function compactSummary(value: string) {
  if (value.length <= SUMMARY_MAX_CHARS) {
    return value;
  }

  const trimmed = value.slice(0, SUMMARY_MAX_CHARS).trimEnd();
  const lastSpaceIndex = trimmed.lastIndexOf(" ");
  const compacted = lastSpaceIndex > SUMMARY_MAX_CHARS * 0.75 ? trimmed.slice(0, lastSpaceIndex) : trimmed;

  return `${compacted}...`;
}

export function NewsItemCard({ item, onItemStateChange }: NewsItemCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isRead = Boolean(item.readAt);
  const isSaved = Boolean(item.savedAt);
  const isArchived = Boolean(item.archivedAt);
  const hasLongSummary = item.summary.length > SUMMARY_MAX_CHARS;
  const previewSummary = compactSummary(item.summary);

  if (isArchived) {
    return null;
  }

  function toTimestamp(enabled: boolean, currentValue: string | null) {
    return enabled ? currentValue ?? new Date().toISOString() : null;
  }

  return (
    <Card className={cn(isRead && "bg-card/70")}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary" className="bg-accent text-accent-foreground">
            {item.category}
          </Badge>
          <span>{item.source}</span>
          <span>{formatDate(item.publishedAt)}</span>
          {item.importanceScore === null ? null : <Badge variant="outline">{item.importanceScore}</Badge>}
        </div>

        <CardTitle className="text-base leading-snug sm:text-lg">
          <Link className="hover:underline" href={`/news/${item.id}`}>
            {item.title}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <p className="text-sm leading-6 text-muted-foreground">
            {expanded || !hasLongSummary ? item.summary : previewSummary}
          </p>
          {hasLongSummary ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit px-0 text-primary hover:bg-transparent"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              {expanded ? "Show less" : "Show more"}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <NewsItemActions
            itemId={item.id}
            isRead={isRead}
            isSaved={isSaved}
            isArchived={isArchived}
            onStateChange={(state) =>
              onItemStateChange?.(item.id, {
                archivedAt: toTimestamp(state.archived, item.archivedAt),
                readAt: toTimestamp(state.read, item.readAt),
                savedAt: toTimestamp(state.saved, item.savedAt),
              })
            }
          />
          <a
            className={buttonVariants({ variant: "outline", size: "lg" })}
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink aria-hidden="true" />
            Source
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
