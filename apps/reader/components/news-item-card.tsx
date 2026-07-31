"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpenText, ExternalLink, Info, MoreHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewsItemFeedbackActions } from "@/components/news-item-feedback-actions";
import { NewsItemActions } from "@/components/news-item-actions";
import { NewsNoteAction } from "@/components/news-note-action";
import { NewsPreviewCard } from "@/components/news-preview-card";
import type { NewsItemWithState } from "@/lib/news";
import type { RankedNewsItem } from "@/lib/reader-feed-ranking";
import type { FeedbackReason, FeedbackSentiment } from "@/lib/reader-feedback";
import { cn } from "@/lib/utils";

const SUMMARY_MAX_CHARS = 260;
const DISPLAY_TIME_ZONE = "Europe/Warsaw";

type NewsItemCardProps = {
  density?: "comfortable" | "compact";
  item: NewsItemWithState | RankedNewsItem;
  onFastRead?: () => void;
  onFeedbackChange?: (itemId: string, feedback: FeedbackSentiment | null, reason: FeedbackReason | null) => void;
  onItemStateChange?: (
    itemId: string,
    state: Pick<NewsItemWithState, "archivedAt" | "readAt" | "savedAt">,
  ) => void;
  onSourceOpen?: () => void;
};

function formatDate(value: string | null) {
  if (!value) {
    return "No publication date";
  }

  const includesTime = value.includes("T");
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: includesTime ? "2-digit" : undefined,
    minute: includesTime ? "2-digit" : undefined,
    timeZone: DISPLAY_TIME_ZONE,
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((accumulator, part) => {
      accumulator[part.type] = part.value;
      return accumulator;
    }, {});

  const date = `${parts.month} ${parts.day}`;
  return includesTime ? `${date}, ${parts.hour}:${parts.minute} ${parts.dayPeriod}` : date;
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

export function NewsItemCard({
  density = "comfortable",
  item,
  onFastRead,
  onFeedbackChange,
  onItemStateChange,
  onSourceOpen,
}: NewsItemCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [noteCount, setNoteCount] = useState(item.noteCount);
  const isRead = Boolean(item.readAt);
  const isSaved = Boolean(item.savedAt);
  const hasPreview = Boolean(item.preview);
  const hasLongSummary = !hasPreview && item.summary.length > SUMMARY_MAX_CHARS;
  const previewSummary = compactSummary(item.summary);
  const compact = density === "compact";
  const rankedItem = "rankingReasons" in item ? item : null;
  const hasExplanation = Boolean(
    rankedItem?.rankingReasons.length
      || item.whyInteresting
      || item.recommendedAction
      || item.changedFields.length,
  );

  function toTimestamp(enabled: boolean, currentValue: string | null) {
    return enabled ? currentValue ?? new Date().toISOString() : null;
  }

  function handleItemStateChange(state: { read: boolean; saved: boolean }) {
    onItemStateChange?.(item.id, {
      archivedAt: item.archivedAt,
      readAt: toTimestamp(state.read, item.readAt),
      savedAt: toTimestamp(state.saved, item.savedAt),
    });
  }

  return (
    <Card
      size="sm"
      className={cn(
        "overflow-visible py-0 shadow-sm ring-foreground/8 transition-colors hover:ring-foreground/15",
        isRead && "bg-card/60",
      )}
    >
      <CardHeader className="gap-2 px-3.5 pb-1 pt-3.5 sm:px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="secondary" className="bg-accent text-accent-foreground">
              {item.category}
            </Badge>
            {rankedItem?.isNew ? <Badge>New</Badge> : null}
            {rankedItem?.isUpdated ? <Badge variant="secondary">Updated</Badge> : null}
            <span className="truncate">{item.source}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDate(item.publishedAt)}</span>
            {item.sourceCount > 1 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.sourceCount} sources</span>
              </>
            ) : null}
          </div>
          <Link
            className={cn(buttonVariants({ variant: "default", size: "sm" }), "shrink-0 shadow-sm")}
            href={`/news/${item.id}`}
            onClick={onFastRead}
          >
            <BookOpenText aria-hidden="true" />
            <span className="hidden min-[420px]:inline">Fast read</span>
            <span className="min-[420px]:hidden">Read</span>
          </Link>
        </div>

        <CardTitle className={cn("text-[1.02rem] font-semibold leading-snug", compact && "sm:text-[1.05rem]")}>
          <a
            className="decoration-foreground/30 hover:underline"
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
            onClick={onSourceOpen}
          >
            {item.title}
          </a>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 px-3.5 pb-3.5 sm:px-4">
        <div className="grid gap-2">
          <NewsPreviewCard
            preview={item.preview}
            summary={expanded || !hasLongSummary ? item.summary : previewSummary}
            summaryAction={
              hasLongSummary ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-6 px-1.5 text-primary hover:bg-muted"
                  title={expanded ? "Show less" : "Show more"}
                  aria-label={expanded ? "Show less" : "Show more"}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? "Less" : "More"}
                </Button>
              ) : null
            }
          />
          {hasExplanation ? (
            whyOpen ? (
              <div className="grid gap-1 rounded-lg border bg-muted/25 p-2.5 text-xs leading-5 text-muted-foreground">
                {rankedItem?.rankingReasons.map((reason) => <p key={reason}>{reason}</p>)}
                {item.whyInteresting ? <p>{item.whyInteresting}</p> : null}
                {item.recommendedAction ? <p className="font-medium text-foreground/80">{item.recommendedAction}</p> : null}
                {item.changedFields.length ? <p>Changed: {item.changedFields.join(", ")}.</p> : null}
              </div>
            ) : null
          ) : null}
        </div>

        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t pt-2.5">
          <NewsItemFeedbackActions
            buttonSize="sm"
            buttonClassName="h-8 border-transparent bg-muted/55 px-2.5 hover:bg-muted focus-visible:border-transparent"
            itemId={item.id}
            feedback={item.feedback}
            feedbackReason={item.feedbackReason}
            showLabels
            onFeedbackChange={(feedback, reason) => onFeedbackChange?.(item.id, feedback, reason)}
          />

          <div className="ml-auto flex items-center gap-1">
            {hasExplanation ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground"
                aria-expanded={whyOpen}
                onClick={() => setWhyOpen((value) => !value)}
              >
                <Info aria-hidden="true" />
                Why
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn("h-8 px-2 text-xs text-muted-foreground", actionsOpen && "bg-muted text-foreground")}
              title="More actions"
              aria-label="More actions"
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((value) => !value)}
            >
              <MoreHorizontal aria-hidden="true" />
              Actions
            </Button>
          </div>
        </div>

        {actionsOpen ? (
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-muted/30 p-2 duration-200 animate-in fade-in slide-in-from-top-1">
            <NewsItemActions
              buttonSize="icon-sm"
              buttonClassName="border-transparent bg-background/80 hover:bg-muted focus-visible:border-transparent focus-visible:ring-0"
              itemId={item.id}
              isRead={isRead}
              isSaved={isSaved}
              onStateChange={handleItemStateChange}
            />
            <NewsNoteAction
              buttonSize="icon-sm"
              buttonClassName="border-transparent bg-background/80 hover:bg-muted focus-visible:border-transparent focus-visible:ring-0"
              initialCount={noteCount}
              itemId={item.id}
              onCreated={() => setNoteCount((value) => value + 1)}
            />
            <a
              className={buttonVariants({
                variant: "outline",
                size: "icon-sm",
                className: "border-transparent bg-background/80 hover:bg-muted focus-visible:border-transparent focus-visible:ring-0",
              })}
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              onClick={onSourceOpen}
              title="Open source"
              aria-label="Open source"
            >
              <ExternalLink aria-hidden="true" />
            </a>
            <span className="ml-1 text-xs text-muted-foreground">Read · Save · Note · Source</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
