"use client";

import { CheckCheck, ChevronDown, EyeOff, Inbox, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { NewsFeedSection } from "@/components/news-feed-section";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { READER_FEEDS, type ReaderFeedId } from "@/lib/feed-categories";
import type { ReaderFeedPage } from "@/lib/reader-feed";
import { FEED_PERIODS, FEED_SORTS, type FeedPeriod, type FeedSort, type RankedNewsItem } from "@/lib/reader-feed-ranking";
import { READER_VIEWS, type ReaderViewId } from "@/lib/reader-feed-filters";
import type { FeedbackReason, FeedbackSentiment } from "@/lib/reader-feedback";
import { cn } from "@/lib/utils";

type NewsFeedProps = {
  briefingSlot?: ReactNode;
  digestSlot: ReactNode;
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

const SORT_LABELS: Record<FeedSort, string> = {
  "for-you": "For you",
  latest: "Latest",
  top: "Top",
};

const PERIOD_LABELS: Record<FeedPeriod, string> = {
  history: "History",
  latest: "Latest digest",
  "since-visit": "Since last visit",
};

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
  briefingSlot,
  digestSlot,
  initialFeed,
  initialPage,
  initialPeriod,
  initialSort,
  initialView,
}: NewsFeedProps) {
  const [selection, setSelection] = useState<FeedSelection>({
    feed: initialFeed,
    period: initialPeriod,
    sort: initialSort,
    view: initialView,
  });
  const [page, setPage] = useState(initialPage);
  const [openFilter, setOpenFilter] = useState<"feed" | "view" | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [moreExpanded, setMoreExpanded] = useState(false);
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
    window.history.replaceState(null, "", query ? `/?${query}` : "/");
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
      if (!response.ok || !payload?.grouped) throw new Error(payload?.error || "Could not load the feed.");

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
      setError(loadError instanceof Error ? loadError.message : "Could not load the feed.");
    } finally {
      if (abortRef.current === controller) setIsLoading(false);
    }
  }

  function changeSelection(patch: Partial<FeedSelection>) {
    const next = { ...selection, ...patch };
    setOpenFilter(null);
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
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not mark items read.");
      visibleUnreadItems.forEach((item) => trackInteraction("read", item, items.indexOf(item), undefined, "bulk"));
    } catch (markError) {
      setPage(previousPage);
      setError(markError instanceof Error ? markError.message : "Could not mark items read.");
    } finally {
      setIsMarkingRead(false);
    }
  }

  const activeFeed = READER_FEEDS.find((feed) => feed.id === selection.feed) || READER_FEEDS[0];
  const activeView = READER_VIEWS.find((view) => view.id === selection.view) || READER_VIEWS[0];
  const moreItems = moreExpanded ? page.grouped.more : [];
  const actionableOffset = page.grouped.top.length;
  const worthOffset = actionableOffset + page.grouped.actionable.length;
  const moreOffset = worthOffset + page.grouped.worthKnowing.length;

  return (
    <>
      {briefingSlot}
      {digestSlot}

      <section className="grid gap-2 border-y py-2" aria-label="Reading controls">
        <div className="grid grid-cols-3 gap-1.5" aria-label="Feed ranking">
          {FEED_SORTS.map((sort) => (
            <Button key={sort} type="button" size="sm" variant={selection.sort === sort ? "default" : "outline"} onClick={() => changeSelection({ sort })}>
              {SORT_LABELS[sort]}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <Button type="button" variant={openFilter === "feed" ? "secondary" : "outline"} size="sm" className="min-w-0 justify-between" aria-expanded={openFilter === "feed"} onClick={() => setOpenFilter((value) => value === "feed" ? null : "feed")}>
            <span className="truncate">{activeFeed.label}</span>
            <span className="flex items-center gap-1 tabular-nums">{page.feedCounts[selection.feed] || 0}<ChevronDown className="size-3" aria-hidden="true" /></span>
          </Button>
          <Button type="button" variant={openFilter === "view" ? "secondary" : "outline"} size="sm" className="min-w-0 justify-between" aria-expanded={openFilter === "view"} onClick={() => setOpenFilter((value) => value === "view" ? null : "view")}>
            <span className="truncate">{activeView.label}</span>
            <span className="flex items-center gap-1 tabular-nums">{page.viewCounts[selection.view] || 0}<ChevronDown className="size-3" aria-hidden="true" /></span>
          </Button>
        </div>

        {openFilter === "feed" ? (
          <nav className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted/20 p-1" aria-label="Category feeds">
            {READER_FEEDS.map((feed) => (
              <Button key={feed.id} type="button" size="sm" variant={selection.feed === feed.id ? "default" : "ghost"} className="justify-between" onClick={() => changeSelection({ feed: feed.id })}>
                <span>{feed.label}</span><span className="tabular-nums opacity-70">{page.feedCounts[feed.id] || 0}</span>
              </Button>
            ))}
          </nav>
        ) : null}

        {openFilter === "view" ? (
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted/20 p-1" aria-label="Item filters">
            {READER_VIEWS.map((view) => (
              <Button key={view.id} type="button" size="sm" variant={selection.view === view.id ? "default" : "ghost"} className="justify-between" onClick={() => changeSelection({ view: view.id })}>
                <span>{view.label}</span><span className="tabular-nums opacity-70">{page.viewCounts[view.id] || 0}</span>
              </Button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1.5" aria-label="Feed period">
          {FEED_PERIODS.map((period) => (
            <Button key={period} type="button" size="sm" variant={selection.period === period ? "secondary" : "ghost"} onClick={() => changeSelection({ period })}>
              {PERIOD_LABELS[period]}
            </Button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="outline" size="sm" disabled={isMarkingRead || !visibleUnreadItems.length} onClick={() => void markVisibleAsRead()}>
            {isMarkingRead ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCheck aria-hidden="true" />} Mark read
          </Button>
          <Button type="button" variant={selection.view === "unread" ? "secondary" : "outline"} size="sm" onClick={() => changeSelection({ view: selection.view === "unread" ? "all" : "unread" })}>
            <EyeOff aria-hidden="true" /> Hide read
          </Button>
          {isLoading ? <span className="text-xs text-muted-foreground" role="status">Updating…</span> : null}
        </div>
        {error ? <span className="text-xs text-destructive" role="alert">{error}</span> : null}
      </section>

      <div className={cn("grid gap-4 transition-opacity", isLoading && "pointer-events-none opacity-60")}>
        {items.length ? (
          <>
            <NewsFeedSection exposureContextId={page.rankingContextId} label="Top stories" items={page.grouped.top} rankOffset={0} onExposure={trackExposure} onFeedbackChange={updateFeedback} onItemStateChange={updateItemState} onFastRead={(item, rank) => trackInteraction("fast_read", item, rank)} onSourceOpen={(item, rank) => trackInteraction("source_open", item, rank, sourceAttributionMetadata(item))} />
            <NewsFeedSection exposureContextId={page.rankingContextId} label="Act on this" items={page.grouped.actionable} rankOffset={actionableOffset} onExposure={trackExposure} onFeedbackChange={updateFeedback} onItemStateChange={updateItemState} onFastRead={(item, rank) => trackInteraction("fast_read", item, rank)} onSourceOpen={(item, rank) => trackInteraction("source_open", item, rank, sourceAttributionMetadata(item))} />
            <NewsFeedSection exposureContextId={page.rankingContextId} label="Worth knowing" items={page.grouped.worthKnowing} rankOffset={worthOffset} onExposure={trackExposure} onFeedbackChange={updateFeedback} onItemStateChange={updateItemState} onFastRead={(item, rank) => trackInteraction("fast_read", item, rank)} onSourceOpen={(item, rank) => trackInteraction("source_open", item, rank, sourceAttributionMetadata(item))} />
            {page.grouped.more.length ? (
              <section className="grid gap-2">
                <Button type="button" variant="outline" onClick={() => setMoreExpanded((value) => !value)}>{moreExpanded ? "Hide more stories" : `Show ${page.grouped.more.length} more stories`}</Button>
                <NewsFeedSection exposureContextId={page.rankingContextId} label="More stories" items={moreItems} rankOffset={moreOffset} onExposure={trackExposure} onFeedbackChange={updateFeedback} onItemStateChange={updateItemState} onFastRead={(item, rank) => trackInteraction("fast_read", item, rank)} onSourceOpen={(item, rank) => trackInteraction("source_open", item, rank, sourceAttributionMetadata(item))} />
              </section>
            ) : null}
            {page.nextCursor ? <Button type="button" variant="outline" disabled={isLoading} onClick={() => void loadFeed(selection, page.nextCursor, true)}>Load more</Button> : null}
          </>
        ) : (
          <Card><CardContent className="flex items-center gap-3 text-muted-foreground"><Inbox className="size-5" aria-hidden="true" /><p className="text-sm">No stories match this view.</p></CardContent></Card>
        )}
      </div>
    </>
  );
}
