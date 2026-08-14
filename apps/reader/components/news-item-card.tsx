"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ExternalLink, Info, MoreHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NewsItemFeedbackActions } from "@/components/news-item-feedback-actions";
import { NewsItemActions } from "@/components/news-item-actions";
import { NewsNoteAction } from "@/components/news-note-action";
import { useLocalize, useReaderLocale } from "@/components/reader-locale-provider";
import type { NewsItemWithState } from "@/lib/news";
import type { RankedNewsItem } from "@/lib/reader-feed-ranking";
import type { FeedbackReason, FeedbackSentiment } from "@/lib/reader-feedback";
import { localeTag, type ReaderLocale } from "@/lib/reader-locale";
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

function formatDate(value: string | null, locale: ReaderLocale) {
  if (!value) {
    return locale === "en" ? "No publication date" : "Brak daty publikacji";
  }

  const includesTime = value.includes("T");
  const parts = new Intl.DateTimeFormat(localeTag(locale), {
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
  return includesTime ? `${date}, ${parts.hour}:${parts.minute}` : date;
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

function readerFriendlySummary(value: string) {
  return value.replace(/^View CSAF Summary\s*/i, "").trim();
}

function localizedCategory(value: string, locale: ReaderLocale) {
  if (locale === "pl") return value;

  return value
    .replaceAll("Bezpieczeństwo", "Security")
    .replaceAll("Geopolityka", "Geopolitics")
    .replaceAll("Gospodarka", "Economy")
    .replaceAll("Oprogramowanie", "Software")
    .replaceAll("Technologie", "Technology")
    .replaceAll("Obronność", "Defence")
    .replaceAll("Azja i Pacyfik", "Asia-Pacific")
    .replaceAll("Polska", "Poland")
    .replaceAll("Świat", "World")
    .replaceAll("Biznes", "Business")
    .replaceAll("Makro", "Macro");
}

export function NewsItemCard({
  density = "comfortable",
  item,
  onFastRead,
  onFeedbackChange,
  onItemStateChange,
  onSourceOpen,
}: NewsItemCardProps) {
  const locale = useReaderLocale();
  const l = useLocalize();
  const [expanded, setExpanded] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [noteCount, setNoteCount] = useState(item.noteCount);
  const isRead = Boolean(item.readAt);
  const isSaved = Boolean(item.savedAt);
  const hasPreview = Boolean(item.preview);
  const cleanSummary = readerFriendlySummary(item.summary);
  const hasLongSummary = !hasPreview && cleanSummary.length > SUMMARY_MAX_CHARS;
  const previewSummary = compactSummary(cleanSummary);
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
        "overflow-visible rounded-none bg-transparent py-0 shadow-none ring-0 transition-colors md:rounded-xl md:bg-card md:shadow-sm md:ring-foreground/8 md:hover:ring-foreground/15",
        isRead && "opacity-70 md:bg-card/60",
      )}
    >
      <CardHeader className="gap-2 px-4 pb-1 pt-4 md:px-4 md:pt-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="ghost" className="h-auto px-0 py-0 font-semibold text-primary">
              {localizedCategory(item.category, locale)}
            </Badge>
            {rankedItem?.isNew ? <Badge>{l("Nowy", "New")}</Badge> : null}
            {rankedItem?.isUpdated ? <Badge variant="secondary">{l("Aktualizacja", "Updated")}</Badge> : null}
            <span className="truncate">{item.source}</span>
            <span aria-hidden="true">·</span>
            <span>{formatDate(item.publishedAt, locale)}</span>
            {item.sourceCount > 1 ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.sourceCount} {l("źródeł", "sources")}</span>
              </>
            ) : null}
          </div>
          <Link
            className={cn(buttonVariants({ variant: "ghost", size: "icon-lg" }), "shrink-0 text-primary md:w-auto md:bg-primary md:px-3 md:text-primary-foreground md:shadow-sm")}
            href={`/news/${item.id}`}
            onClick={onFastRead}
            aria-label={l(`Otwórz: ${item.title}`, `Open: ${item.title}`)}
          >
            <ChevronRight className="size-6 md:size-4" aria-hidden="true" />
            <span className="hidden md:inline">{l("Czytaj", "Read")}</span>
          </Link>
        </div>

        <CardTitle className={cn("line-clamp-3 text-[1.02rem] font-semibold leading-snug md:line-clamp-none", compact && "sm:text-[1.05rem]")}>
          <Link
            className="decoration-foreground/30 hover:text-primary hover:underline"
            href={`/news/${item.id}`}
            onClick={onFastRead}
          >
            {item.title}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 px-4 pb-4 md:px-4 md:pb-3.5">
        <div className="grid gap-2">
          <p className="text-sm leading-5 text-muted-foreground">
            {item.preview?.whyItMatters ? <span className="font-semibold text-foreground/75">{l("Dlaczego ważne: ", "Why it matters: ")}</span> : null}
            <span className={cn(!expanded && "line-clamp-3 md:line-clamp-none")}>
              {item.preview?.whyItMatters || (expanded || !hasLongSummary ? cleanSummary : previewSummary)}
            </span>
            {hasLongSummary ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="ml-1 h-6 px-1.5 align-middle text-primary hover:bg-muted"
                title={expanded ? l("Pokaż mniej", "Show less") : l("Pokaż więcej", "Show more")}
                aria-label={expanded ? l("Pokaż mniej", "Show less") : l("Pokaż więcej", "Show more")}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? l("Mniej", "Less") : l("Więcej", "More")}
              </Button>
            ) : null}
          </p>
          {hasExplanation ? (
            whyOpen ? (
              <div className="grid gap-1 rounded-lg border bg-muted/25 p-2.5 text-xs leading-5 text-muted-foreground">
                {rankedItem?.rankingReasons.map((reason) => <p key={reason}>{reason}</p>)}
                {item.whyInteresting ? <p>{item.whyInteresting}</p> : null}
                {item.recommendedAction ? <p className="font-medium text-foreground/80">{item.recommendedAction}</p> : null}
                {item.changedFields.length ? <p>{l("Zmiany", "Changed")}: {item.changedFields.join(", ")}.</p> : null}
              </div>
            ) : null
          ) : null}
        </div>

        <div className="hidden min-w-0 flex-wrap items-center justify-between gap-2 border-t pt-2.5 md:flex">
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
                {l("Dlaczego", "Why")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn("h-8 px-2 text-xs text-muted-foreground", actionsOpen && "bg-muted text-foreground")}
              title={l("Więcej akcji", "More actions")}
              aria-label={l("Więcej akcji", "More actions")}
              aria-expanded={actionsOpen}
              onClick={() => setActionsOpen((value) => !value)}
            >
              <MoreHorizontal aria-hidden="true" />
              {l("Akcje", "Actions")}
            </Button>
          </div>
        </div>

        {actionsOpen ? (
          <div className="hidden flex-wrap items-center gap-1.5 rounded-lg bg-muted/30 p-2 duration-200 animate-in fade-in slide-in-from-top-1 md:flex">
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
              title={l("Otwórz źródło", "Open source")}
              aria-label={l("Otwórz źródło", "Open source")}
            >
              <ExternalLink aria-hidden="true" />
            </a>
            <span className="ml-1 text-xs text-muted-foreground">{l("Czytaj · Zapisz · Notatka · Źródło", "Read · Save · Note · Source")}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
