"use client";

import { CheckCheck, EyeOff, Inbox, Rows3 } from "lucide-react";
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
  type ReaderDensity,
  type ReaderViewId,
} from "@/lib/reader-feed-filters";
import type { NewsItemWithState } from "@/lib/news";
import type { FeedbackSentiment } from "@/lib/reader-feedback";

type NewsFeedProps = {
  digestSlot: ReactNode;
  initialDensity: ReaderDensity;
  initialFeed: ReaderFeedId;
  initialItems: NewsItemWithState[];
  initialView: ReaderViewId;
};

const FEED_SWITCH_SKELETON_MS = 120;

function FeedStat({ label, value }: { label: string; value: number }) {
  return (
    <Card size="sm" className="bg-card/80 transition-colors duration-200">
      <CardContent className="grid gap-1">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </CardContent>
    </Card>
  );
}

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
  initialDensity,
  initialFeed,
  initialItems,
  initialView,
}: NewsFeedProps) {
  const [activeFeed, setActiveFeed] = useState(initialFeed);
  const [activeView, setActiveView] = useState(initialView);
  const [density, setDensity] = useState(initialDensity);
  const [items, setItems] = useState(initialItems);
  const [isSwitchingFeed, setIsSwitchingFeed] = useState(false);
  const [isMarkingRead, setIsMarkingRead] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const switchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setActiveFeed(initialFeed);
    setActiveView(initialView);
    setDensity(initialDensity);
    setItems(initialItems);
  }, [initialDensity, initialFeed, initialItems, initialView]);

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
  const unreadCount = visibleItems.filter((item) => !item.readAt).length;
  const savedCount = visibleItems.filter((item) => item.savedAt).length;
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

  function writeUrl(nextFeed: ReaderFeedId, nextView: ReaderViewId, nextDensity: ReaderDensity) {
    const params = new URLSearchParams();

    if (nextFeed !== "all") {
      params.set("feed", nextFeed);
    }
    if (nextView !== "all") {
      params.set("view", nextView);
    }
    if (nextDensity === "compact") {
      params.set("density", nextDensity);
    }

    const query = params.toString();
    window.history.replaceState(null, "", query ? `/?${query}` : "/");
  }

  function selectFeed(feedId: ReaderFeedId) {
    if (feedId === activeFeed) {
      return;
    }

    setActiveFeed(feedId);
    scheduleSkeleton();
    writeUrl(feedId, activeView, density);
  }

  function selectView(viewId: ReaderViewId) {
    if (viewId === activeView) {
      return;
    }

    setActiveView(viewId);
    scheduleSkeleton();
    writeUrl(activeFeed, viewId, density);
  }

  function toggleDensity() {
    const nextDensity = density === "compact" ? "comfortable" : "compact";

    setDensity(nextDensity);
    writeUrl(activeFeed, activeView, nextDensity);
  }

  function toggleHideRead() {
    const nextView = activeView === "unread" ? "all" : "unread";

    setActiveView(nextView);
    scheduleSkeleton();
    writeUrl(activeFeed, nextView, density);
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

  return (
    <>
      <section className="grid gap-2 sm:grid-cols-3" aria-label="Feed stats">
        <FeedStat label="In feed" value={visibleItems.length} />
        <FeedStat label="Unread" value={unreadCount} />
        <FeedStat label="Saved" value={savedCount} />
      </section>

      <nav className="flex flex-wrap gap-2" aria-label="Category feeds">
        {READER_FEEDS.map((feed) => {
          const isActive = feed.id === activeFeed;

          return (
            <Button
              key={feed.id}
              variant={isActive ? "default" : "outline"}
              size="lg"
              type="button"
              className={!isActive ? "text-muted-foreground" : undefined}
              aria-current={isActive ? "page" : undefined}
              onClick={() => selectFeed(feed.id)}
            >
              <span>{feed.label}</span>
              <span className="tabular-nums opacity-80">{feedCounts.get(feed.id) || 0}</span>
            </Button>
          );
        })}
      </nav>

      <section className="grid gap-3 border-y py-3" aria-label="Reading controls">
        <div className="flex flex-wrap gap-2">
          {READER_VIEWS.map((view) => {
            const isActive = view.id === activeView;

            return (
              <Button
                key={view.id}
                variant={isActive ? "default" : "outline"}
                size="lg"
                type="button"
                className={!isActive ? "text-muted-foreground" : undefined}
                aria-current={isActive ? "page" : undefined}
                onClick={() => selectView(view.id)}
              >
                <span>{view.label}</span>
                <span className="tabular-nums opacity-80">{viewCounts.get(view.id) || 0}</span>
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={isMarkingRead || !visibleUnreadItems.length}
            onClick={() => void markVisibleAsRead()}
          >
            <CheckCheck aria-hidden="true" />
            Mark visible read
          </Button>
          <Button
            type="button"
            variant={activeView === "unread" ? "secondary" : "outline"}
            size="lg"
            onClick={toggleHideRead}
          >
            <EyeOff aria-hidden="true" />
            Hide read
          </Button>
          <Button type="button" variant={density === "compact" ? "secondary" : "outline"} size="lg" onClick={toggleDensity}>
            <Rows3 aria-hidden="true" />
            Compact
          </Button>
          {batchError ? <span className="text-xs text-destructive">{batchError}</span> : null}
        </div>
      </section>

      {digestSlot}

      {isSwitchingFeed ? (
        <section className="grid gap-3" aria-label="Loading selected feed">
          {Array.from({ length: skeletonCount }).map((_, index) => (
            <NewsCardSkeleton key={index} />
          ))}
        </section>
      ) : visibleItems.length ? (
        <section className="grid gap-3" aria-label="News feed">
          {visibleItems.map((item) => (
            <NewsItemCard
              key={item.id}
              density={density}
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
