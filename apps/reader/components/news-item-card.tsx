"use client";

import { useState } from "react";
import Link from "next/link";
import { BookOpenText, ChevronDown, ChevronUp, ExternalLink, Info, MoreHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewsItemFeedbackActions } from "@/components/news-item-feedback-actions";
import { NewsItemActions } from "@/components/news-item-actions";
import { NewsNoteAction } from "@/components/news-note-action";
import { NewsPreviewCard } from "@/components/news-preview-card";
import type { NewsItemWithState } from "@/lib/news";
import { formatPracticalBucket } from "@/lib/news-display";
import { priorityLabel, type RankedNewsItem } from "@/lib/reader-feed-ranking";
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
  const isArchived = Boolean(item.archivedAt);
  const hasPreview = Boolean(item.preview);
  const hasLongSummary = !hasPreview && item.summary.length > SUMMARY_MAX_CHARS;
  const previewSummary = compactSummary(item.summary);
  const compact = density === "compact";
  const rankedItem = "rankingReasons" in item ? item : null;

  function toTimestamp(enabled: boolean, currentValue: string | null) {
    return enabled ? currentValue ?? new Date().toISOString() : null;
  }

  function handleItemStateChange(state: { archived: boolean; read: boolean; saved: boolean }) {
    onItemStateChange?.(item.id, {
      archivedAt: toTimestamp(state.archived, item.archivedAt),
      readAt: toTimestamp(state.read, item.readAt),
      savedAt: toTimestamp(state.saved, item.savedAt),
    });
  }

  return (
    <Card size="sm" className={cn("[--card-spacing:--spacing(1)] transition-colors", isRead && "bg-card/70")}>
      <CardHeader className="gap-1 px-3 py-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary" className="bg-accent text-accent-foreground">
              {item.category}
            </Badge>
            {item.practicalBucket ? <Badge variant="outline">{formatPracticalBucket(item.practicalBucket)}</Badge> : null}
            <span>{item.source}</span>
            <span>{formatDate(item.publishedAt)}</span>
            <Badge variant="outline">{priorityLabel(item.editorialScore)}</Badge>
            {item.sourceCount > 1 ? <Badge variant="outline">{item.sourceCount} sources</Badge> : null}
            {rankedItem?.isNew ? <Badge>New</Badge> : null}
            {rankedItem?.isUpdated ? <Badge variant="secondary">Updated</Badge> : null}
          </div>
          <Link className={cn(buttonVariants({ variant: "default", size: "sm" }), "shrink-0")} href={`/news/${item.id}`} onClick={onFastRead}>
            <BookOpenText aria-hidden="true" />
            <span className="hidden min-[420px]:inline">Fast read</span>
            <span className="min-[420px]:hidden">Read</span>
          </Link>
        </div>

        <CardTitle className={cn("text-base leading-tight", compact && "text-[0.95rem] sm:text-base")}>
          <a className="hover:underline" href={item.sourceUrl} target="_blank" rel="noreferrer" onClick={onSourceOpen}>
            {item.title}
          </a>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1.5 px-3 pb-1">
        <div className="grid gap-1.5">
          <NewsPreviewCard
            compact={compact}
            preview={item.preview}
            summary={expanded || !hasLongSummary ? item.summary : previewSummary}
            summaryAction={
              hasLongSummary ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="text-primary hover:bg-muted"
                  title={expanded ? "Show less" : "Show more"}
                  aria-label={expanded ? "Show less" : "Show more"}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                </Button>
              ) : null
            }
          />
          {!hasPreview && (item.whyInteresting || item.recommendedAction) ? (
            <div className="grid gap-0.5 text-xs leading-5 text-muted-foreground">
              {item.whyInteresting ? <p>{item.whyInteresting}</p> : null}
              {item.recommendedAction ? <p>{item.recommendedAction}</p> : null}
            </div>
          ) : null}
          {(rankedItem?.rankingReasons.length || item.whyInteresting || Object.keys(item.scoreComponents).length) ? (
            <div className="grid gap-1">
              <Button type="button" variant="ghost" size="sm" className="h-7 w-fit px-1.5 text-xs text-muted-foreground" aria-expanded={whyOpen} onClick={() => setWhyOpen((value) => !value)}>
                <Info aria-hidden="true" /> Why this story?
              </Button>
              {whyOpen ? (
                <div className="grid gap-1 rounded-md bg-muted/25 p-2 text-xs leading-5 text-muted-foreground">
                  {rankedItem?.rankingReasons.map((reason) => <p key={reason}>{reason}</p>)}
                  {item.whyInteresting ? <p>{item.whyInteresting}</p> : null}
                  {item.changedFields.length ? <p>Changed: {item.changedFields.join(", ")}.</p> : null}
                  {Object.keys(item.scoreComponents).length ? <p>Editorial score: {Math.round(item.editorialScore)}.</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            {actionsOpen ? (
              <div className="flex min-w-0 items-center gap-1.5 overflow-visible rounded-lg duration-300 ease-out animate-in fade-in slide-in-from-right-4">
                <NewsItemFeedbackActions
                  buttonSize="icon-sm"
                  buttonClassName="border-transparent bg-muted/40 hover:bg-muted focus-visible:border-transparent focus-visible:ring-0"
                  itemId={item.id}
                  feedback={item.feedback}
                  feedbackReason={item.feedbackReason}
                  onFeedbackChange={(feedback, reason) => onFeedbackChange?.(item.id, feedback, reason)}
                />
                <NewsItemActions
                  buttonSize="icon-sm"
                  buttonClassName="border-transparent bg-muted/40 hover:bg-muted focus-visible:border-transparent focus-visible:ring-0"
                  itemId={item.id}
                  isRead={isRead}
                  isSaved={isSaved}
                  isArchived={isArchived}
                  onStateChange={handleItemStateChange}
                />
                <NewsNoteAction
                  buttonSize="icon-sm"
                  buttonClassName="border-transparent bg-muted/40 hover:bg-muted focus-visible:border-transparent focus-visible:ring-0"
                  initialCount={noteCount}
                  itemId={item.id}
                  onCreated={() => setNoteCount((value) => value + 1)}
                />
                <a
                  className={buttonVariants({
                    variant: "outline",
                    size: "icon-sm",
                    className: "border-transparent bg-muted/40 hover:bg-muted focus-visible:border-transparent focus-visible:ring-0",
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
              </div>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(
                "bg-transparent hover:bg-muted/50 focus-visible:border-transparent focus-visible:ring-0",
                actionsOpen && "bg-transparent text-primary",
              )}
              title="More actions"
              aria-label="More actions"
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((value) => !value)}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
