import { itemMatchesReaderFeed, type ReaderFeedId } from "./feed-categories";
import type { NewsItemWithState } from "./news";

export const READER_VIEWS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "saved", label: "Saved" },
  { id: "archived", label: "Archived" },
] as const;

export type ReaderViewId = (typeof READER_VIEWS)[number]["id"];
export type ReaderDensity = "comfortable" | "compact";

const VIEW_IDS = new Set<ReaderViewId>(READER_VIEWS.map((view) => view.id));

export function normalizeReaderViewId(value: string | string[] | undefined): ReaderViewId {
  const id = Array.isArray(value) ? value[0] : value;

  return id && VIEW_IDS.has(id as ReaderViewId) ? (id as ReaderViewId) : "all";
}

export function normalizeReaderDensity(value: string | string[] | undefined): ReaderDensity {
  const id = Array.isArray(value) ? value[0] : value;

  return id === "compact" ? "compact" : "comfortable";
}

export function itemMatchesReaderView(item: NewsItemWithState, viewId: ReaderViewId) {
  if (viewId === "archived") {
    return Boolean(item.archivedAt);
  }

  if (item.archivedAt) {
    return false;
  }

  if (viewId === "unread") {
    return !item.readAt;
  }

  if (viewId === "saved") {
    return Boolean(item.savedAt);
  }

  return true;
}

export function filterReaderItems(items: NewsItemWithState[], feedId: ReaderFeedId, viewId: ReaderViewId) {
  return items.filter((item) => itemMatchesReaderFeed(item.category, feedId) && itemMatchesReaderView(item, viewId));
}
