"use client";

import { CheckCheck, ChevronDown, EyeOff, Inbox } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { NewsCardSkeleton } from "@/components/news-card-skeleton";
import { NewsItemCard } from "@/components/news-item-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { READER_FEEDS, readerFeedForCategory, type ReaderFeedId } from "@/lib/feed-categories";
import {
  filterReaderItems,
  itemMatchesReaderView,
  READER_VIEWS,
  type ReaderViewId,
} from "@/lib/reader-feed-filters";
import type { NewsItemWithState } from "@/lib/news";
import type { FeedbackSentiment } from "@/lib/reader-feedback";
import { cn } from "@/lib/utils";

type NewsFeedProps = {
  digestSlot: ReactNode;
  initialFeed: ReaderFeedId;
  initialItems: NewsItemWithState[];
  initialView: ReaderViewId;
};

const FEED_SWITCH_SKELETON_MS = 120;

async function apiBatchRead(itemIds: string[]) {
  return fetch("/api/news-items/state", {
    body: JSON.stringify({ action: "read", enabled: true, itemIds }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
}

export function NewsFeed({
  digestSlot,
  initialFeed,
  initialItems,
  initialView,
}: NewsFeedProps) {
  const [activeFeed, setActiveFeed] = useState(initialFeed);
  const [activeView, setActiveView] = useState(initialView);
  const [openFilter, setOpenFilter] = useState<"feed" | "view" | null>(null);
  const [items, setItems] = useState(initialItems);
  const [isSwitchingFeed, setIsSwitchingFeed] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const switchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setActiveFeed(initialFeed);
    setActiveView(initialView);
    setItems(initialItems);
  }, [initialFeed, initialItems, initialView]);

  const visibleItems = useMemo(() => filterReaderItems(items, activeFeed, activeView), [activeFeed, activeView, items]);
  const feedCounts = useMemo(() => {
    const viewItems = items.filter((item) => itemMatchesReaderView(item, activeView));
    const counts = new Map(READER_FEEDS.map((feed) => [feed.id, feed.id === "all" ? viewItems.length : 0]));

    for (const item of viewItems) {
      const feed = readerFeedForCategory(item.category);
      counts.set(feed, (counts.get(feed) || 0) + 1);
    }

    return counts;
  }, [activeView, items]);
  const viewCounts = useMemo(() => {
    const feedItems = items.filter((item) => activeFeed === "all" || readerFeedForCategory(item.category) === activeFeed);

    return new Map(READER_VIEWS.map((view) => [view.id, feedItems.filter((item) => itemMatchesReaderView(item, view.id)).length]));
  }, [activeFeed, items]);
  const visibleUnreadItems = visibleItems.filter((item) => !item.readAt);

  useEffect(() => {
    return () => {
      if (switchTimerRef.current) {
        window.clearTimeout(switchTimerRef.current);
      }
    };
  }, []);

  function scheduleSkeleton() {
    setIsSwitchingFeed(true);

    if (switchTimerRef.current) {
      window.clearTimeout(switchTimerRef.current);
    }

    switchTimerRef.current = window.setTimeout(() => {
      setIsSwitchingFeed(false);
    }, FEED_SWITCH_SKELETON_MS);
  }

  function writeUrl(nextFeed: ReaderFeedId, nextView: ReaderViewId) {
    const params = new URLSearchParams();

    if (nextFeed !== "all") {
      params.set("feed", nextFeed);
    }
    if (nextView !== "all") {
      params.set("view", nextView);
    }

    const query = params.toString();
    window.history.replaceState(null, "", query ? `/?${query}` : "/");
  }

  function selectFeed(feedId: ReaderFeedId) {
    setOpenFilter(null);

    if (feedId === activeFeed) {
      return;
    }

    setActiveFeed(feedId);
    scheduleSkeleton();
    writeUrl(feedId, activeView);
  }

  function selectView(viewId: ReaderViewId) {
    setOpenFilter(null);

    if (viewId === activeView) {
      return;
    }

    setActiveView(viewId);
    scheduleSkeleton();
    writeUrl(activeFeed, viewId);
  }

  function toggleHideRead() {
    const nextView = activeView === "unread" ? "all" : "unread";

    setActiveView(nextView);
    scheduleSkeleton();
    writeUrl(activeFeed, nextView);
  }

  function updateItemState(
    itemId: string,
    state: Pick<NewsItemWithState, "archivedAt" | "readAt" | "savedAt">,
  ) {
    setItems((currentItems) =>
      currentItems.map((item) => (item.id === itemId ? { ...item, ...state } : item)),
    );
  }

  function updateFeedback(itemId: string, feedback: FeedbackSentiment | null) {
    setItems((currentItems) => currentItems.map((item) => (item.id === itemId ? { ...item, feedback } : item)));
  }

  async function markVisibleAsRead() {
    if (isMarkingRead || !visibleUnreadItems.length) {
      return;
    }

    const itemIds = visibleUnreadItems.map((item) => item.id);
    const itemIdSet = new Set(itemIds);
    const previousItems = items;
    const readAt = new Date().toISOString();

    setBatchError(null);
    setIsMarkingRead(true);
    setItems((currentItems) =>
      currentItems.map((item) => (itemIdSet.has(item.id) ? { ...item, readAt: item.readAt ?? readAt } : item)),
    );

    try {
      const response = await apiBatchRead(itemIds);
      const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Could not mark items read.");
      }
    } catch (error) {
      setItems(previousItems);
      setBatchError(error instanceof Error ? error.message : "Could not mark items read.");
    } finally {
      setIsMarkingRead(false);
    }
  }

  const skeletonCount = Math.min(Math.max(visibleItems.length, 1), 3);
  const activeFeedOption = READER_FEEDS.find((feed) => feed.id === activeFeed) ?? READER_FEEDS[0];
  const activeViewOption = READER_VIEWS.find((view) => view.id === activeView) ?? READER_VIEWS[0];

  return (
    <>
      {digestSlot}

      <section className="grid gap-2 border-y py-2" aria-label="Reading controls">
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant={openFilter === "feed" ? "secondary" : "outline"}
            size="sm"
            className="h-8 min-w-0 justify-between gap-2 px-2.5"
            aria-expanded={openFilter === "feed"}
            onClick={() => setOpenFilter((current) => (current === "feed" ? null : "feed"))}
          >
            <span className="truncate">{activeFeedOption.label}</span>
            <span className="flex items-center gap-1 tabular-nums opacity-80">
              {feedCounts.get(activeFeed) || 0}
              <ChevronDown className={cn("size-3 transition-transform", openFilter === "feed" && "rotate-180")} aria-hidden="true" />
            </span>
          </Button>
          <Button
            type="button"
            variant={openFilter === "view" ? "secondary" : "outline"}
            size="sm"
            className="h-8 min-w-0 justify-between gap-2 px-2.5"
            aria-expanded={openFilter === "view"}
            onClick={() => setOpenFilter((current) => (current === "view" ? null : "view"))}
          >
            <span className="truncate">{activeViewOption.label}</span>
            <span className="flex items-center gap-1 tabular-nums opacity-80">
              {viewCounts.get(activeView) || 0}
              <ChevronDown className={cn("size-3 transition-transform", openFilter === "view" && "rotate-180")} aria-hidden="true" />
            </span>
          </Button>
        </div>

        {openFilter === "feed" ? (
          <nav className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted/20 p-1" aria-label="Category feeds">
            {READER_FEEDS.map((feed) => {
              const isActive = feed.id === activeFeed;

              return (
                <Button
                  key={feed.id}
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  type="button"
                  className={cn("h-7 min-w-0 justify-between gap-2 px-2", !isActive && "text-muted-foreground")}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => selectFeed(feed.id)}
                >
                  <span className="truncate">{feed.label}</span>
                  <span className="tabular-nums opacity-75">{feedCounts.get(feed.id) || 0}</span>
                </Button>
              );
            })}
          </nav>
        ) : null}

        {openFilter === "view" ? (
          <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-muted/20 p-1" aria-label="Item filters">
            {READER_VIEWS.map((view) => {
              const isActive = view.id === activeView;

              return (
                <Button
                  key={view.id}
                  variant={isActive ? "default" : "ghost"}
                  size="sm"
                  type="button"
                  className={cn("h-7 min-w-0 justify-between gap-2 px-2", !isActive && "text-muted-foreground")}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => selectView(view.id)}
                >
                  <span className="truncate">{view.label}</span>
                  <span className="tabular-nums opacity-80">{viewCounts.get(view.id) || 0}</span>
                </Button>
              );
            })}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              disabled={isMarkingRead || !visibleUnreadItems.length}
              onClick={() => void markVisibleAsRead()}
            >
              <CheckCheck aria-hidden="true" />
              Mark read
            </Button>
            <Button
              type="button"
              variant={activeView === "unread" ? "secondary" : "outline"}
              size="sm"
              className="h-7"
              onClick={toggleHideRead}
            >
              <EyeOff aria-hidden="true" />
              Hide read
            </Button>
        </div>
        {batchError ? <span className="text-xs text-destructive">{batchError}</span> : null}
      </section>

      {isSwitchingFeed ? (
        <section className="grid gap-2" aria-label="Loading selected feed">
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <NewsCardSkeleton key={index} />
          ))}
        </section>
      ) : visibleItems.length ? (
        <section className="grid gap-2" aria-label="News feed">
          {visibleItems.map((item, index) => (
            <NewsItemCard
              key={`${item.id}-${index}`}
              density="compact"
              item={item}
              onFeedbackChange={updateFeedback}
              onItemStateChange={updateItemState}
            />
          ))}
        </section>
      ) : (
        <Card>
          <CardContent className="flex items-center gap-3 text-muted-foreground">
            <Inbox className="size-5" aria-hidden="true" />
            <p className="text-sm">No items yet.</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
