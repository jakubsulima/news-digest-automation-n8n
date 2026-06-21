export const READER_FEEDS = [
  { id: "all", label: "All" },
  { id: "geopolitics", label: "Geopolitics" },
  { id: "business", label: "Business" },
  { id: "ai", label: "AI" },
  { id: "software", label: "Software" },
  { id: "security", label: "Security" },
] as const;

export type ReaderFeedId = (typeof READER_FEEDS)[number]["id"];

const FEED_IDS = new Set<ReaderFeedId>(READER_FEEDS.map((feed) => feed.id));

export function normalizeReaderFeedId(value: string | string[] | undefined): ReaderFeedId {
  const id = Array.isArray(value) ? value[0] : value;

  return id && FEED_IDS.has(id as ReaderFeedId) ? (id as ReaderFeedId) : "all";
}

export function readerFeedForCategory(category: string): Exclude<ReaderFeedId, "all"> {
  const normalized = category.toLowerCase();

  if (normalized.includes("cyber") || normalized.includes("security") || normalized.includes("bezpieczeństwo")) {
    return "security";
  }

  if (
    normalized.includes("ważne wydarzenia") ||
    normalized.includes("geopol") ||
    normalized.includes("politics") ||
    normalized.includes("world")
  ) {
    return "geopolitics";
  }

  if (normalized.includes("ai") || normalized.includes("sztuczna inteligencja")) {
    return "ai";
  }

  if (
    normalized.includes("software") ||
    normalized.includes("devtools") ||
    normalized.includes("engineering") ||
    normalized.includes("status")
  ) {
    return "software";
  }

  if (
    normalized.includes("gospodarka") ||
    normalized.includes("giełda") ||
    normalized.includes("biznes") ||
    normalized.includes("business") ||
    normalized.includes("makro") ||
    normalized.includes("market") ||
    normalized.includes("rynk") ||
    normalized.includes("bank centralny") ||
    normalized.includes("regulator") ||
    normalized.includes("energy")
  ) {
    return "business";
  }

  return "geopolitics";
}

export function itemMatchesReaderFeed(category: string, feedId: ReaderFeedId) {
  return feedId === "all" || readerFeedForCategory(category) === feedId;
}
