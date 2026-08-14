"use client";

import { CheckCheck, EyeOff, Inbox, Loader2, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { NewsFeedSection } from "@/components/news-feed-section";
import { useLocalize } from "@/components/reader-locale-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { READER_FEEDS, type ReaderFeedId } from "@/lib/feed-categories";
import type { ReaderFeedPage } from "@/lib/reader-feed";
import { FEED_PERIODS, FEED_SORTS, type FeedPeriod, type FeedSort, type RankedNewsItem } from "@/lib/reader-feed-ranking";
import { READER_VIEWS, type ReaderViewId } from "@/lib/reader-feed-filters";
import type { FeedbackReason, FeedbackSentiment } from "@/lib/reader-feedback";
import { cn } from "@/lib/utils";

type NewsFeedProps = {
  initialFeed: ReaderFeedId;
  initialPage: ReaderFeedPage;
  initialPeriod: FeedPeriod;
  initialSort: FeedSort;
  initialView: ReaderViewId;
};

type FeedSelection = {
  feed: ReaderFeedId;
  period: FeedPeriod;
  sort: FeedSort;
  view: ReaderViewId;
};

const SORT_LABELS: Record<FeedSort, readonly [string, string]> = {
  "for-you": ["Dla Ciebie", "For you"],
  latest: ["Najnowsze", "Latest"],
  top: ["Najważniejsze", "Top"],
};

const PERIOD_LABELS: Record<FeedPeriod, readonly [string, string]> = {
  history: ["Historia", "History"],
  latest: ["Ostatni digest", "Latest digest"],
  "since-visit": ["Od ostatniej wizyty", "Since last visit"],
};

const FEED_LABELS: Record<ReaderFeedId, readonly [string, string]> = {
  all: ["Wszystkie", "All"],
  geopolitics: ["Geopolityka", "Geopolitics"],
  business: ["Biznes", "Business"],
  ai: ["AI", "AI"],
  software: ["Oprogramowanie", "Software"],
  security: ["Bezpieczeństwo", "Security"],
};

const VIEW_LABELS: Record<ReaderViewId, readonly [string, string]> = {
  all: ["Wszystkie", "All"],
  unread: ["Nieprzeczytane", "Unread"],
  saved: ["Zapisane", "Saved"],
  archived: ["Archiwum", "Archive"],
};

const VISIBLE_READER_VIEWS = READER_VIEWS.filter((view) => view.id !== "archived");

function pageItems(page: ReaderFeedPage) {
  return [page.grouped.top, page.grouped.actionable, page.grouped.worthKnowing, page.grouped.more].flat();
}

function sourceAttributionMetadata(item: RankedNewsItem) {
  const source = item.sourceVariants.find((variant) => variant.url === item.sourceUrl) || item.sourceVariants[0];
  return {
    readerSourceId: source?.readerSourceId ?? null,
    sourceUrl: source?.sourceFeedUrl ?? item.sourceUrl,
  };
}

async function apiBatchRead(itemIds: string[]) {
  return fetch("/api/news-items/state", {
    body: JSON.stringify({ action: "read", enabled: true, itemIds }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

function sendEvents(events: Array<Record<string, unknown>>) {
  if (!events.length) return Promise.resolve();
  return fetch("/api/feed-events", {
    body: JSON.stringify({ events }),
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST",
  }).then(() => undefined).catch(() => undefined);
}

export function NewsFeed({
  initialFeed,
  initialPage,
  initialPeriod,
  initialSort,
  initialView,
}: NewsFeedProps) {
  const l = useLocalize();
  const [selection, setSelection] = useState<FeedSelection>({
    feed: initialFeed,
    period: initialPeriod,
    sort: initialSort,
    view: initialView,
  });
  const [page, setPage] = useState(initialPage);
  const [isLoading, setIsLoading] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const exposedRecommendationsRef = useRef<Set<string>>(new Set());
  const didRecordVisitRef = useRef(false);
  const items = useMemo(() => pageItems(page), [page]);
  const visibleUnreadItems = items.filter((item) => !item.readAt && !item.archivedAt);

  useEffect(() => {
    sessionIdRef.current ||= crypto.randomUUID();
    if (!didRecordVisitRef.current) {
      didRecordVisitRef.current = true;
      void fetch("/api/reader/visit", { method: "POST" });
    }
    return () => abortRef.current?.abort();
  }, []);

  function writeUrl(next: FeedSelection) {
    const params = new URLSearchParams();
    if (next.feed !== "all") params.set("feed", next.feed);
    if (next.view !== "all") params.set("view", next.view);
    if (next.sort !== "for-you") params.set("sort", next.sort);
    if (next.period !== "latest") params.set("period", next.period);
    const query = params.toString();
    window.history.replaceState(null, "", query ? `/news?${query}` : "/news");
  }

  async function loadFeed(next: FeedSelection, cursor: string | null = null, append = false) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setIsLoading(true);

    try {
      const params = new URLSearchParams({
        feed: next.feed,
        period: next.period,
        sort: next.sort,
        view: next.view,
      });
      if (cursor) params.set("cursor", cursor);
      if (cursor) params.set("rankedAt", page.rankedAt);
      if (cursor) params.set("rankingContextId", page.rankingContextId);
      if (initialPage.previousVisitAt) params.set("since", initialPage.previousVisitAt);
      const response = await fetch(`/api/news-feed?${params}`, { signal: controller.signal });
      const payload = (await response.json().catch(() => null)) as ReaderFeedPage & { error?: string };
      if (!response.ok || !payload?.grouped) throw new Error(payload?.error || l("Nie udało się wczytać feedu.", "Could not load the feed."));

      if (append) {
        const appendedItems = pageItems(payload);
        setPage((current) => ({
          ...payload,
          grouped: { ...current.grouped, more: [...current.grouped.more, ...appendedItems] },
        }));
        setMoreExpanded(true);
      } else {
        setPage(payload);
        setSelection(next);
        writeUrl(next);
        setMoreExpanded(false);
      }
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : l("Nie udało się wczytać feedu.", "Could not load the feed."));
    } finally {
      if (abortRef.current === controller) setIsLoading(false);
    }
  }

  function changeSelection(patch: Partial<FeedSelection>) {
    const next = { ...selection, ...patch };
    void loadFeed(next);
  }

  function updateItem(itemId: string, updater: (item: RankedNewsItem) => RankedNewsItem) {
    setPage((current) => ({
      ...current,
      grouped: Object.fromEntries(
        Object.entries(current.grouped).map(([key, group]) => [
          key,
          group.map((item) => (item.id === itemId ? updater(item) : item)),
        ]),
      ) as ReaderFeedPage["grouped"],
    }));
  }

  function trackInteraction(
    eventType: string,
    item: RankedNewsItem,
    rank: number,
    metadata?: Record<string, unknown>,
    interactionOrigin: "direct" | "bulk" | "automatic" = "direct",
  ) {
    if (!sessionIdRef.current) return;
    void sendEvents([{
      eventType,
      feed: page.selection.feed,
      interactionOrigin,
      isExploration: item.isExploration,
      metadata,
      modelRank: item.modelRank,
      newsItemId: item.id,
      policyVersion: item.policyVersion,
      rank,
      rankingContextId: page.rankingContextId,
      rankScore: item.rankScore,
      recommendationReasons: item.rankingReasons,
      scoreComponents: item.rankingScoreComponents,
      sessionId: sessionIdRef.current,
      sortMode: page.selection.sort,
      storyClusterId: item.storyClusterId,
    }]);
  }

  function trackExposure(item: RankedNewsItem, rank: number) {
    if (!item.storyClusterId) return;
    const key = `${page.rankingContextId}:${item.storyClusterId}`;
    if (exposedRecommendationsRef.current.has(key)) return;
    exposedRecommendationsRef.current.add(key);
    trackInteraction("impression", item, rank);
  }

  function updateItemState(
    itemId: string,
    state: Pick<RankedNewsItem, "archivedAt" | "readAt" | "savedAt">,
  ) {
    const previous = items.find((item) => item.id === itemId);
    updateItem(itemId, (item) => ({ ...item, ...state }));
    if (!previous || !sessionIdRef.current) return;
    const eventType = !previous.savedAt && state.savedAt
      ? "save"
      : !previous.readAt && state.readAt
        ? "read"
        : !previous.archivedAt && state.archivedAt
          ? "archive"
          : null;
    if (eventType) trackInteraction(eventType, previous, items.indexOf(previous));
  }

  function updateFeedback(
    itemId: string,
    feedback: FeedbackSentiment | null,
    reason: FeedbackReason | null,
  ) {
    const previous = items.find((item) => item.id === itemId);
    updateItem(itemId, (item) => ({ ...item, feedback, feedbackReason: reason }));
    if (previous) {
      trackInteraction("feedback", previous, items.indexOf(previous), {
        feedback,
        reason,
        ...(reason === "source" ? sourceAttributionMetadata(previous) : {}),
      });
    }
  }

  async function markVisibleAsRead() {
    if (isMarkingRead || !visibleUnreadItems.length) return;
    const previousPage = page;
    const readAt = new Date().toISOString();
    setIsMarkingRead(true);
    setError(null);
    for (const item of visibleUnreadItems) updateItem(item.id, (current) => ({ ...current, readAt }));

    try {
      const response = await apiBatchRead(visibleUnreadItems.map((item) => item.id));
      const payload = (await response.json().catch(() => null)) as { error?: string; ok?: boolean } | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || l("Nie udało się oznaczyć materiałów jako przeczytane.", "Could not mark stories as read."));
      visibleUnreadItems.forEach((item) => trackInteraction("read", item, items.indexOf(item), undefined, "bulk"));
    } catch (markError) {
      setPage(previousPage);
      setError(markError instanceof Error ? markError.message : l("Nie udało się oznaczyć materiałów jako przeczytane.", "Could not mark stories as read."));
    } finally {
      setIsMarkingRead(false);
    }
  }

  const moreItems = moreExpanded ? page.grouped.more : [];
  const actionableOffset = page.grouped.top.length;
  const worthOffset = actionableOffset + page.grouped.actionable.length;
  const moreOffset = worthOffset + page.grouped.worthKnowing.length;

  return (
    <>
      <section className="sticky top-14 z-40 -mx-4 grid gap-3 border-y bg-background/96 p-3 backdrop-blur-xl md:static md:mx-0 md:rounded-2xl md:border md:bg-card/75 md:p-4 md:shadow-sm" aria-label={l("Sterowanie listą newsów", "News feed controls")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="hidden size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground md:flex">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{l("Twój feed", "Your feed")}</h2>
              <p className="text-xs text-muted-foreground">{l(`${items.length} materiałów w tym widoku`, `${items.length} stories in this view`)}</p>
            </div>
          </div>
          <Button
            type="button"
            variant={filtersOpen ? "secondary" : "outline"}
            size="lg"
            className="md:hidden"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {l("Filtry", "Filters")}
          </Button>
          <div className="hidden flex-wrap items-center gap-1.5 md:flex">
            <Button type="button" variant={selection.view === "unread" ? "secondary" : "outline"} size="sm" onClick={() => changeSelection({ view: selection.view === "unread" ? "all" : "unread" })}>
              <EyeOff aria-hidden="true" /> {selection.view === "unread" ? l("Tylko nieprzeczytane", "Unread only") : l("Ukryj przeczytane", "Hide read")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isMarkingRead || !visibleUnreadItems.length} onClick={() => void markVisibleAsRead()}>
              {isMarkingRead ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCheck aria-hidden="true" />} {l("Oznacz przeczytane", "Mark as read")}
            </Button>
          </div>
        </div>

        <div className={cn(filtersOpen ? "grid" : "hidden", "gap-3 md:grid")}>
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted/35 p-1" aria-label={l("Sortowanie newsów", "News sorting")}>
            {FEED_SORTS.map((sort) => (
              <Button key={sort} type="button" size="sm" variant={selection.sort === sort ? "default" : "ghost"} onClick={() => changeSelection({ sort })}>
                {l(SORT_LABELS[sort][0], SORT_LABELS[sort][1])}
              </Button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            {l("Kategoria", "Category")}
            <select
              className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm font-medium text-foreground outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/25"
              value={selection.feed}
              onChange={(event) => changeSelection({ feed: event.target.value as ReaderFeedId })}
            >
              {READER_FEEDS.map((feed) => (
                <option key={feed.id} value={feed.id}>{l(FEED_LABELS[feed.id][0], FEED_LABELS[feed.id][1])} ({page.feedCounts[feed.id] || 0})</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            {l("Status", "Status")}
            <select
              className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm font-medium text-foreground outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/25"
              value={selection.view}
              onChange={(event) => changeSelection({ view: event.target.value as ReaderViewId })}
            >
              {VISIBLE_READER_VIEWS.map((view) => (
                <option key={view.id} value={view.id}>{l(VIEW_LABELS[view.id][0], VIEW_LABELS[view.id][1])} ({page.viewCounts[view.id] || 0})</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            {l("Okres", "Period")}
            <select
              className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm font-medium text-foreground outline-none transition focus:border-ring focus:ring-3 focus:ring-ring/25"
              value={selection.period}
              onChange={(event) => changeSelection({ period: event.target.value as FeedPeriod })}
            >
              {FEED_PERIODS.map((period) => (
                <option key={period} value={period}>{l(PERIOD_LABELS[period][0], PERIOD_LABELS[period][1])}</option>
              ))}
            </select>
          </label>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 md:hidden">
            <Button type="button" variant={selection.view === "unread" ? "secondary" : "outline"} size="sm" onClick={() => changeSelection({ view: selection.view === "unread" ? "all" : "unread" })}>
              <EyeOff aria-hidden="true" /> {selection.view === "unread" ? l("Tylko nieprzeczytane", "Unread only") : l("Ukryj przeczytane", "Hide read")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={isMarkingRead || !visibleUnreadItems.length} onClick={() => void markVisibleAsRead()}>
              {isMarkingRead ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCheck aria-hidden="true" />} {l("Oznacz przeczytane", "Mark as read")}
            </Button>
          </div>
        </div>

        {isLoading || error ? (
          <div>
            {isLoading ? <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status"><Loader2 className="size-3 animate-spin" aria-hidden="true" />{l("Aktualizuję feed…", "Updating feed…")}</span> : null}
            {error ? <span className="text-xs text-destructive" role="alert">{error}</span> : null}
          </div>
        ) : null}
      </section>

      <div className={cn("grid gap-4 transition-opacity", isLoading && "pointer-events-none opacity-60")}>
        {items.length ? (
          <>
            <NewsFeedSection exposureContextId={page.rankingContextId} label={l("Najważniejsze", "Top stories")} items={page.grouped.top} rankOffset={0} onExposure={trackExposure} onFeedbackChange={updateFeedback} onItemStateChange={updateItemState} onFastRead={(item, rank) => trackInteraction("fast_read", item, rank)} onSourceOpen={(item, rank) => trackInteraction("source_open", item, rank, sourceAttributionMetadata(item))} />
            <NewsFeedSection exposureContextId={page.rankingContextId} label={l("Do działania", "Actionable")} items={page.grouped.actionable} rankOffset={actionableOffset} onExposure={trackExposure} onFeedbackChange={updateFeedback} onItemStateChange={updateItemState} onFastRead={(item, rank) => trackInteraction("fast_read", item, rank)} onSourceOpen={(item, rank) => trackInteraction("source_open", item, rank, sourceAttributionMetadata(item))} />
            <NewsFeedSection exposureContextId={page.rankingContextId} label={l("Warto wiedzieć", "Worth knowing")} items={page.grouped.worthKnowing} rankOffset={worthOffset} onExposure={trackExposure} onFeedbackChange={updateFeedback} onItemStateChange={updateItemState} onFastRead={(item, rank) => trackInteraction("fast_read", item, rank)} onSourceOpen={(item, rank) => trackInteraction("source_open", item, rank, sourceAttributionMetadata(item))} />
            {page.grouped.more.length ? (
              <section className="grid gap-2">
                <Button type="button" variant="outline" onClick={() => setMoreExpanded((value) => !value)}>{moreExpanded ? l("Ukryj pozostałe", "Hide remaining") : l(`Pokaż jeszcze ${page.grouped.more.length}`, `Show ${page.grouped.more.length} more`)}</Button>
                <NewsFeedSection exposureContextId={page.rankingContextId} label={l("Pozostałe", "More")} items={moreItems} rankOffset={moreOffset} onExposure={trackExposure} onFeedbackChange={updateFeedback} onItemStateChange={updateItemState} onFastRead={(item, rank) => trackInteraction("fast_read", item, rank)} onSourceOpen={(item, rank) => trackInteraction("source_open", item, rank, sourceAttributionMetadata(item))} />
              </section>
            ) : null}
            {page.nextCursor ? <Button type="button" variant="outline" disabled={isLoading} onClick={() => void loadFeed(selection, page.nextCursor, true)}>{l("Wczytaj więcej", "Load more")}</Button> : null}
          </>
        ) : (
          <Card><CardContent className="flex items-center gap-3 text-muted-foreground"><Inbox className="size-5" aria-hidden="true" /><p className="text-sm">{l("Brak materiałów pasujących do tego widoku.", "No stories match this view.")}</p></CardContent></Card>
        )}
      </div>
    </>
  );
}
