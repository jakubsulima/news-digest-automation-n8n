import type { ReaderFeedId } from "./feed-categories";
import type { ReaderViewId } from "./reader-feed-filters";
import type { FeedPeriod, FeedSort } from "./reader-feed-ranking";

export const NEWS_LIST_HREF_STORAGE_KEY = "reader-news-list-href-v1";
export const NEWS_LIST_STATE_STORAGE_KEY = "reader-news-list-state-v1";
export const NEWS_LIST_HREF_EVENT = "reader-news-list-href-change";

const FEEDS = new Set<ReaderFeedId>(["all", "geopolitics", "business", "ai", "software", "security"]);
const VIEWS = new Set<ReaderViewId>(["all", "unread", "saved", "archived"]);
const SORTS = new Set<FeedSort>(["for-you", "latest", "top"]);
const PERIODS = new Set<FeedPeriod>(["history", "latest", "since-visit"]);

export type NewsListSelection = {
  feed: ReaderFeedId;
  period: FeedPeriod;
  sort: FeedSort;
  view: ReaderViewId;
};

export function newsListHref(selection: NewsListSelection) {
  const params = new URLSearchParams();
  if (selection.feed !== "all") params.set("feed", selection.feed);
  if (selection.view !== "all") params.set("view", selection.view);
  if (selection.sort !== "for-you") params.set("sort", selection.sort);
  if (selection.period !== "latest") params.set("period", selection.period);
  const query = params.toString();
  return query ? `/news?${query}` : "/news";
}

export function normalizeNewsListHref(value: string | null | undefined) {
  if (!value || value.length > 500) return "/news";

  try {
    const url = new URL(value, "https://reader.local");
    if (url.origin !== "https://reader.local" || url.pathname !== "/news") return "/news";

    return newsListHref({
      feed: FEEDS.has(url.searchParams.get("feed") as ReaderFeedId)
        ? url.searchParams.get("feed") as ReaderFeedId
        : "all",
      period: PERIODS.has(url.searchParams.get("period") as FeedPeriod)
        ? url.searchParams.get("period") as FeedPeriod
        : "latest",
      sort: SORTS.has(url.searchParams.get("sort") as FeedSort)
        ? url.searchParams.get("sort") as FeedSort
        : "for-you",
      view: VIEWS.has(url.searchParams.get("view") as ReaderViewId)
        ? url.searchParams.get("view") as ReaderViewId
        : "all",
    });
  } catch {
    return "/news";
  }
}

export function newsDetailHref(itemId: string, returnHref: string) {
  const params = new URLSearchParams({ from: normalizeNewsListHref(returnHref) });
  return `/news/${encodeURIComponent(itemId)}?${params}`;
}

export function rememberNewsListHref(href: string) {
  if (typeof window === "undefined") return;
  const normalizedHref = normalizeNewsListHref(href);
  try {
    window.sessionStorage.setItem(NEWS_LIST_HREF_STORAGE_KEY, normalizedHref);
  } catch {
    // Navigation still works when session storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(NEWS_LIST_HREF_EVENT, { detail: normalizedHref }));
}

export function rememberedNewsListHref() {
  if (typeof window === "undefined") return "/news";
  try {
    return normalizeNewsListHref(window.sessionStorage.getItem(NEWS_LIST_HREF_STORAGE_KEY));
  } catch {
    return "/news";
  }
}
