"use client";

import { Inbox } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { NewsCardSkeleton } from "@/components/news-card-skeleton";
import { NewsItemCard } from "@/components/news-item-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  itemMatchesReaderFeed,
  READER_FEEDS,
  readerFeedForCategory,
  type ReaderFeedId,
} from "@/lib/feed-categories";
import type { NewsItemWithState } from "@/lib/news";

type NewsFeedProps = {
  digestSlot: ReactNode;
  initialFeed: ReaderFeedId;
  initialItems: NewsItemWithState[];
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

export function NewsFeed({ digestSlot, initialFeed, initialItems }: NewsFeedProps) {
  const [activeFeed, setActiveFeed] = useState(initialFeed);
  const [items, setItems] = useState(initialItems);
  const [isSwitchingFeed, setIsSwitchingFeed] = useState(false);
  const switchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setActiveFeed(initialFeed);
    setItems(initialItems);
  }, [initialFeed, initialItems]);

  const unarchivedItems = useMemo(() => items.filter((item) => !item.archivedAt), [items]);
  const visibleItems = useMemo(
    () => unarchivedItems.filter((item) => itemMatchesReaderFeed(item.category, activeFeed)),
    [activeFeed, unarchivedItems],
  );
  const feedCounts = useMemo(() => {
    const counts = new Map(READER_FEEDS.map((feed) => [feed.id, feed.id === "all" ? unarchivedItems.length : 0]));

    for (const item of unarchivedItems) {
      const feed = readerFeedForCategory(item.category);
      counts.set(feed, (counts.get(feed) || 0) + 1);
    }

    return counts;
  }, [unarchivedItems]);
  const unreadCount = visibleItems.filter((item) => !item.readAt).length;
  const savedCount = visibleItems.filter((item) => item.savedAt).length;

  useEffect(() => {
    return () => {
      if (switchTimerRef.current) {
        window.clearTimeout(switchTimerRef.current);
      }
    };
  }, []);

  function selectFeed(feedId: ReaderFeedId) {
    if (feedId === activeFeed) {
      return;
    }

    setActiveFeed(feedId);
    setIsSwitchingFeed(true);

    if (switchTimerRef.current) {
      window.clearTimeout(switchTimerRef.current);
    }

    switchTimerRef.current = window.setTimeout(() => {
      setIsSwitchingFeed(false);
    }, FEED_SWITCH_SKELETON_MS);

    const nextPath = feedId === "all" ? "/" : `/?feed=${feedId}`;
    window.history.replaceState(null, "", nextPath);
  }

  function updateItemState(
    itemId: string,
    state: Pick<NewsItemWithState, "archivedAt" | "readAt" | "savedAt">,
  ) {
    setItems((currentItems) =>
      currentItems.map((item) => (item.id === itemId ? { ...item, ...state } : item)),
    );
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
            <NewsItemCard key={item.id} item={item} onItemStateChange={updateItemState} />
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
